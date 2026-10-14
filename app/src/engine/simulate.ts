// The engine entry point (plan.md §4.1): state in, events and the new state out.
// Pure: same account + same seed + same days -> same result.
import economy from '../presets/economy.json'
import { type Account, type DailyStat, type EngineEvent, type LedgerEntry, SEGMENTS } from '../store/schema'
import { simulateAudienceDay, subscriberCount } from './audience'
import { ledgerLine } from './economy'

export type SimulateResult = { account: Account; events: EngineEvent[] }

/** Advances the account by `days` days (default seed: the account's own). */
export function simulate(account: Account, days: number, seed: string = account.meta.seed): SimulateResult {
  let audience = account.audience
  const ledger: LedgerEntry[] = [...account.ledger]
  const history: DailyStat[] = [...account.history]
  const events: EngineEvent[] = []
  const price = account.profile.accountType === 'free' ? 0 : account.profile.priceCents

  for (let day = account.clock.day + 1; day <= account.clock.day + days; day++) {
    const before = subscriberCount(audience)
    const r = simulateAudienceDay(audience, account.profile, seed, day)
    audience = r.audience
    const after = subscriberCount(audience)

    const lines = [
      ledgerLine(day, 'subscription', r.newSubscribers, r.newSubscribers * price),
      ledgerLine(day, 'renewal', r.renewals, r.renewals * price),
      ledgerLine(day, 'tip', r.tips.count, r.tips.gross),
    ].filter((l) => l.gross > 0)
    ledger.push(...lines)

    const net = { subscription: 0, renewal: 0, tip: 0, payout: 0 }
    for (const l of lines) net[l.kind] += l.net
    history.push({
      day,
      subscribers: after,
      bySegment: Object.fromEntries(SEGMENTS.map((s) => [s, subscriberCount(audience, s)])) as DailyStat['bySegment'],
      newSubscribers: r.newSubscribers,
      churned: r.churned,
      visitors: r.visitors,
      net,
    })

    if (r.newSubscribers) events.push({ day, type: 'subscribers', count: r.newSubscribers })
    if (r.churned) events.push({ day, type: 'churn', count: r.churned })
    if (r.tips.count) events.push({ day, type: 'tips', count: r.tips.count, gross: r.tips.gross })
    for (const m of economy.milestones) {
      if (before < m && after >= m) events.push({ day, type: 'milestone', subscribers: m })
    }
  }

  const today = account.clock.day + days
  const keepFrom = today - economy.eventDays
  return {
    account: {
      ...account,
      clock: { day: today },
      audience,
      ledger,
      history,
      events: [...account.events, ...events].filter((e) => e.day > keepFrom),
    },
    events,
  }
}
