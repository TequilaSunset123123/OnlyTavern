import { describe, expect, it } from 'vitest'
import { buildFanPrompt, parseFanMessage } from '../llm/fanMessage'
import { createAccount } from '../store/account'
import type { Account } from '../store/schema'
import { addVaultItem } from './content'
import { sendMass, simulateMassDay } from './massMessages'
import { fallbackText, fillMessage, markRead, sendDm } from './regulars'
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
    const filled = fillMessage(a, r.id, opener.id, fallbackText(a, r.id, opener.id))
    const m = filled.threads.find((x) => x.regularId === r.id)!.messages[0]
    expect(m.state).toBe('sent')
    expect(m.text.length).toBeGreaterThan(0)
    expect(markRead(filled, r.id).threads.find((x) => x.regularId === r.id)!.read).toBeGreaterThan(0)
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
      creator: { name: 'Mia', handle: 'mia', accountType: 'free' as const, priceCents: 0, subscribers: 100 },
    }
    const [system, user] = buildFanPrompt(view, t.messages.at(-1)!.id)
    expect(system.content).toContain('<message>')
    expect(user.content).toMatch(/You (bought|did NOT buy) the paid message \[paid message, \$5.00: Red lace set\]/)
    expect(user.content).toContain('[Creator] look')
  })

  it('parses leniently', () => {
    expect(parseFanMessage('<think>hmm</think>\n<message>hey you 😍</message>')).toBe('hey you 😍')
    expect(parseFanMessage('Mike: "can I get more?"', 'Mike')).toBe('can I get more?')
    expect(parseFanMessage('[You] *smiles* sure thing')).toBe('sure thing')
    expect(parseFanMessage('<message>unclosed reply')).toBe('unclosed reply')
    expect(() => parseFanMessage('<message></message>')).toThrow(/empty/)
  })
})
