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
  Member,
  Message,
  Mood,
  Post,
  Regular,
  Profile,
  Segment,
  Settings,
  VaultItem,
} from '../store/schema'
export type { Comment } from '../engine/comments'
export type { PostInput, VaultInput } from '../engine/content'
export type { DmInput } from '../engine/regulars'
export type { MassInput } from '../engine/massMessages'
import type { Comment } from '../engine/comments'
import type { PostInput, VaultInput } from '../engine/content'
import type { MassInput } from '../engine/massMessages'
import type { DmInput } from '../engine/regulars'
import type {
  Account,
  AccountIndex,
  DailyStat,
  EngineEvent,
  LedgerEntry,
  LedgerKind,
  MassMessage,
  Message,
  Post,
  Profile,
  Regular,
  Segment,
  Settings,
  VaultItem,
} from '../store/schema'

export type ProfilePatch = Partial<Pick<Profile, 'name' | 'handle' | 'bio' | 'accountType' | 'priceCents'>>

export type Action =
  | { type: 'account.create'; name: string; handle: string }
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
  | { type: 'dm.send'; id: string; regularId: string; message: DmInput }
  /** The model wrote a pending fan message. */
  | { type: 'dm.fill'; id: string; regularId: string; messageId: string; text: string }
  /** The model failed for a fan opener: use a corpus line instead (plan.md §5). */
  | { type: 'dm.fallback'; id: string; regularId: string; messageId: string }
  | { type: 'dm.read'; id: string; regularId: string }
  | { type: 'mass.send'; id: string; message: MassInput }

/** What changed, so the UI knows which queries to refetch. */
export type Topic = 'accounts' | 'settings' | `account:${string}`

export type DispatchResult = {
  delta: Topic[]
  /** Engine events the action produced. */
  events: EngineEvent[]
  /** Id of whatever the action created (account, vault item, post), if any. */
  id?: string
}

/** All amounts in cents. */
export type Statements = {
  day: number
  balances: { available: number; pending: number; earned: number; paidOut: number; minPayout: number }
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
  creator: { name: string; handle: string; accountType: Profile['accountType']; priceCents: number; subscribers: number }
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
  getSettings(): Promise<Settings>
  getInbox(id: string): Promise<Inbox>
  getThread(id: string, regularId: string): Promise<ThreadView>
  getMassMessages(id: string): Promise<MassMessage[]>
  dispatch(action: Action): Promise<DispatchResult>
}
