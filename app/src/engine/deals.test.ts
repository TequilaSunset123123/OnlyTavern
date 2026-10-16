import { describe, expect, it } from 'vitest'
import { buildFanPrompt } from '../llm/fanMessage'
import { createAccount } from '../store/account'
import { migrate } from '../store/migrate'
import type { Account, Regular } from '../store/schema'
import { askedFor, dealChance } from './deals'
import { sendDm } from './regulars'
import { simulate } from './simulate'
import { threadOf } from './threads'

const grown = (seed = 'a', direction?: 'escort') => {
  let a = createAccount({ id: 'x', seed, now: 0, name: 'TestCreator', handle: 'test', direction })
  a = simulate(a, 90, seed).account
  return a
}
const as = (a: Account, r: Regular, segment: Regular['segment']): Account => ({ ...a, regulars: a.regulars.map((x) => (x.id === r.id ? { ...x, segment, traits: ['pet_names'] } : x)) })

function view(a: Account, r: Regular) {
  const t = threadOf(a, r.id)
  return {
    day: a.clock.day,
    regular: a.regulars.find((x) => x.id === r.id)!,
    messages: t.messages,
    read: 0,
    items: {},
    creator: { name: 'TestCreator', handle: 'test', accountType: 'paid' as const, priceCents: 999, subscribers: 100, direction: 'an amateur creator' },
    loyalty: { points: 0, level: 1, cap: 5, name: 'Curious', from: 0, next: 5 },
    away: null,
    incidents: [],
    traits: [],
    requests: a.requests,
    meetups: a.meetups,
  }
}

describe('deals: one way in, decided by the engine', () => {
  it('reads a custom or a meetup out of your message', () => {
    expect(askedFor('want me to make you a custom?')).toBe('custom')
    expect(askedFor('sure open a request for a custom video')).toBe('custom')
    expect(askedFor('给你拍个定制吧')).toBe('custom')
    expect(askedFor('we could meet up this weekend')).toBe('meetup')
    expect(askedFor('要不要见一面')).toBe('meetup')
    expect(askedFor('nice to meet you babe')).toBeNull()
    expect(askedFor('hey how was your day')).toBeNull()
  })

  it('when you bring up a custom, he says yes or no by the odds; yes opens it on his reply with a card, no does not', () => {
    let yes = 0
    let no = 0
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const base = grown(seed)
      const r0 = base.regulars[0]
      if (!r0) continue
      const a = as(base, r0, 'simp')
      const r = a.regulars.find((x) => x.id === r0.id)!
      const sent = sendDm(a, r.id, { text: 'want a custom made just for you?' }, `ask-${seed}`).account
      const reply = threadOf(sent, r.id).messages.at(-1)!
      expect(reply.intent?.deal?.kind).toBe('custom')
      if (reply.intent?.deal?.step === 'ask') {
        yes++
        const q = sent.requests.find((x) => x.id === reply.intent!.deal!.id)!
        expect(q).toMatchObject({ regularId: r.id, status: 'open', messageId: reply.id })
        expect(sent.events.some((e) => e.type === 'request' && e.requestId === q.id)).toBe(true)
      } else {
        no++
        expect(reply.intent?.deal).toEqual({ kind: 'custom', step: 'no' })
        expect(sent.requests.length).toBe(a.requests.length)
      }
      // The chance is a plain number: his type × warmth × direction, capped at 95%.
      const p = dealChance(a, r, 'custom', true)
      expect(p).toBeGreaterThan(0.4)
      expect(p).toBeLessThanOrEqual(0.95)
    }
    expect(yes + no).toBeGreaterThan(3)
    expect(yes).toBeGreaterThan(0)
  })

  it('haters never take a deal; escorts get far more yeses to a meetup', () => {
    const a = grown('a')
    const r = a.regulars[0]
    const hater = as(a, r, 'hater')
    expect(dealChance(hater, hater.regulars.find((x) => x.id === r.id)!, 'custom', true)).toBe(0)
    const sent = sendDm(hater, r.id, { text: 'want a custom?' }, 's').account
    expect(threadOf(sent, r.id).messages.at(-1)!.intent?.deal).toEqual({ kind: 'custom', step: 'no' })

    const whaleHere = as(a, r, 'whale')
    const escort = { ...whaleHere, direction: { ...whaleHere.direction, id: 'escort' as const, points: { ...whaleHere.direction.points, escort: 200 } } }
    const w = (acc: Account) => acc.regulars.find((x) => x.id === r.id)!
    expect(dealChance(escort, w(escort), 'meetup', true)).toBeGreaterThan(dealChance(whaleHere, w(whaleHere), 'meetup', true) * 1.5)
  })

  it('the prompt gets one line for what happens, and nothing about deals that are not happening', () => {
    const a = grown('b')
    const r = a.regulars[0]
    const opener = threadOf(a, r.id).messages.find((m) => m.intent?.kind === 'opener' && !m.intent.deal)!
    const plain = buildFanPrompt(view(a, r), opener.id)[1].content.split('What happens now:')[1]
    expect(plain).not.toMatch(/custom|meet/i)

    const hater = as(a, r, 'hater')
    const sent = sendDm(hater, r.id, { text: 'come on, meet up with me' }, 's').account
    const reply = threadOf(sent, r.id).messages.at(-1)!
    const lines = buildFanPrompt(view(sent, r), reply.id)[1].content.split('What happens now:')[1].trim().split('\n')
    expect(lines).toContain('- She brought up meeting in person; you turn it down.')
  })

  it('older saves move their request and meetup notes on fan messages into one deal field', () => {
    const a = grown('c')
    const r = a.regulars[0]
    const t = threadOf(a, r.id)
    const old = {
      ...a,
      meta: { ...a.meta, schemaVersion: 7 },
      threads: a.threads.map((x) =>
        x.regularId === r.id
          ? {
              ...x,
              messages: [
                ...t.messages,
                { id: 'o1', day: 1, from: 'fan', text: 'hi', state: 'sent', intent: { kind: 'opener', request: { requestId: 'q1', phase: 'ask' } } },
                { id: 'o2', day: 2, from: 'fan', text: 'hi', state: 'sent', intent: { kind: 'opener', meetup: { meetupId: 'm1', phase: 'invite' } } },
                { id: 'o3', day: 3, from: 'fan', text: 'hi', state: 'sent', intent: { kind: 'opener', meetup: { meetupId: 'm1', phase: 'after' } } },
              ],
            }
          : x,
      ),
    }
    const up = threadOf(migrate(old), r.id).messages.slice(-3).map((m) => m.intent?.deal)
    expect(up).toEqual([
      { kind: 'custom', step: 'ask', id: 'q1' },
      { kind: 'meetup', step: 'ask', id: 'm1' },
      { kind: 'meetup', step: 'met', id: 'm1' },
    ])
  })
})
