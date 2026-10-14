import { describe, expect, it } from 'vitest'
import { createAccount } from '../store/account'
import type { Account } from '../store/schema'
import { balances } from './economy'
import { generateComments } from './comments'
import { addVaultItem, ContentError, publishPost } from './content'
import { activityFactor, freshness } from './posts'
import { simulate } from './simulate'

function account(accountType: 'free' | 'paid' = 'paid', seed = 'a'): Account {
  const a = createAccount({ id: 'x', seed, now: 0, name: 'Mia', handle: 'mia' })
  return { ...a, profile: { ...a.profile, accountType } }
}

const item = (n: number, tags = ['lingerie'], intensity = 3) => ({
  description: `Set ${n}`,
  tags,
  intensity,
  cast: 'me' as const,
})

function withVault(a: Account, n = 3) {
  for (let i = 0; i < n; i++) a = addVaultItem(a, `v${i}`, item(i))
  return a
}

describe('publishing', () => {
  it('follows the real OF rule: only free pages can lock posts', () => {
    const paid = withVault(account('paid'))
    const free = withVault(account('free'))
    const locked = { text: 'hi', vaultIds: ['v0'], access: 'locked' as const, priceCents: 999 }
    expect(() => publishPost(paid, 'p1', locked)).toThrow(/only available on free pages/)
    expect(publishPost(free, 'p1', locked).posts[0]).toMatchObject({ access: 'locked', priceCents: 999 })
  })

  it('validates input', () => {
    const a = withVault(account('free'))
    expect(() => publishPost(a, 'p', { text: ' ', vaultIds: [], access: 'free', priceCents: 0 })).toThrow(ContentError)
    expect(() => publishPost(a, 'p', { text: 'x', vaultIds: ['nope'], access: 'free', priceCents: 0 })).toThrow(/no longer exist/)
    expect(() => publishPost(a, 'p', { text: 'x', vaultIds: ['v0'], access: 'locked', priceCents: 100 })).toThrow(/Price/)
    expect(() => addVaultItem(a, 'v9', { ...item(9), intensity: 7 })).toThrow(/Intensity/)
  })
})

describe('post performance', () => {
  it('a post gets views, likes and comments from the next day on', () => {
    const a = publishPost(withVault(simulate(account(), 20).account), 'p1', { text: 'new set', vaultIds: ['v0'], access: 'free', priceCents: 0 })
    expect(a.posts[0].stats.views).toBe(0)
    const after = simulate(a, 3).account.posts[0].stats
    expect(after.views).toBeGreaterThan(0)
    expect(after.likes).toBeGreaterThan(0)
    expect(after.likes).toBeLessThanOrEqual(after.views)
  })

  it('locked posts on free pages sell and show up in the ledger', () => {
    let a = simulate(account('free'), 30).account
    a = publishPost(withVault(a), 'p1', { text: '', vaultIds: ['v0', 'v1'], access: 'locked', priceCents: 1500 })
    a = simulate(a, 5).account
    const post = a.posts[0]
    expect(post.stats.purchases).toBeGreaterThan(0)
    const ledgerGross = a.ledger.filter((l) => l.kind === 'post').reduce((s, l) => s + l.gross, 0)
    expect(ledgerGross).toBe(post.stats.purchases * 1500)
    expect(balances(a).earned).toBeGreaterThan(0)
  })

  it('repeating the same tags makes posts less fresh', () => {
    let a = withVault(account())
    a = publishPost(a, 'p1', { text: 'a', vaultIds: ['v0'], access: 'free', priceCents: 0 })
    a = publishPost(a, 'p2', { text: 'b', vaultIds: ['v1'], access: 'free', priceCents: 0 })
    expect(freshness(a.posts[1], a)).toBe(1)
    expect(freshness(a.posts[0], a)).toBeLessThan(1)
  })

  it('fans drift away when the creator stops posting', () => {
    const a = account()
    expect(activityFactor(a, 10)).toBe(1)
    expect(activityFactor(a, 20)).toBeLessThan(1)
  })

  it('posting regularly beats not posting over 90 days', () => {
    let posting = withVault(account('paid', 'b'), 6)
    let idle = account('paid', 'b')
    for (let d = 0; d < 90; d += 3) {
      posting = publishPost(posting, `p${d}`, { text: 'x', vaultIds: [`v${(d / 3) % 6}`], access: 'free', priceCents: 0 })
      posting = simulate(posting, 3).account
      idle = simulate(idle, 3).account
    }
    expect(posting.history.at(-1)!.subscribers).toBeGreaterThan(idle.history.at(-1)!.subscribers)
  })
})

describe('comments', () => {
  const setup = () => {
    let a = publishPost(withVault(simulate(account(), 30).account), 'p1', { text: 'x', vaultIds: ['v0'], access: 'free', priceCents: 0 })
    a = simulate(a, 1).account
    return a
  }

  it('match the post comment count and are the same every time', () => {
    const a = setup()
    const post = a.posts[0]
    const once = generateComments(a, post, { fanLanguage: 'en' as const })
    expect(once).toHaveLength(post.stats.comments)
    expect(generateComments(a, post, { fanLanguage: 'en' as const })).toEqual(once)
    expect(once.every((c) => c.text && c.name && c.handle && c.language === 'en')).toBe(true)
  })

  it('earlier comments stay the same when more arrive', () => {
    const a = setup()
    const before = generateComments(a, a.posts[0], { fanLanguage: 'en' as const })
    const later = simulate(a, 2).account
    const after = generateComments(later, later.posts[0], { fanLanguage: 'en' as const })
    expect(after.length).toBeGreaterThanOrEqual(before.length)
    for (const c of before) expect(after.find((x) => x.id === c.id)?.text).toBe(c.text)
  })

  it('use the chosen language', () => {
    const a = setup()
    const zh = generateComments(a, a.posts[0], { fanLanguage: 'zh' as const })
    expect(zh.every((c) => c.language === 'zh' && /[一-鿿]/.test(c.name))).toBe(true)
  })
})
