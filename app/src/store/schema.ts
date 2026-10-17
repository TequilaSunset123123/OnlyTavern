// Account structure (plan.md §7.1). Sections that later steps fill in are kept
// as loose arrays/records for now; each step tightens its own section and adds
// a migration if old saves need converting.
import { z } from 'zod'

export const SCHEMA_VERSION = 15

export const SEGMENTS = ['regular', 'lurker', 'simp', 'whale', 'hater', 'freeloader'] as const
export const SegmentSchema = z.enum(SEGMENTS)

/** What kind of creator you are building (presets/directions.json; 2026-10-15). */
export const DIRECTIONS = ['girl_next_door', 'porn_star', 'egirl', 'escort', 'couple', 'sub', 'domme'] as const
export const DirectionIdSchema = z.enum(DIRECTIONS)

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
  /** Posted for you when you change direction (engine/directions.ts): fans comment on the change. */
  transition: z.object({ from: z.string(), to: z.string() }).optional(),
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

/**
 * A state an event put him in (presets/personas.json `conditions`), since `since`:
 *   - hostile: he turned on you (you ignored him, or turned him down); he acts as a hater
 *     until you win him back. `level`: his loyalty level then (Devoted or more hate longer);
 *   - unhinged: a stalker you won back comes back worse;
 *   - blocked: you blocked him, or he blocked you (after his wife caught you two, or after
 *     The Charity), or the site moved him to the creator he meant (Routing Error), or he
 *     was arrested (Human ATM); for good;
 *   - lyingLow: his wife caught you two and he is keeping away until `until`;
 *   - entitled: he had you for free (or a few dollars) too often (askedMeetups.freeloaderAfter)
 *     and turned freeloader: unlike a born freeloader he thinks he is owed it. Always free,
 *     no more loyalty, one no turns him hostile, and so does ignoring him for a few days;
 *   - fiancee: you said yes to his proposal (Marry Me?); he believes you two are engaged.
 * You cannot write to him while he is blocked or lying low.
 */
export const ConditionSchema = z.discriminatedUnion('id', [
  z.object({ id: z.literal('hostile'), since: z.number().int(), level: z.number().int() }),
  z.object({ id: z.literal('unhinged'), since: z.number().int() }),
  z.object({ id: z.literal('blocked'), since: z.number().int(), by: z.enum(['you', 'him', 'moved', 'arrested']) }),
  z.object({ id: z.literal('lyingLow'), since: z.number().int(), until: z.number().int() }),
  z.object({ id: z.literal('entitled'), since: z.number().int() }),
  z.object({ id: z.literal('fiancee'), since: z.number().int() }),
])
export type Condition = z.infer<typeof ConditionSchema>
export type ConditionId = Condition['id']

/** A crowd fan who talks to you: has a profile, memory and a DM thread (plan.md §4.4). */
export const RegularSchema = z.object({
  id: z.string(),
  segment: SegmentSchema,
  name: z.string(),
  handle: z.string(),
  language: z.enum(['en', 'zh']),
  country: z.string(),
  age: z.number().int(),
  /** One-line background: age, job, where he lives, relationship (presets/personas.json, no model). */
  bio: z.string(),
  // Who he is, in three layers (presets/personas.json; engine/personas.ts). His type
  // (segment) and loyalty sit beside them; name, bio and the rest are only description.
  /** Personality: how he talks (one id from `personalities`). Words only, never a number. */
  personality: z.string(),
  /** Behaviours: lasting tendencies that change the odds (ids from `behaviours`), e.g. obsessed, stalker, cheapskate. */
  behaviours: z.array(z.string()),
  /** Conditions: states that events give him and that can change or go away (engine/conditions.ts). */
  conditions: z.array(ConditionSchema),
  /** Relationship key in presets/personas.json (married men can get caught at a meetup). */
  relationship: z.string(),
  /** Loyalty points, built by everything you two do together (engine/fans.ts). */
  loyalty: z.number().nonnegative(),
  /** Tag ids this fan likes. */
  likes: z.array(z.string()),
  since: z.number().int(),
  /** Total cents spent on you: paid messages, tips, custom requests and meetups. */
  spent: Cents.nonnegative(),
  status: z.enum(['active', 'dormant']),
})

/** Engine decisions the model has to act out in a fan message (plan.md §2.3). */
export const IntentSchema = z.object({
  /** opener: fan starts a chat on their own; reply: answering you. */
  kind: z.enum(['opener', 'reply']),
  topic: z.enum(['chat', 'compliment', 'wants_content', 'tip', 'harass', 'obsess']).optional(),
  /** Outcome for each PPV you sent since the fan's last message. */
  ppv: z.array(z.object({ messageId: z.string(), bought: z.boolean(), reason: z.enum(['liked', 'price', 'taste', 'mood']) })).optional(),
  tip: Cents.optional(),
  /**
   * A deal the engine decided (plan.md §2 rule 3; 2026-10-15): a custom piece or a meetup.
   * ask: he asks for one (on his own, or saying yes to yours); no: he turns yours down;
   * delivered: he reacts to your custom; late: you missed its deadline; met: after meeting;
   * back: he is back after lying low since his wife caught you two.
   * `id` is the Request or Meetup it is about (none for "no").
   */
  deal: z.object({ kind: z.enum(['custom', 'meetup']), step: z.enum(['ask', 'no', 'delivered', 'late', 'met', 'back']), id: z.string().optional() }).optional(),
  /** He reacts to how a stalker incident turned out (Incident id; engine/incidents.ts). */
  incident: z.string().optional(),
  /**
   * He reacts to a special event he is part of (DayEvent id; engine/specials.ts, 2026-10-16/17):
   * The Charity (he had her for free: after; old money walking out: left), Routing Error (the
   * new fan's first message: arrived), Human ATM (his daily $5,000: tribute), Marry Me? and
   * what follows (proposal, yes, deflated, fund, invite, mom, therapist).
   */
  event: z
    .object({
      kind: z.enum(['charity', 'routingError', 'humanAtm', 'marryMe', 'honeymoonFund', 'saveTheDate']),
      step: z.enum(['after', 'left', 'arrived', 'tribute', 'proposal', 'yes', 'deflated', 'fund', 'invite', 'mom', 'therapist']),
      id: z.string(),
    })
    .optional(),
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
  /** What you delivered for a custom request. */
  delivery: z.object({ requestId: z.string(), vaultIds: z.array(z.string()) }).optional(),
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

/** Why a delivered custom was (not) paid for: liked, or what was wrong with it. */
export const DeliveryReasonSchema = z.enum(['liked', 'tags', 'tame', 'explicit', 'reused'])

/** A custom request from a regular (plan.md §4.3; step 5). The engine decides what they want and pay. */
export const RequestSchema = z.object({
  id: z.string(),
  regularId: z.string(),
  day: z.number().int(),
  /** Tag ids the fan wants (from their likes). */
  tags: z.array(z.string()),
  intensity: z.number().int().min(1).max(5),
  /** Paid on delivery, if it matches. */
  offerCents: Cents.nonnegative(),
  /** Last day to deliver; unanswered or undelivered requests expire after it. */
  dueDay: z.number().int(),
  status: z.enum(['open', 'accepted', 'declined', 'delivered', 'expired']),
  acceptedDay: z.number().int().optional(),
  closedDay: z.number().int().optional(),
  /** The fan's message asking for it. */
  messageId: z.string(),
  delivery: z
    .object({ day: z.number().int(), vaultIds: z.array(z.string()), paid: z.boolean(), reason: DeliveryReasonSchema, tipCents: Cents.nonnegative().optional() })
    .optional(),
})

/** An offline job: a regular pays you cash to meet in person (plan.md §4.3; step 5). Off the platform. */
/** You asked him to meet and he did not pay like a client (engine/deals.ts). */
export const MeetupTermsSchema = z.enum(['lowball', 'free', 'worship'])
export type MeetupTerms = z.infer<typeof MeetupTermsSchema>

export const MeetupSchema = z.object({
  id: z.string(),
  regularId: z.string(),
  day: z.number().int(),
  /** Cash, no platform fee. */
  offerCents: Cents.nonnegative(),
  /** Last day to answer the invitation. */
  replyBy: z.number().int(),
  status: z.enum(['open', 'accepted', 'declined', 'done', 'expired', 'cancelled']),
  meetDay: z.number().int().optional(),
  /** Kept from co-creators: their prompts and views leave it out (takes effect with step 6). */
  hidden: z.boolean(),
  /** What happened on the day (rolled then) and the cash you actually got. */
  outcome: z.enum(['smooth', 'bonus', 'noShow', 'creep', 'wife']).optional(),
  paidCents: Cents.nonnegative().optional(),
  closedDay: z.number().int().optional(),
  /** The fan's invitation message. */
  messageId: z.string(),
  /** You brought it up (engine/deals.ts), not him. */
  askedBy: z.literal('you').optional(),
  /**
   * You asked and he did not pay like a client: a few dollars to put you down (lowball),
   * nothing at all (free), or nothing but grovelling thanks (worship: a submissive man).
   */
  terms: MeetupTermsSchema.optional(),
  /** He hates you (a hater, or hostile) and said yes anyway: it is a hate-fuck. */
  hate: z.literal(true).optional(),
})

export const INCIDENT_CHOICES = ['playAlong', 'letDown', 'calm', 'block'] as const
export const INCIDENT_RESULTS = ['gift', 'ok', 'turned', 'calmed', 'escalated', 'blocked', 'backlash'] as const

/**
 * A daily event (engine/events.ts, presets/events.json, 2026-10-16). `kind` is a common,
 * rare or special event id. Common ones just change the odds from `day` to `until`. Rare ones
 * are about one of your fans (`regularId`) and wait for your choice (`open`) for a couple of
 * days; what you chose can leave effects behind (`after`, until its own day). Special ones
 * (engine/specials.ts) are turning points: some wait for your choice like rare ones, some run
 * for a few days (`active`), The Charity runs until you end it, and chained ones wait for
 * their day (`scheduled`).
 */
export const DayEventSchema = z.object({
  id: z.string(),
  kind: z.string(),
  category: z.enum(['common', 'rare', 'special']),
  day: z.number().int(),
  until: z.number().int(),
  /** Which rumor, which trending tag. */
  variant: z.string().optional(),
  regularId: z.string().optional(),
  /** Money the event is about: the brand's fee, the anonymous tip. */
  amountCents: Cents.optional(),
  status: z.enum(['active', 'open', 'done', 'scheduled']),
  choice: z.string().optional(),
  result: z.string().optional(),
  /** The day you chose (or the choice made itself because you did not). */
  closedDay: z.number().int().optional(),
  /** Money the result brought or cost: his gift, the brand's fee after haggling. */
  resultCents: Cents.optional(),
  /** How many men came (The Charity). */
  count: z.number().int().optional(),
  /** How many days it has run (The Charity). */
  days: z.number().int().optional(),
  /** The fans who walked out for good (The Charity: the old money men). */
  leftIds: z.array(z.string()).optional(),
  /** Odds left behind by what you chose, from the day after `closedDay` to `until`. */
  after: z.object({ until: z.number().int(), effects: z.record(z.string(), z.union([z.number(), z.record(z.string(), z.number())])) }).optional(),
})
export type DayEvent = z.infer<typeof DayEventSchema>

/**
 * A stalker incident (2026-10-15): he courts you (courtship) or will not leave you alone
 * (clingy), on an ordinary day or after you met him. You choose what to do in a popup;
 * the engine rolls how it turns out (engine/incidents.ts).
 */
export const IncidentSchema = z.object({
  id: z.string(),
  regularId: z.string(),
  day: z.number().int(),
  kind: z.enum(['courtship', 'clingy']),
  /** The meetup that set it off, if any. */
  meetupId: z.string().optional(),
  /** Which story it is (presets/incidents.json). */
  story: z.number().int().nonnegative(),
  status: z.enum(['open', 'done']),
  choice: z.enum(INCIDENT_CHOICES).optional(),
  result: z.enum(INCIDENT_RESULTS).optional(),
  /** His gift (playing along), or subscribers lost when it blew up. */
  gross: Cents.nonnegative().optional(),
  lost: Count.optional(),
  closedDay: z.number().int().optional(),
})

/** 'offline' is cash from meetups: no fee, never part of the platform balance. */
export const LedgerKindSchema = z.enum(['subscription', 'renewal', 'tip', 'post', 'message', 'custom', 'offline', 'payout'])

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
  z.object({ day: z.number().int(), type: z.literal('request'), regularId: z.string(), requestId: z.string() }),
  z.object({ day: z.number().int(), type: z.literal('request-paid'), regularId: z.string(), gross: Cents }),
  z.object({ day: z.number().int(), type: z.literal('request-unpaid'), regularId: z.string() }),
  z.object({ day: z.number().int(), type: z.literal('request-expired'), regularId: z.string(), accepted: z.boolean() }),
  z.object({
    day: z.number().int(),
    type: z.literal('meetup'),
    regularId: z.string(),
    meetupId: z.string(),
    /** You asked him; what he offered then. */
    askedBy: z.literal('you').optional(),
    terms: MeetupTermsSchema.optional(),
    offerCents: Cents.optional(),
  }),
  z.object({
    day: z.number().int(),
    type: z.literal('meetup-done'),
    regularId: z.string(),
    gross: Cents,
    outcome: z.enum(['smooth', 'bonus', 'noShow', 'creep', 'wife']).optional(),
    /** Subscribers lost when it turned into a scandal. */
    lost: Count.optional(),
    /** After a scandal: whether he will be back one day (loyal enough) or is gone for good. */
    returns: z.boolean().optional(),
    /** You asked him and he took you for a freebie (Meetup.terms). */
    terms: MeetupTermsSchema.optional(),
    /** A hate-fuck (Meetup.hate). */
    hate: z.literal(true).optional(),
  }),
  z.object({ day: z.number().int(), type: z.literal('loyalty-up'), regularId: z.string(), level: z.number().int() }),
  z.object({ day: z.number().int(), type: z.literal('meetup-expired'), regularId: z.string() }),
  z.object({ day: z.number().int(), type: z.literal('regular-turned'), regularId: z.string(), level: z.number().int().optional() }),
  /** A hater got bored and stopped (engine/haters.ts). */
  z.object({ day: z.number().int(), type: z.literal('hater-left'), regularId: z.string() }),
  z.object({ day: z.number().int(), type: z.literal('incident'), regularId: z.string(), incidentId: z.string(), kind: z.enum(['courtship', 'clingy']) }),
  z.object({
    day: z.number().int(),
    type: z.literal('incident-done'),
    regularId: z.string(),
    incidentId: z.string(),
    result: z.enum(INCIDENT_RESULTS),
    gross: Cents.nonnegative().optional(),
    lost: Count.optional(),
  }),
  /** A daily event started (engine/events.ts); `title` in words, for notifications. */
  z.object({ day: z.number().int(), type: z.literal('day-event'), eventId: z.string(), kind: z.string(), variant: z.string().optional(), title: z.string() }),
  /** You chose what to do about a rare event (or it settled itself); `text` says how it turned out. */
  z.object({
    day: z.number().int(),
    type: z.literal('day-event-done'),
    eventId: z.string(),
    kind: z.string(),
    result: z.string(),
    text: z.string(),
    /** It went badly for you. */
    bad: z.boolean().optional(),
    gross: Cents.optional(),
    lost: Count.optional(),
  }),
  /** He came round after turning on you, or (wife) is back after lying low. */
  /** He had you for free (or a few dollars) too often: an entitled freeloader now (engine/meetups.ts). `from`: what he was. */
  z.object({ day: z.number().int(), type: z.literal('regular-entitled'), regularId: z.string(), from: SegmentSchema }),
  z.object({ day: z.number().int(), type: z.literal('regular-back'), regularId: z.string(), reason: z.enum(['wife']).optional() }),
  z.object({ day: z.number().int(), type: z.literal('direction'), direction: DirectionIdSchema, lost: Count }),
  z.object({ day: z.number().int(), type: z.literal('level-up'), direction: DirectionIdSchema, level: z.number().int() }),
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
  /**
   * The direction you are building, whether you picked it yourself (the first pick is
   * free; switching later costs subscribers), and points earned toward every direction.
   */
  direction: z.object({ id: DirectionIdSchema, chosen: z.boolean(), points: z.record(DirectionIdSchema, z.number().nonnegative()) }),
  members: z.array(MemberSchema),
  clock: z.object({ day: z.number().int().nonnegative() }),
  vault: z.array(VaultItemSchema),
  posts: z.array(PostSchema),
  queue: z.array(z.unknown()),
  audience: AudienceSchema,
  regulars: z.array(RegularSchema),
  threads: z.array(ThreadSchema),
  massMessages: z.array(MassMessageSchema),
  requests: z.array(RequestSchema),
  meetups: z.array(MeetupSchema),
  incidents: z.array(IncidentSchema),
  dayEvents: z.array(DayEventSchema),
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
export type DirectionId = z.infer<typeof DirectionIdSchema>
export type Mood = (typeof MOODS)[number]
export type VaultItem = z.infer<typeof VaultItemSchema>
export type Post = z.infer<typeof PostSchema>
export type Regular = z.infer<typeof RegularSchema>
export type Message = z.infer<typeof MessageSchema>
export type Intent = z.infer<typeof IntentSchema>
export type Thread = z.infer<typeof ThreadSchema>
export type MassMessage = z.infer<typeof MassMessageSchema>
export type Request = z.infer<typeof RequestSchema>
export type Meetup = z.infer<typeof MeetupSchema>
export type Incident = z.infer<typeof IncidentSchema>
export type IncidentChoice = (typeof INCIDENT_CHOICES)[number]
export type IncidentResult = (typeof INCIDENT_RESULTS)[number]
export type DeliveryReason = z.infer<typeof DeliveryReasonSchema>
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
  /** Most regulars active at once (3–20); missing = the preset's (presets/audience.json regulars.cap). */
  maxActiveRegulars: z.number().int().min(3).max(20).optional(),
})
export type Settings = z.infer<typeof SettingsSchema>
export const DEFAULT_SETTINGS: Settings = { fanLanguage: 'en', connectionProfile: null }
