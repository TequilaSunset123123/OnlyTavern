// How a deal starts (plan.md §2 rule 3, 2026-10-15). One entry point for customs and
// meetups, two ways in:
//   - a fan brings one up on his own: rolled once a day;
//   - you bring one up in a message: he says yes or no, rolled when you send it.
// Everything with a number is decided here, like a game mechanic; the model only gets
// one line saying what happened (llm/fanMessage.ts). What happens next (accept,
// deliver, meet) is requests.ts and meetups.ts.
import preset from '../presets/audience.json'
import tags from '../presets/tags.json'
import type { Account, EngineEvent, Intent, Meetup, Regular, Request } from '../store/schema'
import { directionEffects } from './directions'
import { behaviour } from './personas'
import { logNormal, type Rng, rngFor } from './rng'
import { addFanMessage, closeness, recentMine, threadOf, unanswered } from './threads'

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
  const p = preset.segments[r.segment]
  if ((r.status !== 'active' && !youAsked) || !(kind === 'custom' ? p.requestDaily : p.meetupDaily)) return false
  const mine: (Request | Meetup)[] = kind === 'custom' ? account.requests.filter((q) => q.regularId === r.id) : account.meetups.filter((m) => m.regularId === r.id)
  if (mine.some((x) => (kind === 'custom' ? requestOpen(x as Request) : meetupOpen(x as Meetup)))) return false
  const last = mine.at(-1)
  return !last || day - (last.closedDay ?? last.day) >= (kind === 'custom' ? Q.cooldownDays : M.cooldownDays)
}

/** He only brings one up himself if you have been talking lately and he is not left waiting. */
function wouldBringUp(account: Account, r: Regular, kind: DealKind, day: number): boolean {
  const t = threadOf(account, r.id)
  return kind === 'custom'
    ? recentMine(t, day) > 0 && unanswered(t) < Q.maxUnanswered
    : recentMine(t, day) >= M.minMessages && unanswered(t) < M.maxUnanswered
}

/**
 * The chance: per day that he brings it up himself, or that he says yes when you do.
 * His type × how warm he is × your direction (× his traits for meetups; × 0.5 after a custom that went badly).
 */
export function dealChance(account: Account, r: Regular, kind: DealKind, day: number, youAsked: boolean): number {
  const warm = closeness(threadOf(account, r.id), day)
  const fx = directionEffects(account)
  const p = preset.segments[r.segment]
  if (kind === 'custom') {
    const last = account.requests.filter((q) => q.regularId === r.id).at(-1)
    const base = youAsked ? Q.accept[r.segment] : p.requestDaily
    return Math.min(0.95, base * fx.requests.rate * warm * (last && wentBadly(last) ? Q.upsetFactor : 1))
  }
  const base = youAsked ? M.accept[r.segment] : p.meetupDaily
  return Math.min(0.95, base * fx.meetups.rate * warm * behaviour(r.traits).meetupFactor)
}

/** Opens a deal on his message `messageId`: what he wants and offers, decided now. */
function open(rng: Rng, account: Account, r: Regular, kind: DealKind, day: number, messageId: string): { account: Account; deal: Deal; event: EngineEvent } {
  const p = preset.segments[r.segment]
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
    const offerCents = Math.min(Q.maxCents, Math.max(Q.minCents, Math.round(logNormal(rng, p.requestMedian * fx.requests.offer, Q.spread)) * 100))
    const id = `${r.id}-q${account.requests.filter((q) => q.regularId === r.id).length}`
    const request: Request = { id, regularId: r.id, day, tags: wanted, intensity, offerCents, dueDay: day + Q.dueDays, status: 'open', messageId }
    return {
      account: { ...account, requests: [...account.requests, request] },
      deal: { kind, step: 'ask', id },
      event: { day, type: 'request', regularId: r.id, requestId: id },
    }
  }
  const offerCents = Math.max(M.minCents, Math.round((logNormal(rng, p.meetupMedian * fx.meetups.offer, M.spread) * 100) / M.roundCents) * M.roundCents)
  const id = `${r.id}-o${account.meetups.filter((m) => m.regularId === r.id).length}`
  const meetup: Meetup = { id, regularId: r.id, day, offerCents, replyBy: day + M.replyDays, status: 'open', hidden: false, messageId }
  return {
    account: { ...account, meetups: [...account.meetups, meetup] },
    deal: { kind, step: 'ask', id },
    event: { day, type: 'meetup', regularId: r.id, meetupId: id },
  }
}

/** Once a day: fans you talk to may bring up a custom or a meetup on their own (at most one each). */
export function simulateDealsDay(account: Account, seed: string, day: number): { account: Account; events: EngineEvent[] } {
  let a = account
  const events: EngineEvent[] = []
  for (const r of a.regulars) {
    for (const kind of ['custom', 'meetup'] as const) {
      if (!eligible(a, r, kind, day, false) || !wouldBringUp(a, r, kind, day)) continue
      const rng = rngFor(seed, day, `deals:${kind}:${r.id}`)
      if (rng() >= dealChance(a, r, kind, day, false)) continue
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
  if (!eligible(account, r, kind, day, true) || rng() >= dealChance(account, r, kind, day, true)) return { account, deal: { kind, step: 'no' }, events: [] }
  const opened = open(rng, account, r, kind, day, replyId)
  return { account: { ...opened.account, events: [...opened.account.events, opened.event] }, deal: opened.deal, events: [opened.event] }
}
