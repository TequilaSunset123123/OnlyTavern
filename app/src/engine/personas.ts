// Who a fan is (plan.md §1, 2026-10-14): every crowd fan and regular is put together
// from our own parts in presets/personas.json, by seed. Fans are men only. No model,
// no name library: the parts are ours, so profiles fit the game.
import personas from '../presets/personas.json'
import type { Segment, Settings } from '../store/schema'
import type { Rng } from './rng'

export type Language = 'en' | 'zh'
export type TraitId = keyof typeof personas.styles

const MIX_CHINESE_SHARE = 0.3
const NUMBERS = ['69', '88', '420', '777', '99', '23']

const at = <T>(list: T[], x: number): T => list[Math.floor(x * list.length)]

function weighted<K extends string>(rng: Rng, weights: Partial<Record<K, number>>): K {
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

export type Persona = { name: string; handle: string; age: number; country: string; bio: string; traits: TraitId[]; relationship: string }

/**
 * A whole regular: identity, age, job, where he lives, relationship and how he writes.
 * `traitFactors` (from your direction) make some styles and traits likelier.
 */
export function makePersona(rng: Rng, segment: Segment, language: Language, traitFactors: Record<string, number> = {}): Persona {
  const { name, handle } = fanIdentity(rng, language)
  const S = personas.segments[segment]
  const age = S.age[0] + Math.floor(rng() * (S.age[1] - S.age[0] + 1))
  const job = at(S.jobs[language], rng())
  const status = weighted(rng, S.relationships)
  const relationship = personas.relationships[status][language]
  const f = (t: string) => traitFactors[t] ?? 1
  const styles = Object.fromEntries(Object.entries(S.styles).map(([t, w]) => [t, w * f(t)])) as Partial<Record<TraitId, number>>
  const extra = 'traits' in S ? (Object.entries(S.traits) as [TraitId, number][]) : []
  const traits = [weighted(rng, styles), ...extra.filter(([t, p]) => rng() < Math.min(0.9, p * f(t))).map(([t]) => t)]
  if (language === 'zh') {
    const place = at(personas.zh.cities, rng())
    return { name, handle, age, country: place.country, bio: `${age}岁，${place.city}，${job}，${relationship}`, traits, relationship: status }
  }
  const place = at(personas.en.places, rng())
  return { name, handle, age, country: place.country, bio: `${age}, ${job} from ${place.city}, ${place.region}, ${relationship}`, traits, relationship: status }
}

type Behaviour = {
  dmFactor?: number
  maxUnanswered?: number
  ignoredFactor?: number
  meetupFactor?: number
  /** Asks to meet from this loyalty level on (lower than his type's). */
  meetupMinLoyalty?: number
  /** Multiplies the chances of what happens at a meetup (presets/personas.json fan.meetup.events). */
  events?: Record<string, number>
  turnsHater?: { afterDays: number; daily: number }
}
const STYLES = personas.styles as Record<string, { label: string; prompt: string; behaviour?: Behaviour }>

/** How the model should make this fan write. */
export const traitPrompt = (id: string) => STYLES[id]?.prompt ?? ''
export const traitLabel = (id: string) => STYLES[id]?.label ?? id

/** When ignored fans give up on you, how fast you can win them back (presets/personas.json). */
export const WIN_BACK = personas.winBack

/**
 * What his traits do: how often he messages you, how many unanswered messages he
 * sends in a row, how much being ignored slows him down, how keen he is to meet,
 * and whether ignoring him for long can turn him into a hater.
 */
export function behaviour(traits: string[]) {
  const own = traits.map((t) => STYLES[t]?.behaviour).filter((x) => !!x)
  const turns = own.map((x) => x.turnsHater).filter((x) => !!x)
  return {
    dmFactor: Math.max(1, ...own.map((x) => x.dmFactor ?? 1)),
    maxUnanswered: Math.max(2, ...own.map((x) => x.maxUnanswered ?? 2)),
    ignoredFactor: Math.max(0.3, ...own.map((x) => x.ignoredFactor ?? 0.3)),
    meetupFactor: Math.max(1, ...own.map((x) => x.meetupFactor ?? 1)),
    meetupMinLoyalty: Math.min(5, ...own.map((x) => x.meetupMinLoyalty ?? 5)),
    /** Product of all his traits' meetup event factors. */
    events: own.reduce<Record<string, number>>((acc, x) => {
      for (const [k, v] of Object.entries(x.events ?? {})) acc[k] = (acc[k] ?? 1) * v
      return acc
    }, {}),
    /** The quickest way he turns, if any of his traits can. */
    turnsHater: turns.sort((a, b) => a.afterDays - b.afterDays || b.daily - a.daily)[0] ?? null,
  }
}
