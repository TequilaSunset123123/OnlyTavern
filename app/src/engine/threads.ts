// Small helpers for DM threads, shared by regulars, deals, requests and meetups.
import preset from '../presets/audience.json'
import type { Account, Intent, Message, Regular, Thread } from '../store/schema'
import { ContentError } from './content'

const C = preset.regulars.closeness

export function threadOf(account: Account, regularId: string): Thread {
  const t = account.threads.find((x) => x.regularId === regularId)
  if (!t) throw new ContentError('Conversation not found')
  return t
}

export function withThread(account: Account, thread: Thread): Account {
  return { ...account, threads: account.threads.map((t) => (t.regularId === thread.regularId ? thread : t)) }
}

export function updateRegular(account: Account, regular: Regular): Account {
  return { ...account, regulars: account.regulars.map((r) => (r.id === regular.id ? regular : r)) }
}

/** A fan message the model still has to write. */
export function pendingMessage(id: string, day: number, intent: Intent, tip?: number): Message {
  return { id, day, from: 'fan', text: '', state: 'pending', intent, ...(tip ? { tipCents: tip } : {}) }
}

/** Adds a fan message of his own (not a reply) to his thread. */
export function addFanMessage(account: Account, regularId: string, day: number, intent: Intent): Account {
  const t = threadOf(account, regularId)
  return withThread(account, { ...t, messages: [...t.messages, pendingMessage(`${regularId}-m${t.messages.length}`, day, intent)] })
}

/** Fan messages since your last one. */
export function unanswered(thread: Thread): number {
  return thread.messages.length - 1 - thread.messages.findLastIndex((m) => m.from === 'me')
}

/** Messages you wrote to this fan yourself in the last 14 days (mass messages don't count). */
export function recentMine(thread: Thread, day: number): number {
  return thread.messages.filter((m) => m.from === 'me' && !m.massId && m.day > day - C.days).length
}

/**
 * How warm this fan is: the more you wrote to them yourself lately, the likelier
 * they buy (and ask for customs or meetups). 0.7 cold … 1.3 after 10 messages in 14 days.
 */
export function closeness(thread: Thread, day: number): number {
  return C.base + C.perMessage * Math.min(C.maxMessages, recentMine(thread, day))
}

/**
 * Ends the thread with a fan reply still to be written. A reply that is already
 * waiting is reused, so several things you do before the fan answers become one
 * reply that reacts to all of them.
 */
export function withReply(thread: Thread, mine: Message, change: (intent: Intent) => Intent, tip?: number): Thread {
  const last = thread.messages.at(-1)
  const folded = last?.state === 'pending' && last.intent?.kind === 'reply' ? last : undefined
  const messages = folded ? thread.messages.slice(0, -1) : [...thread.messages]
  const tipped = folded?.tipCents ?? tip
  const intent = change({ ...folded?.intent, kind: 'reply' })
  messages.push(mine, pendingMessage(`${mine.id}-reply`, mine.day, { ...intent, ...(tipped ? { tip: tipped } : {}) }, tipped))
  // You have seen everything up to your own message; the reply is new.
  return { ...thread, messages, read: messages.length - 1 }
}
