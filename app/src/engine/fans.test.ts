import { describe, expect, it } from 'vitest'
import personas from '../presets/personas.json'
import { createAccount } from '../store/account'
import type { Account, Meetup, Regular } from '../store/schema'
import { subscriberCount } from './audience'
import { addVaultItem } from './content'
import { fanProfile, loyaltyEffects, loyaltyLevel } from './fans'
import { acceptMeetup, meetupOdds, simulateMeetupsDay } from './meetups'
import { sendDm } from './regulars'
import { simulate } from './simulate'
import { threadOf } from './threads'

const grown = (seed = 'a') => simulate(createAccount({ id: 'x', seed, now: 0, name: 'TestCreator', handle: 'test' }), 60, seed).account
const set = (a: Account, id: string, patch: Partial<Regular>): Account => ({ ...a, regulars: a.regulars.map((r) => (r.id === id ? { ...r, ...patch } : r)) })
const reg = (a: Account, id: string) => a.regulars.find((r) => r.id === id)!

describe('loyalty', () => {
  it('rises with what you do together, in five levels, up to his type’s ceiling', () => {
    const a = grown()
    const id = a.regulars[0].id
    let acc = set(a, id, { segment: 'simp', loyalty: 0 })
    expect(loyaltyLevel(reg(acc, id))).toBe(1)
    for (let i = 0; i < 5; i++) acc = sendDm(acc, id, { text: `hey ${i}` }, 's').account
    expect(reg(acc, id).loyalty).toBeGreaterThanOrEqual(5)
    expect(loyaltyLevel(reg(acc, id))).toBeGreaterThanOrEqual(2)
    expect(acc.events.some((e) => e.type === 'loyalty-up' && e.regularId === id && e.level === 2)).toBe(true)

    // A freeloader never gets past level 1, however much you talk.
    const free = set(a, id, { segment: 'freeloader', loyalty: 500 })
    expect(loyaltyLevel(reg(free, id))).toBe(1)
    expect(fanProfile(reg(free, id)).meetup.daily).toBe(0)
    expect(personas.segments.freeloader.fan.loyaltyCap).toBe(1)
  })

  it('a fanatic buys anything; a cold fan is picky', () => {
    let a = addVaultItem(grown('b'), 'v0', { description: 'tame selfie', tags: [], intensity: 1, cast: 'me' })
    const id = a.regulars[0].id
    a = set(a, id, { segment: 'whale', loyalty: 1000 })
    expect(loyaltyEffects(reg(a, id)).buysAnything).toBe(true)
    for (let i = 0; i < 10; i++) {
      // A tame $200 selfie, nothing he likes: only a fanatic would buy it.
      const sent = sendDm(a, id, { text: 'for you', ppv: { vaultIds: ['v0'], priceCents: 20000 } }, `f${i}`).account
      expect(threadOf(sent, id).messages.at(-2)!.ppv!.paid).toBe(true)
    }
    const cold = set(a, id, { segment: 'regular', loyalty: 0 })
    const sold = Array.from({ length: 10 }, (_, i) => sendDm(cold, id, { text: 'for you', ppv: { vaultIds: ['v0'], priceCents: 20000 } }, `c${i}`).account).filter(
      (s) => threadOf(s, id).messages.at(-2)!.ppv!.paid,
    ).length
    expect(sold).toBeLessThan(3)
  })

  it('a stalker you write to about once a week, and leave on read in between, still asks to meet (Rick, 2026-10-15)', () => {
    let invited = 0
    for (const seed of ['c', 'd', 'e', 'f']) {
      const a = grown(seed)
      const id = a.regulars[0].id
      // Like Rick: a simp with obsessive + stalker traits and a few of your messages behind him.
      let acc = set(a, id, { segment: 'simp', personality: 'pet_names', behaviours: ['obsessive', 'stalker'], loyalty: 7, status: 'active', relationship: 'single' })
      for (let d = 0; d < 30 && !acc.meetups.some((m) => m.regularId === id); d++) {
        if (d % 7 === 0) acc = sendDm(acc, id, { text: 'hey' }, seed).account
        acc = simulate(acc, 1, seed).account
      }
      if (acc.meetups.some((m) => m.regularId === id)) invited++
    }
    expect(invited).toBeGreaterThanOrEqual(3)
  })

  it('loyalty makes fans ask for customs and meetups more often', () => {
    const count = (loyalty: number) => {
      let n = 0
      for (const seed of ['a', 'b', 'c', 'd']) {
        let acc = grown(seed)
        acc = { ...acc, regulars: acc.regulars.map((r) => ({ ...r, segment: 'regular' as const, personality: 'horny_direct', behaviours: [], loyalty, status: 'active' as const })) }
        acc = simulate(acc, 30, seed).account
        n += acc.requests.length + acc.meetups.length
      }
      return n
    }
    // Regular fans: level 2 asks for customs now and then; level 4 asks more, and asks to meet too.
    expect(count(35)).toBeGreaterThan(count(5) * 1.5)
  })
})

describe('meetup outcomes', () => {
  const withMeetup = (patch: Partial<Regular>, seed = 'd') => {
    const a = grown(seed)
    const id = a.regulars[0].id
    const acc = set(a, id, { segment: 'whale', personality: 'dominant', behaviours: [], conditions: [], loyalty: 40, status: 'active', relationship: 'married', ...patch })
    const m: Meetup = { id: 'm1', regularId: id, day: acc.clock.day, offerCents: 100000, replyBy: acc.clock.day + 5, status: 'open', hidden: false, messageId: 'x' }
    return { acc: acceptMeetup({ ...acc, meetups: [...acc.meetups, m] }, 'm1', acc.clock.day + 1, false), id }
  }

  it('odds come from his type, behaviours, marriage and your direction', () => {
    const married = meetupOdds(withMeetup({}).acc, reg(withMeetup({}).acc, withMeetup({}).id))
    const single = meetupOdds(withMeetup({ relationship: 'single' }).acc, reg(withMeetup({ relationship: 'single' }).acc, withMeetup({}).id))
    expect(married.wife).toBeGreaterThan(0)
    expect(single.wife).toBe(0)
    const stalker = withMeetup({ segment: 'simp', behaviours: ['stalker'] })
    expect(meetupOdds(stalker.acc, reg(stalker.acc, stalker.id)).creep).toBe(personas.segments.simp.fan.meetup.events.creep * 3)
    const escort = { ...stalker.acc, direction: { ...stalker.acc.direction, id: 'escort' as const, points: { ...stalker.acc.direction.points, escort: 500 } } }
    expect(meetupOdds(escort, reg(escort, stalker.id)).creep).toBeLessThan(meetupOdds(stalker.acc, reg(stalker.acc, stalker.id)).creep!)
  })

  it('each outcome settles the money and its consequences', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 60 && seen.size < 5; i++) {
      const { acc, id } = withMeetup({ segment: i % 2 ? 'simp' : 'whale', ...(i % 3 ? { behaviours: ['stalker'] } : { personality: 'dominant' }) }, `s${i}`)
      const before = subscriberCount(acc.audience)
      const day = simulateMeetupsDay(acc, `o${i}`, acc.clock.day + 1)
      const m = day.account.meetups.find((x) => x.id === 'm1')!
      const cash = day.account.ledger.filter((l) => l.kind === 'offline' && l.id.endsWith('m1')).reduce((s, l) => s + l.gross, 0)
      seen.add(m.outcome!)
      expect(m.status).toBe('done')
      expect(cash).toBe(m.paidCents)
      if (m.outcome === 'smooth') expect(m.paidCents).toBe(100000)
      if (m.outcome === 'bonus') expect(m.paidCents).toBe(150000)
      if (m.outcome === 'noShow') expect(m.paidCents).toBe(0)
      if (m.outcome === 'creep') {
        expect(m.paidCents).toBe(50000)
        expect(reg(day.account, id).behaviours).toContain('stalker')
      }
      if (m.outcome === 'wife') {
        expect(m.paidCents).toBe(0)
        expect(reg(day.account, id).status).toBe('dormant')
        expect(reg(day.account, id).conditions.map((c) => c.id)).toContainEqual(expect.stringMatching(/^(blocked|lyingLow)$/))
        expect(subscriberCount(day.account.audience)).toBeLessThanOrEqual(before)
      }
      expect(day.events[0]).toMatchObject({ type: 'meetup-done', outcome: m.outcome, gross: m.paidCents })
      expect(threadOf(day.account, id).messages.at(-1)!.intent?.deal).toEqual({ kind: 'meetup', step: 'met', id: 'm1' })
    }
    expect(seen.size).toBeGreaterThanOrEqual(4)
  })

  it('after his wife catches you: up to Loyal he blocks you for good; Devoted or more comes back in 2–4 weeks', () => {
    const caught = (loyalty: number) => {
      for (let i = 0; i < 200; i++) {
        const { acc, id } = withMeetup({ loyalty }, `w${i}`)
        const day = simulateMeetupsDay(acc, `w${i}`, acc.clock.day + 1)
        if (day.account.meetups.find((x) => x.id === 'm1')!.outcome === 'wife') return { acc: { ...day.account, clock: { day: acc.clock.day + 1 } }, id, events: day.events }
      }
      throw new Error('no wife outcome in 200 tries')
    }
    // Loyal (level 3): gone for good, and you cannot write to him.
    const low = caught(20)
    expect(reg(low.acc, low.id).conditions).toEqual([{ id: 'blocked', since: low.acc.clock.day, by: 'him' }])
    expect(low.events[0]).toMatchObject({ returns: false })
    expect(() => sendDm(low.acc, low.id, { text: 'hey' }, 's')).toThrow(/blocked/)
    expect(simulate(low.acc, 60, 'x').account.regulars.find((r) => r.id === low.id)!.status).toBe('dormant')

    // Devoted (level 4): lies low, then writes to you again and stays around.
    const high = caught(40)
    const until = reg(high.acc, high.id).conditions.find((c) => c.id === 'lyingLow')!.until
    expect(until - high.acc.clock.day).toBeGreaterThanOrEqual(14)
    expect(until - high.acc.clock.day).toBeLessThanOrEqual(30)
    expect(high.events[0]).toMatchObject({ returns: true })
    expect(() => sendDm(high.acc, high.id, { text: 'hey' }, 's')).toThrow(/lying low/)
    const back = simulate(high.acc, until - high.acc.clock.day, 'x')
    expect(reg(back.account, high.id).status).toBe('active')
    expect(back.events).toContainEqual({ day: until, type: 'regular-back', regularId: high.id, reason: 'wife' })
    expect(threadOf(back.account, high.id).messages.at(-1)!.intent?.deal).toEqual({ kind: 'meetup', step: 'back', id: 'm1' })
    expect(sendDm(back.account, high.id, { text: 'welcome back' }, 's').account).toBeTruthy()
  })
})
