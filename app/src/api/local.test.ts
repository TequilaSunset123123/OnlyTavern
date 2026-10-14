import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '../store/storage'
import { createLocalApi } from './local'

function setup() {
  let n = 0
  const api = createLocalApi(createMemoryStorage(), {
    now: () => 1000 + n,
    newId: () => `id${++n}`,
    newSeed: () => `seed${n}`,
  })
  return api
}

describe('local api: accounts', () => {
  it('creates accounts and makes the newest one active', async () => {
    const api = setup()
    const a = await api.dispatch({ type: 'account.create', name: 'Mia', handle: 'mia' })
    const b = await api.dispatch({ type: 'account.create', name: 'Zoe', handle: 'zoe' })
    const index = await api.listAccounts()
    expect(index.accounts.map((x) => x.name)).toEqual(['Mia', 'Zoe'])
    expect(index.activeId).toBe(b.id)
    expect((await api.getAccount(a.id!))?.profile.handle).toBe('mia')
  })

  it('switches the active account', async () => {
    const api = setup()
    const a = await api.dispatch({ type: 'account.create', name: 'Mia', handle: 'mia' })
    await api.dispatch({ type: 'account.create', name: 'Zoe', handle: 'zoe' })
    await api.dispatch({ type: 'account.select', id: a.id! })
    expect((await api.listAccounts()).activeId).toBe(a.id)
    await expect(api.dispatch({ type: 'account.select', id: 'nope' })).rejects.toThrow(/not found/)
  })

  it('deletes accounts and falls back to another active one', async () => {
    const api = setup()
    const a = await api.dispatch({ type: 'account.create', name: 'Mia', handle: 'mia' })
    const b = await api.dispatch({ type: 'account.create', name: 'Zoe', handle: 'zoe' })
    await api.dispatch({ type: 'account.delete', id: b.id! })
    expect(await api.listAccounts()).toMatchObject({ accounts: [{ id: a.id }], activeId: a.id })
    expect(await api.getAccount(b.id!)).toBeNull()
    await api.dispatch({ type: 'account.delete', id: a.id! })
    expect(await api.listAccounts()).toEqual({ accounts: [], activeId: null })
  })

  it('exports and re-imports an account as a copy with identical content', async () => {
    const api = setup()
    const a = await api.dispatch({ type: 'account.create', name: 'Mia', handle: 'mia' })
    const { fileName, json } = await api.exportAccount(a.id!)
    expect(fileName).toBe('onlytavern-mia.json')
    const b = await api.dispatch({ type: 'account.import', json })
    expect(b.id).not.toBe(a.id)
    const [orig, copy] = [await api.getAccount(a.id!), await api.getAccount(b.id!)]
    expect({ ...copy!, meta: { ...copy!.meta, id: a.id } }).toEqual(orig)
    expect((await api.listAccounts()).accounts).toHaveLength(2)
  })

  it('returns only JSON-safe values', async () => {
    const api = setup()
    const r = await api.dispatch({ type: 'account.create', name: 'Mia', handle: 'mia' })
    const values = [r, await api.listAccounts(), await api.getAccount(r.id!), await api.exportAccount(r.id!)]
    for (const v of values) expect(JSON.parse(JSON.stringify(v))).toEqual(v)
  })
})

describe('local api: engine', () => {
  async function withAccount() {
    const api = setup()
    const { id } = await api.dispatch({ type: 'account.create', name: 'Mia', handle: 'mia' })
    return { api, id: id! }
  }

  it('advances the clock and reports events', async () => {
    const { api, id } = await withAccount()
    const r = await api.dispatch({ type: 'clock.advance', id, days: 30 })
    expect(r.delta).toEqual([`account:${id}`])
    expect(r.events.length).toBeGreaterThan(0)
    const stats = await api.getStatistics(id)
    expect(stats.day).toBe(30)
    expect(stats.history).toHaveLength(30)
    expect(stats.segments.reduce((a, s) => a + s.count, 0)).toBe(stats.history.at(-1)!.subscribers)
    await expect(api.dispatch({ type: 'clock.advance', id, days: 0 })).rejects.toThrow(/1–90/)
  })

  it('statements total up the ledger and payouts reduce the balance', async () => {
    const { api, id } = await withAccount()
    await api.dispatch({ type: 'clock.advance', id, days: 60 })
    const before = await api.getStatements(id)
    const sumNet = before.entries.reduce((a, e) => a + e.net, 0)
    expect(before.balances.earned).toBe(sumNet)
    expect(before.entries[0].day).toBeGreaterThanOrEqual(before.entries.at(-1)!.day) // newest first
    await api.dispatch({ type: 'payout.request', id, amount: 2000 })
    const after = await api.getStatements(id)
    expect(after.balances.available).toBe(before.balances.available - 2000)
    expect(after.totals.payout).toEqual({ count: 1, gross: 0, net: -2000 })
  })

  it('updates the profile and keeps the account list in sync', async () => {
    const { api, id } = await withAccount()
    await api.dispatch({ type: 'profile.update', id, patch: { name: 'Mia Rose', handle: '@miarose', priceCents: 1499 } })
    expect((await api.getAccount(id))?.profile).toMatchObject({ name: 'Mia Rose', handle: 'miarose', priceCents: 1499 })
    expect((await api.listAccounts()).accounts[0]).toMatchObject({ name: 'Mia Rose', handle: 'miarose' })
    await expect(api.dispatch({ type: 'profile.update', id, patch: { priceCents: 100 } })).rejects.toThrow(/Price/)
    await expect(api.dispatch({ type: 'profile.update', id, patch: { name: ' ' } })).rejects.toThrow(/empty/)
  })
})

describe('local api: content', () => {
  it('vault, publishing, feed, comments and notifications work end to end', async () => {
    const api = setup()
    const { id } = await api.dispatch({ type: 'account.create', name: 'Mia', handle: 'mia' })
    const accountId = id!
    await api.dispatch({ type: 'clock.advance', id: accountId, days: 20 })
    const v = await api.dispatch({
      type: 'vault.add',
      id: accountId,
      item: { description: 'Red lingerie set', tags: ['lingerie'], intensity: 3, cast: 'me' },
    })
    expect((await api.getVault(accountId)).map((i) => i.id)).toEqual([v.id])

    const p = await api.dispatch({ type: 'post.publish', id: accountId, post: { text: 'new set', vaultIds: [v.id!], access: 'free', priceCents: 0 } })
    await api.dispatch({ type: 'clock.advance', id: accountId, days: 3 })
    const feed = await api.getFeed(accountId)
    expect(feed.canLockPosts).toBe(false) // paid page
    expect(feed.posts[0]).toMatchObject({ id: p.id, tags: ['lingerie'], intensity: 3 })
    expect(feed.posts[0].items[0]?.description).toBe('Red lingerie set')

    const comments = await api.getComments(accountId, p.id!)
    expect(comments).toHaveLength(feed.posts[0].stats.comments)
    expect((await api.getNotifications(accountId)).some((e) => e.type === 'post')).toBe(true)

    await api.dispatch({ type: 'settings.update', patch: { fanLanguage: 'zh' } })
    expect(await api.getSettings()).toMatchObject({ fanLanguage: 'zh' })
    await expect(api.dispatch({ type: 'settings.update', patch: { fanLanguage: 'fr' as 'zh' } })).rejects.toThrow()
    expect((await api.getTags()).length).toBeGreaterThan(10)
  })
})
