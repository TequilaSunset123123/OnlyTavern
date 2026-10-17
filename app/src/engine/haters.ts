// Haters (2026-10-15). A fan you keep ignoring may turn on you: he gets the Hostile
// condition (engine/conditions.ts) and acts as a hater, but keeps his type, personality
// and behaviours. How likely that is, how long he keeps at it, what it costs you and how
// you win him back depend on who he is:
//   - his type and behaviours say when ignoring him turns him (segments.<type>.fan.ghosted,
//     behaviours.<id>.modifiers.turnsHater, whichever is quicker);
//   - loyalty makes ghosting cheaper: loyal fans wait longer and turn less often
//     (loyalty.ghostTurn / ghostPatience), and go dormant later;
//   - but one who turns at Devoted or Fanatic stays a hater twice as long (haters.devoted*);
//   - every hater who is at it hurts your name: fewer visitors (haters.fame; stalkers more);
//   - half of them give up within their half-life (his type's; a stalker's is the longest);
//   - winning one back lifts the condition and takes messages (a whale needs more); a
//     stalker comes back with the Unhinged condition.
// Numbers: presets/personas.json. Fans who were haters from the start (their type) keep
// the plain dormancy rule (regulars.ts).
import audience from '../presets/audience.json'
import personas from '../presets/personas.json'
import type { Account, EngineEvent, Regular } from '../store/schema'
import { actingType, conditionOf, hasCondition, withCondition, withoutCondition } from './conditions'
import { wontTurn } from './eventEffects'
import { loyaltyLevel } from './fans'
import { modifiers } from './personas'
import { rngFor } from './rng'
import { lastContact, pendingMessage, recentMine, threadOf, unanswered, updateRegular, withThread } from './threads'

const H = personas.haters
const L = personas.loyalty
type Rule = { afterDays: number; daily: number }

/** When ignoring him turns him (none for fans who never turn): after how many days, and the daily chance then. */
export function ghostRule(r: Regular): Rule | null {
  if (actingType(r) === 'hater') return null
  const rules = [personas.segments[r.segment].fan.ghosted, modifiers(r).turnsHater].filter((x): x is Rule => !!x)
  if (!rules.length) return null
  const quickest = rules.sort((a, b) => a.afterDays - b.afterDays || b.daily - a.daily)[0]
  const i = loyaltyLevel(r) - 1
  return { afterDays: quickest.afterDays + L.ghostPatience[i], daily: quickest.daily * L.ghostTurn[i] }
}

/** Days without a message from you before he goes dormant: loyal fans wait longer. */
export const dormantAfterDays = (r: Regular) => audience.regulars.dormantAfterDays + L.ghostPatience[loyaltyLevel(r) - 1]

/** A hostile fan: half of them give up within this many days. */
export function haterHalfLife(r: Regular): number | null {
  const hostile = conditionOf(r, 'hostile')
  if (!hostile) return null
  const base = modifiers(r).haterHalfLifeDays ?? personas.segments[r.segment].fan.asHater!.halfLifeDays
  return base * (hostile.level >= H.devotedAt ? H.devotedHalfLife : 1)
}

/** What it takes to win a hostile fan back: your messages in the last 14 days, days since he turned, then a daily chance. */
export const winBackRule = (r: Regular) => (conditionOf(r, 'hostile') ? personas.segments[r.segment].fan.asHater!.winBack : null)

/** Your name takes a hit for every hater who is at it: the factor on your visitors (1 = no hit). */
export function haterFame(account: Account): number {
  const hit = account.regulars.filter((r) => actingType(r) === 'hater' && r.status === 'active').reduce((s, r) => s + H.fame.perHater * modifiers(r).fame, 0)
  return 1 - Math.min(H.fame.max, hit)
}

/** He turns on you: hostile from now on (he acts as a hater). Whatever he had open with you is off. */
export function turnHater(account: Account, r: Regular, day: number): { account: Account; event: EngineEvent } {
  const level = loyaltyLevel(r)
  let a = updateRegular(account, { ...withCondition(r, { id: 'hostile', since: day, level }), status: 'active' })
  a = {
    ...a,
    requests: a.requests.map((q) => (q.regularId === r.id && q.status === 'open' ? { ...q, status: 'expired' as const, closedDay: day } : q)),
    meetups: a.meetups.map((m) => (m.regularId === r.id && m.status === 'open' ? { ...m, status: 'expired' as const, closedDay: day } : m)),
  }
  // He lets you know what he thinks of you.
  const t = threadOf(a, r.id)
  a = withThread(a, { ...t, messages: [...t.messages, pendingMessage(`${r.id}-m${t.messages.length}`, day, { kind: 'opener', topic: 'harass' })] })
  return { account: a, event: { day, type: 'regular-turned', regularId: r.id, level } }
}

/**
 * You said no to an entitled fan (a meetup or custom he wanted, or a meetup you called off):
 * that is all it takes, he turns on you (conditions.ts `entitled`). Anyone else shrugs it off.
 * Ignoring him turns him too, after a few days (conditions.entitled.modifiers.turnsHater).
 */
export function snubbed(account: Account, regularId: string): Account {
  const r = account.regulars.find((x) => x.id === regularId)
  if (!r || !hasCondition(r, 'entitled') || hasCondition(r, 'hostile')) return account
  const t = turnHater(account, r, account.clock.day)
  return { ...t.account, events: [...t.account.events, t.event] }
}

/** He comes round: no longer hostile; a stalker comes back worse (behaviours.<id>.modifiers.comesBackAs). */
function winBack(account: Account, r: Regular, day: number): Account {
  const worse = modifiers(r).comesBackAs as 'unhinged'[]
  return updateRegular(account, worse.reduce((x, id) => withCondition(x, { id, since: day }), withoutCondition(r, 'hostile')))
}

/** One simulated day: ignored fans may turn; turned haters may come round, or give up. */
export function simulateHatersDay(account: Account, seed: string, day: number): { account: Account; events: EngineEvent[] } {
  let a = account
  const events: EngineEvent[] = []
  for (const { id } of account.regulars) {
    const r = a.regulars.find((x) => x.id === id)!
    if (r.status !== 'active') continue
    const t = threadOf(a, id)
    const rr = rngFor(seed, day, `regulars:mood:${id}`)
    const hostile = conditionOf(r, 'hostile')
    if (hostile) {
      const w = winBackRule(r)!
      if (day - hostile.since >= w.afterDays && recentMine(t, day) >= w.messages && rr() < w.daily) {
        a = winBack(a, r, day)
        events.push({ day, type: 'regular-back', regularId: id })
      } else if (rr() < 1 - 0.5 ** (1 / haterHalfLife(r)!)) {
        a = updateRegular(a, { ...r, status: 'dormant' })
        events.push({ day, type: 'hater-left', regularId: id })
      }
      continue
    }
    const rule = ghostRule(r)
    // Engaged to you, in his mind (Marry Me?): he waits for you however long it takes.
    if (!rule || wontTurn(a, r) || unanswered(t) === 0 || day - lastContact(r, t) < rule.afterDays || rr() >= rule.daily) continue
    const turned = turnHater(a, r, day)
    a = turned.account
    events.push(turned.event)
  }
  return { account: a, events }
}
