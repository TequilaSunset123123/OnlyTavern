import { LOYALTY_GAIN } from '../engine/fans'
import { makePersona } from '../engine/personas'
import personas from '../presets/personas.json'
import { rngFor } from '../engine/rng'
import { initialAudience, noPoints } from './account'
import { type Account, AccountSchema, SCHEMA_VERSION, type Segment } from './schema'

type Doc = Record<string, unknown>

/** Upgrades a save by exactly one version: MIGRATIONS[n] turns version n into n + 1. */
export type Migration = (doc: Doc) => Doc

// When the account structure changes: bump SCHEMA_VERSION in schema.ts and add
// the step from the previous version here.
export const MIGRATIONS: Record<number, Migration> = {
  // Step 2 (engine v0): price in cents, a real starting crowd, daily history.
  1: (doc) => {
    const { subscriptionPrice, ...profile } = doc.profile as { subscriptionPrice?: number }
    return {
      ...doc,
      profile: { ...profile, priceCents: Math.round((subscriptionPrice ?? 9.99) * 100) },
      audience: initialAudience(),
      ledger: [],
      events: [],
      history: [],
    }
  },
  // Step 3 (vault, posts): typed vault/posts, a 'post' earnings kind.
  2: (doc) => ({
    ...doc,
    vault: [],
    posts: [],
    history: (doc.history as { net: object }[]).map((d) => ({ ...d, net: { ...d.net, post: 0 } })),
  }),
  // Step 4 (DMs): regulars, threads, mass messages, a 'message' earnings kind.
  3: (doc) => ({
    ...doc,
    regulars: [],
    threads: [],
    massMessages: [],
    history: (doc.history as { net: object }[]).map((d) => ({ ...d, net: { ...d.net, message: 0 } })),
  }),
  // Step 5 (custom requests, meetups): typed requests, meetups, 'custom' and 'offline' (cash) earnings.
  4: (doc) => ({
    ...doc,
    requests: [],
    meetups: [],
    history: (doc.history as { net: object }[]).map((d) => ({ ...d, net: { ...d.net, custom: 0, offline: 0 } })),
  }),
  // Fan personas (2026-10-14): regulars get a new identity from our own parts (men only)
  // and traits for how they write. Everything else about them stays.
  5: (doc) => {
    const seed = (doc.meta as { seed: string }).seed
    type Old = { id: string; since: number; segment: Segment; language: 'en' | 'zh' }
    return {
      ...doc,
      regulars: (doc.regulars as Old[]).map((r) => ({ ...r, ...makePersona(rngFor(seed, r.since, `persona:${r.id}`), r.segment, r.language) })),
    }
  },
  // Directions (2026-10-15): older accounts start as girl next door, not yet chosen
  // (so the first pick is free), with no points.
  6: (doc) => ({ ...doc, direction: { id: 'girl_next_door', chosen: false, points: noPoints() } }),
  // One deal field on fan messages instead of separate request / meetup ones (2026-10-15).
  7: (doc) => {
    type OldIntent = { request?: { requestId: string; phase: string }; meetup?: { meetupId: string; phase: string } } & Record<string, unknown>
    const deal = ({ request, meetup, ...rest }: OldIntent) => ({
      ...rest,
      ...(request ? { deal: { kind: 'custom', step: request.phase, id: request.requestId } } : {}),
      ...(meetup ? { deal: { kind: 'meetup', step: meetup.phase === 'invite' ? 'ask' : 'met', id: meetup.meetupId } } : {}),
    })
    type OldThread = { messages: { intent?: OldIntent }[] }
    return {
      ...doc,
      threads: (doc.threads as OldThread[]).map((t) => ({ ...t, messages: t.messages.map((m) => (m.intent ? { ...m, intent: deal(m.intent) } : m)) })),
    }
  },
  // Loyalty and outcomes (2026-10-15): each regular's loyalty from what you two already
  // did; whether he is married, read from his bio; past meetups went smoothly.
  8: (doc) => {
    type Msg = { from: string; massId?: string; ppv?: { paid: boolean }; tipCents?: number }
    const threads = doc.threads as { regularId: string; messages: Msg[] }[]
    const requests = doc.requests as { regularId: string; delivery?: { paid: boolean } }[]
    const meetups = doc.meetups as { regularId: string; status: string; offerCents: number }[]
    const labels = Object.entries(personas.relationships)
    const G = LOYALTY_GAIN
    const loyaltyOf = (id: string) => {
      const msgs = threads.find((t) => t.regularId === id)?.messages ?? []
      return (
        msgs.filter((m) => m.from === 'me' && !m.massId).length * G.message +
        msgs.filter((m) => m.from === 'me' && m.ppv?.paid).length * G.purchase +
        msgs.filter((m) => m.from === 'fan' && m.tipCents).length * G.tip +
        requests.filter((q) => q.regularId === id && q.delivery?.paid).length * G.custom +
        meetups.filter((m) => m.regularId === id && m.status === 'done').length * G.meetup
      )
    }
    return {
      ...doc,
      regulars: (doc.regulars as { id: string; bio: string }[]).map((r) => ({
        ...r,
        loyalty: loyaltyOf(r.id),
        relationship: labels.find(([, l]) => r.bio.includes(l.en) || r.bio.includes(l.zh))?.[0] ?? 'single',
      })),
      meetups: meetups.map((m) => (m.status === 'done' ? { ...m, outcome: 'smooth', paidCents: m.offerCents } : m)),
    }
  },
  // v9 -> v10 (2026-10-15): stalker incidents; a hater remembers how loyal he was when he turned.
  9: (doc) => {
    const P = personas.loyalty.points
    type Turned = { from: keyof typeof personas.segments; day: number; trait?: string }
    return {
      ...doc,
      incidents: [],
      regulars: (doc.regulars as { loyalty: number; turned?: Turned }[]).map((r) =>
        r.turned
          ? { ...r, turned: { ...r.turned, level: Math.min(personas.segments[r.turned.from].fan.loyaltyCap, P.filter((x) => r.loyalty >= x).length) } }
          : r,
      ),
    }
  },
}

export class SaveError extends Error {}

export function versionOf(doc: unknown): number {
  const v = (doc as { meta?: { schemaVersion?: unknown } } | null)?.meta?.schemaVersion
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new SaveError('Not an OnlyTavern account (missing schemaVersion)')
  }
  return v
}

/** Runs the migrations from the save's version up to `target`. Does not validate. */
export function upgrade(raw: unknown, migrations: Record<number, Migration>, target: number): Doc {
  let version = versionOf(raw)
  if (version > target) {
    throw new SaveError(`This save is from a newer version of OnlyTavern (schema ${version})`)
  }
  let doc = structuredClone(raw) as Doc
  while (version < target) {
    const step = migrations[version]
    if (!step) throw new SaveError(`No migration from schema ${version}`)
    doc = step(doc)
    version += 1
    doc = { ...doc, meta: { ...(doc.meta as object), schemaVersion: version } }
  }
  return doc
}

/** Brings any older save up to the current structure and validates it. */
export function migrate(raw: unknown): Account {
  const parsed = AccountSchema.safeParse(upgrade(raw, MIGRATIONS, SCHEMA_VERSION))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new SaveError(`Account data is damaged: ${issue?.path.join('.')} ${issue?.message ?? 'invalid'}`)
  }
  return parsed.data
}
