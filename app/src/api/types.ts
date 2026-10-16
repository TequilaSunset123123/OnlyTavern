// The contract between the UI and everything behind it (plan.md §9.1).
// Every method is async and takes / returns plain JSON, so the same calls can
// later go over HTTP to a server plugin unchanged.
export type {
  Account,
  AccountIndex,
  AccountSummary,
  DailyStat,
  EngineEvent,
  LedgerEntry,
  LedgerKind,
  Intent,
  MassMessage,
  Meetup,
  Incident,
  IncidentChoice,
  IncidentResult,
  Member,
  Message,
  Mood,
  Post,
  Regular,
  Request,
  DeliveryReason,
  DirectionId,
  Profile,
  Segment,
  Settings,
  VaultItem,
} from '../store/schema'
export type { Comment } from '../engine/comments'
export type { PostInput, VaultInput } from '../engine/content'
export type { DmInput } from '../engine/regulars'
export type { DeliveryCheck } from '../engine/requests'
export type { MassInput } from '../engine/massMessages'
export type { DirectionInfo } from '../engine/directions'
export type { LoyaltyInfo, MeetupOutcome } from '../engine/fans'
export type { LayerInfo } from '../engine/personas'
export type { Lapse, MeetupReport, PeriodReport } from '../engine/report'
import type { Comment } from '../engine/comments'
import type { PostInput, VaultInput } from '../engine/content'
import type { DirectionInfo } from '../engine/directions'
import type { LoyaltyInfo } from '../engine/fans'
import type { LayerInfo } from '../engine/personas'
import type { Lapse, PeriodReport } from '../engine/report'
import type { MassInput } from '../engine/massMessages'
import type { DmInput } from '../engine/regulars'
import type { DeliveryCheck } from '../engine/requests'
import type {
  Account,
  AccountIndex,
  DailyStat,
  DirectionId,
  EngineEvent,
  LedgerEntry,
  LedgerKind,
  Incident,
  IncidentChoice,
  MassMessage,
  Meetup,
  Message,
  Post,
  Profile,
  Regular,
  Request,
  Segment,
  Settings,
  VaultItem,
} from '../store/schema'

export type ProfilePatch = Partial<Pick<Profile, 'name' | 'handle' | 'bio' | 'accountType' | 'priceCents'>>

export type Action =
  | { type: 'account.create'; name: string; handle: string; direction?: DirectionId }
  | { type: 'account.select'; id: string }
  | { type: 'account.delete'; id: string }
  | { type: 'account.import'; json: string }
  | { type: 'profile.update'; id: string; patch: ProfilePatch }
  /** "Next day": run the engine for 1–90 days. */
  | { type: 'clock.advance'; id: string; days: number }
  | { type: 'payout.request'; id: string; amount: number }
  | { type: 'vault.add'; id: string; item: VaultInput }
  | { type: 'vault.update'; id: string; itemId: string; patch: Partial<VaultInput> }
  | { type: 'vault.delete'; id: string; itemId: string }
  | { type: 'post.publish'; id: string; post: PostInput }
  | { type: 'post.delete'; id: string; postId: string }
  | { type: 'settings.update'; patch: Partial<Settings> }
  /** Pick your direction: the first pick is free, switching later loses subscribers. */
  | { type: 'direction.set'; id: string; direction: DirectionId }
  /** Developer: jump to the next level of the current direction. */
  | { type: 'dev.levelUp'; id: string }
  | { type: 'dm.send'; id: string; regularId: string; message: DmInput }
  /** The model wrote a pending fan message. */
  | { type: 'dm.fill'; id: string; regularId: string; messageId: string; text: string }
  /** The model failed for a fan opener: use a corpus line instead (plan.md §5). */
  | { type: 'dm.fallback'; id: string; regularId: string; messageId: string }
  | { type: 'dm.read'; id: string; regularId: string }
  | { type: 'mass.send'; id: string; message: MassInput }
  | { type: 'request.accept'; id: string; requestId: string }
  /** Say no, or back out of one you accepted. */
  | { type: 'request.decline'; id: string; requestId: string }
  | { type: 'request.deliver'; id: string; requestId: string; vaultIds: string[]; text: string }
  /** Say yes to a meetup and pick the game day. */
  | { type: 'meetup.accept'; id: string; meetupId: string; day: number; hidden: boolean }
  | { type: 'meetup.decline'; id: string; meetupId: string }
  | { type: 'meetup.cancel'; id: string; meetupId: string }
  /** Keep a meetup from co-creators (or not). */
  | { type: 'meetup.hide'; id: string; meetupId: string; hidden: boolean }
  /** What you do about a stalker incident; the engine rolls how it goes. */
  | { type: 'incident.resolve'; id: string; incidentId: string; choice: IncidentChoice }

/** What changed, so the UI knows which queries to refetch. */
export type Topic = 'accounts' | 'settings' | `account:${string}`

export type DispatchResult = {
  delta: Topic[]
  /** Engine events the action produced. */
  events: EngineEvent[]
  /** Id of whatever the action created (account, vault item, post), if any. */
  id?: string
  /** clock.advance: what happened over those days, for the report popup. */
  report?: PeriodReport
}

/** All amounts in cents. */
export type Statements = {
  day: number
  /** `cash` is meetup money: off the platform, not part of the other balances. */
  balances: { available: number; pending: number; earned: number; paidOut: number; minPayout: number; cash: number }
  /** Newest first. */
  entries: LedgerEntry[]
  totals: Record<LedgerKind, { count: number; gross: number; net: number }>
}

export type Statistics = {
  day: number
  history: DailyStat[]
  segments: { id: Segment; label: string; count: number }[]
}

export type Tag = { id: string; en: string; zh: string; intensity: number }

/** Ready-made post captions by kind, in English and Chinese (presets/captions.json). */
export type CaptionKind = 'tease' | 'newSet' | 'locked' | 'chat'
export type Captions = Record<'en' | 'zh', Record<CaptionKind, string[]>>

/** A post with what the UI needs to show it. */
export type FeedPost = Post & {
  /** Vault items in order; null where an item was deleted from the vault. */
  items: (VaultItem | null)[]
  intensity: number
  tags: string[]
}

export type Feed = { day: number; canLockPosts: boolean; posts: FeedPost[] }

export type InboxThread = {
  regular: Regular
  loyalty: LoyaltyInfo
  last: Message | null
  unread: number
  /** A fan message is waiting for the model to write it. */
  pending: boolean
  /** Cents this fan tipped you in DMs. */
  tipped: number
}

export type Inbox = { day: number; threads: InboxThread[] }

/** Everything needed to show a conversation and to prompt the model for the fan. */
export type ThreadView = {
  day: number
  regular: Regular
  messages: Message[]
  /** Messages you have seen. */
  read: number
  /** Vault items referenced by PPV messages (null = deleted). */
  items: Record<string, VaultItem | null>
  creator: { name: string; handle: string; accountType: Profile['accountType']; priceCents: number; subscribers: number; direction: string }
  /** How loyal he is (engine/fans.ts): level 1–5, his type's ceiling, and points toward the next level. */
  loyalty: LoyaltyInfo
  /** His Blocked or Lying low condition, if he has one now: he blocked you (gone), lies low for a while, or you blocked him. You cannot write to him meanwhile. */
  away: 'gone' | 'lyingLow' | 'blocked' | null
  /** Who he is in three layers (engine/personas.ts): how he talks, his lasting tendencies, the states he is in now. A label for the UI, a description for the model. */
  personality: LayerInfo
  behaviours: LayerInfo[]
  conditions: LayerInfo[]
  /** This fan's custom requests and meetup invitations. */
  requests: Request[]
  meetups: Meetup[]
  /** Stalker incidents with him (engine/incidents.ts). */
  incidents: Incident[]
}

export type RequestRow = {
  request: Request
  regular: Regular
  /** The fan's message asking for it (null while the model has not written it). */
  message: Message | null
  /** What you delivered (null = removed from the vault). */
  items: (VaultItem | null)[]
}

export type MeetupRow = { meetup: Meetup; regular: Regular; message: Message | null }

/** Newest first. */
export type Requests = { day: number; requests: RequestRow[]; meetups: MeetupRow[] }

export type Directions = {
  current: DirectionId
  /** False until you pick one yourself; the first pick is free. */
  chosen: boolean
  /** Share of subscribers that leave when you switch (0–1). */
  switchLoss: number
  all: DirectionInfo[]
}

/** A stalker incident waiting for you to decide (engine/incidents.ts). */
export type IncidentView = {
  incident: Incident
  regular: Regular
  /** The story, with his name in it. */
  story: string
  /** Your options in order, with the chance each goes well (0–1). */
  options: { choice: IncidentChoice; chance: number }[]
}

export interface Api {
  listAccounts(): Promise<AccountIndex>
  getAccount(id: string): Promise<Account | null>
  exportAccount(id: string): Promise<{ fileName: string; json: string }>
  getStatements(id: string): Promise<Statements>
  getStatistics(id: string): Promise<Statistics>
  getVault(id: string): Promise<VaultItem[]>
  getFeed(id: string): Promise<Feed>
  getComments(id: string, postId: string): Promise<Comment[]>
  /** Recent engine events, newest first. */
  getNotifications(id: string): Promise<EngineEvent[]>
  getTags(): Promise<Tag[]>
  getCaptions(): Promise<Captions>
  getSettings(): Promise<Settings>
  getInbox(id: string): Promise<Inbox>
  getThread(id: string, regularId: string): Promise<ThreadView>
  getMassMessages(id: string): Promise<MassMessage[]>
  getRequests(id: string): Promise<Requests>
  getDirections(id: string): Promise<Directions>
  /** Stalker incidents waiting for your decision, oldest first. */
  getIncidents(id: string): Promise<IncidentView[]>
  /** What would lapse if you skipped `days` days ahead now. */
  getLapsing(id: string, days: number): Promise<Lapse[]>
  /** Would he pay if you delivered these items for his custom? A fixed rule, so it can be shown before you send. */
  getDeliveryCheck(id: string, requestId: string, vaultIds: string[]): Promise<DeliveryCheck>
  /** The directions you can pick, for a new account. */
  getDirectionOptions(): Promise<{ id: DirectionId; label: string; blurb: string }[]>
  dispatch(action: Action): Promise<DispatchResult>
}
