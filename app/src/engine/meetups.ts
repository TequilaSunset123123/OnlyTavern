// Meetups after the invitation (plan.md §4.3, step 5): you say yes (and pick the day)
// or no. On the day the engine rolls what happens (2026-10-15), from his type, his
// behaviours, whether he is married, and your direction (engine/fans.ts):
//   smooth   he pays the cash he offered;
//   bonus    he pays half as much again;
//   noShow   he does not turn up: nothing;
//   creep    he gets too pushy and you leave early with half; he may fixate on you (stalker);
//            (a freebie stays free; a few-dollar offer is paid to the dollar, not rounded to $50)
//   wife     his wife catches him: nothing, a scandal costs you subscribers. He goes quiet:
//            for good up to Loyal (level 3); a Devoted or Fanatic fan is back in 2–4 weeks.
// A stalker may follow it up with an incident (incidents.ts). Cash is off the platform:
// no fee, not in the platform balance. How an invitation starts is deals.ts.
import preset from '../presets/audience.json'
import type { Account, EngineEvent, LedgerEntry, Meetup, Regular } from '../store/schema'
import { pickWeighted } from './comments'
import { loseSubscribers } from './audience'
import { ContentError } from './content'
import { meetupOpen as isOpen } from './deals'
import { addPoints, directionEffects, meetupPoints } from './directions'
import { paymentLine as line } from './economy'
import { addLoyalty, fanProfile, loyaltyLevel, type MeetupOutcome } from './fans'
import { withCondition } from './conditions'
import { afterMeetup } from './incidents'
import { withBehaviour } from './personas'
import { type Rng, rngFor } from './rng'
import { addFanMessage, updateRegular } from './threads'

const M = preset.meetups
const O = M.outcomes

function update(account: Account, id: string, change: (m: Meetup) => Meetup): Account {
  return { ...account, meetups: account.meetups.map((m) => (m.id === id ? change(m) : m)) }
}

function mustFind(account: Account, id: string): Meetup {
  const m = account.meetups.find((x) => x.id === id)
  if (!m) throw new ContentError('Invitation not found')
  return m
}

/** The chances of each outcome for this client: his type's × his behaviours' × your direction's. */
export function meetupOdds(account: Account, r: Regular): Partial<Record<MeetupOutcome, number>> {
  const dir = directionEffects(account).meetupEvents
  const odds = fanProfile(r).events
  return Object.fromEntries(Object.entries(odds).map(([k, w]) => [k, w * (dir[k] ?? 1)]))
}

const roundCash = (cents: number) => Math.round(cents / M.roundCents) * M.roundCents
const roundDollars = (cents: number) => Math.round(cents / 100) * 100

/** The day of the meeting: roll what happens and settle it. */
function meet(rng: Rng, account: Account, m: Meetup, day: number): { account: Account; events: EngineEvent[]; ledger: LedgerEntry[] } {
  const r = account.regulars.find((x) => x.id === m.regularId)!
  const odds = meetupOdds(account, r)
  const outcome: MeetupOutcome = Object.values(odds).some((w) => (w ?? 0) > 0) ? pickWeighted(rng, odds as Record<MeetupOutcome, number>) : 'smooth'
  const round = m.terms ? roundDollars : roundCash
  const paid = { smooth: m.offerCents, bonus: round(m.offerCents * O.bonusFactor), creep: round(m.offerCents * O.creepPaid), noShow: 0, wife: 0 }[outcome]

  let a = update(account, m.id, (x) => ({ ...x, status: 'done', closedDay: day, outcome, paidCents: paid }))
  const ledger = paid ? [line(day, 'offline', m.id, paid)] : []
  a = updateRegular(a, { ...a.regulars.find((x) => x.id === r.id)!, spent: r.spent + paid })
  let lost: number | undefined
  let returns: boolean | undefined

  if (outcome === 'smooth' || outcome === 'bonus') a = addLoyalty(addPoints(a, meetupPoints()), r.id, 'meetup')
  if (outcome === 'creep') {
    // He gets fixated on you.
    const cur = a.regulars.find((x) => x.id === r.id)!
    a = addLoyalty(updateRegular(a, withBehaviour(cur, 'stalker')), r.id, 'creepMeetup')
  }
  if (outcome === 'wife') {
    // A scandal: some subscribers leave, and he goes quiet (and drops whatever else he had going with you).
    const scandal = loseSubscribers(rng, a.audience, O.wifeLoss)
    lost = scandal.lost
    const cur = a.regulars.find((x) => x.id === r.id)!
    returns = loyaltyLevel(cur) >= O.wifeBackFromLevel
    const [lo, hi] = O.wifeQuietDays
    // Devoted enough: he lies low for a while. Otherwise he blocks you for good.
    const away = returns ? withCondition(cur, { id: 'lyingLow', since: day, until: day + lo + Math.floor(rng() * (hi - lo + 1)) }) : withCondition(cur, { id: 'blocked', since: day, by: 'him' })
    a = updateRegular({ ...a, audience: scandal.audience }, { ...away, status: 'dormant' })
    a = {
      ...a,
      requests: a.requests.map((q) => (q.regularId === r.id && (q.status === 'open' || q.status === 'accepted') ? { ...q, status: 'expired' as const, closedDay: day } : q)),
      meetups: a.meetups.map((x) => (x.regularId === r.id && x.id !== m.id && isOpen(x) ? { ...x, status: 'cancelled' as const, closedDay: day } : x)),
    }
  }
  a = addFanMessage(a, r.id, day, { kind: 'opener', deal: { kind: 'meetup', step: 'met', id: m.id } })
  // A stalker may not let it end there (incidents.ts).
  const incident = afterMeetup(rng, a, a.regulars.find((x) => x.id === r.id)!, m.id, outcome, day)
  a = incident.account
  const extra = { ...(lost !== undefined ? { lost } : {}), ...(returns !== undefined ? { returns } : {}), ...(m.terms ? { terms: m.terms } : {}) }
  return { account: a, events: [{ day, type: 'meetup-done', regularId: r.id, gross: paid, outcome, ...extra }, ...incident.events], ledger }
}

/** One simulated day: meetings that are due happen (and something happens at them); unanswered invitations lapse. */
export function simulateMeetupsDay(account: Account, seed: string, day: number): { account: Account; events: EngineEvent[] } {
  let a = account
  const events: EngineEvent[] = []
  const ledger: LedgerEntry[] = []

  for (const m of a.meetups.filter((x) => x.status === 'accepted' && x.meetDay !== undefined && x.meetDay <= day)) {
    const r = meet(rngFor(seed, day, `meetup:${m.id}`), a, m, day)
    a = r.account
    events.push(...r.events)
    ledger.push(...r.ledger)
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
