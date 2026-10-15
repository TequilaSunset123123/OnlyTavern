// Meetups after the invitation (plan.md §4.3, step 5): you say yes (and pick the day)
// or no; on the day it happens and he pays cash, off the platform: no fee, not in the
// platform balance. Only the result is recorded; the meeting itself is not played out.
// How an invitation starts is deals.ts.
import preset from '../presets/audience.json'
import type { Account, EngineEvent, LedgerEntry, Meetup } from '../store/schema'
import { ContentError } from './content'
import { meetupOpen as isOpen } from './deals'
import { addPoints, meetupPoints } from './directions'
import { paymentLine as line } from './economy'
import { addFanMessage } from './threads'

const M = preset.meetups

function update(account: Account, id: string, change: (m: Meetup) => Meetup): Account {
  return { ...account, meetups: account.meetups.map((m) => (m.id === id ? change(m) : m)) }
}

function mustFind(account: Account, id: string): Meetup {
  const m = account.meetups.find((x) => x.id === id)
  if (!m) throw new ContentError('Invitation not found')
  return m
}

/** One simulated day: meetings that are due happen and unanswered invitations lapse. */
export function simulateMeetupsDay(account: Account, day: number): { account: Account; events: EngineEvent[] } {
  let a = account
  const events: EngineEvent[] = []
  const ledger: LedgerEntry[] = []

  for (const m of a.meetups.filter((x) => x.status === 'accepted' && x.meetDay !== undefined && x.meetDay <= day)) {
    a = update(a, m.id, (x) => ({ ...x, status: 'done', closedDay: day }))
    a = { ...a, regulars: a.regulars.map((r) => (r.id === m.regularId ? { ...r, spent: r.spent + m.offerCents } : r)) }
    ledger.push(line(day, 'offline', m.id, m.offerCents))
    events.push({ day, type: 'meetup-done', regularId: m.regularId, gross: m.offerCents })
    a = addFanMessage(a, m.regularId, day, { kind: 'opener', deal: { kind: 'meetup', step: 'met', id: m.id } })
    a = addPoints(a, meetupPoints())
  }

  for (const m of a.meetups.filter((x) => x.status === 'open' && day > x.replyBy)) {
    a = update(a, m.id, (x) => ({ ...x, status: 'expired', closedDay: day }))
    events.push({ day, type: 'meetup-expired', regularId: m.regularId })
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
