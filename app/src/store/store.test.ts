import { describe, expect, it } from 'vitest'
import { createAccount } from './account'
import { migrate, SaveError, upgrade } from './migrate'
import { SCHEMA_VERSION } from './schema'
import { exportAccount, importAccount } from './transfer'

const fresh = () => createAccount({ id: 'a1', seed: 's1', now: 1000, name: 'Mia', handle: 'mia' })

describe('createAccount', () => {
  it('produces a valid account with the owner as the only member', () => {
    const account = migrate(fresh())
    expect(account.meta).toEqual({ schemaVersion: SCHEMA_VERSION, id: 'a1', seed: 's1', createdAt: 1000 })
    expect(account.members).toEqual([{ id: 'owner', source: 'persona', role: 'owner' }])
  })
})

describe('migrate', () => {
  it('rejects things that are not saves', () => {
    expect(() => migrate(null)).toThrow(SaveError)
    expect(() => migrate({ hello: 1 })).toThrow(/schemaVersion/)
  })

  it('rejects saves from a newer version', () => {
    const doc = { ...fresh(), meta: { ...fresh().meta, schemaVersion: SCHEMA_VERSION + 1 } }
    expect(() => migrate(doc)).toThrow(/newer version/)
  })

  it('rejects damaged saves', () => {
    expect(() => migrate({ ...fresh(), clock: { day: -1 } })).toThrow(/damaged/)
  })

  it('runs each migration in order and stamps the version', () => {
    const v1 = { meta: { schemaVersion: 1 }, a: 1 }
    const migrations = {
      1: (d: Record<string, unknown>) => ({ ...d, b: 2 }),
      2: (d: Record<string, unknown>) => ({ ...d, c: (d.b as number) + 1 }),
    }
    expect(upgrade(v1, migrations, 3)).toEqual({ meta: { schemaVersion: 3 }, a: 1, b: 2, c: 3 })
    expect(v1).toEqual({ meta: { schemaVersion: 1 }, a: 1 }) // input untouched
  })

  it('fails loudly when a migration step is missing', () => {
    expect(() => upgrade({ meta: { schemaVersion: 1 } }, {}, 2)).toThrow(/No migration from schema 1/)
  })
})

describe('export / import', () => {
  it('round-trips everything except the id', () => {
    const original = fresh()
    const copy = importAccount(exportAccount(original), 'a2')
    expect(copy.meta.id).toBe('a2')
    expect({ ...copy, meta: { ...copy.meta, id: 'a1' } }).toEqual(original)
  })

  it('rejects files that are not account exports', () => {
    expect(() => importAccount('not json', 'x')).toThrow(/not valid JSON/)
    expect(() => importAccount('{"format":"something-else"}', 'x')).toThrow(/not an OnlyTavern account/)
  })
})
