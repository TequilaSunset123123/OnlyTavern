// The local (in-browser) implementation of Api: store/ and engine/ running in
// the iframe. Time and ids come in through `env` so tests are
// deterministic and store/ never calls Date.now() or Math.random() itself.
import { subscriberCount } from '../engine/audience'
import { addVaultItem, canLockPosts, deletePost, deleteVaultItem, publishPost, updateVaultItem } from '../engine/content'
import { postIntensity, postTags } from '../engine/posts'
import { balances, requestPayout } from '../engine/economy'
import audiencePreset from '../presets/audience.json'
import economy from '../presets/economy.json'
import tags from '../presets/tags.json'
import { createAccount, summarize } from '../store/account'
import { migrate, SaveError, versionOf } from '../store/migrate'
import { type Account, type AccountIndex, LedgerKindSchema, SCHEMA_VERSION, SEGMENTS, SettingsSchema } from '../store/schema'
import type { AccountStorage } from '../store/storage'
import { exportAccount, exportFileName, importAccount } from '../store/transfer'
import type { Action, Api, DispatchResult, InboxThread, ProfilePatch, Statements } from './types'

// Loaded on demand: these pull in faker's name data and the comment corpus.
const engine = () => import('../engine/simulate')
const dms = () => import('../engine/regulars')
const mass = () => import('../engine/massMessages')

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
      const { simulate } = await engine()
      const settings = await storage.loadSettings()
      let events: DispatchResult['events'] = []
      await update(id, (a) => {
        const r = simulate(a, days, a.meta.seed, settings)
        events = r.events
        return r.account
      })
      return { delta: [`account:${id}`], events }
    },

    async 'payout.request'({ id, amount }) {
      await update(id, (a) => requestPayout(a, amount))
      return { delta: [`account:${id}`], events: [] }
    },

    async 'vault.add'({ id, item }) {
      const itemId = env.newId()
      await update(id, (a) => addVaultItem(a, itemId, item))
      return { delta: [`account:${id}`], events: [], id: itemId }
    },

    async 'vault.update'({ id, itemId, patch }) {
      await update(id, (a) => updateVaultItem(a, itemId, patch))
      return { delta: [`account:${id}`], events: [] }
    },

    async 'vault.delete'({ id, itemId }) {
      await update(id, (a) => deleteVaultItem(a, itemId))
      return { delta: [`account:${id}`], events: [] }
    },

    async 'post.publish'({ id, post }) {
      const postId = env.newId()
      await update(id, (a) => publishPost(a, postId, post))
      return { delta: [`account:${id}`], events: [], id: postId }
    },

    async 'post.delete'({ id, postId }) {
      await update(id, (a) => deletePost(a, postId))
      return { delta: [`account:${id}`], events: [] }
    },

    async 'dm.send'({ id, regularId, message }) {
      const { sendDm } = await dms()
      let events: DispatchResult['events'] = []
      await update(id, (a) => {
        const r = sendDm(a, regularId, message, a.meta.seed)
        events = r.events
        return r.account
      })
      return { delta: [`account:${id}`], events }
    },

    async 'dm.fill'({ id, regularId, messageId, text }) {
      const { fillMessage } = await dms()
      await update(id, (a) => fillMessage(a, regularId, messageId, text))
      return { delta: [`account:${id}`], events: [] }
    },

    async 'dm.fallback'({ id, regularId, messageId }) {
      const { fallbackText, fillMessage } = await dms()
      await update(id, (a) => fillMessage(a, regularId, messageId, fallbackText(a, regularId, messageId)))
      return { delta: [`account:${id}`], events: [] }
    },

    async 'dm.read'({ id, regularId }) {
      const { markRead } = await dms()
      await update(id, (a) => markRead(a, regularId))
      return { delta: [`account:${id}`], events: [] }
    },

    async 'mass.send'({ id, message }) {
      const { sendMass } = await mass()
      const massId = env.newId()
      let events: DispatchResult['events'] = []
      await update(id, (a) => {
        const r = sendMass(a, massId, message, a.meta.seed)
        events = r.events
        return r.account
      })
      return { delta: [`account:${id}`], events, id: massId }
    },

    async 'settings.update'({ patch }) {
      const next = SettingsSchema.parse({ ...(await storage.loadSettings()), ...patch })
      await storage.saveSettings(next)
      return { delta: ['settings'], events: [] }
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
      // Earnings per day from the ledger: DM income happens between simulated days.
      const net = new Map<number, Record<string, number>>()
      for (const e of account.ledger) {
        if (e.kind === 'payout') continue
        const d = net.get(e.day) ?? { subscription: 0, renewal: 0, tip: 0, post: 0, message: 0, payout: 0 }
        d[e.kind] += e.net
        net.set(e.day, d)
      }
      const history = account.history.map((h) => ({ ...h, net: { ...h.net, ...net.get(h.day) } }))
      return { day: account.clock.day, history, segments }
    },
    async getVault(id) {
      return (await mustLoad(id)).vault
    },
    async getFeed(id) {
      const account = await mustLoad(id)
      const posts = account.posts.map((p) => ({
        ...p,
        items: p.vaultIds.map((v) => account.vault.find((i) => i.id === v) ?? null),
        intensity: postIntensity(p, account),
        tags: postTags(p, account),
      }))
      return { day: account.clock.day, canLockPosts: canLockPosts(account), posts }
    },
    async getComments(id, postId) {
      const account = await mustLoad(id)
      const post = account.posts.find((p) => p.id === postId)
      if (!post) throw new SaveError('Post not found')
      // Loaded on demand: faker's name data and the corpus are large and only needed here.
      const { generateComments } = await import('../engine/comments')
      return generateComments(account, post, await storage.loadSettings())
    },
    async getNotifications(id) {
      return [...(await mustLoad(id)).events].reverse()
    },
    async getTags() {
      return tags
    },
    getSettings: () => storage.loadSettings(),
    async getInbox(id) {
      const account = await mustLoad(id)
      const threads: InboxThread[] = account.regulars.map((regular) => {
        const t = account.threads.find((x) => x.regularId === regular.id)!
        const written = t.messages.filter((m) => m.state === 'sent')
        return {
          regular,
          last: written.at(-1) ?? null,
          unread: t.messages.slice(t.read).filter((m) => m.from === 'fan').length,
          pending: t.messages.some((m) => m.state === 'pending'),
          tipped: t.messages.reduce((s, m) => s + (m.from === 'fan' ? (m.tipCents ?? 0) : 0), 0),
        }
      })
      const lastDay = (x: InboxThread) => Math.max(x.regular.since, ...account.threads.find((t) => t.regularId === x.regular.id)!.messages.map((m) => m.day))
      threads.sort((a, b) => lastDay(b) - lastDay(a))
      return { day: account.clock.day, threads }
    },
    async getThread(id, regularId) {
      const account = await mustLoad(id)
      const regular = account.regulars.find((r) => r.id === regularId)
      const thread = account.threads.find((t) => t.regularId === regularId)
      if (!regular || !thread) throw new SaveError('Conversation not found')
      const items = Object.fromEntries(
        thread.messages.flatMap((m) => m.ppv?.vaultIds ?? []).map((v) => [v, account.vault.find((i) => i.id === v) ?? null]),
      )
      const p = account.profile
      return {
        day: account.clock.day,
        regular,
        messages: thread.messages,
        read: thread.read,
        items,
        creator: { name: p.name, handle: p.handle, accountType: p.accountType, priceCents: p.priceCents, subscribers: subscriberCount(account.audience) },
      }
    },
    async getMassMessages(id) {
      return (await mustLoad(id)).massMessages
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
