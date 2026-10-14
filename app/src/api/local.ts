// The local (in-browser) implementation of Api: store/ (and later engine/)
// running in the iframe. Time and ids come in through `env` so tests are
// deterministic and store/ never calls Date.now() or Math.random() itself.
import { createAccount, summarize } from '../store/account'
import { migrate, SaveError, versionOf } from '../store/migrate'
import { SCHEMA_VERSION, type AccountIndex } from '../store/schema'
import type { AccountStorage } from '../store/storage'
import { exportAccount, exportFileName, importAccount } from '../store/transfer'
import type { Action, Api, DispatchResult } from './types'

export type Env = {
  now(): number
  newId(): string
  newSeed(): string
}

export function createLocalApi(storage: AccountStorage, env: Env): Api {
  async function load(id: string) {
    const raw = await storage.loadAccount(id)
    if (raw === null) return null
    const account = migrate(raw)
    if (versionOf(raw) < SCHEMA_VERSION) await storage.saveAccount(account) // keep the upgraded copy
    return account
  }

  async function mustLoad(id: string) {
    const account = await load(id)
    if (!account) throw new SaveError(`Account ${id} not found`)
    return account
  }

  async function updateIndex(change: (index: AccountIndex) => AccountIndex) {
    await storage.saveIndex(change(await storage.loadIndex()))
  }

  const actions: { [T in Action['type']]: (a: Extract<Action, { type: T }>) => Promise<DispatchResult> } = {
    async 'account.create'({ name, handle }) {
      const account = createAccount({ id: env.newId(), seed: env.newSeed(), now: env.now(), name, handle })
      await storage.saveAccount(account)
      await updateIndex((i) => ({ accounts: [...i.accounts, summarize(account, env.now())], activeId: account.meta.id }))
      return { delta: ['accounts'], events: [], id: account.meta.id }
    },

    async 'account.select'({ id }) {
      const { accounts } = await storage.loadIndex()
      if (!accounts.some((a) => a.id === id)) throw new SaveError(`Account ${id} not found`)
      await updateIndex((i) => ({ ...i, activeId: id }))
      return { delta: ['accounts'], events: [] }
    },

    async 'account.delete'({ id }) {
      await storage.deleteAccount(id)
      await updateIndex((i) => {
        const accounts = i.accounts.filter((a) => a.id !== id)
        const activeId = i.activeId === id ? (accounts[0]?.id ?? null) : i.activeId
        return { accounts, activeId }
      })
      return { delta: ['accounts', `account:${id}`], events: [] }
    },

    async 'account.import'({ json }) {
      const account = importAccount(json, env.newId())
      await storage.saveAccount(account)
      await updateIndex((i) => ({ accounts: [...i.accounts, summarize(account, env.now())], activeId: account.meta.id }))
      return { delta: ['accounts'], events: [], id: account.meta.id }
    },
  }

  return {
    listAccounts: () => storage.loadIndex(),
    getAccount: load,
    async exportAccount(id) {
      const account = await mustLoad(id)
      return { fileName: exportFileName(account), json: exportAccount(account) }
    },
    dispatch(action) {
      const run = actions[action.type] as (a: Action) => Promise<DispatchResult>
      return run(action)
    },
  }
}
