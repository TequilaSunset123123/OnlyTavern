// One day of the crowd (plan.md §4.2). Fans are counts in renewal-day buckets:
// on day d, bucket d % 30 comes up for renewal; new subscribers join that bucket.
import preset from '../presets/audience.json'
import { type Audience, type Profile, SEGMENTS, type Segment } from '../store/schema'
import { binomial, logNormal, type Rng, rngFor } from './rng'

type SegmentParams = (typeof preset.segments)[Segment]

export type AudienceDay = {
  audience: Audience
  visitors: number
  newSubscribers: number
  renewals: number
  churned: number
  tips: { count: number; gross: number }
}

export function subscriberCount(audience: Audience, segment?: Segment): number {
  const segs: readonly Segment[] = segment ? [segment] : SEGMENTS
  return segs.reduce((sum, s) => sum + audience.cohorts[s].reduce((a, b) => a + b, 0), 0)
}

/** A scandal: each subscriber leaves with chance `share`. */
export function loseSubscribers(rng: Rng, audience: Audience, share: number): { audience: Audience; lost: number } {
  let lost = 0
  const cohorts = Object.fromEntries(
    SEGMENTS.map((s) => [
      s,
      audience.cohorts[s].map((n) => {
        const leave = binomial(rng, n, share)
        lost += leave
        return n - leave
      }),
    ]),
  ) as Audience['cohorts']
  return { audience: { cohorts }, lost }
}

/** Chance that one visitor of this segment subscribes at the current price. */
export function conversionRate(p: SegmentParams, profile: Profile): number {
  if (profile.accountType === 'free') return p.conversion
  return p.conversion * Math.exp((-p.priceSensitivity * profile.priceCents) / 1000)
}

function renewalRate(p: SegmentParams, profile: Profile): number {
  return profile.accountType === 'free' ? 1 - (1 - p.renewal) * preset.freeChurnFactor : p.renewal
}

export type DayInputs = {
  /** Visitors brought in by posts (plan.md §4.2). */
  extraVisitors?: number
  /** Multiplies renewal chances (e.g. lower when the creator stopped posting). */
  renewalFactor?: number
  /** Your direction: multiplies each fan type's share of visitors, and how many visit. */
  mixFactors?: Partial<Record<Segment, number>>
  visitorFactor?: number
}

export function simulateAudienceDay(
  audience: Audience,
  profile: Profile,
  seed: string,
  day: number,
  { extraVisitors = 0, renewalFactor = 1, mixFactors = {}, visitorFactor = 1 }: DayInputs = {},
): AudienceDay {
  const bucket = day % 30
  const cohorts = structuredClone(audience.cohorts)
  const total = subscriberCount(audience)

  const visitorRng = rngFor(seed, day, 'visitors')
  const expected = (preset.visitorsBase + preset.visitorsPerSubscriber * total) * visitorFactor
  const visitors = Math.round(logNormal(visitorRng, expected, preset.visitorNoise)) + extraVisitors

  let renewals = 0
  let churned = 0
  let newSubscribers = 0
  const tips = { count: 0, gross: 0 }

  for (const s of SEGMENTS) {
    const p = preset.segments[s]

    // Renewals: this bucket's fans decide whether to stay another month.
    const due = cohorts[s][bucket]
    const stay = binomial(rngFor(seed, day, `renew:${s}`), due, renewalRate(p, profile) * renewalFactor)
    renewals += stay
    churned += due - stay
    cohorts[s][bucket] = stay

    // Tips from current subscribers (before today's newcomers).
    const tipRng = rngFor(seed, day, `tips:${s}`)
    const tippers = binomial(tipRng, cohorts[s].reduce((a, b) => a + b, 0), p.tipDaily)
    for (let i = 0; i < tippers; i++) {
      const dollars = Math.min(preset.maxTipDollars, Math.max(1, Math.round(logNormal(tipRng, p.tipMedian, p.tipSpread))))
      tips.count += 1
      tips.gross += dollars * 100
    }

    // Newcomers: visitors of this segment who subscribe.
    const arrivals = binomial(rngFor(seed, day, `arrive:${s}`), visitors, Math.min(1, p.mix * (mixFactors[s] ?? 1)))
    const joined = binomial(rngFor(seed, day, `join:${s}`), arrivals, conversionRate(p, profile))
    cohorts[s][bucket] += joined
    newSubscribers += joined
  }

  return { audience: { cohorts }, visitors, newSubscribers, renewals, churned, tips }
}
