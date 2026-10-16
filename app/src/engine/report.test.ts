import { describe, expect, it } from 'vitest'
import { createAccount } from '../store/account'
import { migrate } from '../store/migrate'
import type { Account, Meetup, Request } from '../store/schema'
import { subscriberCount } from './audience'
import { acceptMeetup } from './meetups'
import { lapsing, periodReport } from './report'
import { simulate } from './simulate'

const grown = (seed = 'a') => simulate(createAccount({ id: 'x', seed, now: 0, name: 'TestCreator', handle: 'test' }), 60, seed).account

describe('time passing', () => {
  it('lists what would lapse before you skip ahead', () => {
    const a = grown()
    const [r1, r2] = a.regulars
    const d = a.clock.day
    const q = (id: string, dueDay: number, status: Request['status']): Request => ({ id, regularId: r1.id, day: d, tags: [], intensity: 1, offerCents: 1000, dueDay, status, messageId: 'x' })
    const m = (id: string, replyBy: number, status: Meetup['status']): Meetup => ({ id, regularId: (r2 ?? r1).id, day: d, offerCents: 10000, replyBy, status, hidden: false, messageId: 'x' })
    const acc: Account = { ...a, requests: [q('q1', d + 3, 'accepted'), q('q2', d + 9, 'open'), q('q3', d + 1, 'delivered')], meetups: [m('o1', d + 2, 'open'), m('o2', d + 2, 'declined')] }
    expect(lapsing(acc, 7).map((x) => [x.id, x.accepted])).toEqual([
      ['o1', false],
      ['q1', true],
    ])
    // Next day: only what is due today lapses.
    expect(lapsing(acc, 1)).toEqual([])
    expect(lapsing({ ...acc, requests: [q('q4', d, 'open')] }, 1).map((x) => x.id)).toEqual(['q4'])
  })

  it('reports what happened over the days: money, subscribers, meetups, fans', () => {
    const a = grown()
    const id = a.regulars[0].id
    const meetup: Meetup = { id: 'm1', regularId: id, day: a.clock.day, offerCents: 50000, replyBy: a.clock.day + 5, status: 'open', hidden: false, messageId: 'x' }
    const before = acceptMeetup({ ...a, meetups: [meetup] }, 'm1', a.clock.day + 3, false)
    const r = simulate(before, 7, 'a')
    const rep = periodReport(before, r.account, r.events)
    expect([rep.from, rep.to]).toEqual([61, 67])
    expect(rep.subscribers).toEqual({ before: subscriberCount(before.audience), after: subscriberCount(r.account.audience) })
    const lines = r.account.ledger.filter((l) => l.day >= 61 && l.kind !== 'payout')
    expect(rep.earned.platform + rep.earned.cash).toBe(lines.reduce((s, l) => s + l.net, 0))
    expect(rep.earned.cash).toBe(lines.filter((l) => l.kind === 'offline').reduce((s, l) => s + l.net, 0))
    expect(rep.meetups).toHaveLength(1)
    expect(rep.meetups[0]).toMatchObject({ regularId: id, day: 63 })
    expect(rep.previous).not.toBeNull()
    expect(rep.regulars.messages).toBe(r.events.filter((e) => e.type === 'dm').length)
  })
})

describe('schema 10', () => {
  it('adds incidents and remembers how loyal a turned hater was', () => {
    const a = grown()
    const r = a.regulars[0]
    const old = {
      ...a,
      meta: { ...a.meta, schemaVersion: 9 },
      incidents: undefined,
      regulars: a.regulars.map((x, i) => (i === 0 ? { ...x, segment: 'hater', loyalty: 40, turned: { from: 'whale', day: 10 } } : x)),
    }
    const up = migrate(old)
    expect(up.incidents).toEqual([])
    expect(up.regulars[0].turned).toEqual({ from: 'whale', day: 10, level: 4 })
    expect(up.regulars[0].id).toBe(r.id)
  })
})
