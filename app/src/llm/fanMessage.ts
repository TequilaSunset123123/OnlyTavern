// Model task: write one fan's DM (plan.md §5 "熟客私信回复" / "熟客主动私信").
// The engine has already decided what happens (bought or not, tip); the model only
// puts it into words. Short input, one tagged output, lenient parsing (plan.md §2).
import type { Message, ThreadView } from '../api'
import { getConnectionProfiles } from '../bridge/st'
import preset from '../presets/audience.json'
import tags from '../presets/tags.json'
import { type ChatMessage, generateWithProfile } from './connection_utils.js'

const LANGUAGES = { en: 'English', zh: 'Simplified Chinese' }
const HISTORY = 16
const MAX_TOKENS = 3000 // reasoning models think before answering
/** A provider that never answers would leave the fan "typing" forever. */
const TIMEOUT_MS = 120_000
const TOPICS = {
  chat: 'just want to chat',
  compliment: 'want to compliment the creator',
  wants_content: 'want to ask for more or for a specific kind of content',
  tip: 'are sending a tip',
}
const REASONS = { liked: 'you wanted it', price: 'too expensive for you', taste: 'not your taste', mood: 'not in the mood right now' }
const NOT_IT = {
  liked: '',
  tags: 'it is not what you asked for',
  tame: 'it is tamer than what you asked for',
  explicit: 'it goes further than you wanted',
  reused: 'you have seen it before, so it was not made for you',
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
const tagLabel = (id: string) => tags.find((t) => t.id === id)?.en ?? id

const describe = (view: ThreadView, ids: string[]) => ids.map((id) => view.items[id]?.description ?? 'a removed item').join(' / ')

function describeItems(view: ThreadView, m: Message): string {
  if (m.delivery) return ` [your custom: ${describe(view, m.delivery.vaultIds)}]`
  if (!m.ppv) return ''
  return ` [paid message, ${money(m.ppv.priceCents)}: ${describe(view, m.ppv.vaultIds)}]`
}

/** Lines for customs and meetups (step 5). */
function describeExtras(view: ThreadView, i: NonNullable<Message['intent']>): string[] {
  const out: string[] = []
  const q = i.request && view.requests.find((x) => x.id === i.request!.requestId)
  if (q && i.request) {
    const wanted = `${q.tags.map(tagLabel).join(' + ')}, explicitness ${q.intensity} of 5`
    if (i.request.phase === 'ask') {
      out.push(
        `You are asking the creator for a custom piece made just for you: ${wanted}. You offer ${money(q.offerCents)}, paid when you receive it, and want it within ${q.dueDay - q.day} days. Say what you would like in your own words and mention the offer.`,
      )
    } else if (i.request.phase === 'late') {
      out.push(`The creator agreed to make your custom (${wanted}) but did not deliver it in time. You are disappointed; you are not paying.`)
    } else if (q.delivery) {
      const got = describe(view, q.delivery.vaultIds)
      out.push(
        q.delivery.paid
          ? `The creator delivered the custom you asked for [${got}]. It is what you wanted: you paid the ${money(q.offerCents)} you offered. React to it.`
          : `The creator delivered [${got}] for your custom (you wanted ${wanted}), but ${NOT_IT[q.delivery.reason]}: you are not paying. Tell them, without being cruel.`,
      )
    }
  }
  const o = i.meetup && view.meetups.find((x) => x.id === i.meetup!.meetupId)
  if (o && i.meetup) {
    out.push(
      i.meetup.phase === 'invite'
        ? `You are asking the creator to meet you in person, off the platform, for a night together, and offer ${money(o.offerCents)} in cash. Be direct but respectful; it is their choice.`
        : `You met the creator in person today and paid ${money(o.offerCents)} in cash. Write to them afterwards.`,
    )
  }
  return out
}

export function buildFanPrompt(view: ThreadView, messageId: string): ChatMessage[] {
  const { regular: r, creator: c } = view
  const target = view.messages.find((m) => m.id === messageId)
  if (!target?.intent) throw new Error('No pending message to write')
  const seg = preset.segments[r.segment]
  const before = view.messages.slice(0, view.messages.indexOf(target)).filter((m) => m.state === 'sent').slice(-HISTORY)

  const system = [
    'You play one fan of a creator on a subscription platform for adults (like OnlyFans), writing to the creator in private messages.',
    'Everyone involved is an adult and everything is consensual.',
    "Write only the fan's next message: no narration, no actions in asterisks, no quotes around it, no name prefix, and never the creator's lines.",
    `Chat style, 1-3 short sentences, written in ${LANGUAGES[r.language]} the way real people type online.`,
    'The game handles all money. Unless "What happens now" says so, do not send, offer or promise a tip or payment (not even "I tip well" or "I\'ll tip you"), and do not say you bought anything.',
    'Put the message between <message> and </message>.',
  ].join('\n')

  const what: string[] = []
  const i = target.intent
  if (i.kind === 'opener') what.push(i.request || i.meetup ? 'You are messaging the creator on your own.' : `You are messaging the creator on your own: you ${TOPICS[i.topic ?? 'chat']}.`)
  else what.push("You are answering the creator's latest message(s).")
  for (const d of i.ppv ?? []) {
    const m = view.messages.find((x) => x.id === d.messageId)
    const desc = m ? describeItems(view, m) : ''
    what.push(d.bought ? `You bought the paid message${desc} and have seen it: react to what you got.` : `You did NOT buy the paid message${desc}: ${REASONS[d.reason]}. Say so in your own way.`)
  }
  what.push(...describeExtras(view, i))
  if (i.tip) what.push(`You are sending a ${money(i.tip)} tip with this message; mention it naturally.`)

  const user = [
    `You are ${r.name} (@${r.handle}), ${r.bio}.`,
    `Fan type: ${seg.label.toLowerCase()}, ${seg.description}.`,
    `You like: ${r.likes.map(tagLabel).join(', ') || 'anything'}. You have spent ${money(r.spent)} on this creator in messages and became a regular on day ${r.since}.`,
    `The creator: ${c.name} (@${c.handle}), ${c.accountType === 'free' ? 'free page' : `paid page at ${money(c.priceCents)}/month`}, ${c.subscribers} subscribers. Today is day ${target.day}.`,
    '',
    before.length ? 'Conversation so far (oldest first):' : 'This is the first message in the conversation.',
    ...before.map((m) => `${m.from === 'me' ? '[Creator]' : '[You]'} ${m.text || '(no text)'}${describeItems(view, m)}${m.tipCents ? ` [you tipped ${money(m.tipCents)}]` : ''}`),
    '',
    'What happens now (the game decided it; act it out without mentioning the game):',
    ...what.map((w) => `- ${w}`),
  ].join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** Lenient: weak models add think blocks, prefixes, quotes or narration (plan.md §13). */
export function parseFanMessage(raw: string, name?: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const tagged = [...text.matchAll(/<message>([\s\S]*?)(?:<\/message>|$)/gi)].map((m) => m[1].trim()).filter(Boolean)
  if (tagged.length) text = tagged[tagged.length - 1]
  text = text
    .replace(/<\/?[a-z_]+>/gi, '')
    .replace(/^\s*(\[?(you|fan|me)\]?|\[[^\]]+\])\s*:?\s*/i, '')
    .trim()
  if (name) text = text.replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:：]\\s*`), '')
  text = text.replace(/^\*[^*]+\*\s*/g, '').replace(/\s*\*[^*]+\*$/g, '')
  text = text.replace(/^["“「](.*)["”」]$/s, '$1').trim()
  if (!text) throw new Error('The model returned an empty message')
  return text.length > 800 ? `${text.slice(0, 800)}…` : text
}

/** Calls the model through the SillyTavern connection profile (null = the selected one). */
export async function writeFanMessage(view: ThreadView, messageId: string, profileId: string | null): Promise<string> {
  const profile = profileId ?? getConnectionProfiles().selected
  if (!profile) throw new Error('No connection profile: pick one in Settings')
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
  try {
    const raw = await generateWithProfile(profile, buildFanPrompt(view, messageId), abort, {
      maxTokens: MAX_TOKENS,
      includePreset: false,
      includeInstruct: false,
    })
    return parseFanMessage(raw, view.regular.name)
  } catch (e) {
    if (abort.signal.aborted) throw new Error(`The model did not answer within ${TIMEOUT_MS / 60_000} minutes`)
    throw e
  } finally {
    clearTimeout(timer)
  }
}
