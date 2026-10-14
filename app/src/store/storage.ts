// Where accounts live. The interface is all the rest of the code sees, so the
// backing store can change (SillyTavern user files today, a server plugin later).
import { type Account, type AccountIndex, DEFAULT_SETTINGS, type Settings } from './schema'

export interface AccountStorage {
  loadIndex(): Promise<AccountIndex>
  saveIndex(index: AccountIndex): Promise<void>
  /** Raw JSON as stored (may be an older schema); null if missing. */
  loadAccount(id: string): Promise<unknown | null>
  saveAccount(account: Account): Promise<void>
  deleteAccount(id: string): Promise<void>
  /** Global settings; missing fields fall back to DEFAULT_SETTINGS. */
  loadSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<void>
}

export const EMPTY_INDEX: AccountIndex = { accounts: [], activeId: null }

/** In-memory storage for tests. Stores JSON strings so tests see real round-trips. */
export function createMemoryStorage(): AccountStorage {
  let index = JSON.stringify(EMPTY_INDEX)
  let settings = JSON.stringify(DEFAULT_SETTINGS)
  const files = new Map<string, string>()
  return {
    async loadIndex() {
      return JSON.parse(index)
    },
    async saveIndex(next) {
      index = JSON.stringify(next)
    },
    async loadAccount(id) {
      const text = files.get(id)
      return text === undefined ? null : JSON.parse(text)
    },
    async saveAccount(account) {
      files.set(account.meta.id, JSON.stringify(account))
    },
    async deleteAccount(id) {
      files.delete(id)
    },
    async loadSettings() {
      return JSON.parse(settings)
    },
    async saveSettings(next) {
      settings = JSON.stringify(next)
    },
  }
}
