// Who a fan is (plan.md §1, 2026-10-14): every crowd fan and regular is put together
// from our own parts in presets/personas.json, by seed. Fans are men only. No model,
// no name library: the parts are ours, so profiles fit the game.
//
// A regular has three layers (2026-10-15), beside his type and loyalty:
//   - personality: how he talks (Horny, Awkward, Quiet, Bossy...). One per fan; words only;
//   - behaviours: lasting tendencies that change the odds (Obsessed, Stalker, Creepy,
//     Cheapskate, Old money). Rolled one by one when he arrives; events can add one;
//   - conditions: states events put him in and take away (engine/conditions.ts).
// His name, age, job, bio are description only: the engine never reads them.
// (His relationship is the exception: a married man can get caught at a meetup.)
import personas from '../presets/personas.json'
import type { Regular, Segment, Settings } from '../store/schema'
import { loveHate } from './conditions'
import type { Rng } from './rng'

export type Language = 'en' | 'zh'

const MIX_CHINESE_SHARE = 0.3
const NUMBERS = ['69', '88', '420', '777', '99', '23']

const at = <T>(list: T[], x: number): T => list[Math.floor(x * list.length)]

export function weighted<K extends string>(rng: Rng, weights: Partial<Record<K, number>>): K {
  const entries = Object.entries(weights) as [K, number][]
  let r = rng() * entries.reduce((a, [, w]) => a + w, 0)
  for (const [k, w] of entries) if ((r -= w) < 0) return k
  return entries[entries.length - 1][0]
}

export function pickLanguage(rng: Rng, setting: Settings['fanLanguage']): Language {
  return setting === 'mix' ? (rng() < MIX_CHINESE_SHARE ? 'zh' : 'en') : setting
}

/**
 * Display name and @handle. Always draws the same count of numbers whatever the
 * language, so a comment keeps its fan (and its text) when you switch languages.
 */
export function fanIdentity(rng: Rng, language: Language): { name: string; handle: string } {
  const r = Array.from({ length: 6 }, () => rng())
  const num = r[5] < 0.5 ? String(10 + Math.floor(r[4] * 90)) : r[5] < 0.75 ? String(1975 + Math.floor(r[4] * 30)) : at(NUMBERS, r[4])
  if (language === 'zh') {
    const Z = personas.zh
    const s = at(Z.surnames, r[0])
    const g = at(Z.givenNames, r[1])
    const name = r[2] < 0.12 ? `老${s.zh}` : r[2] < 0.2 ? `${s.zh}哥` : `${s.zh}${g.zh}`
    const handle = r[3] < 0.5 ? `${s.py}${g.py}${num}` : r[3] < 0.75 ? `${at(Z.handleWords, r[2])}_${s.py}${num}` : `lao${s.py}${num}`
    return { name, handle }
  }
  const E = personas.en
  const name = at(E.firstNames, r[0])
  const first = name.toLowerCase()
  const adjective = at(E.handleAdjectives, r[1])
  const noun = at(E.handleNouns, r[1])
  const handle =
    r[3] < 0.25 ? `${first}${num}` : r[3] < 0.45 ? `${adjective}_${first}` : r[3] < 0.6 ? `${first}_${at(E.lastNames, r[2])}` : r[3] < 0.8 ? `${adjective}${first}${num}` : `${first}the${noun}`
  return { name, handle }
}

export type Persona = { name: string; handle: string; age: number; country: string; bio: string; relationship: string; personality: string; behaviours: string[] }

/**
 * A whole regular: identity, age, job, where he lives, relationship, his personality
 * and behaviours. `attracts` (your direction, your recent posts) makes some likelier.
 */
export function makePersona(rng: Rng, segment: Segment, language: Language, attracts: Record<string, number> = {}): Persona {
  const { name, handle } = fanIdentity(rng, language)
  const S = personas.segments[segment]
  const age = S.age[0] + Math.floor(rng() * (S.age[1] - S.age[0] + 1))
  const job = at(S.jobs[language], rng())
  const status = weighted(rng, S.relationships)
  const relationship = personas.relationships[status][language]
  const f = (id: string) => attracts[id] ?? 1
  const personality = weighted(rng, Object.fromEntries(Object.entries(S.personalities).map(([id, w]) => [id, w * f(id)])))
  const behaviours = Object.entries(S.behaviours as Record<string, number>)
    .filter(([id, p]) => rng() < Math.min(0.9, p * f(id)))
    .map(([id]) => id)
  const who = { relationship: status, personality, behaviours }
  if (language === 'zh') {
    const place = at(personas.zh.cities, rng())
    return { name, handle, age, country: place.country, bio: `${age}岁，${place.city}，${job}，${relationship}`, ...who }
  }
  const place = at(personas.en.places, rng())
  return { name, handle, age, country: place.country, bio: `${age}, ${job} from ${place.city}, ${place.region}, ${relationship}`, ...who }
}

/** An event gives him a lasting tendency (a creepy meetup makes him a stalker). */
export const withBehaviour = (r: Regular, id: string): Regular => (r.behaviours.includes(id) ? r : { ...r, behaviours: [...r.behaviours, id] })

/** What a behaviour or condition does to the odds (presets/personas.json `modifiers`). */
type Modifiers = {
  dmFactor?: number
  maxUnanswered?: number
  ignoredFactor?: number
  meetupFactor?: number
  /** Asks to meet from this loyalty level on (lower than his type's). */
  meetupMinLoyalty?: number
  /** Multiplies the chances of what happens at a meetup (presets/personas.json fan.meetup.events). */
  events?: Record<string, number>
  turnsHater?: { afterDays: number; daily: number }
  /** When hostile, half of them give up within this many days (instead of his type's). */
  haterHalfLifeDays?: number
  /** How much damage he does to your name when he acts as a hater (× the base per hater). */
  fame?: number
  /** Stalker incidents (engine/incidents.ts): × the daily chance; none without it. */
  incidents?: number
  /** The condition he comes back with when you win him back after he turned. */
  comesBackAs?: string
}
type Layer = { label: string; prompt: string; modifiers?: Modifiers; likes?: Record<string, number>; loveHate?: { label: string; prompt: string } }
const PERSONALITIES = personas.personalities as Record<string, Layer>
const BEHAVIOURS = personas.behaviours as Record<string, Layer>
const CONDITIONS = personas.conditions as Record<string, Layer>

export type LayerInfo = { id: string; label: string; prompt: string }
const info = (list: Record<string, Layer>, id: string): LayerInfo => ({ id, label: list[id]?.label ?? id, prompt: list[id]?.prompt ?? '' })

/**
 * Content his personality and behaviours make him want (presets/personas.json `likes`,
 * 2026-10-16): a bossy man wants domination, a misogynist degradation, a submissive one
 * femdom. Extra weight on top of the tags his type likes (engine/regulars.ts), and on what
 * he orders as a custom (engine/deals.ts).
 */
export function likeWeights(r: Pick<Regular, 'personality' | 'behaviours'>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const layer of [PERSONALITIES[r.personality], ...r.behaviours.map((id) => BEHAVIOURS[id])]) {
    for (const [tag, w] of Object.entries(layer?.likes ?? {})) out[tag] = (out[tag] ?? 0) + w
  }
  return out
}

/** Picks up to `n` different keys, each by weight. */
export function pickDistinct(rng: Rng, weights: Record<string, number>, n: number): string[] {
  const left = { ...weights }
  const out: string[] = []
  while (out.length < n && Object.values(left).some((w) => w > 0)) {
    const k = weighted(rng, left)
    out.push(k)
    delete left[k]
  }
  return out
}

/** His three layers as labels (for the UI) and descriptions (for the model). */
export function fanLayers(r: Regular) {
  return {
    personality: info(PERSONALITIES, r.personality),
    behaviours: r.behaviours.map((id) => info(BEHAVIOURS, id)),
    // A hostile fan who was Devoted or more when he turned shows (and writes) as love-hate.
    conditions: r.conditions.map((c) => (c.id === 'hostile' && loveHate(r) ? { id: c.id, ...CONDITIONS.hostile.loveHate! } : info(CONDITIONS, c.id))),
  }
}

/**
 * What his behaviours and conditions do to the odds (his personality never does): how
 * often he messages you, how keen he is to meet, what can happen when you meet, whether
 * ignoring him can turn him hostile, what kind of hater he makes (engine/haters.ts) and
 * whether he has stalker incidents (engine/incidents.ts). His type's own numbers are
 * engine/fans.ts; these adjust them.
 */
export function modifiers(r: Pick<Regular, 'behaviours' | 'conditions'>) {
  const own = [...r.behaviours.map((id) => BEHAVIOURS[id]?.modifiers), ...r.conditions.map((c) => CONDITIONS[c.id]?.modifiers)].filter((x) => !!x)
  const turns = own.map((x) => x.turnsHater).filter((x) => !!x)
  return {
    dmFactor: Math.max(1, ...own.map((x) => x.dmFactor ?? 1)),
    maxUnanswered: Math.max(0, ...own.map((x) => x.maxUnanswered ?? 0)),
    ignoredFactor: Math.max(0, ...own.map((x) => x.ignoredFactor ?? 0)),
    meetupFactor: Math.max(1, ...own.map((x) => x.meetupFactor ?? 1)),
    meetupMinLoyalty: Math.min(5, ...own.map((x) => x.meetupMinLoyalty ?? 5)),
    /** Product of all their meetup event factors. */
    events: own.reduce<Record<string, number>>((acc, x) => {
      for (const [k, v] of Object.entries(x.events ?? {})) acc[k] = (acc[k] ?? 1) * v
      return acc
    }, {}),
    /** The quickest way he turns, if any of them can. */
    turnsHater: turns.sort((a, b) => a.afterDays - b.afterDays || b.daily - a.daily)[0] ?? null,
    haterHalfLifeDays: Math.max(0, ...own.map((x) => x.haterHalfLifeDays ?? 0)) || null,
    fame: Math.max(1, ...own.map((x) => x.fame ?? 1)),
    incidents: Math.max(0, ...own.map((x) => x.incidents ?? 0)),
    comesBackAs: own.map((x) => x.comesBackAs).filter((x): x is string => !!x),
  }
}
