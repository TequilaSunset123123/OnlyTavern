// The engine entry point (plan.md §4.1): state in, events and the new state out.
// Pure: same account + same seed + same days (+ same settings) -> same result.
import economy from '../presets/economy.json'
import { type Account, type DailyStat, DEFAULT_SETTINGS, type EngineEvent, LedgerKindSchema, SEGMENTS, type Settings } from '../store/schema'
import { simulateAudienceDay, subscriberCount } from './audience'
import { simulateDealsDay } from './deals'
import { directionEffects } from './directions'
import { ledgerLine } from './economy'
import { simulateMassDay } from './massMessages'
import { simulateMeetupsDay } from './meetups'
import { activityFactor, simulatePostsDay } from './posts'
import { simulateRegularsDay } from './regulars'
import { simulateRequestsDay } from './requests'

export type SimulateResult = { account: Account; events: EngineEvent[] }

/**
 * Advances the account by `days` days (default seed: the account's own).
 * Settings only affect who new regulars are (their language).
 */
export function simulate(
  account: Account,
  days: number,
  seed: string = account.meta.seed,
  settings: Settings = DEFAULT_SETTINGS,
): SimulateResult {
  let acc = account
  const events: EngineEvent[] = []
  const price = account.profile.accountType === 'free' ? 0 : account.profile.priceCents

  for (let day = account.clock.day + 1; day <= account.clock.day + days; day++) {
    const before = subscriberCount(acc.audience)
    const pd = simulatePostsDay(acc, acc.audience, seed, day)
    const md = simulateMassDay({ ...acc, posts: pd.posts }, acc.audience, seed, day)
    acc = { ...acc, posts: pd.posts, massMessages: md.massMessages }
    const fx = directionEffects(acc)
    const r = simulateAudienceDay(acc.audience, acc.profile, seed, day, {
      extraVisitors: pd.extraVisitors,
      renewalFactor: activityFactor(acc, day),
      mixFactors: fx.mix,
      visitorFactor: fx.visitors,
    })
    const after = subscriberCount(r.audience)

    const lines = [
      ledgerLine(day, 'subscription', r.newSubscribers, r.newSubscribers * price),
      ledgerLine(day, 'renewal', r.renewals, r.renewals * price),
      ledgerLine(day, 'tip', r.tips.count, r.tips.gross),
      ledgerLine(day, 'post', pd.purchases, pd.gross),
      ledgerLine(day, 'message', md.purchases, md.gross),
    ].filter((l) => l.gross > 0)
    acc = { ...acc, audience: r.audience, ledger: [...acc.ledger, ...lines] }

    // Regulars come last: they react to today's crowd. Then their customs and meetups.
    const rd = simulateRegularsDay(acc, acc.audience, seed, day, settings)
    const qd = simulateRequestsDay(rd.account, day)
    const od = simulateMeetupsDay(qd.account, day)
    const dd = simulateDealsDay(od.account, seed, day)
    acc = dd.account

    const net = Object.fromEntries(LedgerKindSchema.options.map((k) => [k, 0])) as DailyStat['net']
    for (const l of acc.ledger) if (l.day === day) net[l.kind] += l.net
    acc = {
      ...acc,
      history: [
        ...acc.history,
        {
          day,
          subscribers: after,
          bySegment: Object.fromEntries(SEGMENTS.map((s) => [s, subscriberCount(acc.audience, s)])) as DailyStat['bySegment'],
          newSubscribers: r.newSubscribers,
          churned: r.churned,
          visitors: r.visitors,
          net,
        },
      ],
    }

    events.push(...pd.events, ...md.events)
    if (r.newSubscribers) events.push({ day, type: 'subscribers', count: r.newSubscribers })
    if (r.churned) events.push({ day, type: 'churn', count: r.churned })
    if (r.tips.count) events.push({ day, type: 'tips', count: r.tips.count, gross: r.tips.gross })
    for (const m of economy.milestones) {
      if (before < m && after >= m) events.push({ day, type: 'milestone', subscribers: m })
    }
    events.push(...rd.events, ...qd.events, ...od.events, ...dd.events)
  }

  const today = account.clock.day + days
  const keepFrom = today - economy.eventDays
  return {
    account: { ...acc, clock: { day: today }, events: [...account.events, ...events].filter((e) => e.day > keepFrom) },
    events,
  }
}
