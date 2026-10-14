import { describe, expect, it } from 'vitest'
import { createAccount } from '../store/account'
import { migrate } from '../store/migrate'
import type { Account } from '../store/schema'
import { balances, PayoutError, requestPayout } from './economy'
import { binomial, rngFor } from './rng'
import { simulate } from './simulate'

function account(seed: string, accountType: 'free' | 'paid' = 'paid'): Account {
  const a = createAccount({ id: 'x', seed, now: 0, name: 'Mia', handle: 'mia' })
  return { ...a, profile: { ...a.profile, accountType } }
}

const SEEDS = ['a', 'b', 'c', 'd', 'e']

describe('determinism', () => {
  it('same seed, same result', () => {
    expect(simulate(account('a'), 90)).toEqual(simulate(account('a'), 90))
  })

  it('different seeds give different results', () => {
    expect(simulate(account('a'), 90).account.history).not.toEqual(simulate(account('b'), 90).account.history)
  })

  it('advancing day by day equals advancing in one go', () => {
    let stepwise = account('a')
    for (let i = 0; i < 90; i++) stepwise = simulate(stepwise, 1).account
    const split = simulate(simulate(account('a'), 30).account, 60).account
    const once = simulate(account('a'), 90).account
    expect(stepwise).toEqual(once)
    expect(split).toEqual(once)
  })
})

describe('90 days stay in a sensible range', () => {
  for (const seed of SEEDS) {
    it(`paid and free, seed ${seed}`, () => {
      const paid = simulate(account(seed, 'paid'), 90).account
      const free = simulate(account(seed, 'free'), 90).account
      const subs = (a: Account) => a.history.at(-1)!.subscribers

      expect(paid.clock.day).toBe(90)
      expect(paid.history).toHaveLength(90)
      expect(subs(paid)).toBeGreaterThan(10)
      expect(subs(paid)).toBeLessThan(500)
      expect(subs(free)).toBeGreaterThan(subs(paid)) // free pages grow faster
      expect(free.ledger.every((l) => l.kind === 'tip')).toBe(true) // and earn only from tips

      const b = balances(paid)
      expect(b.earned).toBeGreaterThan(50_000) // more than $500 in 3 months
      expect(b.earned).toBeLessThan(5_000_000) // less than $50k
      expect(b.available + b.pending).toBe(b.earned)
    })
  }

  it('takes exactly the 20% platform fee, in whole cents', () => {
    const { ledger } = simulate(account('a'), 90).account
    for (const l of ledger) {
      expect(Number.isInteger(l.gross) && Number.isInteger(l.fee)).toBe(true)
      expect(l.fee).toBe(Math.round(l.gross * 0.2))
      expect(l.net).toBe(l.gross - l.fee)
    }
  })

  it('keeps only the last 30 days of events', () => {
    const { events } = simulate(account('a'), 90).account
    expect(events.length).toBeGreaterThan(0)
    expect(Math.min(...events.map((e) => e.day))).toBeGreaterThan(60)
  })
})

describe('payouts', () => {
  it('moves money out of the available balance', () => {
    const a = simulate(account('a'), 60).account
    const before = balances(a)
    const after = balances(requestPayout(a, 2000))
    expect(after.available).toBe(before.available - 2000)
    expect(after.paidOut).toBe(2000)
    expect(after.pending).toBe(before.pending)
  })

  it('refuses too small or too large amounts', () => {
    const a = simulate(account('a'), 60).account
    expect(() => requestPayout(a, 1999)).toThrow(PayoutError)
    expect(() => requestPayout(a, balances(a).available + 1)).toThrow(/Not enough/)
  })
})

describe('rng helpers', () => {
  it('binomial stays within 0..n and near the mean', () => {
    const rng = rngFor('s', 1, 'test')
    const draws = Array.from({ length: 200 }, () => binomial(rng, 1000, 0.3))
    expect(Math.min(...draws)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...draws)).toBeLessThanOrEqual(1000)
    expect(Math.abs(draws.reduce((a, b) => a + b) / draws.length - 300)).toBeLessThan(10)
  })
})

describe('schema 1 -> 2 migration', () => {
  it('upgrades a step-1 save', () => {
    const v1 = {
      ...createAccount({ id: 'old', seed: 's', now: 5, name: 'Old', handle: 'old' }),
      meta: { schemaVersion: 1, id: 'old', seed: 's', createdAt: 5 },
      profile: { name: 'Old', handle: 'old', bio: '', accountType: 'paid', subscriptionPrice: 12.5 },
      audience: {},
    } as unknown
    const v2 = migrate(v1)
    expect(v2.meta.schemaVersion).toBe(2)
    expect(v2.profile.priceCents).toBe(1250)
    expect(v2.history).toEqual([])
    expect(simulate(v2, 30).account.history).toHaveLength(30)
  })
})
