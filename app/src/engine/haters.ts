// Haters (2026-10-15). A fan you keep ignoring may turn on you. How likely that is, how
// long he keeps at it, what it costs you and how you win him back depend on who he was:
//   - his type and traits say when ignoring him turns him (segments.<type>.fan.ghosted,
//     styles.<trait>.behaviour.turnsHater, whichever is quicker);
//   - loyalty makes ghosting cheaper: loyal fans wait longer and turn less often
//     (loyalty.ghostTurn / ghostPatience), and go dormant later;
//   - but one who turns at Devoted or Fanatic stays a hater twice as long (haters.devoted*);
//   - every hater who is at it hurts your name: fewer visitors (haters.fame; stalkers more);
//   - half of them give up within their half-life (his type's; a stalker's is the longest);
//   - winning one back takes messages (a whale needs more); a stalker comes back unhinged.
// Numbers: presets/personas.json. Fans who were haters from the start keep the plain
// dormancy rule (regulars.ts).
import audience from '../presets/audience.json'
import personas from '../presets/personas.json'
import type { Account, EngineEvent, Regular } from '../store/schema'
import { loyaltyLevel } from './fans'
import { behaviour } from './personas'
import { rngFor } from './rng'
import { pendingMessage, recentMine, threadOf, unanswered, updateRegular, withThread } from './threads'

const H = personas.haters
const L = personas.loyalty
type Rule = { afterDays: number; daily: number }

/** When ignoring him turns him (none for fans who never turn): after how many days, and the daily chance then. */
export function ghostRule(r: Regular): Rule | null {
  if (r.segment === 'hater' || r.turned) return null
  const rules = [personas.segments[r.segment].fan.ghosted, behaviour(r.traits).turnsHater].filter((x): x is Rule => !!x)
  if (!rules.length) return null
  const quickest = rules.sort((a, b) => a.afterDays - b.afterDays || b.daily - a.daily)[0]
  const i = loyaltyLevel(r) - 1
  return { afterDays: quickest.afterDays + L.ghostPatience[i], daily: quickest.daily * L.ghostTurn[i] }
}

/** Days without a message from you before he goes dormant: loyal fans wait longer. */
export const dormantAfterDays = (r: Regular) => audience.regulars.dormantAfterDays + L.ghostPatience[loyaltyLevel(r) - 1]

/** A turned hater: half of them give up within this many days. */
export function haterHalfLife(r: Regular): number | null {
  if (!r.turned) return null
  const base = behaviour(r.traits).haterHalfLifeDays ?? personas.segments[r.turned.from].fan.asHater!.halfLifeDays
  return base * (r.turned.level >= H.devotedAt ? H.devotedHalfLife : 1)
}

/** What it takes to win a turned hater back: your messages in the last 14 days, days since he turned, then a daily chance. */
export const winBackRule = (r: Regular) => (r.turned ? personas.segments[r.turned.from].fan.asHater!.winBack : null)

/** Your name takes a hit for every hater who is at it: the factor on your visitors (1 = no hit). */
export function haterFame(account: Account): number {
  const hit = account.regulars.filter((r) => r.segment === 'hater' && r.status === 'active').reduce((s, r) => s + H.fame.perHater * behaviour(r.traits).fame, 0)
  return 1 - Math.min(H.fame.max, hit)
}

/** He turns on you: a hater from now on, with a misogynist streak. Whatever he had open with you is off. */
export function turnHater(account: Account, r: Regular, day: number): { account: Account; event: EngineEvent } {
  const trait = r.traits.includes('misogynist') ? undefined : 'misogynist'
  const level = loyaltyLevel(r)
  let a = updateRegular(account, {
    ...r,
    segment: 'hater',
    status: 'active',
    traits: trait ? [...r.traits, trait] : r.traits,
    turned: { from: r.segment, day, level, ...(trait ? { trait } : {}) },
  })
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

/** He comes round: back to what he was; a stalker comes back worse (styles.<trait>.behaviour.comesBackAs). */
function winBack(account: Account, r: Regular): Account {
  const { turned, ...back } = r
  if (!turned) return account
  const worse = behaviour(r.traits).comesBackAs.filter((x) => !r.traits.includes(x))
  return updateRegular(account, { ...back, segment: turned.from, traits: [...r.traits.filter((x) => x !== turned.trait), ...worse] })
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
    if (r.turned) {
      const w = winBackRule(r)!
      if (day - r.turned.day >= w.afterDays && recentMine(t, day) >= w.messages && rr() < w.daily) {
        a = winBack(a, r)
        events.push({ day, type: 'regular-back', regularId: id })
      } else if (rr() < 1 - 0.5 ** (1 / haterHalfLife(r)!)) {
        a = updateRegular(a, { ...r, status: 'dormant' })
        events.push({ day, type: 'hater-left', regularId: id })
      }
      continue
    }
    const rule = ghostRule(r)
    const lastMine = Math.max(r.since, r.away?.until ?? r.since, ...t.messages.filter((m) => m.from === 'me').map((m) => m.day))
    if (!rule || unanswered(t) === 0 || day - lastMine < rule.afterDays || rr() >= rule.daily) continue
    const turned = turnHater(a, r, day)
    a = turned.account
    events.push(turned.event)
  }
  return { account: a, events }
}
