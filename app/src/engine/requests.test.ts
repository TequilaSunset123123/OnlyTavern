import { describe, expect, it } from 'vitest'
import { buildFanPrompt } from '../llm/fanMessage'
import preset from '../presets/audience.json'
import { createAccount } from '../store/account'
import { migrate } from '../store/migrate'
import D from '../presets/directions.json'
import { type Account, DIRECTIONS } from '../store/schema'
import { addVaultItem, publishPost } from './content'
import { balances } from './economy'
import { acceptMeetup, cancelMeetup, declineMeetup, hideMeetup } from './meetups'
import { fallbackText, sendDm } from './regulars'
import { acceptRequest, deliverRequest } from './requests'
import { simulate } from './simulate'

const SETTINGS = { fanLanguage: 'en' as const, connectionProfile: null }

function grown(seed = 'a', days = 60): Account {
  let a = createAccount({ id: 'x', seed, now: 0, name: 'Mia', handle: 'mia' })
  a = { ...a, profile: { ...a.profile, accountType: 'free' } }
  return simulate(a, days, seed, SETTINGS).account
}

/** Write to every active regular once a day and let the days pass, until `done` or `max` days. */
function talk(account: Account, done: (a: Account) => boolean, max = 120): Account {
  let a = account
  for (let i = 0; i < max && !done(a); i++) {
    for (const r of a.regulars.filter((x) => x.status === 'active')) a = sendDm(a, r.id, { text: `hi ${i}` }, a.meta.seed).account
    a = simulate(a, 1, a.meta.seed, SETTINGS).account
  }
  return a
}

const withRequest = (seed = 'a') => {
  const a = talk(grown(seed), (x) => x.requests.length > 0)
  const q = a.requests[0]
  expect(q).toBeDefined()
  return { a, q }
}

/** A new vault item that is exactly what the request asks for. */
function made(a: Account, id: string, tags: string[], intensity: number): Account {
  return addVaultItem(a, id, { description: `custom ${id}`, tags, intensity, cast: 'me' })
}

describe('custom requests', () => {
  it('only fans you talk to ask, for things they like, with an offer and a deadline', () => {
    expect(grown('a', 90).requests).toEqual([])
    const { a, q } = withRequest()
    const fan = a.regulars.find((r) => r.id === q.regularId)!
    expect(q.tags.every((t) => fan.likes.includes(t))).toBe(true)
    expect(q.offerCents).toBeGreaterThanOrEqual(preset.requests.minCents)
    expect(q.dueDay).toBe(q.day + preset.requests.dueDays)
    const ask = a.threads.find((t) => t.regularId === fan.id)!.messages.find((m) => m.id === q.messageId)!
    expect(ask).toMatchObject({ from: 'fan', intent: { kind: 'opener', deal: { kind: 'custom', step: 'ask', id: q.id } } })
    expect(withRequest().a.requests).toEqual(a.requests) // deterministic
  })

  it('new content that matches gets paid on delivery, with the platform fee', () => {
    const { a, q } = withRequest()
    let acc = made(acceptRequest(a, q.id), 'c1', q.tags, q.intensity)
    expect(() => deliverRequest(a, q.id, ['c1'], '', 's')).toThrow(/Accept the request first/)
    const spentBefore = acc.regulars.find((r) => r.id === q.regularId)!.spent
    const r = deliverRequest(acc, q.id, ['c1'], 'made just for you', acc.meta.seed)
    acc = r.account
    const done = acc.requests.find((x) => x.id === q.id)!
    expect(done).toMatchObject({ status: 'delivered', delivery: { paid: true, reason: 'liked', vaultIds: ['c1'] } })
    const line = acc.ledger.find((l) => l.kind === 'custom')!
    expect(line).toMatchObject({ gross: q.offerCents, fee: Math.round(q.offerCents * 0.2) })
    const tip = done.delivery?.tipCents ?? 0
    expect(acc.regulars.find((x) => x.id === q.regularId)!.spent).toBe(spentBefore + q.offerCents + tip)
    const messages = acc.threads.find((t) => t.regularId === q.regularId)!.messages
    expect(messages.at(-2)).toMatchObject({ from: 'me', text: 'made just for you', delivery: { requestId: q.id } })
    expect(messages.at(-1)).toMatchObject({ state: 'pending', intent: { kind: 'reply', deal: { kind: 'custom', step: 'delivered', id: q.id } } })
    expect(acc.events.some((e) => e.type === 'request-paid')).toBe(true)
    // A paid custom counts for the directions whose tags it asked for.
    for (const d of DIRECTIONS) {
      const counts = D.directions[d].signatureTags.some((t) => q.tags.includes(t))
      expect(acc.direction.points[d] - a.direction.points[d]).toBe(counts ? 2 : 0)
    }
    expect(() => deliverRequest(acc, q.id, ['c1'], '', 's')).toThrow(/no longer open/)
  })

  it('content they have seen before, or that is not what they asked for, is not paid', () => {
    const { a, q } = withRequest()
    const accepted = made(acceptRequest(a, q.id), 'c1', q.tags, q.intensity)
    const posted = publishPost(accepted, 'p1', { text: '', vaultIds: ['c1'], access: 'free', priceCents: 0 })
    const reused = deliverRequest(posted, q.id, ['c1'], '', 's').account.requests.find((x) => x.id === q.id)!
    expect(reused.delivery).toMatchObject({ paid: false, reason: 'reused' })

    const wrong = made(acceptRequest(a, q.id), 'w1', [], q.intensity)
    const off = deliverRequest(wrong, q.id, ['w1'], '', 's').account
    expect(off.requests.find((x) => x.id === q.id)!.delivery).toMatchObject({ paid: false, reason: 'tags' })
    expect(off.ledger.some((l) => l.kind === 'custom')).toBe(false)
  })

  it('a custom you accepted but did not deliver in time makes the fan say so', () => {
    const { a, q } = withRequest()
    const late = simulate(acceptRequest(a, q.id), preset.requests.dueDays + 1, a.meta.seed, SETTINGS).account
    expect(late.requests.find((x) => x.id === q.id)).toMatchObject({ status: 'expired', acceptedDay: a.clock.day })
    const said = late.threads.find((t) => t.regularId === q.regularId)!.messages.some((m) => m.intent?.deal?.step === 'late')
    expect(said).toBe(true)
  })

  it('the prompt and the fallback line carry what was asked and offered', () => {
    const { a, q } = withRequest()
    const t = a.threads.find((x) => x.regularId === q.regularId)!
    const view = {
      day: a.clock.day,
      regular: a.regulars.find((r) => r.id === q.regularId)!,
      messages: t.messages,
      read: 0,
      items: {},
      creator: { name: 'Mia', handle: 'mia', accountType: 'free' as const, priceCents: 0, subscribers: 100, direction: 'an anime e-girl' },
      loyalty: { points: 0, level: 1, cap: 5, name: 'Curious', from: 0, next: 5 },
      away: null,
      traits: [],
      requests: a.requests,
      meetups: [],
    }
    const [, user] = buildFanPrompt(view, q.messageId)
    expect(user.content).toContain(`you offer $${(q.offerCents / 100).toFixed(2)}`)
    // One line for what happens: the ask, and no topic line on top of it.
    expect(user.content.split('What happens now:')[1].trim().split('\n')).toHaveLength(1)
    expect(fallbackText(a, q.regularId, q.messageId)).toContain(`$${q.offerCents / 100}`)
  })
})

describe('meetups', () => {
  const withInvite = () => {
    const a = talk(grown('a'), (x) => x.meetups.length > 0, 200)
    const m = a.meetups[0]
    expect(m).toBeDefined()
    return { a, m }
  }

  it('fans you write to a lot invite you; accepted meetups pay cash on the day, outside the platform balance', () => {
    const { a, m } = withInvite()
    const invite = a.threads.find((t) => t.regularId === m.regularId)!.messages.find((x) => x.id === m.messageId)!
    expect(invite.intent).toMatchObject({ kind: 'opener', deal: { kind: 'meetup', step: 'ask', id: m.id } })
    expect(m.offerCents % preset.meetups.roundCents).toBe(0)

    const today = a.clock.day
    expect(() => acceptMeetup(a, m.id, today, false)).toThrow(/Pick a day/)
    expect(() => acceptMeetup(a, m.id, today + preset.meetups.maxAheadDays + 1, false)).toThrow(/Pick a day/)
    const accepted = hideMeetup(acceptMeetup(a, m.id, today + 2, false), m.id, true)
    expect(accepted.meetups[0]).toMatchObject({ status: 'accepted', meetDay: today + 2, hidden: true })

    const before = balances(accepted)
    const after1 = simulate(accepted, 1, a.meta.seed, SETTINGS).account
    expect(after1.meetups[0].status).toBe('accepted')
    const after = simulate(after1, 1, a.meta.seed, SETTINGS).account
    expect(after.meetups[0]).toMatchObject({ status: 'done', closedDay: today + 2 })
    const cash = after.ledger.find((l) => l.kind === 'offline')!
    expect(cash).toMatchObject({ day: today + 2, gross: m.offerCents, fee: 0, net: m.offerCents })
    const b = balances(after)
    expect(b.cash).toBe(before.cash + m.offerCents)
    expect(b.earned + b.cash).toBe(after.ledger.filter((l) => l.kind !== 'payout').reduce((s, l) => s + l.net, 0))
    expect(after.events.some((e) => e.type === 'meetup-done' && e.gross === m.offerCents)).toBe(true)
    expect(after.direction.points.escort - accepted.direction.points.escort).toBe(5)
    const last = after.threads.find((t) => t.regularId === m.regularId)!.messages.find((x) => x.intent?.deal?.step === 'met')
    expect(last).toBeDefined()
  })

  it('declining, cancelling and lapsing close the invitation', () => {
    const { a, m } = withInvite()
    expect(declineMeetup(a, m.id).meetups[0].status).toBe('declined')
    expect(() => declineMeetup(declineMeetup(a, m.id), m.id)).toThrow(/no longer open/)
    expect(() => cancelMeetup(a, m.id)).toThrow(/accepted/)
    expect(cancelMeetup(acceptMeetup(a, m.id, a.clock.day + 1, false), m.id).meetups[0].status).toBe('cancelled')
    const lapsed = simulate(a, preset.meetups.replyDays + 1, a.meta.seed, SETTINGS).account
    expect(lapsed.meetups[0].status).toBe('expired')
  })
})

describe('schema 5', () => {
  it('upgrades a step 4 save: no requests or meetups yet, two new earnings kinds', () => {
    const fresh = createAccount({ id: 'a1', seed: 's1', now: 0, name: 'Mia', handle: 'mia' })
    const { meetups: _, ...rest } = fresh
    const v4 = { ...rest, meta: { ...fresh.meta, schemaVersion: 4 }, history: [{ ...emptyDay(), net: { subscription: 0, renewal: 0, tip: 0, post: 0, message: 0, payout: 0 } }] }
    const up = migrate(v4)
    expect(up.meetups).toEqual([])
    expect(up.requests).toEqual([])
    expect(up.history[0].net).toMatchObject({ custom: 0, offline: 0 })
  })
})

function emptyDay() {
  const segments = { regular: 0, lurker: 0, simp: 0, whale: 0, hater: 0, freeloader: 0 }
  return { day: 1, subscribers: 0, bySegment: segments, newSubscribers: 0, churned: 0, visitors: 0 }
}
