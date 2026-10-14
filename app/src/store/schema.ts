// Account structure (plan.md §7.1). Sections that later steps fill in are kept
// as loose arrays/records for now; each step tightens its own section and adds
// a migration if old saves need converting.
import { z } from 'zod'

export const SCHEMA_VERSION = 1

export const MemberSchema = z.object({
  id: z.string(),
  source: z.enum(['persona', 'character']),
  /** Character card avatar file name when source is 'character'. */
  ref: z.string().optional(),
  role: z.enum(['owner', 'co-creator', 'subscriber']),
})

export const ProfileSchema = z.object({
  name: z.string(),
  handle: z.string(),
  bio: z.string(),
  accountType: z.enum(['free', 'paid']),
  subscriptionPrice: z.number().nonnegative(),
})

export const AccountSchema = z.object({
  meta: z.object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: z.string(),
    seed: z.string(),
    createdAt: z.number(),
  }),
  profile: ProfileSchema,
  members: z.array(MemberSchema),
  clock: z.object({ day: z.number().int().nonnegative() }),
  vault: z.array(z.unknown()),
  posts: z.array(z.unknown()),
  queue: z.array(z.unknown()),
  audience: z.record(z.string(), z.unknown()),
  regulars: z.array(z.unknown()),
  threads: z.array(z.unknown()),
  requests: z.array(z.unknown()),
  ledger: z.array(z.unknown()),
  events: z.array(z.unknown()),
  settings: z.record(z.string(), z.unknown()),
})

export type Member = z.infer<typeof MemberSchema>
export type Profile = z.infer<typeof ProfileSchema>
export type Account = z.infer<typeof AccountSchema>

/** One row of the account list (kept in the index, not in the account file). */
export type AccountSummary = {
  id: string
  name: string
  handle: string
  updatedAt: number
}

export type AccountIndex = {
  accounts: AccountSummary[]
  activeId: string | null
}
