// The contract between the UI and everything behind it (plan.md §9.1).
// Every method is async and takes / returns plain JSON, so the same calls can
// later go over HTTP to a server plugin unchanged.
export type { Account, AccountIndex, AccountSummary, Member, Profile } from '../store/schema'
import type { Account, AccountIndex } from '../store/schema'

export type Action =
  | { type: 'account.create'; name: string; handle: string }
  | { type: 'account.select'; id: string }
  | { type: 'account.delete'; id: string }
  | { type: 'account.import'; json: string }

/** What changed, so the UI knows which queries to refetch. */
export type Topic = 'accounts' | `account:${string}`

export type DispatchResult = {
  delta: Topic[]
  /** Engine events (filled from step 2 on). */
  events: unknown[]
  /** Id of the account an action created, if any. */
  id?: string
}

export interface Api {
  listAccounts(): Promise<AccountIndex>
  getAccount(id: string): Promise<Account | null>
  exportAccount(id: string): Promise<{ fileName: string; json: string }>
  dispatch(action: Action): Promise<DispatchResult>
}
