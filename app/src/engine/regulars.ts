// Regulars and DMs (plan.md §4.4). The engine decides everything that has a
// number on it (who reaches out, whether a PPV sells, tips); fan messages are
// stored as 'pending' with the decision as an intent, and the model writes the
// words later (llm/). If the model fails, nothing here is blocked.
import preset from '../presets/audience.json'
import economy from '../presets/economy.json'
import tags from '../presets/tags.json'
import templates from '../presets/templates.json'
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
import { paymentLine as line } from './economy'
import { answerDeal, askedFor } from './deals'
import { directionEffects } from './directions'
import { behaviour, makePersona, pickLanguage, WIN_BACK } from './personas'
import { intensityMatch } from './posts'
import { logNormal, type Rng, rngFor } from './rng'
import { closeness, pendingMessage, recentMine, threadOf, unanswered, updateRegular, withReply, withThread } from './threads'

const R = preset.regulars

type Topic = NonNullable<Intent['topic']>
const OPENER_TOPICS: Record<Segment, Record<Topic, number>> = {
  regular: { chat: 4, compliment: 3, wants_content: 2, tip: 1, harass: 0, obsess: 0 },
  lurker: { chat: 3, compliment: 3, wants_content: 1, tip: 0.5, harass: 0, obsess: 0 },
  simp: { chat: 2, compliment: 4, wants_content: 2, tip: 3, harass: 0, obsess: 0 },
  whale: { chat: 2, compliment: 2, wants_content: 4, tip: 4, harass: 0, obsess: 0 },
  hater: { chat: 1, compliment: 0, wants_content: 0.5, tip: 0, harass: 6, obsess: 0 },
  freeloader: { chat: 2, compliment: 1, wants_content: 5, tip: 0.2, harass: 0, obsess: 0 },
}

/** What a fan writes to you about on his own: his type, then his traits (obsessed fans mostly obsess). */
function openerTopics(r: Regular): Record<Topic, number> {
  const t = { ...OPENER_TOPICS[r.segment] }
  if (r.traits.includes('obsessive') || r.traits.includes('stalker')) t.obsess = 6
  return t
}

export function tipCents(rng: Rng, segment: Segment): number {
  const p = preset.segments[segment]
  return Math.min(preset.maxTipDollars, Math.max(1, Math.round(logNormal(rng, p.dmTipMedian, 0.6)))) * 100
}

function newRegular(rng: Rng, id: string, segment: Segment, day: number, settings: Settings, traitFactors: Record<string, number>): Regular {
  const language = pickLanguage(rng, settings.fanLanguage)
  const pref = preset.segments[segment].preferredIntensity
  const near = tags.filter((t) => Math.abs(t.intensity - pref) <= 1)
  const likes = [...new Set([pick(rng, near), pick(rng, near), pick(rng, near)].map((t) => t.id))]
  return {
    id,
    segment,
    ...makePersona(rng, segment, language, traitFactors),
    language,
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

  // Creepy and obsessed fans you ignore for long enough turn on you; talk to them
  // again and they may come round.
  for (const r of a.regulars) {
    if (r.status !== 'active') continue
    const t = threadOf(a, r.id)
    const lastMine = Math.max(r.since, ...t.messages.filter((m) => m.from === 'me').map((m) => m.day))
    const rr = rngFor(seed, day, `regulars:mood:${r.id}`)
    if (r.turned) {
      if (day - r.turned.day >= WIN_BACK.afterDays && recentMine(t, day) >= WIN_BACK.messages && rr() < WIN_BACK.daily) {
        const { turned, ...back } = r
        a = updateRegular(a, { ...back, segment: turned.from, traits: r.traits.filter((x) => x !== turned.trait) })
        events.push({ day, type: 'regular-back', regularId: r.id })
      }
      continue
    }
    const turns = behaviour(r.traits).turnsHater
    if (!turns || r.segment === 'hater' || unanswered(t) === 0 || day - lastMine < turns.afterDays || rr() >= turns.daily) continue
    const trait = r.traits.includes('misogynist') ? undefined : 'misogynist'
    a = updateRegular(a, { ...r, segment: 'hater', traits: trait ? [...r.traits, trait] : r.traits, turned: { from: r.segment, day, ...(trait ? { trait } : {}) } })
    // Whatever he was offering is off; he lets you know what he thinks of you.
    a = {
      ...a,
      requests: a.requests.map((q) => (q.regularId === r.id && q.status === 'open' ? { ...q, status: 'expired' as const, closedDay: day } : q)),
      meetups: a.meetups.map((m) => (m.regularId === r.id && m.status === 'open' ? { ...m, status: 'expired' as const, closedDay: day } : m)),
    }
    a = withThread(a, { ...t, messages: [...t.messages, pendingMessage(`${r.id}-m${t.messages.length}`, day, { kind: 'opener', topic: 'harass' })] })
    events.push({ day, type: 'regular-turned', regularId: r.id })
  }

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
  // A little traffic from outside on top of your subscribers, so the first regulars do not wait for a big audience.
  const lambda = R.baseDaily + Object.values(weights).reduce((x, y) => x + y, 0)
  const recent = a.regulars.filter((r) => r.since <= day - 3).slice(-R.cap)
  const answered = recent.length ? recent.filter((r) => threadOf(a, r.id).messages.some((m) => m.from === 'me')).length / recent.length : 1
  const chance = Math.min(R.maxNewDaily, 1 - Math.exp(-lambda)) * (R.ignoredFactor + (1 - R.ignoredFactor) * answered)
  if (a.regulars.filter((r) => r.status === 'active').length < R.cap && rng() < chance) {
    const segment = pickWeighted(rng, weights)
    const id = `r${day}-${a.regulars.length}`
    const regular = newRegular(rng, id, segment, day, settings, directionEffects(a).traits)
    const topic = pickWeighted(rng, openerTopics(regular))
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
    // Unanswered messages in a row: at most two (obsessed fans and haters keep going),
    // and less likely once he is waiting for you.
    const b = behaviour(r.traits)
    const tail = unanswered(t)
    if (tail >= b.maxUnanswered) continue
    const p = preset.segments[r.segment]
    const rr = rngFor(seed, day, `regulars:dm:${r.id}`)
    if (rr() >= p.dmDaily * b.dmFactor * (tail > 0 ? b.ignoredFactor : 1)) continue
    const topic = pickWeighted(rr, openerTopics(r))
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
  const myId = `${regularId}-m${thread.messages.length}`
  const rng = rngFor(seed, day, `dm:${myId}`)
  const events: EngineEvent[] = []
  const ledger: LedgerEntry[] = []

  // A reply that is still unwritten reacts to this message too (folded, see withReply).
  const last = thread.messages.at(-1)
  const folded = last?.state === 'pending' && last.intent?.kind === 'reply' ? last : undefined

  let ppv: Message['ppv']
  let decision: NonNullable<Intent['ppv']>[number] | undefined
  let spent = 0
  if (input.ppv) {
    const d = decidePpv(rng, account, regular, thread, input.ppv, !!massId)
    ppv = { ...input.ppv, paid: d.bought }
    decision = { messageId: myId, ...d }
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

  // You brought up a custom or a meetup: he says yes or no, rolled now (deals.ts).
  const kind = massId ? null : askedFor(input.text)
  const answer = kind ? answerDeal(account, regular, kind, seed, `${myId}-reply`) : undefined
  events.push(...(answer?.events ?? []))

  const mine: Message = { id: myId, day, from: 'me', text: input.text.trim(), state: 'sent', ...(ppv ? { ppv } : {}), ...(massId ? { massId } : {}) }
  const next = withReply(thread, mine, (i) => ({ ...i, ...(decision ? { ppv: [...(i.ppv ?? []), decision] } : {}), ...(answer ? { deal: answer.deal } : {}) }), tip)
  const after = answer?.account ?? account

  return {
    account: {
      ...withThread(after, next),
      regulars: after.regulars.map((r) => (r.id === regularId ? { ...r, spent: r.spent + spent, status: 'active' } : r)),
      ledger: [...after.ledger, ...ledger],
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

const TOPIC_MOOD: Record<Topic, Mood> = { chat: 'casual', compliment: 'praise', wants_content: 'request', tip: 'praise', harass: 'negative', obsess: 'flirty' }

const money = (cents: number) => `$${Math.round(cents / 100)}`

/** Template lines for customs and meetups (plan.md §5: "失败时：模板句"). */
function templateText(rng: Rng, account: Account, regular: Regular, intent: Intent): string | null {
  const t = templates[regular.language]
  const d = intent.deal
  if (d?.kind === 'custom' && d.step === 'late') return pick(rng, t.requestLate)
  if (d?.kind === 'meetup' && d.step === 'met') return pick(rng, t.meetupAfter)
  if (d?.step !== 'ask') return null
  if (d.kind === 'meetup') {
    const m = account.meetups.find((x) => x.id === d.id)
    return m ? pick(rng, t.meetupInvite).replace('{money}', money(m.offerCents)) : null
  }
  const q = account.requests.find((x) => x.id === d.id)
  if (!q) return null
  const names = q.tags.map((id) => tags.find((x) => x.id === id)?.[regular.language] ?? id).join(regular.language === 'zh' ? '、' : ' and ')
  return pick(rng, t.requestAsk).replace('{tags}', names).replace('{money}', money(q.offerCents))
}

/** Words for a fan message when the model is not available: a template or corpus line (plan.md §5). */
export function fallbackText(account: Account, regularId: string, messageId: string): string {
  const regular = account.regulars.find((r) => r.id === regularId)!
  const message = threadOf(account, regularId).messages.find((m) => m.id === messageId)!
  const rng = rngFor(account.meta.seed, message.day, `fallback:${messageId}`)
  const template = message.intent && templateText(rng, account, regular, message.intent)
  if (template) return template
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
