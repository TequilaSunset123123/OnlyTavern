// The engine entry point (plan.md §4.1): state in, events and the new state out.
// Pure: same account + same seed + same days (+ same settings) -> same result.
import economy from '../presets/economy.json'
import { type Account, type DailyStat, DEFAULT_SETTINGS, type EngineEvent, LedgerKindSchema, SEGMENTS, type Settings } from '../store/schema'
import { simulateAudienceDay, subscriberCount } from './audience'
import { simulateDealsDay } from './deals'
import { directionEffects, platformFee } from './directions'
import { eventEffects } from './eventEffects'
import { rollDayEvent } from './events'
import { ledgerLine } from './economy'
import { haterFame, simulateHatersDay } from './haters'
import { simulateIncidentsDay } from './incidents'
import { simulateMassDay } from './massMessages'
import { simulateMeetupsDay } from './meetups'
import { activityFactor, simulatePostsDay, tagMix } from './posts'
import { priceSpend } from './price'
import { simulateRegularsDay } from './regulars'
import { simulateRequestsDay } from './requests'

export type SimulateResult = { account: Account; events: EngineEvent[] }

/**
 * Advances the account by `days` days (default seed: the account's own).
 * Settings only affect who new regulars are (their language). `stopAtRare`: stop at the
 * end of a day a rare or special event comes up that waits for your choice (skipping ahead in the app).
 */
export function simulate(
  account: Account,
  days: number,
  seed: string = account.meta.seed,
  settings: Settings = DEFAULT_SETTINGS,
  { stopAtRare = false }: { stopAtRare?: boolean } = {},
): SimulateResult {
  let acc = account
  const events: EngineEvent[] = []
  const price = account.profile.accountType === 'free' ? 0 : account.profile.priceCents
  let today = account.clock.day

  for (let day = account.clock.day + 1; day <= account.clock.day + days; day++) {
    today = day
    const before = subscriberCount(acc.audience)
    // The day's event first (engine/events.ts): everything after rolls with its odds.
    const ed = rollDayEvent(acc, seed, day)
    acc = ed.account
    const ev = eventEffects(acc, day)
    const pd = simulatePostsDay(acc, acc.audience, seed, day)
    const md = simulateMassDay({ ...acc, posts: pd.posts }, acc.audience, seed, day)
    acc = { ...acc, posts: pd.posts, massMessages: md.massMessages }
    const fx = directionEffects(acc)
    // Who your recent posts draw in (posts.ts tagMix): degradation brings freeloaders and haters.
    const drawn = tagMix(acc, day)
    const r = simulateAudienceDay(acc.audience, acc.profile, seed, day, {
      extraVisitors: pd.extraVisitors,
      renewalFactor: activityFactor(acc, day) * ev.renewal,
      mixFactors: Object.fromEntries(SEGMENTS.map((s) => [s, fx.mix[s] * (ev.mix[s] ?? 1) * drawn[s]])),
      // Haters badmouthing you keep some visitors away (haters.ts).
      visitorFactor: fx.visitors * haterFame(acc) * ev.visitors,
      conversionFactor: ev.conversion,
      tipFactor: ev.crowdTips,
      // Fans who pay more tip more (engine/price.ts).
      tipSize: ev.tipSize * priceSpend(acc.profile),
    })
    const after = subscriberCount(r.audience)

    // The platform's cut at your level today (directions.ts platformFee).
    const fee = platformFee(acc)
    const lines = [
      ledgerLine(day, 'subscription', r.newSubscribers, r.newSubscribers * price, fee),
      ledgerLine(day, 'renewal', r.renewals, r.renewals * price, fee),
      ledgerLine(day, 'tip', r.tips.count, r.tips.gross, fee),
      ledgerLine(day, 'post', pd.purchases, pd.gross, fee),
      ledgerLine(day, 'message', md.purchases, md.gross, fee),
    ].filter((l) => l.gross > 0)
    acc = { ...acc, audience: r.audience, ledger: [...acc.ledger, ...lines] }

    // Regulars come last: they react to today's crowd. Who turns on you (or comes round)
    // first, then the rest of them; then customs, meetups and stalker incidents.
    const hd = simulateHatersDay(acc, seed, day)
    const rd = simulateRegularsDay(hd.account, acc.audience, seed, day, settings)
    const qd = simulateRequestsDay(rd.account, day)
    const od = simulateMeetupsDay(qd.account, seed, day)
    const dd = simulateDealsDay(od.account, seed, day)
    const id = simulateIncidentsDay(dd.account, seed, day)
    acc = id.account

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

    events.push(...ed.events, ...pd.events, ...md.events)
    if (r.newSubscribers) events.push({ day, type: 'subscribers', count: r.newSubscribers })
    if (r.churned) events.push({ day, type: 'churn', count: r.churned })
    if (r.tips.count) events.push({ day, type: 'tips', count: r.tips.count, gross: r.tips.gross })
    for (const m of economy.milestones) {
      if (before < m && after >= m) events.push({ day, type: 'milestone', subscribers: m })
    }
    events.push(...hd.events, ...rd.events, ...qd.events, ...od.events, ...dd.events, ...id.events)
    if (stopAtRare && acc.dayEvents.some((e) => e.day === day && e.status === 'open')) break
  }

  const keepFrom = today - economy.eventDays
  return {
    // acc.events already holds the events engine steps noted on the account (level-ups).
    account: { ...acc, clock: { day: today }, events: [...acc.events, ...events].filter((e) => e.day > keepFrom) },
    events,
  }
}
