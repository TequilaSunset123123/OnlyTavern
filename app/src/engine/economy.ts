// Money rules: platform fee, ledger lines, balances and payouts (plan.md §4.3).
import economy from '../presets/economy.json'
import type { Account, LedgerEntry, LedgerKind } from '../store/schema'

export const PLATFORM_FEE = economy.platformFee

/** One payment from one regular. Cash from meetups ('offline') pays no platform fee. */
export function paymentLine(day: number, kind: LedgerKind, id: string, gross: number): LedgerEntry {
  const fee = kind === 'offline' ? 0 : Math.round(gross * PLATFORM_FEE)
  return { id: `${day}-${kind}-${id}`, day, kind, count: 1, gross, fee, net: gross - fee }
}

export function ledgerLine(day: number, kind: LedgerKind, count: number, gross: number): LedgerEntry {
  const fee = Math.round(gross * PLATFORM_FEE)
  return { id: `${day}-${kind}`, day, kind, count, gross, fee, net: gross - fee }
}

export type Balances = {
  /** Can be withdrawn now. */
  available: number
  /** Earned in the last `pendingDays` days; not withdrawable yet. */
  pending: number
  /** All-time net earnings (before payouts). */
  earned: number
  paidOut: number
  minPayout: number
  /** Cash from meetups: earned off the platform, so never part of the balances above. */
  cash: number
}

export function balances(account: Account): Balances {
  const cutoff = account.clock.day - economy.pendingDays
  let available = 0
  let pending = 0
  let paidOut = 0
  let cash = 0
  for (const e of account.ledger) {
    if (e.kind === 'offline') cash += e.net
    else if (e.kind === 'payout') paidOut -= e.net
    else if (e.day > cutoff) pending += e.net
    else available += e.net
  }
  return { available: available - paidOut, pending, earned: available + pending, paidOut, minPayout: economy.minPayoutCents, cash }
}

export class PayoutError extends Error {}

/** Withdraw `amount` cents from the available balance (withdrawals are just numbers). */
export function requestPayout(account: Account, amount: number): Account {
  const { available } = balances(account)
  if (!Number.isInteger(amount) || amount < economy.minPayoutCents) {
    throw new PayoutError(`Minimum withdrawal is $${(economy.minPayoutCents / 100).toFixed(2)}`)
  }
  if (amount > available) throw new PayoutError('Not enough available balance')
  const day = account.clock.day
  const n = account.ledger.filter((e) => e.kind === 'payout' && e.day === day).length
  const line: LedgerEntry = { id: `${day}-payout-${n}`, day, kind: 'payout', count: 1, gross: 0, fee: 0, net: -amount }
  return {
    ...account,
    ledger: [...account.ledger, line],
    events: [...account.events, { day, type: 'payout', amount }],
  }
}
