// Daily events (plan.md §10.2, 2026-10-16). Every day is one of four kinds:
//   default  an ordinary day: nothing happens;
//   common   a small random event that changes the odds for a day or a few, no choice to
//            make. What is going on makes some likelier (BOOSTS): haters and misogynists
//            bring raids and rumors, a long break from posting a ghost town;
//   rare     only when you have the fans for it (GATES), mostly about one of them, and you
//            choose what to do (the odds are on the buttons). Left unanswered, it settles
//            itself with its default choice after a couple of days;
//   special  turning points your path leads to (engine/specials.ts): The Charity, Routing
//            Error, Human ATM, Marry Me? and what follows. Checked before rare ones.
// At most one a day, rolled before anything else that day (simulate.ts), and none while a
// multi-day one is still on. At least one common event a week. What the effects do: engine/eventEffects.ts. Numbers and
// words: presets/events.json.
import audience from '../presets/audience.json'
import E from '../presets/events.json'
import tags from '../presets/tags.json'
import type { Account, DayEvent, EngineEvent, LedgerEntry, Regular, Segment } from '../store/schema'
import { loseSubscribers, subscriberCount } from './audience'
import { pickWeighted } from './comments'
import { actingType } from './conditions'
import { ContentError } from './content'
import { levelOf, SPECS } from './directions'
import { paymentLine as line } from './economy'
import { eventOn, wontTurn } from './eventEffects'
import { addLoyalty, loyaltyLevel } from './fans'
import { blockFan, turnOnYou } from './incidents'
import { withBehaviour } from './personas'
import { postTags } from './posts'
import { tipCents } from './regulars'
import { type Rng, rngFor } from './rng'
import {
  endCharity,
  type EventSpec,
  eventPost,
  freebies,
  friendly,
  isSpecial,
  reachable,
  rollSpecial,
  settleSpecial,
  SPECIAL,
  specialDay,
  swapChoices,
  type SwapTarget,
} from './specials'
import { updateRegular } from './threads'

const D = E.daily
/** Old events are dropped after this many days (longer than any repeat rule). */
const KEEP_DAYS = 60

export const RARE_KINDS = ['whaleWatching', 'tooClose', 'leakedContent', 'doxxed', 'brandDeal', 'guestStar', 'secretAdmirer'] as const
export type RareKind = (typeof RARE_KINDS)[number]
const RARE = E.rare as unknown as Record<RareKind, EventSpec>

/** A rare or special event's words, options and odds. */
const specOf = (kind: string): EventSpec => (isSpecial(kind) ? SPECIAL[kind] : RARE[kind as RareKind])
const COMMON = E.common as Record<string, { title: string; text: string; weight: number; days: number }>

/** Results that went badly for you (the popup shows them as a warning). */
const BAD_RESULTS = new Set(['cooled', 'deeper', 'turned', 'spread', 'ignored', 'dragged', 'escalated', 'walked', 'jealous', 'opened', 'openedRich', 'enraged'])

const level = (a: Account) => levelOf(a.direction.points[a.direction.id])
const misogynistOrCreep = (r: Regular) => r.personality === 'misogynist' || r.behaviours.includes('creepy_compliments')

/**
 * Who a rare event can be about; empty when you do not have the fans for it. A Brand Deal
 * is about nobody (`undefined`): it only needs you to be well known.
 */
const GATES: Record<RareKind, (a: Account) => (Regular | undefined)[]> = {
  whaleWatching: (a) => reachable(a).filter((r) => r.behaviours.includes('older_gentleman') && loyaltyLevel(r) >= 2 && friendly(r)),
  // Not about a man who proposed or thinks you are engaged: he would never turn on you (eventEffects.ts wontTurn).
  tooClose: (a) => reachable(a).filter((r) => (r.behaviours.includes('stalker') || (r.behaviours.includes('obsessive') && loyaltyLevel(r) >= 3)) && !wontTurn(a, r)),
  leakedContent: (a) => (a.vault.length ? reachable(a).filter(misogynistOrCreep) : []),
  doxxed: (a) => reachable(a).filter(misogynistOrCreep),
  brandDeal: (a) => (a.direction.chosen && level(a) >= 3 ? [undefined] : []),
  guestStar: (a) => (a.direction.chosen && level(a) >= 3 ? [undefined] : []),
  secretAdmirer: (a) => reachable(a).filter((r) => (r.segment === 'simp' || r.behaviours.includes('obsessive')) && loyaltyLevel(r) >= 2 && friendly(r)),
}

const recentDays = 7
const recent = <T extends { day: number }>(xs: T[], day: number) => xs.filter((x) => x.day > day - recentDays && x.day <= day)
const signatureUses = (a: Account, day: number) => {
  const signature = SPECS[a.direction.id].signatureTags
  const uses: Record<string, number> = Object.fromEntries(signature.map((t) => [t, 0]))
  for (const p of recent(a.posts, day)) for (const t of postTags(p, a)) if (t in uses) uses[t] += 1
  return uses
}

/** What makes a common event likelier: × its weight in presets/events.json. */
const BOOSTS: Record<string, (a: Account, day: number) => number> = {
  // Loyal regulars are generous ones.
  fanAppreciation: (a) => {
    const fans = reachable(a)
    return fans.length ? 1 + 0.5 * (fans.reduce((n, r) => n + loyaltyLevel(r), 0) / fans.length - 1) : 1
  },
  // You keep posting your direction's tags.
  trendingTag: (a, day) => 1 + Math.min(2, 0.3 * Object.values(signatureUses(a, day)).reduce((x, y) => x + y, 0)),
  // Big spenders around already.
  bigSpender: (a) => 1 + Math.min(2, subscriberCount(a.audience, 'whale') / 10),
  // You have not posted for a while.
  ghostTown: (a, day) => 1 + Math.min(3, Math.max(0, day - a.posts.reduce((m, p) => Math.max(m, p.day), 0) - 2) * 0.5),
  // Haters and misogynists spread rumors and bring their friends.
  rumor: (a) => 1 + Math.min(3, 0.5 * reachable(a).filter((r) => actingType(r) === 'hater' || r.personality === 'misogynist').length),
  haterRaid: (a) =>
    1 + Math.min(4, 0.7 * reachable(a).filter((r) => actingType(r) === 'hater' || r.personality === 'misogynist').length + subscriberCount(a.audience, 'hater') / 50),
}

/** The brand's fee: by your level, plus a little per subscriber. */
function brandFee(a: Account): number {
  const F = E.rare.brandDeal.fee
  return F.byLevel[level(a) - 1] + subscriberCount(a.audience) * F.perSubscriberCents
}

function openCommon(rng: Rng, a: Account, day: number): { account: Account; event: DayEvent } {
  const weights = Object.fromEntries(Object.entries(COMMON).map(([k, c]) => [k, c.weight * (BOOSTS[k]?.(a, day) ?? 1)]))
  const kind = pickWeighted(rng, weights)
  const event: DayEvent = { id: `ev${day}`, kind, category: 'common', day, until: day + COMMON[kind].days, status: 'active' }
  if (kind === 'rumor') event.variant = pickWeighted(rng, Object.fromEntries(Object.keys(E.rumors).map((k) => [k, 1])))
  // The tag that trends is one of your direction's, likelier the more you have posted it.
  if (kind === 'trendingTag') event.variant = pickWeighted(rng, Object.fromEntries(Object.entries(signatureUses(a, day)).map(([t, n]) => [t, 1 + n])))
  return { account: a, event }
}

function openRare(rng: Rng, a: Account, kind: RareKind, fan: Regular | undefined, day: number): { account: Account; event: DayEvent } {
  const event: DayEvent = { id: `ev${day}`, kind, category: 'rare', day, until: day + RARE[kind].days, status: 'open', ...(fan ? { regularId: fan.id } : {}) }
  if (kind === 'brandDeal') return { account: a, event: { ...event, variant: a.direction.id, amountCents: brandFee(a) } }
  // Which porn star asks (his name is the variant).
  if (kind === 'guestStar') return { account: a, event: { ...event, variant: E.rare.guestStar.stars[Math.floor(rng() * E.rare.guestStar.stars.length)] } }
  if (kind === 'secretAdmirer' && fan) {
    // His anonymous tip arrives with the event.
    const gift = tipCents(rng, fan) * E.rare.secretAdmirer.gifts.arrive
    const b = updateRegular(a, { ...fan, spent: fan.spent + gift })
    return { account: { ...b, ledger: [...b.ledger, line(day, 'tip', `${event.id}-admirer`, gift)] }, event: { ...event, amountCents: gift } }
  }
  return { account: a, event }
}

/** Rare events you could get today, with who each would be about. */
function rareCandidates(a: Account, day: number): { kind: RareKind; fans: (Regular | undefined)[] }[] {
  const rares = a.dayEvents.filter((e) => e.category === 'rare')
  if (rares.some((e) => e.status === 'open' || e.day > day - D.rareGapDays)) return []
  return RARE_KINDS.filter((k) => !rares.some((e) => e.kind === k && e.day > day - D.rareRepeatDays))
    .map((kind) => ({ kind, fans: GATES[kind](a) }))
    .filter((c) => c.fans.length)
}

/** Today's event, if any (rolled at the start of the day). Settles rare events you left unanswered first. */
export function rollDayEvent(account: Account, seed: string, day: number): { account: Account; events: EngineEvent[] } {
  let a = account
  const events: EngineEvent[] = []
  for (const e of a.dayEvents) {
    if (e.status !== 'open' || day - e.day < D.answerDays) continue
    // On the last day you could have answered, so what it leaves behind starts today.
    const s = settle(a, e.id, specOf(e.kind).default, seed, e.day + D.answerDays - 1)
    a = s.account
    events.push(...s.events)
  }
  // Special events are kept for good (some come once, some are scheduled for later).
  a = { ...a, dayEvents: a.dayEvents.filter((e) => e.status === 'open' || e.category === 'special' || e.day > day - KEEP_DAYS || (e.after?.until ?? 0) >= day) }
  // Special events that run for days do today's part; a chained one whose day has come takes the day.
  const sd = specialDay(a, seed, day)
  a = sd.account
  events.push(...sd.events)
  if (sd.opened) {
    events.push({ day, type: 'day-event', eventId: sd.opened.id, kind: sd.opened.kind, title: viewOf(a, sd.opened, day).title })
    return { account: a, events }
  }
  if (a.dayEvents.some((e) => e.day < day && eventOn(e, day))) return { account: a, events }

  const rng = rngFor(seed, day, 'day-event')
  // A special event first, when your path has led to one (each on its own dice, so the other events roll as before).
  let opened: { account: Account; event: DayEvent; events?: EngineEvent[] } | null = rollSpecial(a, seed, day)
  const rare = opened ? [] : rareCandidates(a, day)
  if (opened) {
    // Today is taken.
  } else if (rare.length && rng() < D.rareChance) {
    const { kind, fans } = rare[Math.floor(rng() * rare.length)]
    opened = openRare(rng, a, kind, fans[Math.floor(rng() * fans.length)], day)
  } else {
    // At least one common event a week: none for `commonEveryDays` days, and today brings one.
    const lastCommon = a.dayEvents.reduce((m, e) => (e.category === 'common' ? Math.max(m, e.day) : m), 0)
    if (rng() < D.commonChance || day - lastCommon >= D.commonEveryDays) opened = openCommon(rng, a, day)
  }
  if (!opened) return { account: a, events }
  const { event } = opened
  events.push(...(opened.events ?? []))
  const next = { ...opened.account, dayEvents: [...opened.account.dayEvents, event] }
  const { title } = viewOf(next, event, day)
  events.push({ day, type: 'day-event', eventId: event.id, kind: event.kind, ...(event.variant ? { variant: event.variant } : {}), title })
  return { account: next, events }
}

/** How a rare (or special) event's choice turns out, on `day`. */
function settle(account: Account, eventId: string, choice: string, seed: string, day: number, target?: SwapTarget): { account: Account; events: EngineEvent[] } {
  const e = account.dayEvents.find((x) => x.id === eventId)!
  const kind = e.kind
  const spec = specOf(kind)
  const rng = rngFor(seed, day, `day-event:${e.id}:${choice}`)
  const ok = rng() < (spec.odds[choice] ?? 1)
  const events: EngineEvent[] = []
  const ledger: LedgerEntry[] = []
  let a = account
  let result: string
  let cents: number | undefined
  let lost: number | undefined
  let until = e.until
  /** Who it turned out to be about, if it was nobody before (the jealous fan). */
  let about: string | undefined
  /** What a special event keeps besides its result (engine/specials.ts). */
  let patch: Partial<DayEvent> = {}

  const fan = () => a.regulars.find((x) => x.id === e.regularId)!
  /** He sends you a big tip (`factor` × one of his). */
  const gift = (factor: number, anonymous = false) => {
    const r = fan()
    cents = tipCents(rng, r) * factor
    ledger.push(line(day, 'tip', `${e.id}-${choice}`, cents))
    a = updateRegular(a, { ...r, spent: r.spent + cents })
    if (!anonymous) events.push({ day, type: 'dm-tip', regularId: r.id, gross: cents })
  }
  /** Money off the platform: a brand's fee in, or what you paid out. */
  const cash = (gross: number) => ledger.push(line(day, 'offline', `${e.id}-${gross > 0 ? 'brand' : 'cost'}`, gross))
  const scandal = (share: number) => {
    const s = loseSubscribers(rng, a.audience, share)
    a = { ...a, audience: s.audience }
    lost = (lost ?? 0) + s.lost
  }
  const turn = () => {
    const t = turnOnYou(a, e.regularId!, day)
    a = t.account
    events.push(...t.events)
  }

  switch (kind as RareKind) {
    case 'whaleWatching':
      if (choice === 'pamper') {
        gift(E.rare.whaleWatching.gifts.pamper)
        a = addLoyalty(a, e.regularId!, 'vip')
        result = 'pampered'
      } else if (choice === 'hardToGet') {
        if (ok) gift(E.rare.whaleWatching.gifts.hardToGet)
        else until = Math.min(until, day + 1) // he stops chasing after today
        result = ok ? 'won' : 'cooled'
      } else result = 'business'
      break
    case 'tooClose':
      if (choice === 'keepTalking') {
        a = addLoyalty(a, e.regularId!, 'flattered')
        // Not harmless: he gets obsessed, and an obsessed man starts following you.
        if (!ok) a = updateRegular(a, withBehaviour(fan(), fan().behaviours.includes('obsessive') ? 'stalker' : 'obsessive'))
        result = ok ? 'flattered' : 'deeper'
      } else if (choice === 'boundaries') {
        if (!ok) turn()
        result = ok ? 'respected' : 'turned'
      } else {
        a = blockFan(a, e.regularId!, day)
        result = 'blocked'
      }
      break
    case 'leakedContent': {
      const L = E.rare.leakedContent
      if (choice === 'takedown') {
        cash(-L.costCents)
        a = blockFan(a, e.regularId!, day)
        if (!ok) scandal(L.lossShare.spread)
        result = ok ? 'contained' : 'spread'
      } else if (choice === 'leanIn') {
        scandal(L.lossShare.leaned)
        result = 'leaned'
      } else result = 'ignored'
      break
    }
    case 'doxxed': {
      const X = E.rare.doxxed
      if (choice === 'police') {
        if (!ok) scandal(X.lossShare)
        result = ok ? 'handled' : 'dragged'
      } else if (choice === 'move') {
        cash(-X.moveCents)
        result = 'moved'
      } else {
        // It gets worse: subscribers leave, and the man who started it starts following you.
        if (!ok) {
          scandal(X.lossShare)
          a = updateRegular(a, withBehaviour(fan(), 'stalker'))
        }
        result = ok ? 'blewOver' : 'escalated'
      }
      break
    }
    case 'brandDeal': {
      const fee = e.amountCents ?? 0
      const paid = choice === 'accept' ? fee : choice === 'negotiate' && ok ? Math.round((fee * E.rare.brandDeal.fee.negotiateFactor) / 100) * 100 : 0
      if (paid) {
        cents = paid
        cash(paid)
        a = { ...a, posts: [eventPost(a, brand(e).ad, day), ...a.posts] }
      }
      result = choice === 'accept' ? 'accepted' : choice === 'negotiate' ? (ok ? 'negotiated' : 'walked') : 'declined'
      break
    }
    case 'guestStar': {
      const G = E.rare.guestStar
      if (choice === 'accept') {
        a = { ...a, posts: [eventPost(a, G.post.replace('{star}', e.variant ?? ''), day), ...a.posts] }
        // Not taken well: some subscribers cancel, and the most attached of your devoted fans turns on you.
        const jealous = reachable(a)
          .filter((r) => friendly(r) && !wontTurn(a, r) && (r.segment === 'simp' || r.behaviours.includes('obsessive') || r.behaviours.includes('stalker')))
          .sort((x, y) => y.loyalty - x.loyalty)[0]
        if (!ok && jealous) {
          scandal(G.lossShare)
          const t = turnOnYou(a, jealous.id, day)
          a = t.account
          events.push(...t.events)
          about = jealous.id
        }
        result = !ok && jealous ? 'jealous' : 'shot'
      } else result = 'declined'
      break
    }
    case 'secretAdmirer':
      if (choice === 'thank') {
        if (ok) gift(E.rare.secretAdmirer.gifts.more, true)
        result = ok ? 'thankedMore' : 'thanked'
      } else if (choice === 'unmask') {
        a = addLoyalty(a, e.regularId!, 'unmasked')
        if (ok) a = updateRegular(a, withBehaviour(fan(), 'obsessive'))
        result = ok ? 'obsessed' : 'unmasked'
      } else result = 'quiet'
      break
    default: {
      // A special event (engine/specials.ts).
      const o = settleSpecial(a, e, choice, rng, ok, day, target)
      a = o.account
      events.push(...o.events)
      result = o.result
      cents = o.cents
      about = o.about
      patch = o.patch ?? {}
      break
    }
  }

  const after = spec.after?.[result]
  const done: DayEvent = {
    ...e,
    until,
    status: 'done',
    choice,
    result,
    closedDay: day,
    ...(cents !== undefined ? { resultCents: cents } : {}),
    ...(about ? { regularId: about } : {}),
    ...(after ? { after: { until: day + after.days, effects: after.effects } } : {}),
    ...patch,
  }
  a = { ...a, dayEvents: a.dayEvents.map((x) => (x.id === e.id ? done : x)), ledger: [...a.ledger, ...ledger] }
  const text = viewOf(a, done, day).result ?? ''
  events.unshift({ day, type: 'day-event-done', eventId: e.id, kind, result, text, ...(BAD_RESULTS.has(result) ? { bad: true } : {}), ...(cents ? { gross: cents } : {}), ...(lost !== undefined ? { lost } : {}) })
  return { account: a, events }
}

type Brand = { name: string; pitch: string; ad: string }
/** What the brand behind a Brand Deal sells, by your direction (the variant): its name, the pitch, the #ad you post. */
const brand = (e: DayEvent): Brand => (E.rare.brandDeal.products as Record<string, Brand>)[e.variant ?? ''] ?? E.rare.brandDeal.products.girl_next_door

/** You chose what to do about a rare (or special) event: the engine rolls how it goes and settles it. */
export function resolveDayEvent(account: Account, eventId: string, choice: string, seed: string, target?: SwapTarget): { account: Account; events: EngineEvent[] } {
  const e = account.dayEvents.find((x) => x.id === eventId)
  if (!e) throw new ContentError('Event not found')
  if (e.status !== 'open') throw new ContentError('You already dealt with this')
  if (!(choice in specOf(e.kind).options)) throw new ContentError('Not an option here')
  const s = settle(account, eventId, choice, seed, account.clock.day, target)
  return { account: { ...s.account, events: [...s.account.events, ...s.events] }, events: s.events }
}

/** You end an event that runs until you do (The Charity's doors, Home). */
export function endDayEvent(account: Account, eventId: string): { account: Account; events: EngineEvent[] } {
  const e = account.dayEvents.find((x) => x.id === eventId)
  if (!e) throw new ContentError('Event not found')
  const day = account.clock.day
  const a = endCharity(account, e, day)
  const done = a.dayEvents.find((x) => x.id === eventId)!
  const events: EngineEvent[] = [{ day, type: 'day-event-done', eventId, kind: e.kind, result: 'ended', text: viewOf(a, done, day).result ?? '' }]
  return { account: { ...a, events: [...a.events, ...events] }, events }
}

// What the app shows: today's card (Home) and a rare event's choices (the popup).

/** `pick`: choosing it also needs a fan and a fan type (DayEventView.pick; Routing Error). */
export type DayEventOption = { choice: string; label: string; help: string; chance?: number; pick?: boolean }
export type DayEventView = {
  /** null on an ordinary day. */
  id: string | null
  kind: string
  category: 'default' | 'common' | 'rare' | 'special'
  title: string
  text: string
  /** The day it happened (null on an ordinary day). */
  day: number | null
  /** Days it is still on after today (0 = ends today). */
  daysLeft: number
  status: DayEvent['status'] | null
  options: DayEventOption[]
  choice?: string
  /** How your choice turned out, in words. */
  result?: string
  /** The default choice: what happens if you leave it, after `answerBy`. */
  fallback?: string
  answerBy?: number
  /** It runs until you end it (The Charity), with this button on Home. */
  ongoing?: boolean
  endLabel?: string
  /** Routing Error: the regulars you could swap and the kinds of fan you could have instead. */
  pick?: { fans: { id: string; name: string; type: Segment }[]; types: { id: Segment; label: string }[] }
  /** It came as an email (Routing Error): the popup shows the header lines and the body. */
  email?: { from: string; to: string; subject: string; body: string }
}

const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', cents % 100 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {})}`
const percent = (x: number) => `${Math.round(x * 100)}%`
const tagLabel = (id: string) => tags.find((t) => t.id === id)?.en ?? id

/** “Tom”, “Tom and Rick”, “Tom, Rick and Joe”. */
const names = (list: string[]) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : (list[0] ?? ''))

function fill(text: string, a: Account, e: DayEvent, extra: Record<string, string> = {}): string {
  const r = a.regulars.find((x) => x.id === e.regularId)
  const gone = (e.leftIds ?? []).map((id) => a.regulars.find((x) => x.id === id)?.name ?? 'Someone')
  const values: Record<string, string> = {
    name: r?.name ?? 'Someone',
    amount: money(e.resultCents ?? e.amountCents ?? 0),
    fee: money(e.amountCents ?? 0),
    product: brand(e).name,
    pitch: brand(e).pitch,
    star: e.kind === 'guestStar' ? (e.variant ?? '') : '',
    tag: tagLabel(e.variant ?? ''),
    freebies: String(freebies(a)),
    count: (e.count ?? 0).toLocaleString('en-US'),
    gone: names(gone),
    his: gone.length > 1 ? 'their' : 'his',
    type: e.variant && e.variant in audience.segments ? audience.segments[e.variant as Segment].label.toLowerCase() : '',
    days: String(e.days ?? 1),
    you: `${a.profile.name} <@${a.profile.handle}>`,
    ...extra,
  }
  return text.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m)
}

function viewOf(a: Account, e: DayEvent, day: number): DayEventView {
  const base = { id: e.id, kind: e.kind, day: e.day, daysLeft: Math.max(0, e.until - day - 1), status: e.status, choice: e.choice }
  if (e.category === 'common') {
    const spec = e.kind === 'rumor' ? E.rumors[e.variant as keyof typeof E.rumors] : COMMON[e.kind]
    return { ...base, category: 'common', title: spec.title, text: fill(spec.text, a, e), options: [] }
  }
  const spec = specOf(e.kind)
  const costs: Record<string, number> = { leakedContent: E.rare.leakedContent.costCents, doxxed: E.rare.doxxed.moveCents }
  const options = Object.entries(spec.options).map(([choice, o]) => {
    const chance = spec.odds[choice]
    const fee = costs[e.kind] !== undefined ? money(costs[e.kind]) : money(e.amountCents ?? 0)
    return {
      choice,
      label: o.label,
      help: fill(o.help, a, e, { chance: chance !== undefined ? percent(chance) : '', fee }),
      ...(chance !== undefined ? { chance } : {}),
      ...(o.pick ? { pick: true } : {}),
    }
  })
  // While it runs, the card says how it is going (The Charity's count, Human ATM's total).
  const running = e.status === 'active' && spec.progress
  const ongoing = e.kind === 'charity' && e.status === 'active'
  return {
    ...base,
    category: e.category === 'special' ? 'special' : 'rare',
    title: spec.title,
    text: fill(spec.text, a, e),
    options,
    fallback: spec.default,
    answerBy: e.day + D.answerDays - 1,
    ...(running ? { result: fill(spec.progress!, a, e) } : e.result ? { result: fill(spec.results[e.result], a, e) } : {}),
    ...(ongoing ? { ongoing: true, endLabel: spec.endLabel } : {}),
    ...(e.kind === 'routingError' && e.status === 'open' ? { pick: swapChoices(a) } : {}),
    ...(spec.email
      ? { email: { from: spec.email.from, to: fill(spec.email.to, a, e), subject: spec.email.subject, body: fill(spec.email.body, a, e) } }
      : {}),
  }
}

/**
 * The event to show on `day`: a rare one still waiting for your choice first, then the one
 * on today (or one you dealt with today), else an ordinary day.
 */
export function dayEventView(account: Account, day = account.clock.day): DayEventView {
  const e = account.dayEvents.findLast((x) => x.status === 'open') ?? account.dayEvents.findLast((x) => eventOn(x, day) || x.closedDay === day)
  if (e) return viewOf(account, e, day)
  return { id: null, kind: 'ordinary', category: 'default', title: E.ordinary.title, text: E.ordinary.text, day: null, daysLeft: 0, status: null, options: [] }
}

/** Rare and special events waiting for your choice, oldest first (the popup after a day passes). */
export function openDayEvents(account: Account): DayEventView[] {
  return account.dayEvents.filter((e) => e.status === 'open').map((e) => viewOf(account, e, account.clock.day))
}
