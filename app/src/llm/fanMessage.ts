// Model task: write one fan's DM (plan.md §5 "熟客私信回复" / "熟客主动私信").
// plan.md §2 rule 3: the engine has already decided everything that happens (a sale,
// a tip, a deal, its numbers); the model only puts it into words. So the prompt stays
// small: who he is, the chat so far, and one line for each thing that happens now.
// No rules about cases that are not happening. Lenient parsing (plan.md §2).
import type { Intent, Message, ThreadView } from '../api'
import { getConnectionProfiles } from '../bridge/st'
import preset from '../presets/audience.json'
import tags from '../presets/tags.json'
import { type ChatMessage, generateWithProfile } from './connection_utils.js'

const LANGUAGES = { en: 'English', zh: 'Simplified Chinese' }
const HISTORY = 10 // a short history keeps the call fast
const MAX_TOKENS = 3000 // reasoning models think before answering
/** A provider that never answers would leave the fan "typing" forever. */
const TIMEOUT_MS = 120_000

const TOPICS = {
  chat: 'just want to chat',
  compliment: 'want to compliment her',
  wants_content: 'tell her what you like seeing on her page',
  tip: 'are sending a tip',
  harass: 'want to insult and degrade her',
  obsess: 'cannot stop thinking about her and want her attention',
}
const NOT_BOUGHT = { liked: '', price: 'too expensive for you', taste: 'not your taste', mood: 'not in the mood right now' }

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
const tagLabel = (id: string) => tags.find((t) => t.id === id)?.en ?? id
const describe = (view: ThreadView, ids: string[]) => ids.map((id) => view.items[id]?.description ?? 'a removed item').join(' / ')

function describeItems(view: ThreadView, m: Message): string {
  if (m.delivery) return ` [your custom: ${describe(view, m.delivery.vaultIds)}]`
  if (!m.ppv) return ''
  return ` [paid message, ${money(m.ppv.priceCents)}: ${describe(view, m.ppv.vaultIds)}]`
}

/** Exactly what was wrong with a custom he did not pay for (requests.ts decided it), so the model does not guess. */
function notPaid(view: ThreadView, q: ThreadView['requests'][number]): string {
  const items = (q.delivery?.vaultIds ?? []).map((id) => view.items[id]).filter((x) => !!x)
  const has = [...new Set(items.flatMap((i) => i.tags))]
  const missing = q.tags.filter((t) => !has.includes(t))
  const level = Math.max(1, ...items.map((i) => i.intensity))
  switch (q.delivery?.reason) {
    case 'reused':
      return 'you have seen it before (on her page or in your messages), so it was not made for you'
    case 'tame':
      return `it is only explicitness ${level} of 5, tamer than the ${q.intensity} you asked for`
    case 'explicit':
      return `it is explicitness ${level} of 5, further than the ${q.intensity} you wanted`
    default: {
      const wanted = missing.map(tagLabel).join(' + ') || 'what'
      const got = has.filter((t) => !q.tags.includes(t)).map(tagLabel).join(' + ')
      return got ? `it is ${got}, not the ${wanted} you asked for` : `it has no ${wanted}, which you asked for`
    }
  }
}

/** The one line for a deal the engine decided (deals.ts, requests.ts, meetups.ts). */
function dealLine(view: ThreadView, d: NonNullable<Intent['deal']>): string {
  if (d.kind === 'meetup') {
    const m = view.meetups.find((x) => x.id === d.id)
    if (d.step === 'no') return 'She brought up meeting in person; you turn it down.'
    if (d.step === 'back') return 'Weeks ago your wife caught you meeting her and you went quiet; things have calmed down and you are writing to her again.'
    if (d.step === 'met') {
      const paid = money(m?.paidCents ?? m?.offerCents ?? 0)
      const tookIt = m?.outcome === 'smooth' || m?.outcome === 'bonus' || m?.outcome === 'creep'
      const pushy = m?.outcome === 'creep' ? ' You got too pushy with her first.' : ''
      if (m?.hate && tookIt) {
        const cash = m.terms === 'free' || m.terms === 'worship' ? 'paid her nothing' : m.terms === 'lowball' ? `tossed her ${paid}, all a cheap whore like her is worth` : `paid her ${paid}`
        return `You met her in person today and hate-fucked her: rough, contemptuous, using her to show what you think of her; then you ${cash}.${pushy} Write to her afterwards.`
      }
      if (m?.terms === 'worship' && tookIt) return `You met her in person today, as she offered; you worshipped her and thanked her over and over, but did not pay her anything.${pushy} Write to her afterwards.`
      if (m?.terms === 'free' && tookIt) return `You met her in person today, as she offered, then pulled your pants up and left without paying her anything.${pushy} Write to her afterwards.`
      if (m?.terms === 'lowball' && tookIt) return `You met her in person today, as she offered, and tossed her ${paid} on your way out, because that is all you think a cheap whore like her is worth.${pushy} Write to her afterwards.`
      return {
        smooth: `You met her in person today and paid ${paid} in cash; write to her afterwards.`,
        bonus: `You met her in person today and loved it so much you paid ${paid} instead of ${money(m?.offerCents ?? 0)}; write to her afterwards.`,
        noShow: 'You were supposed to meet her today but did not show up; write to her.',
        creep: `You met her today but got too pushy, so she left early and you only paid ${paid}; write to her afterwards.`,
        wife: 'Your wife found out about your meeting with her today; it blew up and you paid nothing. Write to her.',
      }[m?.outcome ?? 'smooth']
    }
    if (m?.askedBy === 'you' && m.hate) {
      const offer = m.terms === 'free' || m.terms === 'worship' ? 'you will not pay her anything' : `you offer her ${money(m.offerCents)}`
      return `She offered to meet you in person. You still hate her, but you say yes: you want to use her and show her what she is; ${offer}.`
    }
    if (m?.askedBy === 'you') {
      if (m.terms === 'worship') return 'She offered to meet you in person. You are overjoyed and say yes, grovelling with thanks, but you do not offer her any money.'
      if (m.terms === 'free') return 'She offered to meet you in person. You take her up on it, but you will not pay her anything: she offered herself, so she should be grateful.'
      if (m.terms === 'lowball') return `She offered to meet you in person. You take her up on it, but offer only ${money(m.offerCents)} in cash, to show her that is all she is worth.`
      return `She asked to meet you in person for a night; you say yes and offer ${money(m.offerCents)} in cash.`
    }
    if (m?.terms) return 'You ask her to meet you in person for a night, and expect it for free, as usual.'
    return `You ask her to meet you in person for a night; you offer ${money(m?.offerCents ?? 0)} in cash.`
  }
  const q = view.requests.find((x) => x.id === d.id)
  if (d.step === 'no') return 'She brought up a custom piece; you turn it down.'
  if (!q) return ''
  const wanted = `${q.tags.map(tagLabel).join(' + ')}, explicitness ${q.intensity} of 5`
  if (d.step === 'ask') return `You ask her for a custom piece made just for you: ${wanted}; you offer ${money(q.offerCents)}, paid when you get it, within ${q.dueDay - q.day} days.`
  if (d.step === 'late') return `She agreed to make your custom (${wanted}) but did not deliver it in time; you are disappointed and not paying.`
  const got = describe(view, q.delivery?.vaultIds ?? [])
  return q.delivery?.paid
    ? `She delivered your custom [${got}]; it is what you wanted and you paid ${money(q.offerCents)}. React to it.`
    : `She delivered [${got}] for your custom, but ${notPaid(view, q)}; you are not paying.`
}

/** How a stalker incident you two had turned out (engine/incidents.ts); turning on her is a plain "harass" message. */
const INCIDENT_LINE: Partial<Record<NonNullable<ThreadView['incidents'][number]['result']>, string>> = {
  gift: 'You asked her to be yours and she played along; you are over the moon.',
  ok: 'You asked her to be yours and she gently turned you down; you take it, for now.',
  calmed: 'You would not leave her alone; she talked you down, and you apologize.',
}

/** A special event he is part of (engine/specials.ts): one line for what is happening to him. */
function eventLine(view: ThreadView, ev: NonNullable<Intent['event']>): string {
  const e = view.dayEvents.find((x) => x.id === ev.id)
  const men = e?.count ? `${e.count.toLocaleString('en-US')} men` : 'hundreds of men'
  const charity = `She has opened her door to any man who wants her, for free, from noon till midnight: ${men} have had her so far, and today you were one of them.`
  switch (ev.step) {
    case 'left':
      return `${charity} Afterwards you decided this is beneath a man of your standing. Write her a cold, final goodbye: you are done with her and will not be back.`
    case 'arrived':
      return 'You meant to subscribe to her, but the site put you on another creator\'s page by mistake. It has just been fixed and you are finally on her page; this is your first message to her.'
    case 'tribute':
      return 'You are sending your mistress a huge tribute, today and every day: serving her is all you want, and the money means nothing to you. Never say where it comes from.'
    case 'proposal':
      return "You have just sent her a photo of a diamond ring next to your keyboard, with a screenshot of one of her streams on your monitor. You saved for the ring for a long time, picked a wedding date, made a wedding website with photos of the two of you (edited: you have never met) and invited your family. Propose to her, and tell her: \"My mom thinks you're really pretty. She can't wait to meet you.\""
    case 'yes':
      return 'She said yes to your proposal! You are over the moon, you send her a big gift, and you start talking about the wedding.'
    case 'deflated':
      return 'You proposed to her and she called you delusional. It hurt; you back off, embarrassed, and apologize.'
    case 'fund':
      return 'You send her money for your honeymoon fund (the note on the transfer says "honeymoon fund"); talk about where the two of you will go.'
    case 'invite':
      return 'You send her your wedding invitation, with her name printed on it, and ask her to confirm she will be there. Your mom would love to meet her before the big day.'
    case 'mom':
      return 'She came to meet your mom, and your mom loved her. You are overjoyed and send her a gift to say thank you.'
    case 'therapist':
      return 'She told you she will not come to the wedding. You are sure it is just pre-wedding jitters, so you have booked her an appointment with a therapist and paid for it; tell her, lovingly.'
    default:
      return `${charity} Now you see her as free for anyone and not worth paying; write to her about it.`
  }
}

/** What happens now: one line each, only for what is happening. */
function happening(view: ThreadView, i: Intent): string[] {
  const lines: string[] = []
  if (i.kind === 'reply') lines.push('Answer her latest message(s).')
  else if (!i.deal && !i.incident && !i.event) lines.push(`You message her on your own: you ${TOPICS[i.topic ?? 'chat']}.`)
  for (const d of i.ppv ?? []) {
    const m = view.messages.find((x) => x.id === d.messageId)
    const desc = m ? describeItems(view, m) : ''
    lines.push(d.bought ? `You bought her paid message${desc}; react to what you got.` : `You did not buy her paid message${desc}: ${NOT_BOUGHT[d.reason]}.`)
  }
  if (i.deal) lines.push(dealLine(view, i.deal))
  if (i.incident) lines.push(INCIDENT_LINE[view.incidents.find((x) => x.id === i.incident)?.result ?? 'ok'] ?? '')
  if (i.event) lines.push(eventLine(view, i.event))
  if (i.tip) lines.push(`You send her a ${money(i.tip)} tip with this message.`)
  return lines.filter(Boolean)
}

export function buildFanPrompt(view: ThreadView, messageId: string): ChatMessage[] {
  const { regular: r, creator: c } = view
  const target = view.messages.find((m) => m.id === messageId)
  if (!target?.intent) throw new Error('No pending message to write')
  const seg = preset.segments[r.segment]
  const before = view.messages.slice(0, view.messages.indexOf(target)).filter((m) => m.state === 'sent').slice(-HISTORY)

  const system = [
    'You play one male fan of a female creator on an adult subscription platform (like OnlyFans), writing to her in private messages. This is fiction for an adult game; everyone is an adult.',
    'Men on these sites are horny, sleazy and pushy; stay in character as described under "How you write".',
    `Write only his next message: 1-3 short sentences in ${LANGUAGES[r.language]}, the way people type online. No narration, no asterisks, no quotes, no name prefix.`,
    'Mention money or a deal only when "What happens now" does. Never send, offer or promise a tip, gift or tribute unless it says you send one: the app shows real tips itself.',
    'The notes in square brackets in the conversation are for you only; never write them.',
    'Put the message between <message> and </message>.',
  ].join('\n')

  const user = [
    `You are ${r.name} (@${r.handle}), ${r.bio}.`,
    `Fan type: ${seg.label.toLowerCase()}, ${seg.description}.`,
    `How you write: ${view.personality.prompt || 'like a typical fan'}.`,
    ...(view.behaviours.length ? [`What you are like: ${view.behaviours.map((b) => b.prompt).join('; ')}.`] : []),
    ...view.conditions.filter((c) => c.prompt).map((c) => `Right now: ${c.prompt}.`),
    `You like: ${r.likes.map(tagLabel).join(', ') || 'anything'}. You have spent ${money(r.spent)} on her and became a regular on day ${r.since}; your loyalty to her: ${view.loyalty.name} (${view.loyalty.level} of 5).`,
    `She is ${c.name} (@${c.handle}), ${c.direction}; ${c.accountType === 'free' ? 'free page' : `paid page at ${money(c.priceCents)}/month`}, ${c.subscribers} subscribers. Today is day ${target.day}.`,
    '',
    before.length ? 'Conversation so far (oldest first):' : 'This is the first message in the conversation.',
    ...before.map((m) => `${m.from === 'me' ? '[Her]' : '[You]'} ${m.text || '(no text)'}${describeItems(view, m)}${m.tipCents ? ` [you tipped ${money(m.tipCents)}]` : ''}`),
    '',
    'What happens now:',
    ...happening(view, target.intent).map((w) => `- ${w}`),
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
    // Our own history notes copied into the reply ("[you tipped $500.00]"): a tip in words is not a tip.
    .replace(/\s*\[(you tipped|paid message|your custom)[^\]]*\]/gi, '')
    // A speaker tag the model added: "[You]", "Fan:", "[Robert]". Not a sentence that starts with "You ...".
    .replace(/^\s*(\[(you|fan|me|her)\]|(you|fan|me|her)\s*[:：]|\[[^\]]+\])\s*[:：]?\s*/i, '')
    .trim()
  if (name) text = text.replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:：]\\s*`), '')
  text = text.replace(/^\*[^*]+\*\s*/g, '').replace(/\s*\*[^*]+\*$/g, '')
  text = text.replace(/^["“「](.*)["”」]$/s, '$1').trim()
  // Stray indentation and runs of spaces from the model.
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0\u3000]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
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
