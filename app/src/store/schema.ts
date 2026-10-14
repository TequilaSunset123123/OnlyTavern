// Account structure (plan.md §7.1). Sections that later steps fill in are kept
// as loose arrays/records for now; each step tightens its own section and adds
// a migration if old saves need converting.
import { z } from 'zod'

export const SCHEMA_VERSION = 4

export const SEGMENTS = ['regular', 'lurker', 'simp', 'whale', 'hater', 'freeloader'] as const
export const SegmentSchema = z.enum(SEGMENTS)

/** All money is integer cents. */
const Cents = z.number().int()
const Count = z.number().int().nonnegative()

/** Moods of crowd comments (corpus keys). */
export const MOODS = ['praise', 'flirty', 'casual', 'request', 'negative'] as const

/** A content item in the vault. Everything is text: no images (plan.md §1). */
export const VaultItemSchema = z.object({
  id: z.string(),
  description: z.string(),
  /** Tag ids from presets/tags.json. */
  tags: z.array(z.string()),
  /** 1 = safe for work … 5 = most explicit. */
  intensity: z.number().int().min(1).max(5),
  /** Who is in it. */
  cast: z.enum(['me', 'partner', 'both']),
  source: z.enum(['manual', 'rp']),
  createdDay: z.number().int(),
})

export const PostSchema = z.object({
  id: z.string(),
  day: z.number().int(),
  text: z.string(),
  vaultIds: z.array(z.string()),
  /** Locked = pay-per-view post (free pages only, like real OF). */
  access: z.enum(['free', 'locked']),
  priceCents: Cents.nonnegative(),
  /** Member id of whoever posted it. */
  author: z.string(),
  stats: z.object({ views: Count, likes: Count, comments: Count, purchases: Count, earned: Cents }),
})

/** The crowd as counts only (plan.md §2.4): per segment, subscribers by renewal day (day % 30). */
export const AudienceSchema = z.object({
  cohorts: z.record(SegmentSchema, z.array(z.number().int().nonnegative()).length(30)),
})

/** A crowd fan who talks to you: has a profile, memory and a DM thread (plan.md §4.4). */
export const RegularSchema = z.object({
  id: z.string(),
  segment: SegmentSchema,
  name: z.string(),
  handle: z.string(),
  language: z.enum(['en', 'zh']),
  country: z.string(),
  age: z.number().int(),
  /** One-line background, built from templates (no model). */
  bio: z.string(),
  /** Tag ids this fan likes. */
  likes: z.array(z.string()),
  since: z.number().int(),
  /** Total cents spent on you in DMs (PPV + tips). */
  spent: Cents.nonnegative(),
  status: z.enum(['active', 'dormant']),
})

/** Engine decisions the model has to act out in a fan message (plan.md §2.3). */
export const IntentSchema = z.object({
  /** opener: fan starts a chat on their own; reply: answering you. */
  kind: z.enum(['opener', 'reply']),
  topic: z.enum(['chat', 'compliment', 'wants_content', 'tip']).optional(),
  /** Outcome for each PPV you sent since the fan's last message. */
  ppv: z.array(z.object({ messageId: z.string(), bought: z.boolean(), reason: z.enum(['liked', 'price', 'taste', 'mood']) })).optional(),
  tip: Cents.optional(),
})

export const MessageSchema = z.object({
  id: z.string(),
  day: z.number().int(),
  from: z.enum(['me', 'fan']),
  text: z.string(),
  /** Pay-per-view attachment. */
  ppv: z.object({ vaultIds: z.array(z.string()), priceCents: Cents.nonnegative(), paid: z.boolean() }).optional(),
  tipCents: Cents.nonnegative().optional(),
  /** Fan messages wait as 'pending' until the model has written them. */
  state: z.enum(['sent', 'pending']),
  intent: IntentSchema.optional(),
  /** Set by a mass message. */
  massId: z.string().optional(),
  /** Who put a fan message into words: the model, or a corpus line when it was unavailable. */
  writtenBy: z.enum(['model', 'corpus']).optional(),
})

export const ThreadSchema = z.object({
  regularId: z.string(),
  messages: z.array(MessageSchema),
  /** How many messages you have seen; fan messages after that are unread. */
  read: z.number().int().nonnegative(),
})

export const MassMessageSchema = z.object({
  id: z.string(),
  day: z.number().int(),
  text: z.string(),
  ppv: z.object({ vaultIds: z.array(z.string()), priceCents: Cents.nonnegative() }).optional(),
  audience: z.enum(['all', 'regulars']),
  stats: z.object({ sent: Count, views: Count, purchases: Count, earned: Cents }),
})

export const LedgerKindSchema = z.enum(['subscription', 'renewal', 'tip', 'post', 'message', 'payout'])

/** One line per day and kind (the crowd's payments are aggregated, not stored per fan). */
export const LedgerEntrySchema = z.object({
  id: z.string(),
  day: z.number().int(),
  kind: LedgerKindSchema,
  count: z.number().int().nonnegative(),
  gross: Cents,
  fee: Cents,
  net: Cents,
})

export const DailyStatSchema = z.object({
  day: z.number().int(),
  subscribers: z.number().int().nonnegative(),
  bySegment: z.record(SegmentSchema, z.number().int().nonnegative()),
  newSubscribers: z.number().int().nonnegative(),
  churned: z.number().int().nonnegative(),
  visitors: z.number().int().nonnegative(),
  net: z.record(LedgerKindSchema, Cents),
})

export const EngineEventSchema = z.discriminatedUnion('type', [
  z.object({ day: z.number().int(), type: z.literal('subscribers'), count: z.number().int() }),
  z.object({ day: z.number().int(), type: z.literal('churn'), count: z.number().int() }),
  z.object({ day: z.number().int(), type: z.literal('tips'), count: z.number().int(), gross: Cents }),
  z.object({ day: z.number().int(), type: z.literal('milestone'), subscribers: z.number().int() }),
  z.object({ day: z.number().int(), type: z.literal('payout'), amount: Cents }),
  z.object({ day: z.number().int(), type: z.literal('post'), postId: z.string(), views: Count, likes: Count, comments: Count }),
  z.object({ day: z.number().int(), type: z.literal('purchases'), postId: z.string(), count: Count, gross: Cents }),
  z.object({ day: z.number().int(), type: z.literal('regular'), regularId: z.string() }),
  z.object({ day: z.number().int(), type: z.literal('dm'), regularId: z.string() }),
  z.object({ day: z.number().int(), type: z.literal('dm-purchase'), regularId: z.string(), gross: Cents }),
  z.object({ day: z.number().int(), type: z.literal('dm-tip'), regularId: z.string(), gross: Cents }),
  z.object({ day: z.number().int(), type: z.literal('mass'), massId: z.string(), views: Count, purchases: Count, gross: Cents }),
])

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
  /** Monthly subscription price; ignored for free accounts. */
  priceCents: Cents.nonnegative(),
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
  vault: z.array(VaultItemSchema),
  posts: z.array(PostSchema),
  queue: z.array(z.unknown()),
  audience: AudienceSchema,
  regulars: z.array(RegularSchema),
  threads: z.array(ThreadSchema),
  massMessages: z.array(MassMessageSchema),
  requests: z.array(z.unknown()),
  ledger: z.array(LedgerEntrySchema),
  /** Recent engine events (the last `eventDays` days), for notifications. */
  events: z.array(EngineEventSchema),
  /** One snapshot per simulated day, for charts. */
  history: z.array(DailyStatSchema),
  settings: z.record(z.string(), z.unknown()),
})

export type Member = z.infer<typeof MemberSchema>
export type Profile = z.infer<typeof ProfileSchema>
export type Account = z.infer<typeof AccountSchema>
export type Segment = z.infer<typeof SegmentSchema>
export type Mood = (typeof MOODS)[number]
export type VaultItem = z.infer<typeof VaultItemSchema>
export type Post = z.infer<typeof PostSchema>
export type Regular = z.infer<typeof RegularSchema>
export type Message = z.infer<typeof MessageSchema>
export type Intent = z.infer<typeof IntentSchema>
export type Thread = z.infer<typeof ThreadSchema>
export type MassMessage = z.infer<typeof MassMessageSchema>
export type Audience = z.infer<typeof AudienceSchema>
export type LedgerKind = z.infer<typeof LedgerKindSchema>
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>
export type DailyStat = z.infer<typeof DailyStatSchema>
export type EngineEvent = z.infer<typeof EngineEventSchema>

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

/** Global settings (extension settings, not per account; plan.md §7.2). */
export const SettingsSchema = z.object({
  /** Language of fan comments and (from step 4) messages. */
  fanLanguage: z.enum(['en', 'zh', 'mix']),
  /** SillyTavern connection profile id for fan messages; null = ST's selected one. */
  connectionProfile: z.string().nullable(),
})
export type Settings = z.infer<typeof SettingsSchema>
export const DEFAULT_SETTINGS: Settings = { fanLanguage: 'en', connectionProfile: null }
