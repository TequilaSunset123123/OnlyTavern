import { describe, expect, it } from 'vitest'
import { createAccount } from '../store/account'
import type { Account, Incident, IncidentChoice, Meetup, Regular } from '../store/schema'
import { subscriberCount } from './audience'
import { incidentOdds, resolveIncident } from './incidents'
import { acceptMeetup, simulateMeetupsDay } from './meetups'
import { sendDm } from './regulars'
import { simulate } from './simulate'
import { threadOf } from './threads'

const grown = (seed = 'a') => simulate(createAccount({ id: 'x', seed, now: 0, name: 'TestCreator', handle: 'test' }), 60, seed).account
const reg = (a: Account, id: string) => a.regulars.find((r) => r.id === id)!
const set = (a: Account, id: string, patch: Partial<Regular>): Account => ({
  ...a,
  regulars: a.regulars.map((r) => {
    if (r.id !== id) return r
    return { ...r, conditions: [], ...patch }
  }),
})

/** His first fan, as a stalker simp with an open incident of `kind`. */
function withIncident(kind: Incident['kind'], patch: Partial<Regular> = {}, seed = 'a') {
  const a = grown(seed)
  const id = a.regulars[0].id
  const acc = set(a, id, { segment: 'simp', behaviours: ['stalker'], status: 'active', loyalty: 10, ...patch })
  const incident: Incident = { id: `${id}-i0`, regularId: id, day: acc.clock.day, kind, story: 0, status: 'open' }
  return { acc: { ...acc, incidents: [incident] }, id, incidentId: incident.id }
}

describe('stalker incidents', () => {
  it('happen to stalkers as time goes by, and never to anyone else', () => {
    const count = (behaviours: string[]) => {
      let n = 0
      for (const seed of ['a', 'b', 'c']) {
        let a = grown(seed)
        a = { ...a, incidents: [], regulars: a.regulars.map((r) => ({ ...r, segment: 'simp' as const, behaviours, conditions: [], status: 'active' as const, since: a.clock.day })) }
        const after = simulate(a, 30, seed).account
        n += after.incidents.length
        // New regulars arriving meanwhile may be stalkers of their own.
        expect(after.incidents.every((x) => reg(after, x.regularId).behaviours.includes('stalker') || reg(after, x.regularId).conditions.some((c) => c.id === 'unhinged'))).toBe(true)
      }
      return n
    }
    // Obsessed fans only get them once a creepy meetup has made them stalkers too (checked above).
    expect(count(['stalker'])).toBeGreaterThan(count(['obsessive']))
  })

  it('follow a meetup with a stalker: courtship after a good night, clingy after a creepy one', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 80 && seen.size < 2; i++) {
      const a = grown('m')
      const id = a.regulars[0].id
      const acc = set(a, id, { segment: 'simp', behaviours: ['stalker'], status: 'active', loyalty: 20, relationship: 'single' })
      const m: Meetup = { id: 'm1', regularId: id, day: acc.clock.day, offerCents: 50000, replyBy: acc.clock.day + 5, status: 'open', hidden: false, messageId: 'x' }
      const day = simulateMeetupsDay(acceptMeetup({ ...acc, meetups: [m], incidents: [] }, 'm1', acc.clock.day + 1, false), `m${i}`, acc.clock.day + 1)
      const incident = day.account.incidents.find((x) => x.meetupId === 'm1')
      if (!incident) continue
      const outcome = day.account.meetups[0].outcome
      expect(incident.kind).toBe(outcome === 'creep' ? 'clingy' : 'courtship')
      expect(day.events).toContainEqual({ day: acc.clock.day + 1, type: 'incident', regularId: id, incidentId: incident.id, kind: incident.kind })
      seen.add(incident.kind)
    }
    expect(seen).toEqual(new Set(['courtship', 'clingy']))
  })

  it('show the odds: loyal fans take no better; haters listen less', () => {
    const low = withIncident('courtship', { loyalty: 0 })
    const high = withIncident('courtship', { loyalty: 40 })
    expect(incidentOdds(high.acc, high.acc.incidents[0]).letDown!).toBeGreaterThan(incidentOdds(low.acc, low.acc.incidents[0]).letDown!)
    const fan = withIncident('clingy')
    const hater = withIncident('clingy', { segment: 'hater', personality: 'misogynist', behaviours: ['stalker'] })
    expect(incidentOdds(hater.acc, hater.acc.incidents[0]).calm!).toBeLessThan(incidentOdds(fan.acc, fan.acc.incidents[0]).calm!)
  })

  it('play along: a big gift, more obsession, more loyalty', () => {
    const { acc, id, incidentId } = withIncident('courtship')
    const r = resolveIncident(acc, incidentId, 'playAlong', 's')
    const x = r.account.incidents[0]
    expect(x).toMatchObject({ status: 'done', choice: 'playAlong', result: 'gift' })
    expect(r.account.ledger.at(-1)).toMatchObject({ kind: 'tip', gross: x.gross })
    expect(reg(r.account, id).behaviours).toContain('obsessive')
    expect(reg(r.account, id).loyalty).toBe(13)
    expect(reg(r.account, id).spent).toBe(reg(acc, id).spent + x.gross!)
    const last = threadOf(r.account, id).messages.at(-1)!
    expect(last).toMatchObject({ state: 'pending', tipCents: x.gross, intent: { kind: 'opener', incident: incidentId } })
    expect(() => resolveIncident(r.account, incidentId, 'block', 's')).toThrow(/already/)
  })

  it('every other choice can go either way, and settles what follows', () => {
    const results = new Map<string, number>()
    const tryAll = (kind: Incident['kind'], choice: IncidentChoice) => {
      for (let i = 0; i < 30; i++) {
        const { acc, id, incidentId } = withIncident(kind)
        const before = subscriberCount(acc.audience)
        const r = resolveIncident(acc, incidentId, choice, `t${i}`)
        const x = r.account.incidents[0]
        results.set(`${choice}:${x.result}`, (results.get(`${choice}:${x.result}`) ?? 0) + 1)
        const after = reg(r.account, id)
        if (x.result === 'turned' || x.result === 'escalated') expect(after.conditions.map((c) => c.id)).toContain('hostile')
        if (x.result === 'escalated' || x.result === 'backlash') expect(subscriberCount(r.account.audience)).toBe(before - x.lost!)
        if (x.result === 'blocked' || x.result === 'backlash') {
          expect(after.conditions).toContainEqual({ id: 'blocked', since: acc.clock.day, by: 'you' })
          expect(() => sendDm(r.account, id, { text: 'hey' }, 's')).toThrow(/blocked him/)
          // He never comes back on his own.
          expect(reg(simulate(r.account, 30, 's').account, id).status).toBe('dormant')
        }
        if (x.result === 'ok' || x.result === 'calmed') expect(threadOf(r.account, id).messages.at(-1)!.intent).toEqual({ kind: 'opener', incident: incidentId })
        expect(r.events[0]).toMatchObject({ type: 'incident-done', incidentId, result: x.result })
      }
    }
    tryAll('courtship', 'letDown')
    tryAll('courtship', 'block')
    tryAll('clingy', 'calm')
    tryAll('clingy', 'block')
    expect([...results.keys()].sort()).toEqual(['block:backlash', 'block:blocked', 'calm:calmed', 'calm:escalated', 'letDown:ok', 'letDown:turned'])
  })
})
