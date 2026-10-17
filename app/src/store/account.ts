import audiencePreset from '../presets/audience.json'
import { type Account, type AccountSummary, type Audience, DIRECTIONS, type DirectionId, SCHEMA_VERSION, SEGMENTS, type Segment } from './schema'

export type NewAccountInput = {
  id: string
  seed: string
  now: number
  name: string
  handle: string
  /** Picked when creating the account; without one it starts as girl next door, not yet chosen. */
  direction?: DirectionId
}

export const noPoints = () => Object.fromEntries(DIRECTIONS.map((d) => [d, 0])) as Record<DirectionId, number>

/** The starting crowd from presets/audience.json, spread over renewal days without randomness. */
export function initialAudience(start: Partial<Record<Segment, number>> = audiencePreset.start): Audience {
  const cohorts = Object.fromEntries(SEGMENTS.map((s) => [s, Array<number>(30).fill(0)])) as Audience['cohorts']
  for (const s of SEGMENTS) {
    for (let i = 0; i < (start[s] ?? 0); i++) cohorts[s][(i * 7 + 1) % 30] += 1
  }
  return { cohorts }
}

export function createAccount({ id, seed, now, name, handle, direction }: NewAccountInput): Account {
  return {
    meta: { schemaVersion: SCHEMA_VERSION, id, seed, createdAt: now },
    profile: { name, handle, bio: '', accountType: 'paid', priceCents: 999 },
    direction: { id: direction ?? 'girl_next_door', chosen: !!direction, points: noPoints() },
    members: [{ id: 'owner', source: 'persona', role: 'owner' }],
    clock: { day: 0 },
    vault: [],
    posts: [],
    queue: [],
    audience: initialAudience(),
    regulars: [],
    threads: [],
    massMessages: [],
    requests: [],
    meetups: [],
    incidents: [],
    dayEvents: [],
    ledger: [],
    events: [],
    history: [],
    settings: {},
  }
}

export function summarize(account: Account, updatedAt: number): AccountSummary {
  return {
    id: account.meta.id,
    name: account.profile.name,
    handle: account.profile.handle,
    updatedAt,
  }
}
