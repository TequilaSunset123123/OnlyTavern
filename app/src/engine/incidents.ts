// Stalker incidents (2026-10-15). A fan with the Stalker behaviour (or the Unhinged
// condition) courts you (courtship: gifts, a ring, "be my girlfriend") or will not leave
// you alone (clingy: turns up where you are, digs up your name). The engine decides that
// one happens and which kind: on any day, or after you meet him. You choose what to do
// in a popup, and the engine rolls how it turns out. Every chance is shown with the
// choice (incidentOdds), so nothing is hidden:
//   courtship  play along  he sends a big gift, and gets more obsessed;
//              let down    he takes it (more likely the more loyal he is), or turns on you;
//              block       he is gone for good;
//   clingy     calm down   he backs off (loyalty helps; a hater listens less), or it blows
//                          up: he posts about you, subscribers leave, and he turns on you;
//              block       he is gone; sometimes he makes a scene first (subscribers leave).
// Numbers: presets/personas.json incidents; stories: presets/incidents.json.
import personas from '../presets/personas.json'
import stories from '../presets/incidents.json'
import type { Account, Condition, EngineEvent, Incident, IncidentChoice, IncidentResult, LedgerEntry, Regular } from '../store/schema'
import { loseSubscribers } from './audience'
import { ContentError } from './content'
import { platformFee } from './directions'
import { paymentLine as line } from './economy'
import { addLoyalty, loyaltyLevel, type MeetupOutcome } from './fans'
import { wontTurn } from './eventEffects'
import { turnHater } from './haters'
import { actingType, hasCondition, withCondition } from './conditions'
import { modifiers, withBehaviour } from './personas'
import { tipCents } from './regulars'
import { type Rng, rngFor } from './rng'
import { addFanMessage, updateRegular } from './threads'

const I = personas.incidents
export type IncidentKind = Incident['kind']

/** The choices for each kind of incident, in the order the popup shows them. */
export const INCIDENT_OPTIONS: Record<IncidentKind, IncidentChoice[]> = { courtship: ['playAlong', 'letDown', 'block'], clingy: ['calm', 'block'] }

/** His story for the popup ({name} is his name). */
export function incidentStory(incident: Incident): string {
  const list = stories[incident.meetupId ? (`${incident.kind}Meetup` as const) : incident.kind]
  return list[incident.story % list.length]
}

const clamp = (x: number) => Math.min(0.9, Math.max(0.05, x))

/** The chance that each choice goes well, given who he is now. */
export function incidentOdds(account: Account, incident: Incident): Partial<Record<IncidentChoice, number>> {
  const r = account.regulars.find((x) => x.id === incident.regularId)!
  const level = loyaltyLevel(r)
  if (incident.kind === 'courtship') return { playAlong: 1, letDown: clamp(I.courtship.letDown.ok + I.courtship.letDown.perLevel * (level - 1)), block: 1 }
  const calm = I.clingy.calm
  const unhinged = hasCondition(r, 'unhinged') ? I.clingy.block.unhinged : 0
  return { calm: clamp(calm.ok + calm.perLevel * (level - 1) + (actingType(r) === 'hater' ? calm.hater : 0)), block: clamp(I.clingy.block.ok + unhinged) }
}

/** How often he has incidents: × the daily chance (0 unless a behaviour or condition says so: stalker, unhinged). */
const proneness = (r: Regular) => modifiers(r).incidents

function canHaveOne(account: Account, r: Regular, day: number): boolean {
  // Engaged to you, in his mind (Marry Me?): no courting, no scenes (and so no turning on you).
  if (r.status !== 'active' || !proneness(r) || wontTurn(account, r)) return false
  const his = account.incidents.filter((x) => x.regularId === r.id)
  if (his.some((x) => x.status === 'open')) return false
  const last = his.at(-1)
  return !last || day - (last.closedDay ?? last.day) >= I.cooldownDays
}

function open(rng: Rng, account: Account, r: Regular, kind: IncidentKind, day: number, meetupId?: string): { account: Account; events: EngineEvent[] } {
  const id = `${r.id}-i${account.incidents.filter((x) => x.regularId === r.id).length}`
  const list = stories[meetupId ? (`${kind}Meetup` as const) : kind]
  const incident: Incident = { id, regularId: r.id, day, kind, ...(meetupId ? { meetupId } : {}), story: Math.floor(rng() * list.length), status: 'open' }
  return { account: { ...account, incidents: [...account.incidents, incident] }, events: [{ day, type: 'incident', regularId: r.id, incidentId: id, kind }] }
}

/** A hater only ever won't leave you alone; an unhinged fan mostly; the rest mostly court you. */
function kindFor(rng: Rng, r: Regular): IncidentKind {
  if (actingType(r) === 'hater') return 'clingy'
  return rng() < (hasCondition(r, 'unhinged') ? I.unhingedCourtshipShare : I.courtshipShare) ? 'courtship' : 'clingy'
}

/** One simulated day: a stalker may court you or turn up where you are. */
export function simulateIncidentsDay(account: Account, seed: string, day: number): { account: Account; events: EngineEvent[] } {
  let a = account
  const events: EngineEvent[] = []
  for (const r of a.regulars) {
    if (!canHaveOne(a, r, day)) continue
    const rng = rngFor(seed, day, `incident:${r.id}`)
    if (rng() >= I.daily * proneness(r)) continue
    const opened = open(rng, a, r, kindFor(rng, r), day)
    a = opened.account
    events.push(...opened.events)
  }
  return { account: a, events }
}

/** After meeting a stalker: a good night makes him court you; a creepy one makes him follow you. */
export function afterMeetup(rng: Rng, account: Account, r: Regular, meetupId: string, outcome: MeetupOutcome, day: number): { account: Account; events: EngineEvent[] } {
  const kind: IncidentKind | null = outcome === 'smooth' || outcome === 'bonus' ? 'courtship' : outcome === 'creep' ? 'clingy' : null
  if (!kind || !canHaveOne(account, r, day) || rng() >= Math.min(1, I.afterMeetup * proneness(r))) return { account, events: [] }
  return open(rng, account, r, kind, day, meetupId)
}

/** You block him (or he blocks you, the site moves him, the police take him: `by`): gone for good, and whatever was open with him is off. */
export function blockFan(account: Account, regularId: string, day: number, by: Extract<Condition, { id: 'blocked' }>['by'] = 'you'): Account {
  const a = updateRegular(account, { ...withCondition(account.regulars.find((x) => x.id === regularId)!, { id: 'blocked', since: day, by }), status: 'dormant' })
  return {
    ...a,
    requests: a.requests.map((q) => (q.regularId === regularId && (q.status === 'open' || q.status === 'accepted') ? { ...q, status: 'expired' as const, closedDay: day } : q)),
    meetups: a.meetups.map((m) => (m.regularId === regularId && (m.status === 'open' || m.status === 'accepted') ? { ...m, status: 'cancelled' as const, closedDay: day } : m)),
  }
}

/** He turns on you; if he already has, he lets you know what he thinks of you. */
export function turnOnYou(account: Account, regularId: string, day: number): { account: Account; events: EngineEvent[] } {
  const cur = account.regulars.find((x) => x.id === regularId)!
  if (actingType(cur) === 'hater') return { account: addFanMessage(account, regularId, day, { kind: 'opener', topic: 'harass' }), events: [] }
  const t = turnHater(account, cur, day)
  return { account: t.account, events: [t.event] }
}

/** You chose what to do: the engine rolls how it goes and settles it. */
export function resolveIncident(account: Account, incidentId: string, choice: IncidentChoice, seed: string): { account: Account; events: EngineEvent[] } {
  const incident = account.incidents.find((x) => x.id === incidentId)
  if (!incident) throw new ContentError('Incident not found')
  if (incident.status !== 'open') throw new ContentError('You already dealt with this')
  if (!INCIDENT_OPTIONS[incident.kind].includes(choice)) throw new ContentError('Not an option here')
  const day = account.clock.day
  const r = account.regulars.find((x) => x.id === incident.regularId)!
  const rng = rngFor(seed, day, `incident:${incidentId}:${choice}`)
  const ok = rng() < (incidentOdds(account, incident)[choice] ?? 0)
  const events: EngineEvent[] = []
  const ledger: LedgerEntry[] = []
  let a = account
  let result: IncidentResult
  let gross: number | undefined
  let lost: number | undefined

  const scandal = (share: number) => {
    const s = loseSubscribers(rng, a.audience, share)
    a = { ...a, audience: s.audience }
    lost = s.lost
  }
  const block = () => {
    a = blockFan(a, r.id, day)
  }
  const turn = () => {
    const t = turnOnYou(a, r.id, day)
    a = t.account
    events.push(...t.events)
  }

  if (choice === 'playAlong') {
    // He takes it as a yes: a big gift, and he gets even more hooked.
    result = 'gift'
    gross = tipCents(rng, r) * I.courtship.playAlong.giftFactor
    ledger.push(line(day, 'tip', `${incidentId}-gift`, gross, platformFee(a)))
    events.push({ day, type: 'dm-tip', regularId: r.id, gross })
    a = updateRegular(a, { ...withBehaviour(r, 'obsessive'), spent: r.spent + gross })
    a = addLoyalty(a, r.id, 'playAlong')
    a = addFanMessage(a, r.id, day, { kind: 'opener', incident: incidentId, tip: gross }, gross)
  } else if (choice === 'letDown') {
    result = ok ? 'ok' : 'turned'
    if (ok) a = addFanMessage(a, r.id, day, { kind: 'opener', incident: incidentId })
    else turn()
  } else if (choice === 'calm') {
    result = ok ? 'calmed' : 'escalated'
    if (ok) a = addFanMessage(addLoyalty(a, r.id, 'calmed'), r.id, day, { kind: 'opener', incident: incidentId })
    else {
      scandal(I.clingy.calm.loss)
      turn()
    }
  } else {
    // Block: a courting fan just goes; a clingy one may make a scene on his way out.
    result = incident.kind === 'clingy' && !ok ? 'backlash' : 'blocked'
    if (result === 'backlash') scandal(I.clingy.block.loss)
    block()
  }

  a = {
    ...a,
    incidents: a.incidents.map((x) =>
      x.id === incidentId ? { ...x, status: 'done' as const, choice, result, closedDay: day, ...(gross ? { gross } : {}), ...(lost !== undefined ? { lost } : {}) } : x,
    ),
    ledger: [...a.ledger, ...ledger],
  }
  const done: EngineEvent = { day, type: 'incident-done', regularId: r.id, incidentId, result, ...(gross ? { gross } : {}), ...(lost !== undefined ? { lost } : {}) }
  events.unshift(done)
  return { account: { ...a, events: [...a.events, ...events] }, events }
}
