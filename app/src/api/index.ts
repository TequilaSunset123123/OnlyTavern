// Picks the backend once at startup. Only the local one exists for now; a
// server-plugin backend would be chosen here (plan.md §9.1 rule 8).
import { getStContext } from '../bridge/st'
import { createLocalStorageStorage, createStStorage } from '../bridge/storage'
import { createLocalApi } from './local'
import type { Api } from './types'

function createApi(): Api {
  const ctx = getStContext()
  const storage = ctx ? createStStorage(ctx) : createLocalStorageStorage()
  return createLocalApi(storage, {
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
    newSeed: () => crypto.randomUUID(),
  })
}

export const api: Api = createApi()
export * from './types'
