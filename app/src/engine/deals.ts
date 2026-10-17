// How a deal starts (plan.md §2 rule 3, 2026-10-15). One entry point for customs and
// meetups, two ways in:
//   - a fan brings one up on his own: rolled once a day, once he is loyal enough;
//   - you bring one up in a message: he says yes or no, rolled when you send it. Asked to
//     meet, men nearly always say yes; but unless he is devoted to you (loyalty, a simp,
//     obsessed, old money) he takes you for a freebie: he offers nothing, or a few dollars
//     to put you down; a submissive man never insults you, he just grovels and does not
//     pay (personas.json askedMeetups).
// Everything with a number is decided here, like a game mechanic; the numbers per fan
// type are in presets/personas.json (engine/fans.ts). The model only gets one line
// saying what happened (llm/fanMessage.ts). What happens next (accept, deliver, meet)
// is requests.ts and meetups.ts.
import preset from '../presets/audience.json'
import tags from '../presets/tags.json'
import type { Account, EngineEvent, Intent, Meetup, Regular, Request } from '../store/schema'
import personas from '../presets/personas.json'
import { actingType, hasCondition } from './conditions'
import { likeWeights, pickDistinct } from './personas'
import { directionEffects } from './directions'
import { eventEffects, heldByEvent, targetFactor } from './eventEffects'
import { fanProfile, loyaltyEffects, loyaltyLevel } from './fans'
import { priceSpend } from './price'
import { logNormal, type Rng, rngFor } from './rng'
import { addFanMessage, threadOf } from './threads'

const Q = preset.requests
const M = preset.meetups
const ASKED = personas.askedMeetups
export type DealKind = 'custom' | 'meetup'
type Deal = NonNullable<Intent['deal']>

export const requestOpen = (q: Request) => q.status === 'open' || q.status === 'accepted'
export const meetupOpen = (m: Meetup) => m.status === 'open' || m.status === 'accepted'

/** Ended badly for the fan: you backed out, were late, or what you sent was not it. */
export const wentBadly = (q: Request) =>
  (q.status === 'declined' && q.acceptedDay !== undefined) ||
  (q.status === 'expired' && q.acceptedDay !== undefined) ||
  (q.status === 'delivered' && !q.delivery?.paid)

/** His chance to say yes when you ask (before loyalty): customs his type's `custom.accept`, meetups `meetup.asked.accept`. */
const askedAccept = (r: Regular, kind: DealKind) => (kind === 'custom' ? fanProfile(r).custom.accept : fanProfile(r).meetup.asked.accept)

/**
 * Hard rules: his type does this at all, nothing of this kind is open with him, no special
 * event has him to itself (Human ATM), and the last one ended a while ago (no wait when you
 * ask him to meet: he is always up for it).
 * A dormant fan only counts when you write to him (that wakes him).
 */
function eligible(account: Account, r: Regular, kind: DealKind, day: number, youAsked: boolean): boolean {
  if ((r.status !== 'active' && !youAsked) || !(youAsked ? askedAccept(r, kind) : fanProfile(r)[kind].daily)) return false
  // Human ATM has him (eventEffects.ts heldByEvent): no deals until it is over.
  if (heldByEvent(account, r.id, day)) return false
  const mine: (Request | Meetup)[] = kind === 'custom' ? account.requests.filter((q) => q.regularId === r.id) : account.meetups.filter((m) => m.regularId === r.id)
  if (mine.some((x) => (kind === 'custom' ? requestOpen(x as Request) : meetupOpen(x as Meetup)))) return false
  if (youAsked && kind === 'meetup') return true
  const last = mine.at(-1)
  const cooldown = kind === 'custom' ? Q.cooldownDays : (fanProfile(r).meetup.cooldownDays ?? M.cooldownDays)
  return !last || day - (last.closedDay ?? last.day) >= cooldown
}

/** He only brings one up himself once he is loyal enough (his type's level; lower for obsessed fans and stalkers). */
const loyalEnough = (r: Regular, kind: DealKind) => loyaltyLevel(r) >= fanProfile(r)[kind].minLoyalty

/**
 * The chance: per day that he brings it up himself, or that he says yes when you do.
 * His type's rate × his loyalty × your direction (× his behaviours for meetups; × 0.5 after a custom that went badly).
 * Loyalty counts more for meetups (×2.5 at Devoted, ×4 at Fanatic) than for customs.
 * You asking him to meet is different: his type's `asked.accept` (most men say yes),
 * closing in on 97% as his loyalty rises; your direction and his behaviours do not matter.
 */
export function dealChance(account: Account, r: Regular, kind: DealKind, youAsked: boolean, day = account.clock.day): number {
  const f = fanProfile(r)
  const fx = directionEffects(account)
  const loyal = loyaltyEffects(r).deal
  // The day's event (engine/eventEffects.ts): a rumor, a whale in the spotlight. Only for what he brings up himself.
  const ev = eventEffects(account, day)
  const spotlight = youAsked ? 1 : targetFactor(ev, r.id, 'deal')
  if (kind === 'custom') {
    const last = account.requests.filter((q) => q.regularId === r.id).at(-1)
    const base = youAsked ? f.custom.accept : f.custom.daily * spotlight
    return Math.min(0.95, base * loyal * fx.requests.rate * (last && wentBadly(last) ? Q.upsetFactor : 1))
  }
  if (youAsked) {
    const accept = f.meetup.asked.accept
    return Math.min(0.97, accept + (0.97 - accept) * ((loyaltyLevel(r) - 1) / 4))
  }
  return Math.min(0.95, f.meetup.daily * loyaltyEffects(r).meetup * fx.meetups.rate * f.meetup.factor * ev.meetupRate * spotlight)
}

/** You asked him to meet: does he pay like a client, or take you for a freebie? An entitled fan never pays. */
export function paysWhenAsked(r: Regular): boolean {
  if (hasCondition(r, 'entitled')) return false
  const P = ASKED.pays
  return loyaltyLevel(r) >= P.minLoyalty || P.segments.includes(actingType(r)) || r.behaviours.some((b) => P.behaviours.includes(b))
}

/** What he offers: like a client (around his type's median, × loyalty and direction), or, when you asked and he does not pay, a few dollars or nothing. */
function meetupOffer(rng: Rng, account: Account, r: Regular, youAsked: boolean): { offerCents: number; terms?: Meetup['terms'] } {
  const worship = ASKED.worship.personalities.includes(r.personality)
  // Entitled: he expects it free, whoever asks.
  if (hasCondition(r, 'entitled')) return { offerCents: 0, terms: worship ? 'worship' : 'free' }
  if (youAsked && !paysWhenAsked(r)) {
    if (worship) return { offerCents: 0, terms: 'worship' }
    if (rng() < fanProfile(r).meetup.asked.free) return { offerCents: 0, terms: 'free' }
    const [lo, hi] = ASKED.lowballDollars
    return { offerCents: (lo + Math.floor(rng() * (hi - lo + 1))) * 100, terms: 'lowball' }
  }
  // Men who pay more to subscribe pay more to meet (engine/price.ts).
  const median = fanProfile(r).meetup.median * directionEffects(account).meetups.offer * loyaltyEffects(r).spend * priceSpend(account.profile)
  return { offerCents: Math.max(M.minCents, Math.round((logNormal(rng, median, M.spread) * 100) / M.roundCents) * M.roundCents) }
}

/** Opens a deal on his message `messageId`: what he wants and offers, decided now. */
function open(rng: Rng, account: Account, r: Regular, kind: DealKind, day: number, messageId: string, youAsked: boolean): { account: Account; deal: Deal; event: EngineEvent } {
  const f = fanProfile(r)
  const fx = directionEffects(account)
  if (kind === 'custom') {
    // One or two of the things he likes, the ones his personality wants first (a bossy man
    // orders domination and BDSM: likeWeights); as explicit as the most explicit of them.
    const kink = likeWeights(r)
    const wanted = pickDistinct(rng, Object.fromEntries(r.likes.map((t) => [t, 1 + (kink[t] ?? 0)])), rng() < 0.5 ? 1 : 2)
    const intensity = Math.max(1, ...wanted.map((id) => tags.find((x) => x.id === id)?.intensity ?? 1))
    // Fans who pay more to subscribe offer more, and never less than a month of it (engine/price.ts).
    const median = f.custom.median * fx.requests.offer * loyaltyEffects(r).spend * priceSpend(account.profile)
    const floor = Math.max(Q.minCents, account.profile.accountType === 'free' ? 0 : Math.ceil(account.profile.priceCents / 100) * 100)
    const offerCents = Math.min(Q.maxCents, Math.max(floor, Math.round(logNormal(rng, median, Q.spread)) * 100))
    const id = `${r.id}-q${account.requests.filter((q) => q.regularId === r.id).length}`
    const request: Request = { id, regularId: r.id, day, tags: wanted, intensity, offerCents, dueDay: day + Q.dueDays, status: 'open', messageId }
    return {
      account: { ...account, requests: [...account.requests, request] },
      deal: { kind, step: 'ask', id },
      event: { day, type: 'request', regularId: r.id, requestId: id },
    }
  }
  const { offerCents, terms } = meetupOffer(rng, account, r, youAsked)
  const id = `${r.id}-o${account.meetups.filter((m) => m.regularId === r.id).length}`
  const asked = youAsked ? { askedBy: 'you' as const, ...(terms ? { terms } : {}) } : terms ? { terms } : {}
  // A hater (or a fan who turned on you) says yes only to use you: a hate-fuck.
  const hate = actingType(r) === 'hater' ? { hate: true as const } : {}
  const meetup: Meetup = { id, regularId: r.id, day, offerCents, replyBy: day + M.replyDays, status: 'open', hidden: false, messageId, ...asked, ...hate }
  return {
    account: { ...account, meetups: [...account.meetups, meetup] },
    deal: { kind, step: 'ask', id },
    event: { day, type: 'meetup', regularId: r.id, meetupId: id, ...(youAsked ? { ...asked, offerCents } : {}) },
  }
}

/**
 * Once a day: loyal enough fans may bring up a meetup or a custom on their own (at most one
 * a day each). Meetups are rolled first: fans who order customs often used to crowd them out.
 */
export function simulateDealsDay(account: Account, seed: string, day: number): { account: Account; events: EngineEvent[] } {
  let a = account
  const events: EngineEvent[] = []
  for (const r of a.regulars) {
    for (const kind of ['meetup', 'custom'] as const) {
      if (!eligible(a, r, kind, day, false) || !loyalEnough(r, kind)) continue
      const rng = rngFor(seed, day, `deals:${kind}:${r.id}`)
      if (rng() >= dealChance(a, r, kind, false, day)) continue
      const opened = open(rng, a, r, kind, day, `${r.id}-m${threadOf(a, r.id).messages.length}`, false)
      a = addFanMessage(opened.account, r.id, day, { kind: 'opener', deal: opened.deal })
      events.push(opened.event)
      break
    }
  }
  return { account: a, events }
}

// Reading your message for a deal you brought up (English and Chinese).
const CUSTOM_WORDS = /\bcustoms?\b|\bcommission|made (just )?for you|定制|专属/i
const MEETUP_WORDS = /\bmeet(ing)? (up|in person|irl)|\bmeet-?up\b|\bin person\b|\bhook ?up\b|\bnight together\b|见面|见一面|约会|线下|出来玩|开房/i

/** Did you bring up a custom or a meetup in this message? */
export function askedFor(text: string): DealKind | null {
  return CUSTOM_WORDS.test(text) ? 'custom' : MEETUP_WORDS.test(text) ? 'meetup' : null
}

/**
 * You brought up a deal: he says yes (the deal opens on his reply `replyId`, with his
 * numbers) or no. Rolled when you send the message.
 */
export function answerDeal(account: Account, r: Regular, kind: DealKind, seed: string, replyId: string): { account: Account; deal: Deal; events: EngineEvent[] } {
  const day = account.clock.day
  const rng = rngFor(seed, day, `deals:asked:${replyId}`)
  if (!eligible(account, r, kind, day, true) || rng() >= dealChance(account, r, kind, true)) return { account, deal: { kind, step: 'no' }, events: [] }
  const opened = open(rng, account, r, kind, day, replyId, true)
  return { account: { ...opened.account, events: [...opened.account.events, opened.event] }, deal: opened.deal, events: [opened.event] }
}
