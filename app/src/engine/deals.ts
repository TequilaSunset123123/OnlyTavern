// How a deal starts (plan.md §2 rule 3, 2026-10-15). One entry point for customs and
// meetups, two ways in:
//   - a fan brings one up on his own: rolled once a day, once he is loyal enough;
//   - you bring one up in a message: he says yes or no, rolled when you send it.
// Everything with a number is decided here, like a game mechanic; the numbers per fan
// type are in presets/personas.json (engine/fans.ts). The model only gets one line
// saying what happened (llm/fanMessage.ts). What happens next (accept, deliver, meet)
// is requests.ts and meetups.ts.
import preset from '../presets/audience.json'
import tags from '../presets/tags.json'
import type { Account, EngineEvent, Intent, Meetup, Regular, Request } from '../store/schema'
import { directionEffects } from './directions'
import { fanProfile, loyaltyEffects, loyaltyLevel } from './fans'
import { logNormal, type Rng, rngFor } from './rng'
import { addFanMessage, threadOf } from './threads'

const Q = preset.requests
const M = preset.meetups
export type DealKind = 'custom' | 'meetup'
type Deal = NonNullable<Intent['deal']>

export const requestOpen = (q: Request) => q.status === 'open' || q.status === 'accepted'
export const meetupOpen = (m: Meetup) => m.status === 'open' || m.status === 'accepted'

/** Ended badly for the fan: you backed out, were late, or what you sent was not it. */
export const wentBadly = (q: Request) =>
  (q.status === 'declined' && q.acceptedDay !== undefined) ||
  (q.status === 'expired' && q.acceptedDay !== undefined) ||
  (q.status === 'delivered' && !q.delivery?.paid)

/**
 * Hard rules: his type does this at all, nothing of this kind is open with him, and the
 * last one ended a while ago. A dormant fan only counts when you write to him (that wakes him).
 */
function eligible(account: Account, r: Regular, kind: DealKind, day: number, youAsked: boolean): boolean {
  const f = fanProfile(r)[kind]
  if ((r.status !== 'active' && !youAsked) || !(youAsked ? f.accept : f.daily)) return false
  const mine: (Request | Meetup)[] = kind === 'custom' ? account.requests.filter((q) => q.regularId === r.id) : account.meetups.filter((m) => m.regularId === r.id)
  if (mine.some((x) => (kind === 'custom' ? requestOpen(x as Request) : meetupOpen(x as Meetup)))) return false
  const last = mine.at(-1)
  return !last || day - (last.closedDay ?? last.day) >= (kind === 'custom' ? Q.cooldownDays : M.cooldownDays)
}

/** He only brings one up himself once he is loyal enough (his type's level; lower for obsessed fans and stalkers). */
const loyalEnough = (r: Regular, kind: DealKind) => loyaltyLevel(r) >= fanProfile(r)[kind].minLoyalty

/**
 * The chance: per day that he brings it up himself, or that he says yes when you do.
 * His type's rate × his loyalty × your direction (× his traits for meetups; × 0.5 after a custom that went badly).
 * Loyalty counts more for meetups (×2.5 at Devoted, ×4 at Fanatic) than for customs.
 */
export function dealChance(account: Account, r: Regular, kind: DealKind, youAsked: boolean): number {
  const f = fanProfile(r)
  const fx = directionEffects(account)
  const loyal = loyaltyEffects(r).deal
  if (kind === 'custom') {
    const last = account.requests.filter((q) => q.regularId === r.id).at(-1)
    const base = youAsked ? f.custom.accept : f.custom.daily
    return Math.min(0.95, base * loyal * fx.requests.rate * (last && wentBadly(last) ? Q.upsetFactor : 1))
  }
  const base = youAsked ? f.meetup.accept : f.meetup.daily
  return Math.min(0.95, base * loyaltyEffects(r).meetup * fx.meetups.rate * f.meetup.factor)
}

/** Opens a deal on his message `messageId`: what he wants and offers, decided now. */
function open(rng: Rng, account: Account, r: Regular, kind: DealKind, day: number, messageId: string): { account: Account; deal: Deal; event: EngineEvent } {
  const f = fanProfile(r)
  const fx = directionEffects(account)
  if (kind === 'custom') {
    // One or two of the things he likes; as explicit as the most explicit of them.
    const likes = [...r.likes]
    for (let i = likes.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[likes[i], likes[j]] = [likes[j], likes[i]]
    }
    const wanted = likes.slice(0, rng() < 0.5 ? 1 : 2)
    const intensity = Math.max(1, ...wanted.map((id) => tags.find((x) => x.id === id)?.intensity ?? 1))
    const offerCents = Math.min(Q.maxCents, Math.max(Q.minCents, Math.round(logNormal(rng, f.custom.median * fx.requests.offer, Q.spread)) * 100))
    const id = `${r.id}-q${account.requests.filter((q) => q.regularId === r.id).length}`
    const request: Request = { id, regularId: r.id, day, tags: wanted, intensity, offerCents, dueDay: day + Q.dueDays, status: 'open', messageId }
    return {
      account: { ...account, requests: [...account.requests, request] },
      deal: { kind, step: 'ask', id },
      event: { day, type: 'request', regularId: r.id, requestId: id },
    }
  }
  const offerCents = Math.max(M.minCents, Math.round((logNormal(rng, f.meetup.median * fx.meetups.offer, M.spread) * 100) / M.roundCents) * M.roundCents)
  const id = `${r.id}-o${account.meetups.filter((m) => m.regularId === r.id).length}`
  const meetup: Meetup = { id, regularId: r.id, day, offerCents, replyBy: day + M.replyDays, status: 'open', hidden: false, messageId }
  return {
    account: { ...account, meetups: [...account.meetups, meetup] },
    deal: { kind, step: 'ask', id },
    event: { day, type: 'meetup', regularId: r.id, meetupId: id },
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
      if (rng() >= dealChance(a, r, kind, false)) continue
      const opened = open(rng, a, r, kind, day, `${r.id}-m${threadOf(a, r.id).messages.length}`)
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
  const opened = open(rng, account, r, kind, day, replyId)
  return { account: { ...opened.account, events: [...opened.account.events, opened.event] }, deal: opened.deal, events: [opened.event] }
}
