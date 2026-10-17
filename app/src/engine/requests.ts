// Custom requests after they start (plan.md §4.3, step 5): you accept or decline,
// deliver, or miss the deadline; on delivery the engine decides whether it matches
// and the fan pays (through the platform, 20% fee). How a request starts is deals.ts.
import preset from '../presets/audience.json'
import type { Account, DeliveryReason, EngineEvent, LedgerEntry, Message, Request } from '../store/schema'
import { ContentError } from './content'
import { requestOpen as isOpen } from './deals'
import { addPoints, customPoints, platformFee } from './directions'
import { paymentLine as line } from './economy'
import { addLoyalty, fanProfile, loyaltyEffects } from './fans'
import { snubbed } from './haters'
import { intensityMatch } from './posts'
import { tipCents } from './regulars'
import { rngFor } from './rng'
import { addFanMessage, threadOf, withReply, withThread } from './threads'

const Q = preset.requests

function update(account: Account, id: string, change: (q: Request) => Request): Account {
  return { ...account, requests: account.requests.map((q) => (q.id === id ? change(q) : q)) }
}

function mustFind(account: Account, id: string): Request {
  const q = account.requests.find((x) => x.id === id)
  if (!q) throw new ContentError('Request not found')
  return q
}

/** One simulated day: requests past their deadline expire. If you had said yes, he lets you know he is disappointed. */
export function simulateRequestsDay(account: Account, day: number): { account: Account; events: EngineEvent[] } {
  let a = account
  const events: EngineEvent[] = []
  for (const q of a.requests.filter((x) => isOpen(x) && day > x.dueDay)) {
    a = update(a, q.id, (x) => ({ ...x, status: 'expired', closedDay: day }))
    events.push({ day, type: 'request-expired', regularId: q.regularId, accepted: q.acceptedDay !== undefined })
    if (q.acceptedDay !== undefined) a = addFanMessage(a, q.regularId, day, { kind: 'opener', deal: { kind: 'custom', step: 'late', id: q.id } })
  }
  return { account: a, events }
}

export function acceptRequest(account: Account, id: string): Account {
  const q = mustFind(account, id)
  if (q.status !== 'open') throw new ContentError('This request is no longer open')
  return update(account, id, (x) => ({ ...x, status: 'accepted', acceptedDay: account.clock.day }))
}

/** Say no (or back out after saying yes, which the fan remembers). An entitled fan turns on you for it. */
export function declineRequest(account: Account, id: string): Account {
  const q = mustFind(account, id)
  if (!isOpen(q)) throw new ContentError('This request is no longer open')
  return snubbed(update(account, id, (x) => ({ ...x, status: 'declined', closedDay: account.clock.day })), q.regularId)
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
  /** Wanted tags none of the items has. */
  missing: string[]
  /** Explicitness of what you picked (its most explicit item). */
  level: number
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
  const missing = request.tags.filter((t) => !items.some((i) => i.tags.includes(t)))
  return { tags: covered, intensity: match, reused, score, paid, reason, missing, level }
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
    ledger.push(line(day, 'custom', id, q.offerCents, platformFee(account)))
    events.push({ day, type: 'request-paid', regularId: q.regularId, gross: q.offerCents })
    // A perfect one may earn a tip on top: his tip chance (type × loyalty) × 2.
    const chance = Math.min(0.9, fanProfile(regular).tip.chance * loyaltyEffects(regular).tip * Q.tipFactor)
    if (check.score >= Q.perfectScore && rng() < chance) {
      tip = tipCents(rng, regular)
      ledger.push(line(day, 'tip', `${id}-tip`, tip, platformFee(account)))
      events.push({ day, type: 'dm-tip', regularId: q.regularId, gross: tip })
    }
  } else {
    events.push({ day, type: 'request-unpaid', regularId: q.regularId })
  }

  const mine: Message = { id: myId, day, from: 'me', text: text.trim(), state: 'sent', delivery: { requestId: id, vaultIds } }
  const next = withReply(thread, mine, (i) => ({ ...i, deal: { kind: 'custom', step: 'delivered', id } }), tip)
  const spent = (check.paid ? q.offerCents : 0) + (tip ?? 0)
  const credited = check.paid ? addLoyalty(addPoints(account, customPoints(q.tags)), q.regularId, 'custom') : account
  const delivered = update(withThread(credited, next), id, (x) => ({
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
