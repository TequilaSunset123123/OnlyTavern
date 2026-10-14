import { type Account, type AccountSummary, SCHEMA_VERSION } from './schema'

export type NewAccountInput = {
  id: string
  seed: string
  now: number
  name: string
  handle: string
}

export function createAccount({ id, seed, now, name, handle }: NewAccountInput): Account {
  return {
    meta: { schemaVersion: SCHEMA_VERSION, id, seed, createdAt: now },
    profile: { name, handle, bio: '', accountType: 'paid', subscriptionPrice: 9.99 },
    members: [{ id: 'owner', source: 'persona', role: 'owner' }],
    clock: { day: 0 },
    vault: [],
    posts: [],
    queue: [],
    audience: {},
    regulars: [],
    threads: [],
    requests: [],
    ledger: [],
    events: [],
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
