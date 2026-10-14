// AccountStorage backends (the interface is in store/storage.ts).
//
// Inside SillyTavern: one file per account in the user's files folder via ST's
// /api/files endpoints (TauriTavern implements the same ones), and the account
// list in extension settings (plan.md §7.2). Outside SillyTavern (dev server):
// localStorage.
import { type Account, type AccountIndex, DEFAULT_SETTINGS, type Settings } from '../store/schema'
import { EMPTY_INDEX, type AccountStorage } from '../store/storage'
import type { StContext } from './st'

const SETTINGS_KEY = 'onlytavern'

// ST only accepts [a-zA-Z0-9_-.] in file names; account ids are UUIDs.
const fileName = (id: string) => `onlytavern-${id.replace(/[^a-zA-Z0-9_-]/g, '')}.json`

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function createStStorage(ctx: StContext): AccountStorage {
  const settings = () => {
    const s = (ctx.extensionSettings[SETTINGS_KEY] ??= {}) as { index?: AccountIndex; settings?: Partial<Settings> }
    return s
  }
  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify(body) })
    if (!res.ok) throw new Error(`${url} failed: ${res.status} ${await res.text()}`)
    return res
  }

  return {
    async loadIndex() {
      return structuredClone(settings().index ?? EMPTY_INDEX)
    },
    async saveIndex(index) {
      settings().index = structuredClone(index)
      ctx.saveSettingsDebounced()
    },
    async loadSettings() {
      return { ...DEFAULT_SETTINGS, ...settings().settings }
    },
    async saveSettings(next) {
      settings().settings = structuredClone(next)
      ctx.saveSettingsDebounced()
    },
    async loadAccount(id) {
      const res = await fetch(`/user/files/${fileName(id)}`, { cache: 'no-cache' })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`Loading account ${id} failed: ${res.status}`)
      return res.json()
    },
    async saveAccount(account: Account) {
      await post('/api/files/upload', { name: fileName(account.meta.id), data: toBase64(JSON.stringify(account)) })
    },
    async deleteAccount(id) {
      const res = await fetch('/api/files/delete', {
        method: 'POST',
        headers: ctx.getRequestHeaders(),
        body: JSON.stringify({ path: `user/files/${fileName(id)}` }),
      })
      if (!res.ok && res.status !== 404) throw new Error(`Deleting account ${id} failed: ${res.status}`)
    },
  }
}

export function createLocalStorageStorage(): AccountStorage {
  const key = (k: string) => `onlytavern:${k}`
  const read = (k: string) => {
    const v = localStorage.getItem(key(k))
    return v === null ? null : JSON.parse(v)
  }
  return {
    async loadIndex() {
      return read('index') ?? structuredClone(EMPTY_INDEX)
    },
    async saveIndex(index) {
      localStorage.setItem(key('index'), JSON.stringify(index))
    },
    async loadAccount(id) {
      return read(`account:${id}`)
    },
    async saveAccount(account) {
      localStorage.setItem(key(`account:${account.meta.id}`), JSON.stringify(account))
    },
    async deleteAccount(id) {
      localStorage.removeItem(key(`account:${id}`))
    },
    async loadSettings() {
      return { ...DEFAULT_SETTINGS, ...read('settings') }
    },
    async saveSettings(next) {
      localStorage.setItem(key('settings'), JSON.stringify(next))
    },
  }
}
