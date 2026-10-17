// How posts perform (plan.md §4.3). A post is seen over its first days after
// publishing (heat); each fan type reacts according to how well the post's
// explicitness matches its taste and how fresh the tags are. Locked posts sell
// to viewers; every post also brings some new profile visitors.
import preset from '../presets/audience.json'
import { type Account, type Audience, type EngineEvent, type Post, SEGMENTS } from '../store/schema'
import { subscriberCount } from './audience'
import { eventEffects } from './eventEffects'
import { PLATFORM_FEE } from './economy'
import { binomial, rngFor } from './rng'

const P = preset.post

/** Explicitness of a post: its most explicit vault item (text-only posts count as 1). */
export function postIntensity(post: Post, account: Account): number {
  const levels = post.vaultIds.map((id) => account.vault.find((v) => v.id === id)?.intensity ?? 1)
  return Math.max(1, ...levels)
}

export function postTags(post: Post, account: Account): string[] {
  return [...new Set(post.vaultIds.flatMap((id) => account.vault.find((v) => v.id === id)?.tags ?? []))]
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
  events: EngineEvent[]
}

export function simulatePostsDay(account: Account, audience: Audience, seed: string, day: number): PostsDay {
  const sameDay = new Map<number, number>()
  for (const p of account.posts) sameDay.set(p.day, (sameDay.get(p.day) ?? 0) + 1)

  let extraVisitors = 0
  let purchases = 0
  let gross = 0
  const events: EngineEvent[] = []
  // The day's event (engine/eventEffects.ts): a trending tag, an algorithm shift.
  const ev = eventEffects(account, day)

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
    const today = { views: 0, likes: 0, comments: 0, purchases: 0 }

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
    }

    extraVisitors += P.visitorsPerPost * reach * fresh + today.likes * P.visitorsPerLike
    purchases += today.purchases
    gross += today.purchases * price
    if (today.views) events.push({ day, type: 'post', postId: post.id, views: today.views, likes: today.likes, comments: today.comments })
    if (today.purchases) events.push({ day, type: 'purchases', postId: post.id, count: today.purchases, gross: today.purchases * price })

    const net = today.purchases * price - Math.round(today.purchases * price * PLATFORM_FEE)
    return {
      ...post,
      stats: {
        views: post.stats.views + today.views,
        likes: post.stats.likes + today.likes,
        comments: post.stats.comments + today.comments,
        purchases: post.stats.purchases + today.purchases,
        earned: post.stats.earned + net,
      },
    }
  })

  return { posts, extraVisitors: Math.round(extraVisitors), purchases, gross, events }
}

/** Fans drift away from creators who stop posting. */
export function activityFactor(account: Account, day: number): number {
  const last = account.posts.reduce((m, p) => Math.max(m, p.day), 0)
  return day - last > P.inactiveDays ? P.inactiveRenewalFactor : 1
}
