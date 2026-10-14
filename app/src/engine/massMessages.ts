// Mass messages (plan.md §8.1 Messages, "按群群发"): the crowd's opens and PPV
// purchases are counted by the engine over the next days; regulars get the
// message in their DMs and up to a few of them reply (decided here, written by
// the model later).
import preset from '../presets/audience.json'
import type { Account, Audience, EngineEvent, MassMessage, Segment } from '../store/schema'
import { SEGMENTS } from '../store/schema'
import { subscriberCount } from './audience'
import { ContentError } from './content'
import { PLATFORM_FEE } from './economy'
import { intensityMatch } from './posts'
import { type DmInput, sendDm } from './regulars'
import { binomial, rngFor } from './rng'

const R = preset.regulars

export type MassInput = DmInput & { audience: MassMessage['audience'] }

export function sendMass(account: Account, id: string, input: MassInput, seed: string): { account: Account; events: EngineEvent[] } {
  if (!input.text.trim() && !input.ppv) throw new ContentError('Write something or attach paid content')
  const regulars = account.regulars.filter((r) => r.status === 'active')
  const crowd = input.audience === 'all' ? subscriberCount(account.audience) : 0
  if (crowd + regulars.length === 0) throw new ContentError('Nobody to send to yet')

  let a: Account = {
    ...account,
    massMessages: [
      {
        id,
        day: account.clock.day,
        text: input.text.trim(),
        ...(input.ppv ? { ppv: input.ppv } : {}),
        audience: input.audience,
        stats: { sent: Math.max(crowd, regulars.length), views: 0, purchases: 0, earned: 0 },
      },
      ...account.massMessages,
    ],
  }
  // Regulars get it as a DM; only a few answer, the rest just see it.
  const events: EngineEvent[] = []
  const rng = rngFor(seed, account.clock.day, `mass:${id}:who`)
  const shuffled = [...regulars]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const repliers = shuffled.slice(0, R.maxMassReplies)
  for (const r of regulars) {
    if (repliers.includes(r)) {
      const res = sendDm(a, r.id, input, seed, id)
      a = res.account
      events.push(...res.events)
    } else {
      a = {
        ...a,
        threads: a.threads.map((t) =>
          t.regularId === r.id
            ? {
                ...t,
                read: t.messages.length + 1,
                messages: [
                  ...t.messages,
                  { id: `${r.id}-m${t.messages.length}`, day: a.clock.day, from: 'me' as const, text: input.text.trim(), state: 'sent' as const, massId: id, ...(input.ppv ? { ppv: { ...input.ppv, paid: false } } : {}) },
                ],
              }
            : t,
        ),
      }
    }
  }
  return { account: a, events }
}

export type MassDay = { massMessages: MassMessage[]; purchases: number; gross: number; events: EngineEvent[] }

/** The crowd opens and buys mass messages over the days after sending. */
export function simulateMassDay(account: Account, audience: Audience, seed: string, day: number): MassDay {
  let purchases = 0
  let gross = 0
  const events: EngineEvent[] = []
  const massMessages = account.massMessages.map((m) => {
    const heat = R.massHeat[day - m.day - 1]
    if (!heat || m.audience !== 'all') return m
    const price = m.ppv?.priceCents ?? 0
    const items = (m.ppv?.vaultIds ?? []).map((id) => account.vault.find((v) => v.id === id)).filter((v) => !!v)
    const intensity = Math.max(1, ...items.map((i) => i.intensity))
    const today = { views: 0, purchases: 0 }
    for (const s of SEGMENTS as readonly Segment[]) {
      const p = preset.segments[s]
      const rng = rngFor(seed, day, `mass:${m.id}:${s}`)
      const views = binomial(rng, subscriberCount(audience, s), Math.min(1, p.reach * heat))
      today.views += views
      if (price > 0) {
        const chance = p.ppvRate * R.massPpvFactor * intensityMatch(intensity, p.preferredIntensity) * Math.exp((-p.priceSensitivity * price) / 1000)
        today.purchases += binomial(rng, views, Math.min(1, chance))
      }
    }
    purchases += today.purchases
    gross += today.purchases * price
    const net = today.purchases * price - Math.round(today.purchases * price * PLATFORM_FEE)
    if (today.views) events.push({ day, type: 'mass', massId: m.id, views: today.views, purchases: today.purchases, gross: today.purchases * price })
    return {
      ...m,
      stats: { ...m.stats, views: m.stats.views + today.views, purchases: m.stats.purchases + today.purchases, earned: m.stats.earned + net },
    }
  })
  return { massMessages, purchases, gross, events }
}

