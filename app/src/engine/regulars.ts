// Regulars and DMs (plan.md §4.4). The engine decides everything that has a
// number on it (who reaches out, whether a PPV sells, tips); fan messages are
// stored as 'pending' with the decision as an intent, and the model writes the
// words later (llm/). If the model fails, nothing here is blocked.
import preset from '../presets/audience.json'
import economy from '../presets/economy.json'
import tags from '../presets/tags.json'
import type {
  Account,
  Audience,
  EngineEvent,
  Intent,
  LedgerEntry,
  Message,
  Mood,
  Regular,
  Segment,
  Settings,
  Thread,
} from '../store/schema'
import { SEGMENTS } from '../store/schema'
import { subscriberCount } from './audience'
import { CORPUS, pick, pickWeighted } from './comments'
import { ContentError } from './content'
import { PLATFORM_FEE } from './economy'
import { fanBackground, fanIdentity, pickLanguage } from './fans'
import { intensityMatch } from './posts'
import { logNormal, type Rng, rngFor } from './rng'

const R = preset.regulars

type Topic = NonNullable<Intent['topic']>
const OPENER_TOPICS: Record<Segment, Record<Topic, number>> = {
  regular: { chat: 4, compliment: 3, wants_content: 2, tip: 1 },
  lurker: { chat: 3, compliment: 3, wants_content: 1, tip: 0.5 },
  simp: { chat: 2, compliment: 4, wants_content: 2, tip: 3 },
  whale: { chat: 2, compliment: 2, wants_content: 4, tip: 4 },
  hater: { chat: 5, compliment: 0.5, wants_content: 1, tip: 0 },
  freeloader: { chat: 2, compliment: 1, wants_content: 5, tip: 0.2 },
}

function line(day: number, kind: LedgerEntry['kind'], id: string, gross: number): LedgerEntry {
  const fee = Math.round(gross * PLATFORM_FEE)
  return { id: `${day}-${kind}-${id}`, day, kind, count: 1, gross, fee, net: gross - fee }
}

function tipCents(rng: Rng, segment: Segment): number {
  const p = preset.segments[segment]
  return Math.min(preset.maxTipDollars, Math.max(1, Math.round(logNormal(rng, p.dmTipMedian, 0.6)))) * 100
}

function threadOf(account: Account, regularId: string): Thread {
  const t = account.threads.find((x) => x.regularId === regularId)
  if (!t) throw new ContentError('Conversation not found')
  return t
}

function withThread(account: Account, thread: Thread): Account {
  return { ...account, threads: account.threads.map((t) => (t.regularId === thread.regularId ? thread : t)) }
}

/** A fan message the model still has to write. */
function pendingMessage(id: string, day: number, intent: Intent, tip?: number): Message {
  return { id, day, from: 'fan', text: '', state: 'pending', intent, ...(tip ? { tipCents: tip } : {}) }
}

function newRegular(rng: Rng, id: string, segment: Segment, day: number, settings: Settings): Regular {
  const language = pickLanguage(rng, settings.fanLanguage)
  const pref = preset.segments[segment].preferredIntensity
  const near = tags.filter((t) => Math.abs(t.intensity - pref) <= 1)
  const likes = [...new Set([pick(rng, near), pick(rng, near), pick(rng, near)].map((t) => t.id))]
  return {
    id,
    segment,
    ...fanIdentity(rng, language),
    language,
    ...fanBackground(rng, language),
    likes,
    since: day,
    spent: 0,
    status: 'active',
  }
}

export type RegularsDay = { account: Account; events: EngineEvent[] }

/**
 * One simulated day: maybe a crowd fan becomes a regular (and says hi), active
 * regulars sometimes message you on their own, ignored ones go dormant.
 */
export function simulateRegularsDay(account: Account, audience: Audience, seed: string, day: number, settings: Settings): RegularsDay {
  let a = account
  const events: EngineEvent[] = []
  const ledger: LedgerEntry[] = []

  // Dormant: you have not written to them for a long time.
  a = {
    ...a,
    regulars: a.regulars.map((r) => {
      const t = a.threads.find((x) => x.regularId === r.id)
      const lastMine = Math.max(r.since, ...(t?.messages.filter((m) => m.from === 'me').map((m) => m.day) ?? []))
      return r.status === 'active' && day - lastMine > R.dormantAfterDays ? { ...r, status: 'dormant' as const } : r
    }),
  }

  // Someone new reaches out. Word gets around: if you leave regulars unanswered
  // (after giving you a few days), new ones write less often.
  const rng = rngFor(seed, day, 'regulars:new')
  const weights = Object.fromEntries(SEGMENTS.map((s) => [s, subscriberCount(audience, s) * preset.segments[s].reachOut])) as Record<Segment, number>
  const lambda = Object.values(weights).reduce((x, y) => x + y, 0)
  const recent = a.regulars.filter((r) => r.since <= day - 3).slice(-R.cap)
  const answered = recent.length ? recent.filter((r) => threadOf(a, r.id).messages.some((m) => m.from === 'me')).length / recent.length : 1
  const chance = Math.min(R.maxNewDaily, 1 - Math.exp(-lambda)) * (R.ignoredFactor + (1 - R.ignoredFactor) * answered)
  if (a.regulars.filter((r) => r.status === 'active').length < R.cap && rng() < chance) {
    const segment = pickWeighted(rng, weights)
    const id = `r${day}-${a.regulars.length}`
    const regular = newRegular(rng, id, segment, day, settings)
    const topic = pickWeighted(rng, OPENER_TOPICS[segment])
    const tip = topic === 'tip' ? tipCents(rng, segment) : undefined
    a = {
      ...a,
      regulars: [...a.regulars, { ...regular, spent: tip ?? 0 }],
      threads: [...a.threads, { regularId: id, read: 0, messages: [pendingMessage(`${id}-m0`, day, { kind: 'opener', topic, ...(tip ? { tip } : {}) }, tip)] }],
    }
    events.push({ day, type: 'regular', regularId: id })
    if (tip) {
      ledger.push(line(day, 'tip', `${id}-m0`, tip))
      events.push({ day, type: 'dm-tip', regularId: id, gross: tip })
    }
  }

  // Active regulars message you on their own, less often if you owe them a reply.
  for (const r of a.regulars) {
    if (r.status !== 'active' || r.since === day) continue
    const t = threadOf(a, r.id)
    // Unanswered messages in a row: at most two, and less likely after the first.
    const tail = t.messages.length - 1 - t.messages.findLastIndex((m) => m.from === 'me')
    if (tail >= 2) continue
    const waiting = tail === 1
    const p = preset.segments[r.segment]
    const rr = rngFor(seed, day, `regulars:dm:${r.id}`)
    if (rr() >= p.dmDaily * (waiting ? 0.3 : 1)) continue
    const topic = pickWeighted(rr, OPENER_TOPICS[r.segment])
    const tip = topic === 'tip' && rr() < Math.max(p.dmTipChance, 0.5) ? tipCents(rr, r.segment) : undefined
    const id = `${r.id}-m${t.messages.length}`
    a = withThread(a, { ...t, messages: [...t.messages, pendingMessage(id, day, { kind: 'opener', topic: tip ? 'tip' : topic === 'tip' ? 'chat' : topic, ...(tip ? { tip } : {}) }, tip)] })
    events.push({ day, type: 'dm', regularId: r.id })
    if (tip) {
      ledger.push(line(day, 'tip', id, tip))
      a = { ...a, regulars: a.regulars.map((x) => (x.id === r.id ? { ...x, spent: x.spent + tip } : x)) }
      events.push({ day, type: 'dm-tip', regularId: r.id, gross: tip })
    }
  }

  return { account: { ...a, ledger: [...a.ledger, ...ledger] }, events }
}

export type DmInput = { text: string; ppv?: { vaultIds: string[]; priceCents: number } }

function checkPpv(account: Account, ppv: DmInput['ppv']) {
  if (!ppv) return
  if (ppv.vaultIds.length === 0) throw new ContentError('Pick content from the vault for a paid message')
  if (ppv.vaultIds.some((v) => !account.vault.some((i) => i.id === v))) throw new ContentError('Some vault items no longer exist')
  const p = ppv.priceCents
  if (!Number.isInteger(p) || p < economy.minPostPriceCents || p > economy.maxPostPriceCents) {
    throw new ContentError(`Price must be $${economy.minPostPriceCents / 100}–$${economy.maxPostPriceCents / 100}`)
  }
}

/**
 * How warm this fan is: the more you wrote to them yourself lately (mass messages
 * don't count), the likelier they buy. 0.7 cold … 1.3 after 10 messages in 14 days.
 */
export function closeness(thread: Thread, day: number): number {
  const C = R.closeness
  const recent = thread.messages.filter((m) => m.from === 'me' && !m.massId && m.day > day - C.days).length
  return C.base + C.perMessage * Math.min(C.maxMessages, recent)
}

/** Would this fan buy this PPV? Decided by the engine only (plan.md §4.4, 2026-10-14). */
function decidePpv(rng: Rng, account: Account, regular: Regular, thread: Thread, ppv: NonNullable<DmInput['ppv']>, mass: boolean) {
  const p = preset.segments[regular.segment]
  const items = ppv.vaultIds.map((id) => account.vault.find((v) => v.id === id)!)
  const intensity = Math.max(...items.map((i) => i.intensity))
  const match = intensityMatch(intensity, p.preferredIntensity)
  // Personal offers: prices hurt less than on the wall (per $25 instead of per $10).
  const priceFactor = Math.exp((-p.priceSensitivity * ppv.priceCents) / R.dmPriceScaleCents)
  const likesBonus = items.some((i) => i.tags.some((t) => regular.likes.includes(t))) ? 1.5 : 1
  const warm = closeness(thread, account.clock.day) * (mass ? R.massPpvFactor : 1)
  const chance = Math.min(0.95, p.dmPpvRate * warm * match * priceFactor * likesBonus)
  if (rng() < chance) return { bought: true, reason: 'liked' as const }
  const reason = priceFactor < 0.5 ? ('price' as const) : match < 0.5 ? ('taste' as const) : ('mood' as const)
  return { bought: false, reason }
}

/**
 * You write to a regular. The fan's reaction is decided now (buy the PPV? tip?)
 * and queued as a pending reply for the model to put into words. Writing again
 * before the reply is written folds everything into one reply.
 */
export function sendDm(
  account: Account,
  regularId: string,
  input: DmInput,
  seed: string,
  massId?: string,
): { account: Account; events: EngineEvent[] } {
  if (!input.text.trim() && !input.ppv) throw new ContentError('Write something or attach paid content')
  checkPpv(account, input.ppv)
  const regular = account.regulars.find((r) => r.id === regularId)
  if (!regular) throw new ContentError('Conversation not found')
  const day = account.clock.day
  const thread = threadOf(account, regularId)
  const n = thread.messages.length
  const myId = `${regularId}-m${n}`
  const rng = rngFor(seed, day, `dm:${myId}`)
  const events: EngineEvent[] = []
  const ledger: LedgerEntry[] = []

  // Fold an unwritten reply into the new one.
  const last = thread.messages.at(-1)
  const folded = last?.state === 'pending' && last.intent?.kind === 'reply' ? last : undefined
  const messages = folded ? thread.messages.slice(0, -1) : [...thread.messages]

  let ppv: Message['ppv']
  const decisions = [...(folded?.intent?.ppv ?? [])]
  let spent = 0
  if (input.ppv) {
    const d = decidePpv(rng, account, regular, thread, input.ppv, !!massId)
    ppv = { ...input.ppv, paid: d.bought }
    decisions.push({ messageId: myId, ...d })
    if (d.bought) {
      ledger.push(line(day, 'message', myId, input.ppv.priceCents))
      spent += input.ppv.priceCents
      events.push({ day, type: 'dm-purchase', regularId, gross: input.ppv.priceCents })
    }
  }

  const p = preset.segments[regular.segment]
  let tip = folded?.tipCents
  if (!tip && rng() < p.dmTipChance) {
    tip = tipCents(rng, regular.segment)
    ledger.push(line(day, 'tip', `${myId}-reply`, tip))
    spent += tip
    events.push({ day, type: 'dm-tip', regularId, gross: tip })
  }

  messages.push({ id: myId, day, from: 'me', text: input.text.trim(), state: 'sent', ...(ppv ? { ppv } : {}), ...(massId ? { massId } : {}) })
  messages.push(pendingMessage(`${myId}-reply`, day, { kind: 'reply', ...(decisions.length ? { ppv: decisions } : {}), ...(tip ? { tip } : {}) }, tip))

  return {
    account: {
      // You have seen everything up to your own message; the reply is new.
      ...withThread(account, { ...thread, messages, read: messages.length - 1 }),
      regulars: account.regulars.map((r) => (r.id === regularId ? { ...r, spent: r.spent + spent, status: 'active' } : r)),
      ledger: [...account.ledger, ...ledger],
    },
    events,
  }
}

/** A pending fan message gets its words (from the model, or a corpus line). */
export function fillMessage(account: Account, regularId: string, messageId: string, text: string, writtenBy: Message['writtenBy'] = 'model'): Account {
  const thread = threadOf(account, regularId)
  if (!thread.messages.some((m) => m.id === messageId && m.state === 'pending')) return account // already written or gone
  return withThread(account, {
    ...thread,
    messages: thread.messages.map((m) => (m.id === messageId ? { ...m, text, state: 'sent' as const, writtenBy } : m)),
  })
}

const TOPIC_MOOD: Record<Topic, Mood> = { chat: 'casual', compliment: 'praise', wants_content: 'request', tip: 'praise' }

/** Words for a fan message when the model is not available: a corpus line (plan.md §5). */
export function fallbackText(account: Account, regularId: string, messageId: string): string {
  const regular = account.regulars.find((r) => r.id === regularId)!
  const message = threadOf(account, regularId).messages.find((m) => m.id === messageId)!
  const rng = rngFor(account.meta.seed, message.day, `fallback:${messageId}`)
  const corpus = CORPUS[regular.language]
  const bought = message.intent?.ppv?.some((d) => d.bought)
  const mood: Mood = message.intent?.kind === 'reply' ? (bought ? 'praise' : 'casual') : TOPIC_MOOD[message.intent?.topic ?? 'chat']
  return pick(rng, corpus.segments[regular.segment][mood])
}

/** You have seen the conversation up to now. */
export function markRead(account: Account, regularId: string): Account {
  const thread = threadOf(account, regularId)
  const written = thread.messages.filter((m) => m.state === 'sent').length
  return thread.read >= written ? account : withThread(account, { ...thread, read: written })
}
