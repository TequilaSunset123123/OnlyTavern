// The local (in-browser) implementation of Api: store/ and engine/ running in
// the iframe. Time and ids come in through `env` so tests are
// deterministic and store/ never calls Date.now() or Math.random() itself.
import { subscriberCount } from '../engine/audience'
import { balances, requestPayout } from '../engine/economy'
import { simulate } from '../engine/simulate'
import audiencePreset from '../presets/audience.json'
import economy from '../presets/economy.json'
import { createAccount, summarize } from '../store/account'
import { migrate, SaveError, versionOf } from '../store/migrate'
import { type Account, type AccountIndex, LedgerKindSchema, SCHEMA_VERSION, SEGMENTS } from '../store/schema'
import type { AccountStorage } from '../store/storage'
import { exportAccount, exportFileName, importAccount } from '../store/transfer'
import type { Action, Api, DispatchResult, ProfilePatch, Statements } from './types'

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

  /** Load, change, save; keeps the account list's name/handle in sync. */
  async function update(id: string, change: (a: Account) => Account) {
    const account = change(await mustLoad(id))
    await storage.saveAccount(account)
    await updateIndex((i) => ({
      ...i,
      accounts: i.accounts.map((a) => (a.id === id ? summarize(account, env.now()) : a)),
    }))
    return account
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

    async 'profile.update'({ id, patch }) {
      const clean = validateProfile(patch)
      await update(id, (a) => ({ ...a, profile: { ...a.profile, ...clean } }))
      return { delta: ['accounts', `account:${id}`], events: [] }
    },

    async 'clock.advance'({ id, days }) {
      if (!Number.isInteger(days) || days < 1 || days > 90) throw new SaveError('days must be 1–90')
      let events: DispatchResult['events'] = []
      await update(id, (a) => {
        const r = simulate(a, days)
        events = r.events
        return r.account
      })
      return { delta: [`account:${id}`], events }
    },

    async 'payout.request'({ id, amount }) {
      await update(id, (a) => requestPayout(a, amount))
      return { delta: [`account:${id}`], events: [] }
    },
  }

  return {
    listAccounts: () => storage.loadIndex(),
    getAccount: load,
    async exportAccount(id) {
      const account = await mustLoad(id)
      return { fileName: exportFileName(account), json: exportAccount(account) }
    },
    async getStatements(id) {
      const account = await mustLoad(id)
      const totals = Object.fromEntries(
        LedgerKindSchema.options.map((k) => [k, { count: 0, gross: 0, net: 0 }]),
      ) as Statements['totals']
      for (const e of account.ledger) {
        totals[e.kind].count += e.count
        totals[e.kind].gross += e.gross
        totals[e.kind].net += e.net
      }
      return { day: account.clock.day, balances: balances(account), entries: [...account.ledger].reverse(), totals }
    },
    async getStatistics(id) {
      const account = await mustLoad(id)
      const segments = SEGMENTS.map((s) => ({
        id: s,
        label: audiencePreset.segments[s].label,
        count: subscriberCount(account.audience, s),
      }))
      return { day: account.clock.day, history: account.history, segments }
    },
    dispatch(action) {
      const run = actions[action.type] as (a: Action) => Promise<DispatchResult>
      return run(action)
    },
  }
}

function validateProfile(patch: ProfilePatch): ProfilePatch {
  const clean: ProfilePatch = {}
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new SaveError('Name cannot be empty')
    clean.name = patch.name.trim()
  }
  if (patch.handle !== undefined) {
    const handle = patch.handle.replace(/^@/, '').trim()
    if (!handle) throw new SaveError('Handle cannot be empty')
    clean.handle = handle
  }
  if (patch.bio !== undefined) clean.bio = patch.bio
  if (patch.accountType !== undefined) clean.accountType = patch.accountType
  if (patch.priceCents !== undefined) {
    const p = patch.priceCents
    if (!Number.isInteger(p) || p < economy.minPriceCents || p > economy.maxPriceCents) {
      throw new SaveError(`Price must be $${economy.minPriceCents / 100}–$${economy.maxPriceCents / 100}`)
    }
    clean.priceCents = p
  }
  return clean
}
