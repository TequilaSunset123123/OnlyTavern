import { initialAudience } from './account'
import { type Account, AccountSchema, SCHEMA_VERSION } from './schema'

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
