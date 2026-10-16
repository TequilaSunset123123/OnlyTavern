import { describe, expect, it } from 'vitest'
import { buildFanPrompt, parseFanMessage } from '../llm/fanMessage'
import { createAccount } from '../store/account'
import type { Account } from '../store/schema'
import { addVaultItem, publishPost } from './content'
import { sendMass, simulateMassDay } from './massMessages'
import { activeCap, fallbackText, fillMessage, markRead, sendDm, simulateRegularsDay, tagAttracts } from './regulars'
import { simulate } from './simulate'

function grown(seed = 'a', days = 40): Account {
  let a = createAccount({ id: 'x', seed, now: 0, name: 'Mia', handle: 'mia' })
  a = { ...a, profile: { ...a.profile, accountType: 'free' } }
  a = addVaultItem(a, 'v0', { description: 'Red lace set', tags: ['lingerie'], intensity: 3, cast: 'me' })
  return simulate(a, days, seed, { fanLanguage: 'en', connectionProfile: null }).account
}

describe('regulars', () => {
  it('crowd fans become regulars over time, up to the cap, each with an opening message', () => {
    const a = grown('a', 90)
    expect(a.regulars.length).toBeGreaterThan(0)
    expect(a.regulars.filter((r) => r.status === 'active').length).toBeLessThanOrEqual(8)
    for (const r of a.regulars) {
      const t = a.threads.find((x) => x.regularId === r.id)!
      expect(t.messages[0]).toMatchObject({ from: 'fan', intent: { kind: 'opener' } })
      expect(r.name && r.handle && r.bio).toBeTruthy()
      // Spent counts every tip this fan sent, opener tips included.
      const tips = t.messages.reduce((sum, m) => sum + (m.from === 'fan' ? (m.tipCents ?? 0) : 0), 0)
      expect(r.spent).toBe(tips)
    }
  })

  it('is deterministic', () => {
    expect(grown('b', 60).regulars).toEqual(grown('b', 60).regulars)
  })

  it('uses the fan language setting for new regulars', () => {
    let a = createAccount({ id: 'x', seed: 'c', now: 0, name: 'Mia', handle: 'mia' })
    a = simulate(a, 90, 'c', { fanLanguage: 'zh', connectionProfile: null }).account
    expect(a.regulars.length).toBeGreaterThan(0)
    expect(a.regulars.every((r) => r.language === 'zh')).toBe(true)
  })

  it('degradation, domination and BDSM posts draw in more misogynists', () => {
    let a = createAccount({ id: 'x', seed: 'm', now: 0, name: 'Mia', handle: 'mia' })
    a = addVaultItem(a, 'v0', { description: 'Collar and leash', tags: ['degradation', 'domination'], intensity: 5, cast: 'me' })
    a = addVaultItem(a, 'v1', { description: 'Red lace set', tags: ['lingerie'], intensity: 3, cast: 'me' })
    expect(tagAttracts(a, 0)).toEqual({})
    const kinky = publishPost(a, 'p0', { text: '', vaultIds: ['v0'], access: 'free', priceCents: 0 })
    // The strongest tag on a post counts: degradation ×3.
    expect(tagAttracts(kinky, 0)).toEqual({ misogynist: 3 })
    // Half your recent posts: half the pull.
    const mixed = publishPost(kinky, 'p1', { text: '', vaultIds: ['v1'], access: 'free', priceCents: 0 })
    expect(tagAttracts(mixed, 0)).toEqual({ misogynist: 2 })
    // Older than regulars.recentDays: no pull.
    expect(tagAttracts(mixed, 30)).toEqual({})
  })

  it('a lower cap in Settings sends the regulars you neglected longest to sleep', () => {
    const settings = { fanLanguage: 'en' as const, connectionProfile: null }
    const a = grown('cap', 120)
    const active = a.regulars.filter((r) => r.status === 'active').length
    expect(active).toBeGreaterThan(3)
    const day = a.clock.day + 1
    const after = simulateRegularsDay({ ...a, requests: [], meetups: [] }, a.audience, 'cap', day, { ...settings, maxActiveRegulars: 3 }).account
    expect(after.regulars.filter((r) => r.status === 'active' && !r.conditions.some((c) => c.id === 'hostile')).length).toBeLessThanOrEqual(3)
    expect(activeCap(settings)).toBe(8)
  })
})

describe('DMs', () => {
  const withRegular = () => {
    const a = grown('a', 90)
    return { a, r: a.regulars[0] }
  }

  it('sending queues a pending reply with the engine decision; buying shows in the ledger', () => {
    const { a, r } = withRegular()
    let bought = 0
    let acc = a
    for (let i = 0; i < 20; i++) {
      acc = sendDm(acc, r.id, { text: `pic ${i}`, ppv: { vaultIds: ['v0'], priceCents: 500 } }, acc.meta.seed).account
      const t = acc.threads.find((x) => x.regularId === r.id)!
      const reply = t.messages.at(-1)!
      expect(reply).toMatchObject({ from: 'fan', state: 'pending', intent: { kind: 'reply' } })
      if (t.messages.at(-2)!.ppv?.paid) bought++
      acc = fillMessage(acc, r.id, reply.id, 'ok')
    }
    const dmIncome = acc.ledger.filter((l) => l.kind === 'message').reduce((s, l) => s + l.gross, 0)
    expect(dmIncome).toBe(bought * 500)
    expect(acc.regulars.find((x) => x.id === r.id)!.spent).toBeGreaterThanOrEqual(dmIncome)
  })

  it('writing twice before the fan answers folds into one reply', () => {
    const { a, r } = withRegular()
    let acc = sendDm(a, r.id, { text: 'hey' }, a.meta.seed).account
    acc = sendDm(acc, r.id, { text: 'you there?' }, a.meta.seed).account
    const t = acc.threads.find((x) => x.regularId === r.id)!
    expect(t.messages.filter((m) => m.state === 'pending' && m.intent?.kind === 'reply')).toHaveLength(1)
    expect(t.messages.at(-1)!.state).toBe('pending')
  })

  it('a corpus line fills an opener when the model is unavailable', () => {
    const { a, r } = withRegular()
    const opener = a.threads.find((x) => x.regularId === r.id)!.messages[0]
    const filled = fillMessage(a, r.id, opener.id, fallbackText(a, r.id, opener.id), 'corpus')
    const m = filled.threads.find((x) => x.regularId === r.id)!.messages[0]
    expect(m).toMatchObject({ state: 'sent', writtenBy: 'corpus' })
    expect(m.text.length).toBeGreaterThan(0)
    expect(markRead(filled, r.id).threads.find((x) => x.regularId === r.id)!.read).toBeGreaterThan(0)
  })

  it('chatting first warms a fan up: they buy more often', () => {
    const rate = (warmUp: number) => {
      let sold = 0
      for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
        const a = grown(seed, 90)
        for (const r of a.regulars.filter((x) => x.segment === 'regular' || x.segment === 'simp')) {
          let acc = a
          for (let i = 0; i < warmUp; i++) acc = sendDm(acc, r.id, { text: `hey ${i}` }, seed).account
          for (let k = 0; k < 10; k++) {
            const res = sendDm(acc, r.id, { text: 'for you', ppv: { vaultIds: ['v0'], priceCents: 999 } }, `${seed}${k}`).account
            if (res.threads.find((x) => x.regularId === r.id)!.messages.at(-2)!.ppv!.paid) sold++
          }
        }
      }
      return sold
    }
    expect(rate(10)).toBeGreaterThan(rate(0))
  })

  it('a decision that is not to buy says why', () => {
    const { a, r } = withRegular()
    const acc = sendDm(a, r.id, { text: 'pricey', ppv: { vaultIds: ['v0'], priceCents: 20000 } }, a.meta.seed).account
    const reply = acc.threads.find((x) => x.regularId === r.id)!.messages.at(-1)!
    expect(reply.intent?.ppv?.[0]).toMatchObject({ bought: false, reason: 'price' })
  })

  it('validates paid messages', () => {
    const { a, r } = withRegular()
    expect(() => sendDm(a, r.id, { text: '', ppv: { vaultIds: ['nope'], priceCents: 500 } }, 's')).toThrow(/no longer exist/)
    expect(() => sendDm(a, r.id, { text: '' }, 's')).toThrow(/Write something/)
  })
})

describe('mass messages', () => {
  it('the crowd buys over the next days and up to 3 regulars answer', () => {
    const a = grown('a', 90)
    const sent = sendMass(a, 'm1', { text: 'new set', ppv: { vaultIds: ['v0'], priceCents: 800 }, audience: 'all' }, a.meta.seed).account
    const pendingReplies = sent.threads.filter((t) => t.messages.at(-1)?.state === 'pending' && t.messages.at(-2)?.massId === 'm1')
    expect(pendingReplies.length).toBeLessThanOrEqual(3)
    const day = simulateMassDay(sent, sent.audience, sent.meta.seed, sent.clock.day + 1)
    expect(day.massMessages[0].stats.views).toBeGreaterThan(0)
    const after = simulate(sent, 3).account
    expect(after.massMessages[0].stats.views).toBeGreaterThan(0)
    const crowdIncome = after.ledger.filter((l) => l.kind === 'message' && l.id === `${l.day}-message`).reduce((s, l) => s + l.gross, 0)
    expect(crowdIncome).toBe(after.massMessages[0].stats.purchases * 800)
  })
})

describe('fan message prompt and parsing', () => {
  it('the prompt carries the decision and the history, and no example sentences', () => {
    const a = grown('a', 90)
    const r = a.regulars[0]
    const acc = sendDm(a, r.id, { text: 'look', ppv: { vaultIds: ['v0'], priceCents: 500 } }, a.meta.seed).account
    const t = acc.threads.find((x) => x.regularId === r.id)!
    const view = {
      day: acc.clock.day,
      regular: acc.regulars.find((x) => x.id === r.id)!,
      messages: t.messages,
      read: 0,
      items: { v0: acc.vault[0] },
      creator: { name: 'Mia', handle: 'mia', accountType: 'free' as const, priceCents: 0, subscribers: 100, direction: 'an anime e-girl' },
      loyalty: { points: 0, level: 1, cap: 5, name: 'Curious', from: 0, next: 5 },
      away: null,
      incidents: [],
      personality: { id: 'horny_direct', label: 'Horny', prompt: 'always horny' },
      behaviours: [{ id: 'creepy_compliments', label: 'Creepy', prompt: 'sleazy compliments' }],
      conditions: [{ id: 'hostile', label: 'Hostile', prompt: 'you resent her' }],
      requests: [],
      meetups: [],
    }
    const [system, user] = buildFanPrompt(view, t.messages.at(-1)!.id)
    expect(system.content).toContain('<message>')
    expect(user.content).toMatch(/You (bought|did not buy) her paid message \[paid message, \$5.00: Red lace set\]/)
    expect(user.content).toContain('[Her] look')
    expect(system.content).toContain('Mention money or a deal only when')
    expect(user.content).toContain('How you write: always horny.')
    expect(user.content).toContain('What you are like: sleazy compliments.')
    expect(user.content).toContain('Right now: you resent her.')
    expect(user.content).not.toMatch(/You are sending a \$/)
  })

  it('parses leniently', () => {
    expect(parseFanMessage('<think>hmm</think>\n<message>hey you 😍</message>')).toBe('hey you 😍')
    expect(parseFanMessage('Mike: "can I get more?"', 'Mike')).toBe('can I get more?')
    expect(parseFanMessage('[You] *smiles* sure thing')).toBe('sure thing')
    expect(parseFanMessage('<message>unclosed reply')).toBe('unclosed reply')
    expect(() => parseFanMessage('<message></message>')).toThrow(/empty/)
    // A sentence that starts with "You" keeps it (Robert, 2026-10-16); a speaker tag does not.
    expect(parseFanMessage("<message>You haven't answered me for hours, baby...</message>")).toBe("You haven't answered me for hours, baby...")
    expect(parseFanMessage('Fan: miss you')).toBe('miss you')
    expect(parseFanMessage('<message>\n    hey   baby,\n\n\n\n   miss you  </message>')).toBe('hey baby,\n\nmiss you')
  })
})
