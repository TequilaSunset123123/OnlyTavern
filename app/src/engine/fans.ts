// What a regular does (2026-10-15), all from presets/personas.json in one place:
//   - his type's profile (segments.<type>.fan): how often he writes, buys, tips, orders
//     customs, asks to meet, what can happen at a meetup, and his loyalty ceiling;
//   - his behaviours and conditions (behaviours.<id>.modifiers, conditions.<id>.modifiers)
//     adjust it; his personality never does (engine/personas.ts);
//   - while he is hostile he acts as a hater, whatever his type (engine/conditions.ts); one
//     who was Devoted or more when he turned is love-hate: he still buys and tips a little
//     and says yes when you ask to meet (haters.loveHate);
//   - his loyalty level scales how likely he is to do things and how much he spends.
// Loyalty is built by everything you two do together: your messages, his purchases,
// tips, customs and meetups. Five levels; at the top he buys anything. Some types never
// get far (a freeloader stays at 1). Everything here is a number the engine rolls
// against; the model never sees the rules, only what happened.
import personas from '../presets/personas.json'
import type { Account, EngineEvent, Regular } from '../store/schema'
import { actingType, hasCondition, loveHate } from './conditions'
import { modifiers } from './personas'

const L = personas.loyalty
export type LoyaltyGain = keyof typeof L.gain
export type MeetupOutcome = 'smooth' | 'bonus' | 'noShow' | 'creep' | 'wife'

const LH = personas.haters.loveHate

/** His type's profile (a hater's while he is hostile) with his behaviours and conditions applied. */
export function fanProfile(r: Regular) {
  const f = personas.segments[actingType(r)].fan
  const own = personas.segments[r.segment].fan
  const b = modifiers(r)
  // Love-hate: writes like a hater, but keeps part of his own buying and tipping, never
  // brings up a deal himself, and answers you as he used to when you ask to meet.
  const torn = loveHate(r)
  return {
    loyaltyCap: own.loyaltyCap,
    /** Writing on his own: the daily chance, how many unanswered messages in a row, and how much less often once he is waiting on you. */
    dm: { daily: f.dmDaily * b.dmFactor, maxUnanswered: Math.max(f.maxUnanswered, b.maxUnanswered), ignoredFactor: Math.max(f.ignoredFactor, b.ignoredFactor) },
    ppv: torn ? own.ppv * LH.buy : f.ppv,
    tip: torn ? { ...own.tip, chance: own.tip.chance * LH.tip } : f.tip,
    custom: f.custom,
    meetup: {
      ...f.meetup,
      asked: torn ? own.meetup.asked : f.meetup.asked,
      factor: b.meetupFactor,
      minLoyalty: Math.min(f.meetup.minLoyalty, b.meetupMinLoyalty),
      // An entitled fan asks for his freebies far more than his type would (conditions.entitled);
      // once he turns hostile he stops asking.
      daily: hasCondition(r, 'hostile') ? f.meetup.daily : Math.max(f.meetup.daily, b.meetupDaily),
      cooldownDays: Number.isFinite(b.meetupCooldownDays) ? b.meetupCooldownDays : null,
    },
    /**
     * Chances of what happens when you meet: his type's, times his behaviours'; "wife" only for
     * married men. The more loyal he is, the less he stands you up (loyalty.noShow: a Fanatic
     * never does), and an obsessed man or a stalker never does (2026-10-17).
     */
    events: Object.fromEntries(
      (Object.entries(f.meetup.events) as [MeetupOutcome, number][]).map(([k, w]) => [
        k,
        k === 'wife' && r.relationship !== 'married' ? 0 : w * (b.events[k] ?? 1) * (k === 'noShow' ? L.noShow[loyaltyLevel(r) - 1] : 1),
      ]),
    ) as Partial<Record<MeetupOutcome, number>>,
  }
}

/** 1–5, never above his type's ceiling. Turning hostile does not take it away: a Devoted fan who turns is love-hate. */
export function loyaltyLevel(r: Regular): number {
  return Math.min(personas.segments[r.segment].fan.loyaltyCap, L.points.filter((p) => r.loyalty >= p).length)
}

/**
 * How his loyalty scales what he does: how likely he is to buy, tip, order customs (deal)
 * and meet, and how much he spends (spend: tips, offers, the PPV prices he will pay). A
 * Fanatic buys anything, unless he is hostile.
 */
export function loyaltyEffects(r: Regular) {
  const level = loyaltyLevel(r)
  return {
    level,
    buy: L.buy[level - 1],
    tip: L.tip[level - 1],
    deal: L.deal[level - 1],
    meetup: L.meetup[level - 1],
    spend: L.spend[level - 1],
    buysAnything: level >= L.buysAnythingAt && !hasCondition(r, 'hostile'),
  }
}

export type LoyaltyInfo = { points: number; level: number; cap: number; name: string; from: number; next: number | null }

export function loyaltyInfo(r: Regular): LoyaltyInfo {
  const level = loyaltyLevel(r)
  const cap = personas.segments[r.segment].fan.loyaltyCap
  return { points: r.loyalty, level, cap, name: L.names[level - 1], from: L.points[level - 1], next: level < cap ? L.points[level] : null }
}

/** Something you two did together; notes when he reaches a new level. An entitled fan takes it all for granted: no loyalty. */
export function addLoyalty(account: Account, regularId: string, gain: LoyaltyGain): Account {
  const r = account.regulars.find((x) => x.id === regularId)
  if (!r || hasCondition(r, 'entitled')) return account
  const after = { ...r, loyalty: r.loyalty + L.gain[gain] }
  const up = loyaltyLevel(after) > loyaltyLevel(r)
  const event: EngineEvent[] = up ? [{ day: account.clock.day, type: 'loyalty-up', regularId, level: loyaltyLevel(after) }] : []
  return { ...account, regulars: account.regulars.map((x) => (x.id === regularId ? after : x)), events: [...account.events, ...event] }
}

export const LOYALTY_GAIN = L.gain
