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
  Member,
  Profile,
  Segment,
} from '../store/schema'
import type { Account, AccountIndex, DailyStat, EngineEvent, LedgerEntry, LedgerKind, Profile, Segment } from '../store/schema'

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

/** What changed, so the UI knows which queries to refetch. */
export type Topic = 'accounts' | `account:${string}`

export type DispatchResult = {
  delta: Topic[]
  /** Engine events the action produced. */
  events: EngineEvent[]
  /** Id of the account an action created, if any. */
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

export interface Api {
  listAccounts(): Promise<AccountIndex>
  getAccount(id: string): Promise<Account | null>
  exportAccount(id: string): Promise<{ fileName: string; json: string }>
  getStatements(id: string): Promise<Statements>
  getStatistics(id: string): Promise<Statistics>
  dispatch(action: Action): Promise<DispatchResult>
}
