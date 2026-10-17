// Daily events (plan.md §10.2, 2026-10-16). Every day is one of four kinds:
//   default  an ordinary day: nothing happens;
//   common   a small random event that changes the odds for a day or a few, no choice to
//            make. What is going on makes some likelier (BOOSTS): haters and misogynists
//            bring raids and rumors, a long break from posting a ghost town;
//   rare     only when you have the fans for it (GATES), mostly about one of them, and you
//            choose what to do (the odds are on the buttons). Left unanswered, it settles
//            itself with its default choice after a couple of days;
//   special  a turning point your path leads to (SPECIAL_GATES), once per account: The
//            Charity, for a Sub who has been had for free again and again. It waits for
//            you like a rare one (one button), and settles itself if you leave it.
// At most one a day, rolled before anything else that day (simulate.ts), and none while a
// multi-day one is still on. At least one common event a week. What the effects do: engine/eventEffects.ts. Numbers and
// words: presets/events.json.
import E from '../presets/events.json'
import tags from '../presets/tags.json'
import type { Account, DayEvent, EngineEvent, LedgerEntry, Post, Regular } from '../store/schema'
import { loseSubscribers, subscriberCount } from './audience'
import { pickWeighted } from './comments'
import { actingType, awayNow, hasCondition } from './conditions'
import { ContentError } from './content'
import { levelOf, SPECS } from './directions'
import { paymentLine as line } from './economy'
import { eventOn } from './eventEffects'
import { addLoyalty, loyaltyLevel } from './fans'
import { blockFan, turnOnYou } from './incidents'
import { withBehaviour } from './personas'
import { postTags } from './posts'
import { tipCents } from './regulars'
import { type Rng, rngFor } from './rng'
import { addFanMessage, updateRegular } from './threads'

const D = E.daily
/** Old events are dropped after this many days (longer than any repeat rule). */
const KEEP_DAYS = 60

export const RARE_KINDS = ['whaleWatching', 'tooClose', 'leakedContent', 'doxxed', 'brandDeal', 'guestStar', 'secretAdmirer'] as const
export type RareKind = (typeof RARE_KINDS)[number]
type After = { days: number; effects: Record<string, number | Record<string, number>> }
type RareSpec = {
  title: string
  text: string
  days: number
  default: string
  options: Record<string, { label: string; help: string }>
  odds: Record<string, number>
  results: Record<string, string>
  after?: Record<string, After>
}
const RARE = E.rare as unknown as Record<RareKind, RareSpec>

export const SPECIAL_KINDS = ['charity'] as const
export type SpecialKind = (typeof SPECIAL_KINDS)[number]
const SPECIAL = E.special as unknown as Record<SpecialKind, RareSpec>
/** A rare or special event's words, options and odds. */
const specOf = (kind: string): RareSpec => (RARE as Record<string, RareSpec>)[kind] ?? (SPECIAL as Record<string, RareSpec>)[kind]
const COMMON = E.common as Record<string, { title: string; text: string; weight: number; days: number }>

/** Results that went badly for you (the popup shows them as a warning). */
const BAD_RESULTS = new Set(['cooled', 'deeper', 'turned', 'spread', 'ignored', 'dragged', 'escalated', 'walked', 'jealous', 'opened', 'openedRich'])

const level = (a: Account) => levelOf(a.direction.points[a.direction.id])
const reachable = (a: Account) => a.regulars.filter((r) => r.status === 'active' && !hasCondition(r, 'blocked'))
const friendly = (r: Regular) => !hasCondition(r, 'hostile')
const misogynistOrCreep = (r: Regular) => r.personality === 'misogynist' || r.behaviours.includes('creepy_compliments')

/**
 * Who a rare event can be about; empty when you do not have the fans for it. A Brand Deal
 * is about nobody (`undefined`): it only needs you to be well known.
 */
const GATES: Record<RareKind, (a: Account) => (Regular | undefined)[]> = {
  whaleWatching: (a) => reachable(a).filter((r) => r.behaviours.includes('older_gentleman') && loyaltyLevel(r) >= 2 && friendly(r)),
  tooClose: (a) => reachable(a).filter((r) => r.behaviours.includes('stalker') || (r.behaviours.includes('obsessive') && loyaltyLevel(r) >= 3)),
  leakedContent: (a) => (a.vault.length ? reachable(a).filter(misogynistOrCreep) : []),
  doxxed: (a) => reachable(a).filter(misogynistOrCreep),
  brandDeal: (a) => (a.direction.chosen && level(a) >= 3 ? [undefined] : []),
  guestStar: (a) => (a.direction.chosen && level(a) >= 3 ? [undefined] : []),
  secretAdmirer: (a) => reachable(a).filter((r) => (r.segment === 'simp' || r.behaviours.includes('obsessive')) && loyaltyLevel(r) >= 2 && friendly(r)),
}

/** Meetups where a man had you for free, for a few insulting dollars or for grovelling thanks (Meetup.terms). */
export const freebies = (a: Account) => a.meetups.filter((m) => m.status === 'done' && m.terms && m.outcome !== 'noShow' && m.outcome !== 'wife').length

/** When a special event can come: where your path has led. Each comes once per account. */
const SPECIAL_GATES: Record<SpecialKind, (a: Account) => boolean> = {
  // A Sub who has been had for free again and again: everyone knows her as the girl who never makes them pay.
  charity: (a) => a.direction.id === 'sub' && freebies(a) >= E.special.charity.minFreebies,
}

/** Special events you could get today (none while another event waits for your choice). */
const specialCandidates = (a: Account): SpecialKind[] =>
  a.dayEvents.some((e) => e.status === 'open') ? [] : SPECIAL_KINDS.filter((k) => !a.dayEvents.some((e) => e.kind === k) && SPECIAL_GATES[k](a))

function openSpecial(a: Account, kind: SpecialKind, day: number): { account: Account; event: DayEvent } {
  return { account: a, event: { id: `ev${day}`, kind, category: 'special', day, until: day + SPECIAL[kind].days, status: 'open' } }
}

/** For testing (Settings, Developer): a special event waiting for you today, whatever led there. */
export function openSpecialForTesting(account: Account, kind: SpecialKind): Account {
  if (account.dayEvents.some((e) => e.status === 'open')) throw new ContentError('Deal with the event that is waiting first')
  const day = account.clock.day
  const { event } = openSpecial(account, kind, day)
  return { ...account, dayEvents: [...account.dayEvents.filter((e) => e.id !== event.id), event] }
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
  // Special events are kept for good: each comes once.
  a = { ...a, dayEvents: a.dayEvents.filter((e) => e.status === 'open' || e.category === 'special' || e.day > day - KEEP_DAYS || (e.after?.until ?? 0) >= day) }
  if (a.dayEvents.some((e) => e.day < day && eventOn(e, day))) return { account: a, events }

  const rng = rngFor(seed, day, 'day-event')
  // A special event first, when your path has led to one (on its own dice, so the other events roll as before).
  const special = specialCandidates(a)
  let opened: { account: Account; event: DayEvent } | null =
    special.length && rngFor(seed, day, 'day-event:special')() < D.specialChance ? openSpecial(a, special[0], day) : null
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
  const next = { ...opened.account, dayEvents: [...opened.account.dayEvents, event] }
  const { title } = viewOf(next, event, day)
  events.push({ day, type: 'day-event', eventId: event.id, kind: event.kind, ...(event.variant ? { variant: event.variant } : {}), title })
  return { account: next, events }
}

/** How a rare (or special) event's choice turns out, on `day`. */
function settle(account: Account, eventId: string, choice: string, seed: string, day: number): { account: Account; events: EngineEvent[] } {
  const e = account.dayEvents.find((x) => x.id === eventId)!
  const kind = e.kind as RareKind | SpecialKind
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
  /** How many men came, and who walked out for good (The Charity). */
  let count: number | undefined
  const left: string[] = []

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

  switch (kind) {
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
        a = { ...a, posts: [eventPost(a, E.rare.brandDeal.adPost.replace('{product}', product(e)), day), ...a.posts] }
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
          .filter((r) => friendly(r) && (r.segment === 'simp' || r.behaviours.includes('obsessive') || r.behaviours.includes('stalker')))
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
    case 'charity': {
      // Free for everyone: no money at all. Your regulars were all in the queue, and they
      // come out of it seeing you as free: freeloaders, creeps and misogynists. Old money
      // came too, then decided this is beneath him and left for good.
      const C = E.special.charity
      const [lo, hi] = C.men
      const men = lo + Math.floor(rng() * (hi - lo + 1))
      count = men
      // Each of them writes to you about it (the model puts it into words): old money says goodbye first.
      for (const r of a.regulars) {
        if (awayNow(r, day)) continue
        if (r.behaviours.includes('older_gentleman')) {
          a = blockFan(addFanMessage(a, r.id, day, { kind: 'opener', event: { kind: 'charity', step: 'left', id: e.id } }), r.id, day, 'him')
          left.push(r.id)
        } else {
          a = updateRegular(a, withBehaviour({ ...r, segment: 'freeloader', personality: 'misogynist' }, 'creepy_compliments'))
          a = addFanMessage(a, r.id, day, { kind: 'opener', event: { kind: 'charity', step: 'after', id: e.id } })
        }
      }
      a = { ...a, posts: [eventPost(a, C.post.replace('{count}', men.toLocaleString('en-US')), day), ...a.posts] }
      result = left.length ? 'openedRich' : 'opened'
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
    ...(count !== undefined ? { count } : {}),
    ...(left.length ? { leftIds: left } : {}),
    ...(after ? { after: { until: day + after.days, effects: after.effects } } : {}),
  }
  a = { ...a, dayEvents: a.dayEvents.map((x) => (x.id === e.id ? done : x)), ledger: [...a.ledger, ...ledger] }
  const text = viewOf(a, done, day).result ?? ''
  events.unshift({ day, type: 'day-event-done', eventId: e.id, kind, result, text, ...(BAD_RESULTS.has(result) ? { bad: true } : {}), ...(cents ? { gross: cents } : {}), ...(lost !== undefined ? { lost } : {}) })
  return { account: a, events }
}

/** A post an event makes for you: the brand's #ad, the scene with the guest star. */
function eventPost(a: Account, text: string, day: number): Post {
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

const product = (e: DayEvent) => (E.rare.brandDeal.products as Record<string, string>)[e.variant ?? ''] ?? 'products'

/** You chose what to do about a rare (or special) event: the engine rolls how it goes and settles it. */
export function resolveDayEvent(account: Account, eventId: string, choice: string, seed: string): { account: Account; events: EngineEvent[] } {
  const e = account.dayEvents.find((x) => x.id === eventId)
  if (!e) throw new ContentError('Event not found')
  if (e.status !== 'open') throw new ContentError('You already dealt with this')
  if (!(choice in specOf(e.kind).options)) throw new ContentError('Not an option here')
  const s = settle(account, eventId, choice, seed, account.clock.day)
  return { account: { ...s.account, events: [...s.account.events, ...s.events] }, events: s.events }
}

// What the app shows: today's card (Home) and a rare event's choices (the popup).

export type DayEventOption = { choice: string; label: string; help: string; chance?: number }
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
    product: product(e),
    star: e.kind === 'guestStar' ? (e.variant ?? '') : '',
    tag: tagLabel(e.variant ?? ''),
    freebies: String(freebies(a)),
    count: (e.count ?? 0).toLocaleString('en-US'),
    gone: names(gone),
    his: gone.length > 1 ? 'their' : 'his',
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
    return { choice, label: o.label, help: fill(o.help, a, e, { chance: chance !== undefined ? percent(chance) : '', fee }), ...(chance !== undefined ? { chance } : {}) }
  })
  return {
    ...base,
    category: e.category === 'special' ? 'special' : 'rare',
    title: spec.title,
    text: fill(spec.text, a, e),
    options,
    fallback: spec.default,
    answerBy: e.day + D.answerDays - 1,
    ...(e.result ? { result: fill(spec.results[e.result], a, e) } : {}),
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
