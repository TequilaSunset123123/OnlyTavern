// The local (in-browser) implementation of Api: store/ and engine/ running in
// the iframe. Time and ids come in through `env` so tests are
// deterministic and store/ never calls Date.now() or Math.random() itself.
import { subscriberCount } from '../engine/audience'
import { addVaultItem, canLockPosts, deletePost, deleteVaultItem, publishPost, updateVaultItem } from '../engine/content'
import { directionInfo, directionPrompt, levelUpForTesting, setDirection, SPECS, SWITCH_LOSS } from '../engine/directions'
import { fanLayers, traitLabel } from '../engine/personas'
import { postIntensity, postTags } from '../engine/posts'
import { loyaltyInfo } from '../engine/fans'
import { awayNow, conditionOf } from '../engine/conditions'
import { balances, requestPayout } from '../engine/economy'
import audiencePreset from '../presets/audience.json'
import economy from '../presets/economy.json'
import captions from '../presets/captions.json'
import tags from '../presets/tags.json'
import { createAccount, summarize } from '../store/account'
import { migrate, SaveError, versionOf } from '../store/migrate'
import { type Account, type AccountIndex, DIRECTIONS, DirectionIdSchema, LedgerKindSchema, type Message, SCHEMA_VERSION, SEGMENTS, SettingsSchema } from '../store/schema'
import type { AccountStorage } from '../store/storage'
import { exportAccount, exportFileName, importAccount } from '../store/transfer'
import type { Action, Api, DispatchResult, InboxThread, ProfilePatch, Statements, Tag, TagDraw } from './types'

/** Who a tag draws in, for the New post page: anything it makes ×1.5 or likelier, strongest first. */
function tagDraws(factors: Partial<Record<string, number>> | undefined, label: (id: string) => string): TagDraw[] {
  return Object.entries(factors ?? {})
    .filter((e): e is [string, number] => (e[1] ?? 0) >= 1.5)
    .sort(([, a], [, b]) => b - a)
    .map(([id, factor]) => ({ label: label(id), factor }))
}
const TAGS: Tag[] = tags.map((t) => ({
  id: t.id,
  en: t.en,
  zh: t.zh,
  intensity: t.intensity,
  draws: {
    types: tagDraws('audience' in t ? t.audience : undefined, (s) => `${audiencePreset.segments[s as keyof typeof audiencePreset.segments].label}s`),
    traits: tagDraws('attracts' in t ? t.attracts : undefined, traitLabel),
  },
}))

// Loaded on demand: these pull in the comment corpus and the fan persona parts.
const engine = () => import('../engine/simulate')
const dms = () => import('../engine/regulars')
const mass = () => import('../engine/massMessages')
const requests = () => import('../engine/requests')
const meetups = () => import('../engine/meetups')
const incidents = () => import('../engine/incidents')
const dayEvents = () => import('../engine/events')
const timeline = () => import('../engine/report')

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

  let writes: Promise<unknown> = Promise.resolve()

  /** Load, change, save; keeps the account list's name/handle in sync. Saves nothing if nothing changed. */
  async function update(id: string, change: (a: Account) => Account) {
    const before = await mustLoad(id)
    const account = change(before)
    if (account === before) return account
    await storage.saveAccount(account)
    await updateIndex((i) => ({
      ...i,
      accounts: i.accounts.map((a) => (a.id === id ? summarize(account, env.now()) : a)),
    }))
    return account
  }

  const actions: { [T in Action['type']]: (a: Extract<Action, { type: T }>) => Promise<DispatchResult> } = {
    async 'account.create'({ name, handle, direction }) {
      const account = createAccount({ id: env.newId(), seed: env.newSeed(), now: env.now(), name, handle, direction: direction && DirectionIdSchema.parse(direction) })
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
      const { periodReport } = await timeline()
      const settings = await storage.loadSettings()
      let events: DispatchResult['events'] = []
      let report: DispatchResult['report']
      await update(id, (a) => {
        // A rare event stops the skip on its day, so you can choose (engine/events.ts).
        const r = simulate(a, days, a.meta.seed, settings, { stopAtRare: true })
        events = r.events
        report = periodReport(a, r.account, r.events, days)
        return r.account
      })
      return { delta: [`account:${id}`], events, report }
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
      await update(id, (a) => fillMessage(a, regularId, messageId, fallbackText(a, regularId, messageId), 'corpus'))
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

    async 'request.accept'({ id, requestId }) {
      const { acceptRequest } = await requests()
      await update(id, (a) => acceptRequest(a, requestId))
      return { delta: [`account:${id}`], events: [] }
    },

    async 'request.decline'({ id, requestId }) {
      const { declineRequest } = await requests()
      await update(id, (a) => declineRequest(a, requestId))
      return { delta: [`account:${id}`], events: [] }
    },

    async 'request.deliver'({ id, requestId, vaultIds, text }) {
      const { deliverRequest } = await requests()
      let events: DispatchResult['events'] = []
      await update(id, (a) => {
        const r = deliverRequest(a, requestId, vaultIds, text, a.meta.seed)
        events = r.events
        return r.account
      })
      return { delta: [`account:${id}`], events }
    },

    async 'meetup.accept'({ id, meetupId, day, hidden }) {
      const { acceptMeetup } = await meetups()
      await update(id, (a) => acceptMeetup(a, meetupId, day, hidden))
      return { delta: [`account:${id}`], events: [] }
    },

    async 'meetup.decline'({ id, meetupId }) {
      const { declineMeetup } = await meetups()
      await update(id, (a) => declineMeetup(a, meetupId))
      return { delta: [`account:${id}`], events: [] }
    },

    async 'meetup.cancel'({ id, meetupId }) {
      const { cancelMeetup } = await meetups()
      await update(id, (a) => cancelMeetup(a, meetupId))
      return { delta: [`account:${id}`], events: [] }
    },

    async 'meetup.hide'({ id, meetupId, hidden }) {
      const { hideMeetup } = await meetups()
      await update(id, (a) => hideMeetup(a, meetupId, hidden))
      return { delta: [`account:${id}`], events: [] }
    },

    async 'incident.resolve'({ id, incidentId, choice }) {
      const { resolveIncident } = await incidents()
      let events: DispatchResult['events'] = []
      await update(id, (a) => {
        const r = resolveIncident(a, incidentId, choice, a.meta.seed)
        events = r.events
        return r.account
      })
      return { delta: [`account:${id}`], events }
    },

    async 'dayEvent.choose'({ id, eventId, choice }) {
      const { resolveDayEvent } = await dayEvents()
      let events: DispatchResult['events'] = []
      await update(id, (a) => {
        const r = resolveDayEvent(a, eventId, choice, a.meta.seed)
        events = r.events
        return r.account
      })
      return { delta: [`account:${id}`], events }
    },

    async 'direction.set'({ id, direction }) {
      let events: DispatchResult['events'] = []
      // The announcement is written in your fans' language (mixed: English).
      const language = (await storage.loadSettings()).fanLanguage === 'zh' ? 'zh' : 'en'
      await update(id, (a) => {
        const r = setDirection(a, DirectionIdSchema.parse(direction), a.meta.seed, language)
        events = r.events
        return r.account
      })
      return { delta: [`account:${id}`], events }
    },

    async 'dev.levelUp'({ id }) {
      await update(id, levelUpForTesting)
      return { delta: [`account:${id}`], events: [] }
    },

    async 'dev.charity'({ id }) {
      const { openSpecialForTesting } = await dayEvents()
      await update(id, (a) => openSpecialForTesting(a, 'charity'))
      return { delta: [`account:${id}`], events: [] }
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
        const d = net.get(e.day) ?? Object.fromEntries(LedgerKindSchema.options.map((k) => [k, 0]))
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
      // Loaded on demand: the comment corpus is large and only needed here.
      const { generateComments } = await import('../engine/comments')
      return generateComments(account, post, await storage.loadSettings())
    },
    async getNotifications(id) {
      return [...(await mustLoad(id)).events].reverse()
    },
    async getTags() {
      return TAGS
    },
    async getCaptions() {
      return captions
    },
    // The cap shows the preset's number until you change it.
    getSettings: async () => {
      const s = await storage.loadSettings()
      return { ...s, maxActiveRegulars: s.maxActiveRegulars ?? audiencePreset.regulars.cap }
    },
    async getInbox(id) {
      const account = await mustLoad(id)
      const threads: InboxThread[] = account.regulars.map((regular) => {
        const t = account.threads.find((x) => x.regularId === regular.id)!
        const written = t.messages.filter((m) => m.state === 'sent')
        return {
          regular,
          loyalty: loyaltyInfo(regular),
          last: written.at(-1) ?? null,
          unread: t.messages.slice(t.read).filter((m) => m.from === 'fan').length,
          pending: t.messages.some((m) => m.state === 'pending'),
          tipped: t.messages.reduce((s, m) => s + (m.from === 'fan' ? (m.tipCents ?? 0) : 0), 0),
          opened: t.read > 0 || t.messages.some((m) => m.from === 'me'),
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
        thread.messages
          .flatMap((m) => [...(m.ppv?.vaultIds ?? []), ...(m.delivery?.vaultIds ?? [])])
          .map((v) => [v, account.vault.find((i) => i.id === v) ?? null]),
      )
      const p = account.profile
      return {
        day: account.clock.day,
        regular,
        messages: thread.messages,
        read: thread.read,
        items,
        creator: {
          name: p.name,
          handle: p.handle,
          accountType: p.accountType,
          priceCents: p.priceCents,
          subscribers: subscriberCount(account.audience),
          direction: directionPrompt(account),
        },
        loyalty: loyaltyInfo(regular),
        away: !awayNow(regular, account.clock.day) ? null : !conditionOf(regular, 'blocked') ? 'lyingLow' : conditionOf(regular, 'blocked')?.by === 'you' ? 'blocked' : 'gone',
        ...fanLayers(regular),
        requests: account.requests.filter((q) => q.regularId === regularId),
        meetups: account.meetups.filter((m) => m.regularId === regularId),
        incidents: account.incidents.filter((x) => x.regularId === regularId),
        dayEvents: account.dayEvents.filter((e) => thread.messages.some((m) => m.intent?.event?.id === e.id)),
      }
    },
    async getMassMessages(id) {
      return (await mustLoad(id)).massMessages
    },
    async getDirections(id) {
      const account = await mustLoad(id)
      return {
        current: account.direction.id,
        chosen: account.direction.chosen,
        switchLoss: SWITCH_LOSS,
        all: DIRECTIONS.map((d) => directionInfo(account, d)),
      }
    },
    async getDirectionOptions() {
      return DIRECTIONS.map((id) => ({ id, label: SPECS[id].label, blurb: SPECS[id].blurb }))
    },
    async getIncidents(id) {
      const account = await mustLoad(id)
      const { incidentOdds, incidentStory, INCIDENT_OPTIONS } = await incidents()
      return account.incidents
        .filter((x) => x.status === 'open')
        .map((incident) => {
          const regular = account.regulars.find((r) => r.id === incident.regularId)!
          const odds = incidentOdds(account, incident)
          return {
            incident,
            regular,
            story: incidentStory(incident).replaceAll('{name}', regular.name),
            options: INCIDENT_OPTIONS[incident.kind].map((choice) => ({ choice, chance: odds[choice] ?? 0 })),
          }
        })
    },
    async getTodaysEvent(id) {
      const { dayEventView } = await dayEvents()
      return dayEventView(await mustLoad(id))
    },
    async getOpenDayEvents(id) {
      const { openDayEvents } = await dayEvents()
      return openDayEvents(await mustLoad(id))
    },
    async getDeliveryCheck(id, requestId, vaultIds) {
      const account = await mustLoad(id)
      const q = account.requests.find((x) => x.id === requestId)
      if (!q) throw new SaveError('Request not found')
      const { checkDelivery } = await requests()
      return checkDelivery(account, q, vaultIds.filter((v) => account.vault.some((i) => i.id === v)))
    },
    async getLapsing(id, days) {
      const { lapsing } = await timeline()
      return lapsing(await mustLoad(id), days)
    },
    async getRequests(id) {
      const account = await mustLoad(id)
      const regular = (regularId: string) => account.regulars.find((r) => r.id === regularId)!
      const message = (regularId: string, messageId: string): Message | null => {
        const m = account.threads.find((t) => t.regularId === regularId)?.messages.find((x) => x.id === messageId)
        return m?.state === 'sent' ? m : null
      }
      return {
        day: account.clock.day,
        requests: [...account.requests].reverse().map((request) => ({
          request,
          regular: regular(request.regularId),
          message: message(request.regularId, request.messageId),
          items: (request.delivery?.vaultIds ?? []).map((v) => account.vault.find((i) => i.id === v) ?? null),
        })),
        meetups: [...account.meetups].reverse().map((meetup) => ({
          meetup,
          regular: regular(meetup.regularId),
          message: message(meetup.regularId, meetup.messageId),
        })),
      }
    },
    // One write at a time: each action loads, changes and saves the whole account,
    // so two at once would overwrite each other (e.g. the model's reply and "mark read").
    dispatch(action) {
      const run = actions[action.type] as (a: Action) => Promise<DispatchResult>
      const result = writes.then(() => run(action))
      writes = result.catch(() => undefined)
      return result
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
