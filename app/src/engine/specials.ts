// Special events (plan.md §10.2, 2026-10-16/17): turning points your path leads to.
//   charity        a Sub who has been had for free again and again opens her door to every
//                  man who wants her, for free. It runs day after day until you end it; every
//                  regular who comes (now or while it runs) turns freeloader, creep and
//                  misogynist, and old money walks out;
//   routingError   anyone, rarely: the site mixed up a subscriber. Swap one of your regulars (dormant ones too)
//                  for a new fan of the kind you pick, who keeps his loyalty;
//   humanAtm       a Dominatrix's submissive old-money regular at loyalty 4+ sends $5,000 a day
//                  for three days; then the news (humanAtmArrest): he was laundering money,
//                  he is gone, and the money stays with you. Meanwhile he has no customs or
//                  meetups with you (eventEffects.ts heldByEvent);
//   marryMe        an e-girl's obsessed stalker at loyalty 5 proposes. Say yes and he is your
//                  fiancé; a month later the honeymoon fund starts (honeymoonFund), then the
//                  wedding invitation (saveTheDate);
//   brandFollowUp  two weeks after you take a Brand Deal (engine/events.ts), how the product
//                  did off your #ad: rolled from that product's own odds (events.json
//                  rare.brandDeal.products.<key>.followUp). Mostly sold well or so-so, with a
//                  bonus from the brand; the podcast brings its listeners over for a week;
//                  innocent.zip can get one of your subscribers arrested, and haters come.
// Each rolled kind has its own daily chance once its conditions are met (GATES; presets/
// events.json special.<kind>.chance) and its own repeat rule; chained kinds are never rolled:
// an earlier one schedules them (status 'scheduled') and they open on their day. Each pops up
// when it comes, like a rare event (2026-10-17): one that just runs for a few days (Human ATM,
// the honeymoon fund) has a single button and runs on once you click it (status 'active'),
// paying out from the start either way. The fan
// messages they bring are written by the model (intent `event`, llm/fanMessage.ts).
import audience from '../presets/audience.json'
import E from '../presets/events.json'
import { type Account, type DayEvent, type EngineEvent, type Intent, type Post, type Regular, SEGMENTS, type Segment } from '../store/schema'
import { awayNow, hasCondition, withCondition } from './conditions'
import { ContentError } from './content'
import { platformFee } from './directions'
import { paymentLine as line } from './economy'
import { eventOn } from './eventEffects'
import { pickWeighted } from './comments'
import { addLoyalty, loyaltyLevel } from './fans'
import { blockFan, turnOnYou } from './incidents'
import { withBehaviour } from './personas'
import { arrivingRegular } from './regulars'
import { type Rng, rngFor } from './rng'
import { addFanMessage, threadOf, updateRegular } from './threads'

export const SPECIAL_KINDS = ['charity', 'routingError', 'humanAtm', 'humanAtmArrest', 'marryMe', 'honeymoonFund', 'saveTheDate', 'brandFollowUp'] as const
export type SpecialKind = (typeof SPECIAL_KINDS)[number]

type After = { days: number; effects: Record<string, number | Record<string, number>> }
/** A rare or special event's words, options and odds (presets/events.json). */
export type EventSpec = {
  title: string
  text: string
  days: number
  default: string
  /** `pick`: you also pick a fan and a fan type for it (Routing Error). */
  options: Record<string, { label: string; help: string; pick?: boolean }>
  odds: Record<string, number>
  results: Record<string, string>
  after?: Record<string, After>
  /** Special: the daily chance once its conditions are met; days before it can come again (null: once); never rolled (chained). */
  chance?: number
  repeatDays?: number | null
  chained?: boolean
  /** While it runs: what the Home card says, and the button that ends it (The Charity). */
  progress?: string
  endLabel?: string
  /** It arrives as an email (Routing Error): the popup shows it as one; `text` is the one-line notice on Home. */
  email?: { from: string; to: string; subject: string; body: string }
}
const S = E.special
export const SPECIAL = S as unknown as Record<SpecialKind, EventSpec>
export const isSpecial = (kind: string): kind is SpecialKind => (SPECIAL_KINDS as readonly string[]).includes(kind)
/** The `until` of an event that runs until you end it. */
const FOREVER = 1_000_000_000

export const reachable = (a: Account) => a.regulars.filter((r) => r.status === 'active' && !hasCondition(r, 'blocked'))
/** Everyone still yours, dormant or not (not blocked, not lying low): who Routing Error can swap. */
const current = (a: Account, day: number) => a.regulars.filter((r) => !awayNow(r, day))
export const friendly = (r: Regular) => !hasCondition(r, 'hostile')

/** Meetups where a man had you for free, for a few insulting dollars or for grovelling thanks (Meetup.terms). */
export const freebies = (a: Account) => a.meetups.filter((m) => m.status === 'done' && m.terms && m.outcome !== 'noShow' && m.outcome !== 'wife').length

/** Human ATM: a submissive old-money man at loyalty 4 or more who has not turned on you. */
export const isHumanAtm = (r: Regular) => r.personality === 'submissive' && r.behaviours.includes('older_gentleman') && loyaltyLevel(r) >= 4 && friendly(r)
/** Marry Me?: an obsessed stalker at loyalty 5 who has not turned on you. */
export const isSuitor = (r: Regular) => r.behaviours.includes('obsessive') && r.behaviours.includes('stalker') && loyaltyLevel(r) >= 5 && friendly(r)

/** Who a special event can be about (undefined: nobody in particular); empty when your path has not led there. */
const GATES: Partial<Record<SpecialKind, (a: Account, day: number) => (Regular | undefined)[]>> = {
  // Everyone knows her as the girl who never makes them pay. Once the doors have opened, never again.
  charity: (a) =>
    a.direction.id === 'sub' && freebies(a) >= S.charity.minFreebies && !a.dayEvents.some((e) => e.kind === 'charity' && e.choice === 'open') ? [undefined] : [],
  routingError: (a, day) => (current(a, day).length ? [undefined] : []),
  humanAtm: (a) => (a.direction.id === 'domme' ? reachable(a).filter(isHumanAtm) : []),
  marryMe: (a) => (a.direction.id === 'egirl' ? reachable(a).filter(isSuitor) : []),
}

/** Not too soon after the last one of its kind (or never again). */
function repeatOk(a: Account, kind: SpecialKind, day: number): boolean {
  const past = a.dayEvents.filter((e) => e.kind === kind && e.status !== 'scheduled')
  const days = SPECIAL[kind].repeatDays
  return days == null ? !past.length : !past.some((e) => e.day > day - days)
}

export type Opened = { account: Account; event: DayEvent; events: EngineEvent[] }

/** Today's special event, if one comes: every kind whose conditions are met rolls its own dice. */
export function rollSpecial(a: Account, seed: string, day: number): Opened | null {
  if (a.dayEvents.some((e) => e.status === 'open')) return null
  for (const kind of SPECIAL_KINDS) {
    const fans = GATES[kind]?.(a, day) ?? []
    if (!fans.length || !repeatOk(a, kind, day)) continue
    const rng = rngFor(seed, day, `special:${kind}`)
    if (rng() >= (SPECIAL[kind].chance ?? 0)) continue
    return openSpecial(rng, a, kind, fans[Math.floor(rng() * fans.length)], day)
  }
  return null
}

const dollars = (rng: Rng, [lo, hi]: number[]) => (lo + Math.floor(rng() * (hi - lo + 1))) * 100
const withEvent = (a: Account, e: DayEvent): Account => ({ ...a, dayEvents: a.dayEvents.map((x) => (x.id === e.id ? e : x)) })
const eventOf = (a: Account, id: string) => a.dayEvents.find((x) => x.id === id)!

/** He writes to you about it (the model puts it into words). */
const says = (a: Account, r: Regular, day: number, event: NonNullable<Intent['event']>) => addFanMessage(a, r.id, day, { kind: 'opener', event })

/** He sends you money with a message: a tip on the platform. */
function sends(a: Account, r: Regular, cents: number, day: number, event: NonNullable<Intent['event']>): { account: Account; events: EngineEvent[] } {
  let b = addFanMessage(a, r.id, day, { kind: 'opener', tip: cents, event }, cents)
  const id = threadOf(b, r.id).messages.at(-1)!.id
  const cur = b.regulars.find((x) => x.id === r.id)!
  b = updateRegular({ ...b, ledger: [...b.ledger, line(day, 'tip', id, cents, platformFee(b))] }, { ...cur, spent: cur.spent + cents })
  return { account: addLoyalty(b, r.id, 'tip'), events: [{ day, type: 'dm-tip', regularId: r.id, gross: cents }] }
}

/** His open customs and meetups are off (quietly: he is not upset about it). */
const callOff = (a: Account, regularId: string, day: number): Account => ({
  ...a,
  requests: a.requests.map((q) => (q.regularId === regularId && (q.status === 'open' || q.status === 'accepted') ? { ...q, status: 'expired' as const, closedDay: day } : q)),
  meetups: a.meetups.map((m) => (m.regularId === regularId && (m.status === 'open' || m.status === 'accepted') ? { ...m, status: 'cancelled' as const, closedDay: day } : m)),
})

/** A chained event, waiting for its day (with the earlier one's fan, and its variant: the Brand Deal's product). */
const schedule = (kind: SpecialKind, day: number, from: DayEvent): DayEvent => ({
  id: `${kind}-${day}-${from.id}`,
  kind,
  category: 'special',
  day,
  until: day + 1,
  status: 'scheduled',
  ...(from.regularId ? { regularId: from.regularId } : {}),
  ...(from.variant ? { variant: from.variant } : {}),
})

/** You took a Brand Deal (`deal`, its variant the product): two weeks on, how it sold. */
export const scheduleBrandFollowUp = (deal: DayEvent, day: number): DayEvent => schedule('brandFollowUp', day + S.brandFollowUp.afterDays, deal)

type FollowUp = Record<string, { chance: number; cents: number }>
const FOLLOW_UPS: Record<string, { followUp: FollowUp }> = E.rare.brandDeal.products

/** A post an event makes for you: the brand's #ad, the scene with the guest star, The Charity's doors. */
export function eventPost(a: Account, text: string, day: number): Post {
  return {
    id: `event-${day}-${a.posts.length}`,
    day,
    text,
    vaultIds: [],
    access: 'free',
    priceCents: 0,
    author: 'owner',
    stats: { views: 0, likes: 0, comments: 0, purchases: 0, earned: 0 },
  }
}

/** A special event starts today (`id`: a scheduled one keeps its own). What comes with it comes now. */
export function openSpecial(rng: Rng, a: Account, kind: SpecialKind, fan: Regular | undefined, day: number, id = `ev${day}`): Opened {
  const spec = SPECIAL[kind]
  let event: DayEvent = {
    id,
    kind,
    category: 'special',
    day,
    until: day + spec.days,
    status: Object.keys(spec.options).length ? 'open' : 'active',
    ...(fan ? { regularId: fan.id } : {}),
  }
  let b = a
  const events: EngineEvent[] = []
  const later: DayEvent[] = []
  switch (kind) {
    case 'humanAtm': {
      // The first $5,000 today, one each of the next two days (specialDay), then the news.
      // Whatever he had open with you is off, and he opens nothing new until then (deals.ts).
      b = callOff(b, fan!.id, day)
      const s = sends(b, fan!, S.humanAtm.tributeCents, day, { kind: 'humanAtm', step: 'tribute', id })
      b = s.account
      events.push(...s.events)
      event = { ...event, amountCents: S.humanAtm.tributeCents }
      later.push(schedule('humanAtmArrest', day + spec.days, event))
      break
    }
    case 'humanAtmArrest': {
      const atm = a.dayEvents.findLast((e) => e.kind === 'humanAtm' && e.regularId === fan?.id)
      event = { ...event, amountCents: atm?.amountCents ?? 0 }
      break
    }
    case 'marryMe':
      b = says(b, fan!, day, { kind: 'marryMe', step: 'proposal', id })
      break
    case 'honeymoonFund': {
      const cents = dollars(rng, S.honeymoonFund.transfer)
      const s = sends(b, fan!, cents, day, { kind: 'honeymoonFund', step: 'fund', id })
      b = s.account
      events.push(...s.events)
      event = { ...event, amountCents: cents }
      later.push(schedule('saveTheDate', day + S.honeymoonFund.saveTheDateAfterDays, event))
      break
    }
    case 'saveTheDate':
      b = says(b, fan!, day, { kind: 'saveTheDate', step: 'invite', id })
      break
  }
  return { account: { ...b, dayEvents: [...b.dayEvents, ...later] }, event, events }
}

/** He has written to you about this event already. */
const wrote = (a: Account, regularId: string, eventId: string) => threadOf(a, regularId).messages.some((m) => m.intent?.event?.id === eventId)

/**
 * The Charity: every regular who has not been through the door yet comes (those who are
 * blocked or lying low do not). He turns freeloader, misogynist and creep and writes to you
 * about it; old money says goodbye and blocks you.
 */
function charityQueue(a: Account, e: DayEvent, day: number): { account: Account; left: string[] } {
  let b = a
  const left: string[] = []
  for (const r of a.regulars) {
    if (awayNow(r, day) || wrote(b, r.id, e.id)) continue
    if (r.behaviours.includes('older_gentleman')) {
      b = blockFan(says(b, r, day, { kind: 'charity', step: 'left', id: e.id }), r.id, day, 'him')
      left.push(r.id)
    } else {
      b = updateRegular(b, withBehaviour({ ...r, segment: 'freeloader', personality: 'misogynist' }, 'creepy_compliments'))
      b = says(b, b.regulars.find((x) => x.id === r.id)!, day, { kind: 'charity', step: 'after', id: e.id })
    }
  }
  return { account: b, left }
}

const charityMen = (rng: Rng) => S.charity.men[0] + Math.floor(rng() * (S.charity.men[1] - S.charity.men[0] + 1))

/**
 * The start of a day, before anything is rolled: events that run for days do today's part
 * (The Charity's queue, Human ATM's $5,000, a honeymoon transfer), then a chained event whose
 * day has come opens, if nothing else is on or waiting for you (otherwise it waits).
 */
export function specialDay(a: Account, seed: string, day: number): { account: Account; events: EngineEvent[]; opened: DayEvent | null } {
  let b = a
  const events: EngineEvent[] = []
  for (const { id } of a.dayEvents) {
    const e = eventOf(b, id)
    if (e.category !== 'special') continue
    if (e.kind === 'charity' && e.status === 'active' && (e.closedDay ?? e.day) < day) {
      const q = charityQueue(b, e, day)
      const now = eventOf(q.account, id)
      b = withEvent(q.account, {
        ...now,
        count: (now.count ?? 0) + charityMen(rngFor(seed, day, `special:charity:${id}`)),
        days: (now.days ?? 1) + 1,
        ...(q.left.length ? { leftIds: [...(now.leftIds ?? []), ...q.left] } : {}),
      })
      continue
    }
    // The money keeps coming whether or not you have clicked its popup yet.
    if ((e.kind === 'humanAtm' || e.kind === 'honeymoonFund') && (e.status === 'active' || e.status === 'open') && e.day < day && day < e.until) {
      const r = b.regulars.find((x) => x.id === e.regularId)
      // He is gone (you blocked him): it stops.
      if (!r || awayNow(r, day)) {
        b = withEvent(b, { ...e, until: day })
        continue
      }
      const cents = e.kind === 'humanAtm' ? S.humanAtm.tributeCents : dollars(rngFor(seed, day, `special:${id}`), S.honeymoonFund.transfer)
      const s = sends(b, r, cents, day, { kind: e.kind, step: e.kind === 'humanAtm' ? 'tribute' : 'fund', id })
      b = withEvent(s.account, { ...eventOf(s.account, id), amountCents: (e.amountCents ?? 0) + cents })
      events.push(...s.events)
    }
  }

  // A chained event about a man who is gone (or no longer thinks he is engaged) is off.
  b = {
    ...b,
    dayEvents: b.dayEvents.filter((e) => {
      if (e.status !== 'scheduled' || e.day > day || !e.regularId) return true
      const r = b.regulars.find((x) => x.id === e.regularId)
      return !!r && !awayNow(r, day) && (e.kind === 'humanAtmArrest' || hasCondition(r, 'fiancee'))
    }),
  }
  const next = b.dayEvents.find((e) => e.status === 'scheduled' && e.day <= day)
  // The Charity's open doors do not count: they may stay open for good.
  const busy = b.dayEvents.some((e) => e.status === 'open' || (e.status !== 'scheduled' && e.day < day && e.until !== FOREVER && eventOn(e, day)))
  if (!next || busy) return { account: b, events, opened: null }
  const rest = { ...b, dayEvents: b.dayEvents.filter((x) => x.id !== next.id) }
  const o = openSpecial(rngFor(seed, day, `special:${next.id}`), rest, next.kind as SpecialKind, rest.regulars.find((x) => x.id === next.regularId), day, next.id)
  const opened = next.variant ? { ...o.event, variant: next.variant } : o.event
  return { account: { ...o.account, dayEvents: [...o.account.dayEvents, opened] }, events: [...events, ...o.events], opened }
}

/** Routing Error: who to swap, and for what kind of fan. */
export type SwapTarget = { regularId: string; segment: Segment }

export type Outcome = {
  account: Account
  result: string
  events: EngineEvent[]
  cents?: number
  about?: string
  /** Fields the event keeps besides the result (The Charity: it goes on running). */
  patch?: Partial<DayEvent>
}

/** How your choice on a special event turns out (`ok`: the roll against the choice's odds). */
export function settleSpecial(a: Account, e: DayEvent, choice: string, rng: Rng, ok: boolean, day: number, target?: SwapTarget): Outcome {
  const fan = a.regulars.find((x) => x.id === e.regularId)
  switch (e.kind as SpecialKind) {
    case 'charity': {
      if (choice !== 'open') return { account: a, result: 'declined', events: [] }
      const q = charityQueue(a, e, day)
      const b = { ...q.account, posts: [eventPost(q.account, S.charity.openPost, day), ...q.account.posts] }
      return {
        account: b,
        result: q.left.length ? 'openedRich' : 'opened',
        events: [],
        patch: { status: 'active', until: FOREVER, count: charityMen(rng), days: 1, ...(q.left.length ? { leftIds: q.left } : {}) },
      }
    }
    case 'routingError': {
      if (choice !== 'correct') return { account: a, result: 'declined', events: [] }
      const old = current(a, day).find((x) => x.id === target?.regularId)
      if (!old || !target) throw new ContentError('Pick one of your regulars')
      if (!SEGMENTS.includes(target.segment) || target.segment === old.segment) throw new ContentError('Pick a different kind of fan')
      // He goes to the creator he meant; the man who meant you takes his place, with his loyalty.
      const id = `r${day}-${a.regulars.length}`
      const fresh = { ...arrivingRegular(a, rng, id, target.segment, day, old.language), loyalty: old.loyalty }
      let b = blockFan(a, old.id, day, 'moved')
      b = { ...b, regulars: [...b.regulars, fresh], threads: [...b.threads, { regularId: id, read: 0, messages: [] }] }
      b = says(b, fresh, day, { kind: 'routingError', step: 'arrived', id: e.id })
      return { account: b, result: 'corrected', events: [{ day, type: 'regular', regularId: id }], about: id, patch: { leftIds: [old.id], variant: target.segment } }
    }
    case 'humanAtmArrest':
      return { account: fan ? blockFan(a, fan.id, day, 'arrested') : a, result: 'arrested', events: [], cents: e.amountCents ?? 0 }
    // You have seen it: it goes on running (the money comes every day, specialDay).
    case 'humanAtm':
    case 'honeymoonFund':
      return { account: a, result: 'running', events: [], patch: { status: 'active' } }
    case 'marryMe': {
      if (!fan) return { account: a, result: 'blocked', events: [] }
      if (choice === 'yes') {
        const cents = dollars(rng, S.marryMe.gift)
        const b = updateRegular(a, withCondition(fan, { id: 'fiancee', since: day }))
        const s = sends(b, fan, cents, day, { kind: 'marryMe', step: 'yes', id: e.id })
        return {
          account: { ...s.account, dayEvents: [...s.account.dayEvents, schedule('honeymoonFund', day + S.marryMe.honeymoonAfterDays, e)] },
          result: 'yes',
          events: s.events,
          cents,
        }
      }
      if (choice === 'delusional') {
        if (ok) {
          const b = updateRegular(a, { ...fan, behaviours: fan.behaviours.filter((x) => x !== 'obsessive') })
          return { account: says(b, fan, day, { kind: 'marryMe', step: 'deflated', id: e.id }), result: 'deflated', events: [] }
        }
        const t = turnOnYou(a, fan.id, day)
        return { account: t.account, result: 'enraged', events: t.events }
      }
      return { account: blockFan(a, fan.id, day), result: 'blocked', events: [] }
    }
    case 'saveTheDate': {
      if (!fan) return { account: a, result: 'therapist', events: [] }
      if (choice === 'mom') {
        const cents = dollars(rng, S.saveTheDate.gift)
        const s = sends(a, fan, cents, day, { kind: 'saveTheDate', step: 'mom', id: e.id })
        return { account: s.account, result: 'mom', events: s.events, cents }
      }
      return { account: says(a, fan, day, { kind: 'saveTheDate', step: 'therapist', id: e.id }), result: 'therapist', events: [] }
    }
    case 'brandFollowUp': {
      // How it sold, from the product's own odds; the brand pays its bonus directly (off the platform).
      const odds = (FOLLOW_UPS[e.variant ?? ''] ?? FOLLOW_UPS.girl_next_door).followUp
      const result = pickWeighted(rng, Object.fromEntries(Object.entries(odds).map(([r, o]) => [r, o.chance])))
      const cents = odds[result].cents
      if (!cents) return { account: a, result, events: [] }
      return { account: { ...a, ledger: [...a.ledger, line(day, 'offline', `${e.id}-brand`, cents, 0)] }, result, events: [], cents }
    }
    default:
      throw new ContentError('Not an option here')
  }
}

/** You close The Charity's doors: it ends today, and freeloaders keep turning up for a while. */
export function endCharity(a: Account, e: DayEvent, day: number): Account {
  if (e.kind !== 'charity' || e.status !== 'active') throw new ContentError('Nothing to end here')
  const done: DayEvent = {
    ...e,
    status: 'done',
    until: day + 1,
    closedDay: day,
    result: 'ended',
    after: { until: day + S.charity.afterDays, effects: S.charity.ongoing },
  }
  const post = eventPost(a, S.charity.endPost.replace('{count}', (e.count ?? 0).toLocaleString('en-US')), day)
  return { ...withEvent(a, done), posts: [post, ...a.posts] }
}

/** Routing Error: the regulars you could swap, and the kinds of fan you could have instead. */
export function swapChoices(a: Account): { fans: { id: string; name: string; type: Segment }[]; types: { id: Segment; label: string }[] } {
  return {
    fans: current(a, a.clock.day).map((r) => ({ id: r.id, name: r.name, type: r.segment })),
    types: SEGMENTS.map((s) => ({ id: s, label: audience.segments[s].label })),
  }
}
