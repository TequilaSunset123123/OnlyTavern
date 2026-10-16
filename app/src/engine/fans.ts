// What a regular does (2026-10-15), all from presets/personas.json in one place:
//   - his type's profile (segments.<type>.fan): how often he writes, buys, tips, orders
//     customs, asks to meet, what can happen at a meetup, and his loyalty ceiling;
//   - his traits (styles.<trait>.behaviour) adjust it;
//   - his loyalty level scales it.
// Loyalty is built by everything you two do together: your messages, his purchases,
// tips, customs and meetups. Five levels; at the top he buys anything. Some types never
// get far (a freeloader stays at 1). Everything here is a number the engine rolls
// against; the model never sees the rules, only what happened.
import personas from '../presets/personas.json'
import type { Account, EngineEvent, Regular } from '../store/schema'
import { behaviour } from './personas'

const L = personas.loyalty
export type LoyaltyGain = keyof typeof L.gain
export type MeetupOutcome = 'smooth' | 'bonus' | 'noShow' | 'creep' | 'wife'

/** His type's profile with his traits applied. */
export function fanProfile(r: Regular) {
  const f = personas.segments[r.segment].fan
  const b = behaviour(r.traits)
  return {
    loyaltyCap: f.loyaltyCap,
    dmDaily: f.dmDaily,
    ppv: f.ppv,
    tip: f.tip,
    custom: f.custom,
    meetup: { ...f.meetup, factor: b.meetupFactor, minLoyalty: Math.min(f.meetup.minLoyalty, b.meetupMinLoyalty) },
    /** Chances of what happens when you meet: his type's, times his traits'; "wife" only for married men. */
    events: Object.fromEntries(
      (Object.entries(f.meetup.events) as [MeetupOutcome, number][]).map(([k, w]) => [k, k === 'wife' && r.relationship !== 'married' ? 0 : w * (b.events[k] ?? 1)]),
    ) as Partial<Record<MeetupOutcome, number>>,
  }
}

/** 1–5, never above his type's ceiling. */
export function loyaltyLevel(r: Regular): number {
  return Math.min(personas.segments[r.segment].fan.loyaltyCap, L.points.filter((p) => r.loyalty >= p).length)
}

/** How his loyalty scales what he does: buying, tipping, customs (deal) and meetups. */
export function loyaltyEffects(r: Regular) {
  const level = loyaltyLevel(r)
  return { level, buy: L.buy[level - 1], tip: L.tip[level - 1], deal: L.deal[level - 1], meetup: L.meetup[level - 1], buysAnything: level >= L.buysAnythingAt }
}

export type LoyaltyInfo = { points: number; level: number; cap: number; name: string; from: number; next: number | null }

export function loyaltyInfo(r: Regular): LoyaltyInfo {
  const level = loyaltyLevel(r)
  const cap = personas.segments[r.segment].fan.loyaltyCap
  return { points: r.loyalty, level, cap, name: L.names[level - 1], from: L.points[level - 1], next: level < cap ? L.points[level] : null }
}

/** Something you two did together; notes when he reaches a new level. */
export function addLoyalty(account: Account, regularId: string, gain: LoyaltyGain): Account {
  const r = account.regulars.find((x) => x.id === regularId)
  if (!r) return account
  const after = { ...r, loyalty: r.loyalty + L.gain[gain] }
  const up = loyaltyLevel(after) > loyaltyLevel(r)
  const event: EngineEvent[] = up ? [{ day: account.clock.day, type: 'loyalty-up', regularId, level: loyaltyLevel(after) }] : []
  return { ...account, regulars: account.regulars.map((x) => (x.id === regularId ? after : x)), events: [...account.events, ...event] }
}

export const LOYALTY_GAIN = L.gain

/** Lying low, or gone for good, after his wife caught you two (meetups.ts): you cannot write to him. */
export const awayNow = (r: Regular, day: number) => !!r.away && (r.away.until === undefined || day < r.away.until)
