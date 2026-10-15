// Offline jobs (plan.md §4.3, step 5): a regular you are close to offers cash to
// meet you in person. The engine decides who asks and for how much; you say yes
// (and pick the day) or no. The money is cash, off the platform: no fee, not in
// the platform balance. Only the result is recorded; the meeting itself is not played out.
import preset from '../presets/audience.json'
import type { Account, EngineEvent, LedgerEntry, Meetup } from '../store/schema'
import { ContentError } from './content'
import { closeness, line, pendingMessage, recentMine, threadOf, unanswered, withThread } from './regulars'
import { logNormal, rngFor } from './rng'

const M = preset.meetups

const isOpen = (m: Meetup) => m.status === 'open' || m.status === 'accepted'

function update(account: Account, id: string, change: (m: Meetup) => Meetup): Account {
  return { ...account, meetups: account.meetups.map((m) => (m.id === id ? change(m) : m)) }
}

function mustFind(account: Account, id: string): Meetup {
  const m = account.meetups.find((x) => x.id === id)
  if (!m) throw new ContentError('Invitation not found')
  return m
}

function addFanMessage(account: Account, regularId: string, day: number, intent: Parameters<typeof pendingMessage>[2]): Account {
  const t = threadOf(account, regularId)
  return withThread(account, { ...t, messages: [...t.messages, pendingMessage(`${regularId}-m${t.messages.length}`, day, intent)] })
}

/** One simulated day: meetings that are due happen, unanswered invitations lapse, close fans may invite you. */
export function simulateMeetupsDay(account: Account, seed: string, day: number): { account: Account; events: EngineEvent[] } {
  let a = account
  const events: EngineEvent[] = []
  const ledger: LedgerEntry[] = []

  for (const m of a.meetups.filter((x) => x.status === 'accepted' && x.meetDay !== undefined && x.meetDay <= day)) {
    a = update(a, m.id, (x) => ({ ...x, status: 'done', closedDay: day }))
    a = { ...a, regulars: a.regulars.map((r) => (r.id === m.regularId ? { ...r, spent: r.spent + m.offerCents } : r)) }
    ledger.push(line(day, 'offline', m.id, m.offerCents))
    events.push({ day, type: 'meetup-done', regularId: m.regularId, gross: m.offerCents })
    a = addFanMessage(a, m.regularId, day, { kind: 'opener', meetup: { meetupId: m.id, phase: 'after' } })
  }

  for (const m of a.meetups.filter((x) => x.status === 'open' && day > x.replyBy)) {
    a = update(a, m.id, (x) => ({ ...x, status: 'expired', closedDay: day }))
    events.push({ day, type: 'meetup-expired', regularId: m.regularId })
  }

  for (const r of a.regulars) {
    if (r.status !== 'active') continue
    const p = preset.segments[r.segment]
    if (!p.meetupDaily) continue
    const t = threadOf(a, r.id)
    // Only fans you write to a lot, one invitation at a time, and a long pause after the last one.
    if (recentMine(t, day) < M.minMessages || unanswered(t) >= M.maxUnanswered) continue
    const mine = a.meetups.filter((x) => x.regularId === r.id)
    if (mine.some(isOpen)) continue
    const last = mine.at(-1)
    if (last && day - (last.closedDay ?? last.day) < M.cooldownDays) continue

    const rng = rngFor(seed, day, `meetups:${r.id}`)
    if (rng() >= p.meetupDaily * closeness(t, day)) continue
    const offer = Math.max(M.minCents, Math.round((logNormal(rng, p.meetupMedian, M.spread) * 100) / M.roundCents) * M.roundCents)
    const id = `${r.id}-o${mine.length}`
    const messageId = `${r.id}-m${t.messages.length}`
    a = addFanMessage(a, r.id, day, { kind: 'opener', meetup: { meetupId: id, phase: 'invite' } })
    a = { ...a, meetups: [...a.meetups, { id, regularId: r.id, day, offerCents: offer, replyBy: day + M.replyDays, status: 'open', hidden: false, messageId }] }
    events.push({ day, type: 'meetup', regularId: r.id, meetupId: id })
  }

  return { account: { ...a, ledger: [...a.ledger, ...ledger] }, events }
}

/** Say yes and pick the day (tomorrow at the earliest, within two weeks). */
export function acceptMeetup(account: Account, id: string, meetDay: number, hidden: boolean): Account {
  const m = mustFind(account, id)
  const today = account.clock.day
  if (m.status !== 'open') throw new ContentError('This invitation is no longer open')
  if (!Number.isInteger(meetDay) || meetDay <= today || meetDay > today + M.maxAheadDays) {
    throw new ContentError(`Pick a day from ${today + 1} to ${today + M.maxAheadDays}`)
  }
  return update(account, id, (x) => ({ ...x, status: 'accepted', meetDay, hidden }))
}

export function declineMeetup(account: Account, id: string): Account {
  if (mustFind(account, id).status !== 'open') throw new ContentError('This invitation is no longer open')
  return update(account, id, (x) => ({ ...x, status: 'declined', closedDay: account.clock.day }))
}

export function cancelMeetup(account: Account, id: string): Account {
  if (mustFind(account, id).status !== 'accepted') throw new ContentError('Only an accepted meeting can be cancelled')
  return update(account, id, (x) => ({ ...x, status: 'cancelled', closedDay: account.clock.day }))
}

/** Keep it from co-creators, or not (takes effect once the account has one). */
export function hideMeetup(account: Account, id: string, hidden: boolean): Account {
  if (!isOpen(mustFind(account, id))) throw new ContentError('This meeting is already over')
  return update(account, id, (x) => ({ ...x, hidden }))
}
