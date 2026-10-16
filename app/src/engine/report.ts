// Time passing, for the UI (2026-10-15): what would lapse if you skip ahead (asked before
// "+7"), and what happened while the days went by (the report popup afterwards). Built
// from the day snapshots and the engine events; nothing new is rolled here.
import type { Account, DirectionId, EngineEvent, LedgerKind } from '../store/schema'
import { subscriberCount } from './audience'
import { requestOpen } from './deals'
import type { MeetupOutcome } from './fans'
import { haterFame } from './haters'

export type Lapse = { kind: 'custom' | 'meetup'; id: string; regularId: string; name: string; deadline: number; accepted: boolean }

/** Customs and invitations whose deadline passes within the next `days` days. */
export function lapsing(account: Account, days: number): Lapse[] {
  const end = account.clock.day + days
  const name = (id: string) => account.regulars.find((r) => r.id === id)?.name ?? 'A fan'
  return [
    ...account.requests
      .filter((q) => requestOpen(q) && q.dueDay < end)
      .map((q) => ({ kind: 'custom' as const, id: q.id, regularId: q.regularId, name: name(q.regularId), deadline: q.dueDay, accepted: q.status === 'accepted' })),
    ...account.meetups
      .filter((m) => m.status === 'open' && m.replyBy < end)
      .map((m) => ({ kind: 'meetup' as const, id: m.id, regularId: m.regularId, name: name(m.regularId), deadline: m.replyBy, accepted: false })),
  ].sort((a, b) => a.deadline - b.deadline)
}

export type MeetupReport = { regularId: string; name: string; day: number; outcome: MeetupOutcome; paid: number; lost?: number; returns?: boolean }

export type PeriodReport = {
  /** First and last simulated day. */
  from: number
  to: number
  subscribers: { before: number; after: number }
  newSubscribers: number
  churned: number
  visitors: number
  /** Net to you: after the platform fee, and cash from meetups (no fee). */
  earned: { platform: number; cash: number }
  /** Net by kind. */
  byKind: Partial<Record<LedgerKind, number>>
  /** The same length of time just before, for "vs last week" (null when there was none). */
  previous: { earned: number; newSubscribers: number } | null
  regulars: { new: number; messages: number; levelUps: number; turned: number; back: number; left: number }
  meetups: MeetupReport[]
  incidents: number
  /** Haters at it now, and the share of visitors they keep away. */
  haters: { active: number; visitorHit: number }
  levelUps: { direction: DirectionId; level: number }[]
}

export function periodReport(before: Account, after: Account, events: EngineEvent[]): PeriodReport {
  const from = before.clock.day + 1
  const to = after.clock.day
  const days = after.history.filter((h) => h.day >= from && h.day <= to)
  const len = to - from + 1
  const prior = after.history.filter((h) => h.day >= from - len && h.day < from)
  const byKind: Partial<Record<LedgerKind, number>> = {}
  for (const h of days) for (const [k, v] of Object.entries(h.net) as [LedgerKind, number][]) if (k !== 'payout' && v) byKind[k] = (byKind[k] ?? 0) + v
  const earned = (rows: typeof days) => rows.reduce((s, h) => s + Object.entries(h.net).reduce((t, [k, v]) => t + (k === 'payout' ? 0 : v), 0), 0)
  const name = (id: string) => after.regulars.find((r) => r.id === id)?.name ?? 'A fan'
  const n = (type: EngineEvent['type']) => events.filter((e) => e.type === type).length
  const haters = after.regulars.filter((r) => r.segment === 'hater' && r.status === 'active').length
  return {
    from,
    to,
    subscribers: { before: subscriberCount(before.audience), after: subscriberCount(after.audience) },
    newSubscribers: days.reduce((s, h) => s + h.newSubscribers, 0),
    churned: days.reduce((s, h) => s + h.churned, 0),
    visitors: days.reduce((s, h) => s + h.visitors, 0),
    earned: { platform: earned(days) - (byKind.offline ?? 0), cash: byKind.offline ?? 0 },
    byKind,
    previous: prior.length === len ? { earned: earned(prior), newSubscribers: prior.reduce((s, h) => s + h.newSubscribers, 0) } : null,
    regulars: { new: n('regular'), messages: n('dm'), levelUps: n('loyalty-up'), turned: n('regular-turned'), back: n('regular-back'), left: n('hater-left') },
    meetups: events.flatMap((e) =>
      e.type === 'meetup-done'
        ? [{ regularId: e.regularId, name: name(e.regularId), day: e.day, outcome: e.outcome ?? 'smooth', paid: e.gross, ...(e.lost !== undefined ? { lost: e.lost } : {}), ...(e.returns !== undefined ? { returns: e.returns } : {}) }]
        : [],
    ),
    incidents: n('incident'),
    haters: { active: haters, visitorHit: 1 - haterFame(after) },
    levelUps: after.events.flatMap((e) => (e.type === 'level-up' && e.day >= from && e.day <= to ? [{ direction: e.direction, level: e.level }] : [])),
  }
}
