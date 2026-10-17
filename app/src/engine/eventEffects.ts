// What the day's event does to the odds (plan.md §10.2, 2026-10-16). Every effect is a
// multiplier, 1 when nothing is going on. Read here from the account's daily events (the one
// on today, and what an earlier choice left behind) and applied where the numbers are
// rolled: the crowd (audience.ts via simulate.ts), posts, regulars, customs and meetups.
// Which event happens, and what your choice does, is engine/events.ts.
import E from '../presets/events.json'
import type { Account, DayEvent, Regular, Segment } from '../store/schema'

export type EventEffects = {
  /** Crowd: how many visit, how many of them subscribe, how many renew, how often and how much subscribers tip. */
  visitors: number
  conversion: number
  renewal: number
  crowdTips: number
  /** Tip sizes, crowd and regulars. */
  tipSize: number
  /** Each fan type's share of visitors (crowd) and of new regulars. */
  mix: Partial<Record<Segment, number>>
  regularMix: Partial<Record<Segment, number>>
  /** Regulars: how often they tip, write to you, reach out for the first time, buy a paid message. */
  tipChance: number
  dms: number
  newRegulars: number
  /** Posts: how many see them; posts with the trending tag (`tag`). */
  reach: number
  tag?: string
  tagReach: number
  /** Meetups fans bring up: how often. */
  meetupRate: number
  /** One fan in the spotlight (Whale Watching): his tips, deals and messages. */
  target?: { regularId: string; tipChance: number; deal: number; dms: number }
}

type Raw = Record<string, number | Record<string, number>>

const NONE: EventEffects = {
  visitors: 1,
  conversion: 1,
  renewal: 1,
  crowdTips: 1,
  tipSize: 1,
  mix: {},
  regularMix: {},
  tipChance: 1,
  dms: 1,
  newRegulars: 1,
  reach: 1,
  tagReach: 1,
  meetupRate: 1,
}

const COMMON = E.common as Record<string, { effects: Raw }>
const RUMORS = E.rumors as Record<string, { effects: Raw }>

/** On from its day to the day before `until` (a scheduled one is not on yet: it opens on its day, engine/specials.ts). */
export const eventOn = (e: DayEvent, day: number) => e.status !== 'scheduled' && e.day <= day && day < e.until

/** A common event's own effects (a rumor's are its variant's). Rare ones only have a target. */
function ownEffects(e: DayEvent): Raw {
  if (e.category !== 'common') return {}
  return e.kind === 'rumor' ? (RUMORS[e.variant ?? '']?.effects ?? {}) : (COMMON[e.kind]?.effects ?? {})
}

function fold(fx: EventEffects, raw: Raw): EventEffects {
  const out = { ...fx, mix: { ...fx.mix }, regularMix: { ...fx.regularMix } }
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'mix' || key === 'regularMix') {
      for (const [s, m] of Object.entries(value as Record<string, number>)) out[key][s as Segment] = (out[key][s as Segment] ?? 1) * m
    } else if (typeof value === 'number' && key in NONE) (out as Record<string, unknown>)[key] = (out[key as keyof typeof NONE] as number) * value
  }
  return out
}

/** Everything going on on `day`: the event on, and what earlier choices left behind. */
export function eventEffects(account: Account, day: number): EventEffects {
  let fx = NONE
  for (const e of account.dayEvents) {
    if (eventOn(e, day)) {
      fx = fold(fx, ownEffects(e))
      if (e.kind === 'trendingTag' && e.variant) fx = { ...fx, tag: e.variant }
      if (e.kind === 'whaleWatching' && e.regularId) fx = { ...fx, target: { regularId: e.regularId, ...E.rare.whaleWatching.target } }
    }
    if (e.after && e.closedDay !== undefined && e.closedDay < day && day <= e.after.until) fx = fold(fx, e.after.effects)
    // The Charity's doors are open: freeloaders flock in (engine/specials.ts).
    if (e.kind === 'charity' && e.status === 'active' && (e.closedDay ?? e.day) < day) fx = fold(fx, E.special.charity.ongoing)
  }
  return fx
}

/**
 * A special event has him to itself (2026-10-17): from Human ATM's first $5,000 until you have
 * read the news of his arrest, he opens no customs or meetups and says no to yours, so nothing
 * (a wife catching you two) can end it another way (engine/specials.ts, engine/deals.ts).
 */
export const heldByEvent = (account: Account, regularId: string, day: number) =>
  account.dayEvents.some(
    (e) => e.regularId === regularId && ((e.kind === 'humanAtm' && eventOn(e, day)) || (e.kind === 'humanAtmArrest' && e.status !== 'done')),
  )

/**
 * He has proposed to you (Marry Me?, waiting for your answer) or believes you two are engaged
 * (Imaginary Fiancée): he never turns on you, not when you ignore him (haters.ts), not after a
 * stalker incident (incidents.ts), not over a rare event (events.ts). Only "You're Delusional."
 * can (engine/specials.ts).
 */
export const wontTurn = (account: Account, r: Regular) =>
  r.conditions.some((c) => c.id === 'fiancee') || account.dayEvents.some((e) => e.kind === 'marryMe' && e.status === 'open' && e.regularId === r.id)

/** The spotlight's multiplier for this fan (1 for everyone else). */
export function targetFactor(fx: EventEffects, regularId: string, key: 'tipChance' | 'deal' | 'dms'): number {
  return fx.target?.regularId === regularId ? fx.target[key] : 1
}
