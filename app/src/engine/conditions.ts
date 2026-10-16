// Conditions (2026-10-15): the third layer of who a fan is, beside his personality (how he
// talks) and behaviours (lasting tendencies). An event puts him in a condition and a later
// one can lift it: he turns hostile and you win him back; his wife catches you two and
// he lies low until a set day; you block him. Their numbers live in presets/personas.json
// `conditions.<id>.modifiers` and count like a behaviour's (engine/personas.ts).
import personas from '../presets/personas.json'
import type { Condition, ConditionId, Regular, Segment } from '../store/schema'

export function conditionOf<K extends ConditionId>(r: Regular, id: K): Extract<Condition, { id: K }> | undefined {
  return r.conditions.find((c): c is Extract<Condition, { id: K }> => c.id === id)
}

export const hasCondition = (r: Regular, id: ConditionId) => r.conditions.some((c) => c.id === id)

/** Puts him in a condition (replacing the same one if he had it). */
export const withCondition = (r: Regular, c: Condition): Regular => ({ ...r, conditions: [...r.conditions.filter((x) => x.id !== c.id), c] })

export const withoutCondition = (r: Regular, id: ConditionId): Regular => ({ ...r, conditions: r.conditions.filter((c) => c.id !== id) })

/** A hostile fan acts as a hater whatever his type: his profile, what he writes about, the harm to your name. */
export const actingType = (r: Regular): Segment => (hasCondition(r, 'hostile') ? 'hater' : r.segment)

/**
 * Hostile, but he was Devoted or more when he turned (haters.loveHate.fromLevel): he hates
 * you and cannot let go. He still writes like a hater, but keeps buying and tipping a
 * little and still says yes when you ask to meet (engine/fans.ts, engine/deals.ts).
 */
export function loveHate(r: Regular): boolean {
  const hostile = conditionOf(r, 'hostile')
  return !!hostile && hostile.level >= personas.haters.loveHate.fromLevel
}

/** Blocked, or lying low until a later day: you cannot write to him. */
export function awayNow(r: Regular, day: number): boolean {
  const low = conditionOf(r, 'lyingLow')
  return hasCondition(r, 'blocked') || (!!low && day < low.until)
}
