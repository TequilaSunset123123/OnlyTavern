// Export / import of one account as a JSON file (plan.md §7.2). Importing
// "forks": the copy gets a new id, everything else stays the same.
import { migrate, SaveError } from './migrate'
import type { Account } from './schema'

export const EXPORT_FORMAT = 'onlytavern-account'

type ExportFile = { format: typeof EXPORT_FORMAT; account: Account }

export function exportAccount(account: Account): string {
  const file: ExportFile = { format: EXPORT_FORMAT, account }
  return JSON.stringify(file, null, 2)
}

export function importAccount(text: string, newId: string): Account {
  let file: unknown
  try {
    file = JSON.parse(text)
  } catch {
    throw new SaveError('The file is not valid JSON')
  }
  if ((file as Partial<ExportFile> | null)?.format !== EXPORT_FORMAT) {
    throw new SaveError('The file is not an OnlyTavern account export')
  }
  const account = migrate((file as ExportFile).account)
  return { ...account, meta: { ...account.meta, id: newId } }
}

export function exportFileName(account: Account): string {
  const slug = account.profile.handle.replace(/[^a-zA-Z0-9_-]/g, '') || 'account'
  return `onlytavern-${slug}.json`
}
