// Regulars and DMs (plan.md §4.4). The engine decides everything that has a
// number on it (who reaches out, whether a PPV sells, tips); fan messages are
// stored as 'pending' with the decision as an intent, and the model writes the
// words later (llm/). If the model fails, nothing here is blocked.
import preset from '../presets/audience.json'
import personas from '../presets/personas.json'
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
} from '../store/schema'
import { SEGMENTS } from '../store/schema'
import { subscriberCount } from './audience'
import { CORPUS, pick, pickWeighted } from './comments'
import { ContentError } from './content'
import { paymentLine as line } from './economy'
import { answerDeal, askedFor } from './deals'
import { directionEffects } from './directions'
import { type EventEffects, eventEffects, targetFactor } from './eventEffects'
import { dormantAfterDays } from './haters'
import { actingType, awayNow, conditionOf, hasCondition, loveHate, withoutCondition } from './conditions'
import { likeWeights, makePersona, pickDistinct, pickLanguage } from './personas'
import { intensityMatch, tagAttracts, tagMix } from './posts'
import { priceAttracts, priceFreeloaders, priceSpend } from './price'
import { logNormal, type Rng, rngFor } from './rng'
import { addLoyalty, fanProfile, loyaltyEffects } from './fans'
import { addFanMessage, lastContact, pendingMessage, threadOf, unanswered, updateRegular, withReply, withThread } from './threads'

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

/** Love-hate (conditions.ts): mostly insults, often pining for her, sometimes a tip. */
const LOVE_HATE_TOPICS: Record<Topic, number> = { chat: 1, compliment: 0, wants_content: 0, tip: 1, harass: 4, obsess: 3 }

/** What a fan writes to you about on his own: his type (a hater's while hostile), then his behaviours (obsessed fans mostly obsess). */
function openerTopics(r: Regular): Record<Topic, number> {
  if (loveHate(r)) return { ...LOVE_HATE_TOPICS }
  const t = { ...OPENER_TOPICS[actingType(r)] }
  if (r.behaviours.includes('obsessive') || r.behaviours.includes('stalker')) t.obsess = 6
  return t
}

/** A tip from one regular: around his type's median (presets/personas.json), times what his loyalty makes him spend (× `size`: the day's event). */
export function tipCents(rng: Rng, r: Regular, size = 1): number {
  return Math.min(preset.maxTipDollars, Math.max(1, Math.round(logNormal(rng, fanProfile(r).tip.median * loyaltyEffects(r).spend * size, 0.6)))) * 100
}

/** His chance to tip: his type's, scaled by his loyalty and the day's event. */
const tipChance = (r: Regular, ev: EventEffects) => Math.min(0.9, fanProfile(r).tip.chance * loyaltyEffects(r).tip * ev.tipChance * targetFactor(ev, r.id, 'tipChance'))

/**
 * Three tags he likes: any tag about as explicit as his type prefers (weight 1 each), plus
 * what his personality and behaviours want, whatever its explicitness (likeWeights: a
 * bossy man leans to domination and BDSM, a submissive one to femdom).
 */
function pickLikes(rng: Rng, segment: Segment, who: Pick<Regular, 'personality' | 'behaviours'>): string[] {
  const pref = preset.segments[segment].preferredIntensity
  const weights: Record<string, number> = Object.fromEntries(tags.filter((t) => Math.abs(t.intensity - pref) <= 1).map((t) => [t.id, 1]))
  for (const [tag, w] of Object.entries(likeWeights(who))) weights[tag] = (weights[tag] ?? 0) + w
  return pickDistinct(rng, weights, 3)
}

function newRegular(rng: Rng, id: string, segment: Segment, day: number, settings: Settings, attracts: Record<string, number>): Regular {
  const language = pickLanguage(rng, settings.fanLanguage)
  const persona = makePersona(rng, segment, language, attracts)
  return {
    id,
    segment,
    ...persona,
    language,
    likes: pickLikes(rng, segment, persona),
    since: day,
    spent: 0,
    status: 'active',
    loyalty: 0,
    conditions: [],
  }
}

/** Your direction's pull times your posts' pull times your price's (engine/price.ts). */
function attracts(account: Account, day: number): Record<string, number> {
  const out = { ...directionEffects(account).attracts }
  for (const [id, m] of Object.entries(tagAttracts(account, day))) out[id] = (out[id] ?? 1) * m
  for (const [id, m] of Object.entries(priceAttracts(account.profile))) out[id] = (out[id] ?? 1) * m
  return out
}

/** How many regulars can be active at once: your setting (Settings), or the preset's. */
export const activeCap = (settings: Settings) => settings.maxActiveRegulars ?? R.cap

/**
 * How many men a day come looking for a freebie because word got around (personas.json
 * askedMeetups.wordOfMouth): for every meetup in the last 30 days where a man had you for
 * free or a few dollars, +0.04 a day, at most +0.3. They come as freeloaders.
 */
export function freebieRumour(account: Account, day: number): number {
  const W = personas.askedMeetups.wordOfMouth
  const n = account.meetups.filter((m) => m.status === 'done' && m.terms && m.outcome !== 'noShow' && m.outcome !== 'wife' && (m.closedDay ?? m.day) > day - W.days).length
  return Math.min(W.max, n * W.perFreebie)
}

export type RegularsDay = { account: Account; events: EngineEvent[] }

/**
 * One simulated day: maybe a crowd fan becomes a regular (and says hi), active
 * regulars sometimes message you on their own, ignored ones go dormant. Who turns
 * into a hater is haters.ts.
 */
export function simulateRegularsDay(account: Account, audience: Audience, seed: string, day: number, settings: Settings): RegularsDay {
  let a = account
  const events: EngineEvent[] = []
  const ledger: LedgerEntry[] = []

  // Back after lying low since his wife caught you two (meetups.ts).
  for (const r of a.regulars) {
    if (conditionOf(r, 'lyingLow')?.until !== day) continue
    a = updateRegular(a, { ...withoutCondition(r, 'lyingLow'), status: 'active' })
    const caught = a.meetups.findLast((m) => m.regularId === r.id && m.outcome === 'wife')
    a = addFanMessage(a, r.id, day, { kind: 'opener', deal: { kind: 'meetup', step: 'back', ...(caught ? { id: caught.id } : {}) } })
    events.push({ day, type: 'regular-back', regularId: r.id, reason: 'wife' })
  }

  // Dormant: you have not written to them for a long time (since he came back, if he was
  // away); loyal fans wait longer. Hostile fans give up on their own (haters.ts).
  const lastMine = (r: Regular) => lastContact(r, threadOf(a, r.id))
  const hostile = (r: Regular) => hasCondition(r, 'hostile')
  a = {
    ...a,
    regulars: a.regulars.map((r) => (r.status === 'active' && !hostile(r) && day - lastMine(r) > dormantAfterDays(r) ? { ...r, status: 'dormant' as const } : r)),
  }

  // Over your cap (you lowered it in Settings, or wrote to a dormant fan): the ones you
  // have not written to for longest go dormant. Hostile fans and fans with a deal still open stay.
  const cap = activeCap(settings)
  const over = a.regulars.filter((r) => r.status === 'active').length - cap
  if (over > 0) {
    const busy = new Set([
      ...a.requests.filter((q) => q.status === 'open' || q.status === 'accepted').map((q) => q.regularId),
      ...a.meetups.filter((m) => m.status === 'open' || m.status === 'accepted').map((m) => m.regularId),
    ])
    const quiet = new Set(
      a.regulars
        .filter((r) => r.status === 'active' && !hostile(r) && !busy.has(r.id))
        .sort((x, y) => lastMine(x) - lastMine(y))
        .slice(0, over)
        .map((r) => r.id),
    )
    a = { ...a, regulars: a.regulars.map((r) => (quiet.has(r.id) ? { ...r, status: 'dormant' as const } : r)) }
  }

  // Someone new reaches out. Word gets around: if you leave regulars unanswered
  // (after giving you a few days), new ones write less often.
  const rng = rngFor(seed, day, 'regulars:new')
  // The day's event (engine/eventEffects.ts): who reaches out, how often, tips.
  const ev = eventEffects(a, day)
  // What he tips: the day's event, and what he pays to subscribe (engine/price.ts).
  const spend = ev.tipSize * priceSpend(a.profile)
  // Your recent posts: the men they drew in are the ones who write to you (tagMix).
  const drawn = tagMix(a, day)
  const weights = Object.fromEntries(
    SEGMENTS.map((s) => [s, subscriberCount(audience, s) * preset.segments[s].reachOut * (ev.regularMix[s] ?? 1) * drawn[s]]),
  ) as Record<Segment, number>
  // Word gets around that you give it away: men hoping for a freebie of their own come
  // looking for you, as freeloaders, and take up your regulars' slots.
  // A high price keeps most of them away (engine/price.ts).
  weights.freeloader = (weights.freeloader + freebieRumour(a, day)) * priceFreeloaders(a.profile)
  // Better known at a higher direction level: more people reach out (directions.ts dms).
  const fame = directionEffects(a).dms
  // A little traffic from outside on top of your subscribers, so the first regulars do not wait for a big audience.
  const lambda = (R.baseDaily + Object.values(weights).reduce((x, y) => x + y, 0)) * fame
  const recent = a.regulars.filter((r) => r.since <= day - 3).slice(-cap)
  const answered = recent.length ? recent.filter((r) => threadOf(a, r.id).messages.some((m) => m.from === 'me')).length / recent.length : 1
  const chance = Math.min(R.maxNewDaily, 1 - Math.exp(-lambda)) * (R.ignoredFactor + (1 - R.ignoredFactor) * answered) * ev.newRegulars
  if (a.regulars.filter((r) => r.status === 'active').length < cap && rng() < chance) {
    const segment = pickWeighted(rng, weights)
    const id = `r${day}-${a.regulars.length}`
    const regular = newRegular(rng, id, segment, day, settings, attracts(a, day))
    const topic = pickWeighted(rng, openerTopics(regular))
    const tip = topic === 'tip' ? tipCents(rng, regular, spend) : undefined
    a = {
      ...a,
      regulars: [...a.regulars, { ...regular, spent: tip ?? 0 }],
      threads: [...a.threads, { regularId: id, read: 0, messages: [pendingMessage(`${id}-m0`, day, { kind: 'opener', topic, ...(tip ? { tip } : {}) }, tip)] }],
    }
    events.push({ day, type: 'regular', regularId: id })
    if (tip) {
      ledger.push(line(day, 'tip', `${id}-m0`, tip))
      events.push({ day, type: 'dm-tip', regularId: id, gross: tip })
      a = addLoyalty(a, id, 'tip')
    }
  }

  // Active regulars message you on their own, less often if you owe them a reply.
  for (const r of a.regulars) {
    if (r.status !== 'active' || r.since === day) continue
    const t = threadOf(a, r.id)
    // Unanswered messages in a row: at most two (obsessed fans and haters keep going),
    // and less likely once he is waiting for you.
    const dm = fanProfile(r).dm
    const tail = unanswered(t)
    if (tail >= dm.maxUnanswered) continue
    const rr = rngFor(seed, day, `regulars:dm:${r.id}`)
    if (rr() >= dm.daily * fame * ev.dms * targetFactor(ev, r.id, 'dms') * (tail > 0 ? dm.ignoredFactor : 1)) continue
    const topic = pickWeighted(rr, openerTopics(r))
    const tip = topic === 'tip' && rr() < Math.max(tipChance(r, ev), 0.5) ? tipCents(rr, r, spend) : undefined
    const id = `${r.id}-m${t.messages.length}`
    a = withThread(a, { ...t, messages: [...t.messages, pendingMessage(id, day, { kind: 'opener', topic: tip ? 'tip' : topic === 'tip' ? 'chat' : topic, ...(tip ? { tip } : {}) }, tip)] })
    events.push({ day, type: 'dm', regularId: r.id })
    if (tip) {
      ledger.push(line(day, 'tip', id, tip))
      a = addLoyalty({ ...a, regulars: a.regulars.map((x) => (x.id === r.id ? { ...x, spent: x.spent + tip } : x)) }, r.id, 'tip')
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
 * Would this fan buy this PPV? Decided by the engine only (plan.md §4.4): his type's
 * rate × his loyalty × taste × price × whether it has something he likes. A fanatic
 * (top loyalty) buys anything.
 */
function decidePpv(rng: Rng, account: Account, regular: Regular, ppv: NonNullable<DmInput['ppv']>, mass: boolean) {
  const loyal = loyaltyEffects(regular)
  if (loyal.buysAnything && !mass) return { bought: true, reason: 'liked' as const }
  // A love-hate fan still has his old taste.
  const p = preset.segments[loveHate(regular) ? regular.segment : actingType(regular)]
  const items = ppv.vaultIds.map((id) => account.vault.find((v) => v.id === id)!)
  const intensity = Math.max(...items.map((i) => i.intensity))
  const match = intensityMatch(intensity, p.preferredIntensity)
  // Personal offers: prices hurt less than on the wall (per $25 instead of per $10); loyal fans pay more readily.
  const priceFactor = Math.exp((-p.priceSensitivity * ppv.priceCents) / (R.dmPriceScaleCents * loyal.spend))
  const likesBonus = items.some((i) => i.tags.some((t) => regular.likes.includes(t))) ? 1.5 : 1
  const chance = Math.min(0.95, fanProfile(regular).ppv * loyal.buy * (mass ? R.massPpvFactor : 1) * match * priceFactor * likesBonus)
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
  if (awayNow(regular, day)) {
    const blocked = conditionOf(regular, 'blocked')
    throw new ContentError(!blocked ? 'He is lying low since his wife found out' : blocked.by === 'you' ? 'You blocked him' : 'He blocked you after his wife found out')
  }
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
    const d = decidePpv(rng, account, regular, input.ppv, !!massId)
    ppv = { ...input.ppv, paid: d.bought }
    decision = { messageId: myId, ...d }
    if (d.bought) {
      ledger.push(line(day, 'message', myId, input.ppv.priceCents))
      spent += input.ppv.priceCents
      events.push({ day, type: 'dm-purchase', regularId, gross: input.ppv.priceCents })
    }
  }

  let tip = folded?.tipCents
  const ev = eventEffects(account, day)
  if (!tip && rng() < tipChance(regular, ev)) {
    tip = tipCents(rng, regular, ev.tipSize * priceSpend(account.profile))
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
  let after = answer?.account ?? account
  // Loyalty: your message (not a mass one), his purchase and his tip all count.
  if (!massId) after = addLoyalty(after, regularId, 'message')
  if (decision?.bought) after = addLoyalty(after, regularId, 'purchase')
  if (tip && !folded?.tipCents) after = addLoyalty(after, regularId, 'tip')

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
  if (d?.kind === 'meetup' && d.step === 'back') return pick(rng, t.meetupBack)
  if (intent.event?.kind === 'charity') return pick(rng, intent.event.step === 'left' ? t.charityLeft : t.charityAfter)
  if (intent.incident) {
    const result = account.incidents.find((x) => x.id === intent.incident)?.result
    return pick(rng, result === 'gift' ? t.incidentGift : result === 'calmed' ? t.incidentCalmed : t.incidentOk)
  }
  if (d?.kind === 'meetup' && d.step === 'met') {
    const outcome = account.meetups.find((x) => x.id === d.id)?.outcome
    return pick(rng, outcome === 'noShow' ? t.meetupNoShow : outcome === 'creep' ? t.meetupCreep : outcome === 'wife' ? t.meetupWife : t.meetupAfter)
  }
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
  return pick(rng, corpus.segments[actingType(regular)][mood])
}

/** You have seen the conversation up to now. */
export function markRead(account: Account, regularId: string): Account {
  const thread = threadOf(account, regularId)
  const written = thread.messages.filter((m) => m.state === 'sent').length
  return thread.read >= written ? account : withThread(account, { ...thread, read: written })
}
