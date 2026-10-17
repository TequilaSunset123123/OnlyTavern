// How posts perform (plan.md §4.3). A post is seen over its first days after
// publishing (heat); each fan type reacts according to how well the post's
// explicitness matches its taste and how fresh the tags are. Locked posts sell
// to viewers, and viewers tip (2026-10-17: crowd tips only come from posts, each
// fan type's `tipPerView`, likelier the better the post suits him); every post
// also brings some new profile visitors.
import preset from '../presets/audience.json'
import tags from '../presets/tags.json'
import { type Account, type Audience, type EngineEvent, type Post, SEGMENTS, type Segment } from '../store/schema'
import { subscriberCount } from './audience'
import { eventEffects } from './eventEffects'
import { platformFee } from './directions'
import { priceSpend } from './price'
import { binomial, logNormal, rngFor } from './rng'

const P = preset.post

/** Explicitness of a post: its most explicit vault item (text-only posts count as 1). */
export function postIntensity(post: Post, account: Account): number {
  const levels = post.vaultIds.map((id) => account.vault.find((v) => v.id === id)?.intensity ?? 1)
  return Math.max(1, ...levels)
}

export function postTags(post: Post, account: Account): string[] {
  return [...new Set(post.vaultIds.flatMap((id) => account.vault.find((v) => v.id === id)?.tags ?? []))]
}

/**
 * What your recent posts pull in (presets/tags.json): each key's factor is the average,
 * over your last posts (audience.json regulars.recentDays), of the strongest factor a post's tags give
 * it (the one furthest from ×1, so a post with BDSM and romance still draws haters).
 * Posting only degradation gives its full factors; one such post in four, a quarter of the way.
 */
function tagPull(account: Account, day: number, field: 'audience' | 'attracts'): Record<string, number> {
  const recent = account.posts.filter((p) => p.day > day - preset.regulars.recentDays && p.day <= day)
  if (!recent.length) return {}
  const pull = new Map<string, number>()
  for (const p of recent) {
    const ids = new Set(postTags(p, account))
    const strongest: Record<string, number> = {}
    for (const t of tags) {
      if (!ids.has(t.id) || !(field in t)) continue
      for (const [id, m] of Object.entries((t as Record<string, unknown>)[field] as Record<string, number>)) {
        if (Math.abs(Math.log(m)) > Math.abs(Math.log(strongest[id] ?? 1))) strongest[id] = m
      }
    }
    for (const [id, m] of Object.entries(strongest)) pull.set(id, (pull.get(id) ?? 0) + (m - 1))
  }
  return Object.fromEntries([...pull].map(([id, extra]) => [id, 1 + extra / recent.length]))
}

/**
 * Which personalities and behaviours your recent posts draw in (tags.json `attracts`):
 * BDSM, degradation and domination bring misogynists and creeps, femdom submissive men,
 * cosplay and voice notes obsessed ones.
 */
export const tagAttracts = (account: Account, day: number) => tagPull(account, day, 'attracts')

/**
 * Which fan types your recent posts draw in (tags.json `audience`, 2026-10-16): degradation
 * and BDSM bring freeloaders and haters, femdom whales and simps, cosplay simps. It changes
 * who comes, not how many: the factors are scaled so the crowd's usual mix
 * (audience.json `mix`) still adds up to the same number of visitors.
 */
export function tagMix(account: Account, day: number): Record<Segment, number> {
  const pull = tagPull(account, day, 'audience')
  const raw = Object.fromEntries(SEGMENTS.map((s) => [s, pull[s] ?? 1])) as Record<Segment, number>
  const mix = (f: Record<Segment, number>) => SEGMENTS.reduce((sum, s) => sum + preset.segments[s].mix * f[s], 0)
  const k = mix(Object.fromEntries(SEGMENTS.map((s) => [s, 1])) as Record<Segment, number>) / mix(raw)
  return Object.fromEntries(SEGMENTS.map((s) => [s, raw[s] * k])) as Record<Segment, number>
}

/** 1 when the tags are new; lower the more the same tags were posted in the recent window. */
export function freshness(post: Post, account: Account): number {
  const tags = postTags(post, account)
  if (!tags.length) return 1
  const earlier = account.posts.filter(
    (p) => p.id !== post.id && p.day <= post.day && p.day > post.day - P.freshnessWindowDays && account.posts.indexOf(p) > account.posts.indexOf(post),
  )
  const repeats = tags.reduce((n, t) => n + earlier.filter((p) => postTags(p, account).includes(t)).length, 0) / tags.length
  return P.tagRepeatDecay ** repeats
}

export function intensityMatch(intensity: number, preferred: number): number {
  return Math.exp(-((intensity - preferred) ** 2) / (2 * P.intensityTolerance ** 2))
}

export type PostsDay = {
  posts: Post[]
  extraVisitors: number
  purchases: number
  gross: number
  /** Tips viewers left on your posts today. */
  tips: { count: number; gross: number }
  events: EngineEvent[]
}

export function simulatePostsDay(account: Account, audience: Audience, seed: string, day: number): PostsDay {
  const sameDay = new Map<number, number>()
  for (const p of account.posts) sameDay.set(p.day, (sameDay.get(p.day) ?? 0) + 1)

  let extraVisitors = 0
  let purchases = 0
  let gross = 0
  const tips = { count: 0, gross: 0 }
  const events: EngineEvent[] = []
  // The day's event (engine/eventEffects.ts): a trending tag, an algorithm shift, fans in a tipping mood.
  const ev = eventEffects(account, day)
  // Fans who pay more for the page tip more (engine/price.ts).
  const tipSize = ev.tipSize * priceSpend(account.profile)

  const posts = account.posts.map((post) => {
    const age = day - post.day // 1 = the day after publishing
    const heat = P.heat[age - 1]
    if (!heat) return post

    const tags = postTags(post, account)
    const boost = ev.reach * (ev.tag && tags.includes(ev.tag) ? ev.tagReach : 1)
    const reach = (heat / Math.sqrt(sameDay.get(post.day) ?? 1)) * boost // posting a lot on one day splits attention
    const intensity = postIntensity(post, account)
    const fresh = freshness(post, account)
    const price = post.access === 'locked' ? post.priceCents : 0
    const today = { views: 0, likes: 0, comments: 0, purchases: 0, tips: 0, tipped: 0 }

    for (const s of SEGMENTS) {
      const p = preset.segments[s]
      const match = intensityMatch(intensity, p.preferredIntensity)
      const rng = rngFor(seed, day, `post:${post.id}:${s}`)
      const views = binomial(rng, subscriberCount(audience, s), Math.min(1, p.reach * reach))
      today.views += views
      today.likes += binomial(rng, views, Math.min(1, p.likeRate * match * fresh))
      today.comments += binomial(rng, views, Math.min(1, p.commentRate * (0.5 + 0.5 * match)))
      if (price > 0) {
        today.purchases += binomial(rng, views, Math.min(1, p.ppvRate * match * Math.exp((-p.priceSensitivity * price) / 1000)))
      }
      const tippers = binomial(rng, views, Math.min(1, p.tipPerView * match * ev.crowdTips))
      for (let i = 0; i < tippers; i++) {
        today.tips += 1
        today.tipped += Math.min(preset.maxTipDollars, Math.max(1, Math.round(logNormal(rng, p.tipMedian * tipSize, p.tipSpread)))) * 100
      }
    }

    extraVisitors += P.visitorsPerPost * reach * fresh + today.likes * P.visitorsPerLike
    purchases += today.purchases
    gross += today.purchases * price
    tips.count += today.tips
    tips.gross += today.tipped
    if (today.views) events.push({ day, type: 'post', postId: post.id, views: today.views, likes: today.likes, comments: today.comments })
    if (today.purchases) events.push({ day, type: 'purchases', postId: post.id, count: today.purchases, gross: today.purchases * price })

    const cut = (cents: number) => cents - Math.round(cents * platformFee(account))
    const net = cut(today.purchases * price)
    return {
      ...post,
      stats: {
        views: post.stats.views + today.views,
        likes: post.stats.likes + today.likes,
        comments: post.stats.comments + today.comments,
        purchases: post.stats.purchases + today.purchases,
        earned: post.stats.earned + net,
        ...(today.tipped || post.stats.tips ? { tips: (post.stats.tips ?? 0) + cut(today.tipped) } : {}),
      },
    }
  })

  return { posts, extraVisitors: Math.round(extraVisitors), purchases, gross, tips, events }
}

/** Fans drift away from creators who stop posting. */
export function activityFactor(account: Account, day: number): number {
  const last = account.posts.reduce((m, p) => Math.max(m, p.day), 0)
  return day - last > P.inactiveDays ? P.inactiveRenewalFactor : 1
}
