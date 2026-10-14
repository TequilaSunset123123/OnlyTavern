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
