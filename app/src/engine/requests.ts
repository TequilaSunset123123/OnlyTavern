// Custom requests (plan.md §4.3, step 5). Regulars you talk to ask for a piece
// made just for them: the engine picks what they want (from their likes), the
// offer and the deadline, and on delivery decides whether it matches. They pay
// on delivery, through the platform (20% fee). The model only writes the words.
import preset from '../presets/audience.json'
import tags from '../presets/tags.json'
import type { Account, DeliveryReason, EngineEvent, LedgerEntry, Message, Request } from '../store/schema'
import { ContentError } from './content'
import { intensityMatch } from './posts'
import { closeness, line, pendingMessage, recentMine, threadOf, tipCents, unanswered, withReply, withThread } from './regulars'
import { logNormal, rngFor } from './rng'

const Q = preset.requests

const isOpen = (q: Request) => q.status === 'open' || q.status === 'accepted'

/** Ended badly for the fan: you backed out, were late, or what you sent was not it. */
const wentBadly = (q: Request) =>
  (q.status === 'declined' && q.acceptedDay !== undefined) ||
  (q.status === 'expired' && q.acceptedDay !== undefined) ||
  (q.status === 'delivered' && !q.delivery?.paid)

function update(account: Account, id: string, change: (q: Request) => Request): Account {
  return { ...account, requests: account.requests.map((q) => (q.id === id ? change(q) : q)) }
}

function mustFind(account: Account, id: string): Request {
  const q = account.requests.find((x) => x.id === id)
  if (!q) throw new ContentError('Request not found')
  return q
}

/** One simulated day: late requests expire; fans you talk to may ask for a custom. */
export function simulateRequestsDay(account: Account, seed: string, day: number): { account: Account; events: EngineEvent[] } {
  let a = account
  const events: EngineEvent[] = []

  // Past the deadline. If you had said yes, the fan lets you know they are disappointed.
  for (const q of a.requests.filter((x) => isOpen(x) && day > x.dueDay)) {
    a = update(a, q.id, (x) => ({ ...x, status: 'expired', closedDay: day }))
    events.push({ day, type: 'request-expired', regularId: q.regularId, accepted: q.acceptedDay !== undefined })
    if (q.acceptedDay !== undefined) {
      const t = threadOf(a, q.regularId)
      a = withThread(a, { ...t, messages: [...t.messages, pendingMessage(`${q.regularId}-m${t.messages.length}`, day, { kind: 'opener', request: { requestId: q.id, phase: 'late' } })] })
    }
  }

  for (const r of a.regulars) {
    if (r.status !== 'active') continue
    const p = preset.segments[r.segment]
    if (!p.requestDaily) continue
    const t = threadOf(a, r.id)
    // Only fans you have been talking to lately, one request at a time, and a pause after the last one.
    if (recentMine(t, day) === 0 || unanswered(t) >= Q.maxUnanswered) continue
    const mine = a.requests.filter((x) => x.regularId === r.id)
    if (mine.some(isOpen)) continue
    const last = mine.at(-1)
    if (last && day - (last.closedDay ?? last.day) < Q.cooldownDays) continue

    const rng = rngFor(seed, day, `requests:${r.id}`)
    const chance = p.requestDaily * closeness(t, day) * (last && wentBadly(last) ? Q.upsetFactor : 1)
    if (rng() >= chance) continue

    // One or two of the things they like; as explicit as the most explicit of them.
    const likes = [...r.likes]
    for (let i = likes.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[likes[i], likes[j]] = [likes[j], likes[i]]
    }
    const wanted = likes.slice(0, rng() < 0.5 ? 1 : 2)
    const intensity = Math.max(1, ...wanted.map((id) => tags.find((x) => x.id === id)?.intensity ?? 1))
    const offer = Math.min(Q.maxCents, Math.max(Q.minCents, Math.round(logNormal(rng, p.requestMedian, Q.spread)) * 100))
    const id = `${r.id}-q${mine.length}`
    const messageId = `${r.id}-m${t.messages.length}`
    a = {
      ...withThread(a, { ...t, messages: [...t.messages, pendingMessage(messageId, day, { kind: 'opener', request: { requestId: id, phase: 'ask' } })] }),
      requests: [...a.requests, { id, regularId: r.id, day, tags: wanted, intensity, offerCents: offer, dueDay: day + Q.dueDays, status: 'open', messageId }],
    }
    events.push({ day, type: 'request', regularId: r.id, requestId: id })
  }

  return { account: a, events }
}

export function acceptRequest(account: Account, id: string): Account {
  const q = mustFind(account, id)
  if (q.status !== 'open') throw new ContentError('This request is no longer open')
  return update(account, id, (x) => ({ ...x, status: 'accepted', acceptedDay: account.clock.day }))
}

/** Say no (or back out after saying yes, which the fan remembers). */
export function declineRequest(account: Account, id: string): Account {
  const q = mustFind(account, id)
  if (!isOpen(q)) throw new ContentError('This request is no longer open')
  return update(account, id, (x) => ({ ...x, status: 'declined', closedDay: account.clock.day }))
}

/** Has this fan seen the item before: in a post, a mass message, a DM or an earlier custom? */
function seenBefore(account: Account, regularId: string, vaultId: string): boolean {
  if (account.posts.some((p) => p.vaultIds.includes(vaultId))) return true
  if (account.massMessages.some((m) => m.ppv?.vaultIds.includes(vaultId))) return true
  return threadOf(account, regularId).messages.some((m) => m.ppv?.vaultIds.includes(vaultId) || m.delivery?.vaultIds.includes(vaultId))
}

export type DeliveryCheck = {
  /** Share of the wanted tags the items have, 0–1. */
  tags: number
  /** How close the explicitness is, 0–1 (1 = exactly as asked). */
  intensity: number
  /** Items the fan has seen before (a custom must be new). */
  reused: string[]
  score: number
  paid: boolean
  reason: DeliveryReason
}

/** Would the fan accept this as their custom? score = tags × explicitness; reused content never passes. */
export function checkDelivery(account: Account, request: Request, vaultIds: string[]): DeliveryCheck {
  const items = vaultIds.map((id) => account.vault.find((v) => v.id === id)!)
  const covered = request.tags.length ? request.tags.filter((t) => items.some((i) => i.tags.includes(t))).length / request.tags.length : 1
  const level = Math.max(...items.map((i) => i.intensity))
  const match = intensityMatch(level, request.intensity)
  const reused = vaultIds.filter((id) => seenBefore(account, request.regularId, id))
  const score = covered * match
  const paid = reused.length === 0 && score >= Q.passScore
  const reason: DeliveryReason = paid ? 'liked' : reused.length ? 'reused' : covered <= match ? 'tags' : level < request.intensity ? 'tame' : 'explicit'
  return { tags: covered, intensity: match, reused, score, paid, reason }
}

/**
 * You send the custom. The fan decides now whether it is what they asked for and
 * pays the offer (sometimes with a tip for a perfect one); their reply is queued
 * for the model like any DM reply.
 */
export function deliverRequest(account: Account, id: string, vaultIds: string[], text: string, seed: string): { account: Account; events: EngineEvent[] } {
  const q = mustFind(account, id)
  if (q.status !== 'accepted') throw new ContentError(q.status === 'open' ? 'Accept the request first' : 'This request is no longer open')
  if (vaultIds.length === 0) throw new ContentError('Pick content from the vault to deliver')
  if (vaultIds.some((v) => !account.vault.some((i) => i.id === v))) throw new ContentError('Some vault items no longer exist')
  const day = account.clock.day
  const regular = account.regulars.find((r) => r.id === q.regularId)!
  const thread = threadOf(account, q.regularId)
  const myId = `${q.regularId}-m${thread.messages.length}`
  const check = checkDelivery(account, q, vaultIds)
  const rng = rngFor(seed, day, `deliver:${id}`)

  const ledger: LedgerEntry[] = []
  const events: EngineEvent[] = []
  let tip: number | undefined
  if (check.paid) {
    ledger.push(line(day, 'custom', id, q.offerCents))
    events.push({ day, type: 'request-paid', regularId: q.regularId, gross: q.offerCents })
    const chance = Math.min(0.9, preset.segments[regular.segment].dmTipChance * Q.tipFactor)
    if (check.score >= Q.perfectScore && rng() < chance) {
      tip = tipCents(rng, regular.segment)
      ledger.push(line(day, 'tip', `${id}-tip`, tip))
      events.push({ day, type: 'dm-tip', regularId: q.regularId, gross: tip })
    }
  } else {
    events.push({ day, type: 'request-unpaid', regularId: q.regularId })
  }

  const mine: Message = { id: myId, day, from: 'me', text: text.trim(), state: 'sent', delivery: { requestId: id, vaultIds } }
  const next = withReply(thread, mine, (i) => ({ ...i, request: { requestId: id, phase: 'delivered' } }), tip)
  const spent = (check.paid ? q.offerCents : 0) + (tip ?? 0)
  const delivered = update(withThread(account, next), id, (x) => ({
    ...x,
    status: 'delivered',
    closedDay: day,
    delivery: { day, vaultIds, paid: check.paid, reason: check.reason, ...(tip ? { tipCents: tip } : {}) },
  }))
  return {
    account: {
      ...delivered,
      regulars: delivered.regulars.map((r) => (r.id === q.regularId ? { ...r, spent: r.spent + spent, status: 'active' } : r)),
      ledger: [...delivered.ledger, ...ledger],
      events: [...delivered.events, ...events],
    },
    events,
  }
}
