// Creator directions (plan.md §10.1, 2026-10-15): girl next door, porn star, anime
// e-girl, high-end escort, couple account. Pick one; it shifts who visits, which fans
// become regulars, and how often customs and meetups come. What you do for it (posts
// with its tags, customs, meetups) earns points; levels make its effects stronger.
// Switching after your first pick loses part of your subscribers.
import D from '../presets/directions.json'
import type { Account, DirectionId, EngineEvent, Post, Segment } from '../store/schema'
import { DIRECTIONS, SEGMENTS } from '../store/schema'
import { binomial, rngFor } from './rng'

type Spec = {
  label: string
  zh: string
  blurb: string
  prompt: string
  titles: string[]
  signatureTags: string[]
  audience: Partial<Record<Segment, number>>
  visitors: number
  traits: Record<string, number>
  requests: { rate: number; offer: number }
  meetups: { rate: number; offer: number }
  meetupPoints: number
  /** Multiplies the chances of what happens at a meetup (escorts screen clients: less creepy, more generous). */
  meetupEvents: Record<string, number>
  partnerContent?: boolean
}

export const SPECS = D.directions as Record<DirectionId, Spec>
const LEVELS = D.levels
const MAX_LEVEL = LEVELS.points.length

/** 1–5 from points. */
export function levelOf(points: number): number {
  return LEVELS.points.filter((p) => points >= p).length
}

/** How strongly the current direction shows, by level: 40% at level 1 … 100% at level 5. */
function strength(account: Account): number {
  return LEVELS.strength[levelOf(account.direction.points[account.direction.id]) - 1]
}

export type Effects = {
  /** Multiplies each fan type's share of visitors. */
  mix: Record<Segment, number>
  /** Multiplies how many people visit. */
  visitors: number
  /** Multiplies how likely new regulars get each writing style or trait. */
  traits: Record<string, number>
  requests: { rate: number; offer: number }
  meetups: { rate: number; offer: number }
  meetupEvents: Record<string, number>
}

/** What the current direction does right now (scaled by its level). */
export function directionEffects(account: Account): Effects {
  const spec = SPECS[account.direction.id]
  const k = strength(account)
  const scale = (m = 1) => 1 + (m - 1) * k
  return {
    mix: Object.fromEntries(SEGMENTS.map((s) => [s, scale(spec.audience[s])])) as Record<Segment, number>,
    visitors: scale(spec.visitors),
    traits: Object.fromEntries(Object.entries(spec.traits).map(([t, m]) => [t, scale(m)])),
    requests: { rate: scale(spec.requests.rate), offer: scale(spec.requests.offer) },
    meetups: { rate: scale(spec.meetups.rate), offer: scale(spec.meetups.offer) },
    meetupEvents: Object.fromEntries(Object.entries(spec.meetupEvents).map(([e, m]) => [e, scale(m)])),
  }
}

/** Adds points (to every direction they count for) and notes a level-up of the current one. */
export function addPoints(account: Account, gains: Partial<Record<DirectionId, number>>): Account {
  const current = account.direction.id
  const before = levelOf(account.direction.points[current])
  const points = { ...account.direction.points }
  for (const d of DIRECTIONS) points[d] += gains[d] ?? 0
  const after = levelOf(points[current])
  const events: EngineEvent[] = after > before ? [{ day: account.clock.day, type: 'level-up', direction: current, level: after }] : []
  return { ...account, direction: { ...account.direction, points }, events: [...account.events, ...events] }
}

/** A post counts for each direction whose signature tags it carries (couple: also content with your partner). */
export function postPoints(account: Account, post: Post): Partial<Record<DirectionId, number>> {
  const items = post.vaultIds.map((id) => account.vault.find((v) => v.id === id)).filter((v) => !!v)
  const tags = new Set(items.flatMap((i) => i.tags))
  const withPartner = items.some((i) => i.cast !== 'me')
  return Object.fromEntries(
    DIRECTIONS.map((d) => {
      const spec = SPECS[d]
      const matched = Math.min(D.points.maxPerPost, spec.signatureTags.filter((t) => tags.has(t)).length) * D.points.perTag
      return [d, matched + (spec.partnerContent && withPartner ? D.points.partnerBonus : 0)]
    }),
  )
}

/** A paid custom counts for each direction whose signature tags it asked for. */
export function customPoints(tags: string[]): Partial<Record<DirectionId, number>> {
  return Object.fromEntries(DIRECTIONS.map((d) => [d, SPECS[d].signatureTags.some((t) => tags.includes(t)) ? D.points.custom : 0]))
}

/** A meetup counts for the directions built on them (the escort). */
export function meetupPoints(): Partial<Record<DirectionId, number>> {
  return Object.fromEntries(DIRECTIONS.map((d) => [d, SPECS[d].meetupPoints]))
}

/**
 * Pick a direction. The first pick is free; switching after that makes part of your
 * subscribers leave (they came for what you did before).
 */
export function setDirection(account: Account, id: DirectionId, seed: string): { account: Account; events: EngineEvent[] } {
  const { direction } = account
  if (direction.id === id && direction.chosen) return { account, events: [] }
  if (!direction.chosen) return { account: { ...account, direction: { ...direction, id, chosen: true } }, events: [] }
  const day = account.clock.day
  const rng = rngFor(seed, day, `switch:${id}`)
  let lost = 0
  const cohorts = Object.fromEntries(
    SEGMENTS.map((s) => [
      s,
      account.audience.cohorts[s].map((n) => {
        const leave = binomial(rng, n, D.switchLoss)
        lost += leave
        return n - leave
      }),
    ]),
  ) as Account['audience']['cohorts']
  const event: EngineEvent = { day, type: 'direction', direction: id, lost }
  return {
    account: { ...account, audience: { cohorts }, direction: { ...direction, id }, events: [...account.events, event] },
    events: [event],
  }
}

export type DirectionInfo = {
  id: DirectionId
  label: string
  blurb: string
  signatureTags: string[]
  points: number
  level: number
  title: string
  /** Points where the current level started and where the next one starts (null at the top). */
  from: number
  next: number | null
}

export function directionInfo(account: Account, id: DirectionId): DirectionInfo {
  const spec = SPECS[id]
  const points = account.direction.points[id]
  const level = levelOf(points)
  return {
    id,
    label: spec.label,
    blurb: spec.blurb,
    signatureTags: spec.signatureTags,
    points,
    level,
    title: spec.titles[level - 1],
    from: LEVELS.points[level - 1],
    next: level < MAX_LEVEL ? LEVELS.points[level] : null,
  }
}

/** How the model should picture the creator. */
export function directionPrompt(account: Account): string {
  const info = directionInfo(account, account.direction.id)
  return `${SPECS[account.direction.id].prompt} (known as a "${info.title}")`
}

export const SWITCH_LOSS = D.switchLoss
