// Crowd comments (plan.md §4.5): nothing is stored. Each comment is rebuilt from
// (account seed, post, index), so opening a post always shows the same comments,
// and comments that arrive later never change the earlier ones.
import preset from '../presets/audience.json'
import enCorpus from '../presets/corpus/en.json'
import zhCorpus from '../presets/corpus/zh.json'
import styleCorpus from '../presets/corpus/styles.json'
import transitions from '../presets/transitions.json'
import { type Account, MOODS, type Mood, type Post, SEGMENTS, type Segment, type Settings } from '../store/schema'
import { fanIdentity, type Language, pickLanguage, rollTraits, traitLabel } from './personas'
import { postTags, tagAttracts } from './posts'
import { type Rng, rngFor } from './rng'

export type Corpus = { segments: Record<Segment, Record<Mood, string[]>>; tags: Record<string, string[]> }
export const CORPUS: Record<Language, Corpus> = { en: enCorpus as Corpus, zh: zhCorpus as Corpus }
/** Lines by fan style: a personality or behaviour id (presets/corpus/styles.json). */
const STYLES = { en: styleCorpus.en, zh: styleCorpus.zh } as Record<Language, Record<string, string[]>>
const MAX_COMMENTS = 200

export type Comment = {
  id: string
  day: number
  segment: Segment
  mood: Mood
  language: Language
  name: string
  handle: string
  text: string
  /** His type and style, for the comment's byline: “Freeloader · Misogynist”. */
  who: string
}

export function pickWeighted<T extends string>(rng: Rng, weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][]
  let r = rng() * entries.reduce((a, [, w]) => a + w, 0)
  for (const [k, w] of entries) if ((r -= w) < 0) return k
  return entries[entries.length - 1][0]
}

export const pick = <T>(rng: Rng, list: T[]): T => list[Math.floor(rng() * list.length)]

/**
 * Who comments (2026-10-16): your subscribers on the day of the post, each type by how
 * chatty it is. That day's snapshot (account.history) never changes, so neither do the
 * comments. Before the first day: the crowd's usual mix.
 */
function commenterWeights(account: Account, day: number): Record<Segment, number> {
  const counts = account.history.findLast((h) => h.day <= day)?.bySegment
  const total = counts ? SEGMENTS.reduce((n, s) => n + counts[s], 0) : 0
  return Object.fromEntries(
    SEGMENTS.map((s) => [s, (total ? counts![s] / total : preset.segments[s].mix) * preset.segments[s].commentRate]),
  ) as Record<Segment, number>
}

/** “Sloppy” types in lowercase without punctuation (English: Chinese has no case). */
const sloppy = (text: string) => text.toLowerCase().replace(/[.,!?;:'’]/g, '')

type SwitchLines = (typeof transitions.comments)['en']

/**
 * Under the post announcing a direction switch (directions.ts), fans talk about the
 * switch: haters sneer at the new direction, unhappy fans miss the old one, happy ones
 * cheer the new one, and some remark on this very switch.
 */
function switchSets(lines: SwitchLines, post: Post) {
  const { from, to } = post.transition!
  return {
    to: lines.to[to as keyof SwitchLines['to']] ?? [],
    from: lines.from[from as keyof SwitchLines['from']] ?? [],
    hate: lines.hate[to as keyof SwitchLines['hate']] ?? [],
    pair: lines.pair[`${from}>${to}` as keyof SwitchLines['pair']] ?? [],
  }
}

function switchLines(rng: Rng, lines: SwitchLines, post: Post, segment: Segment, mood: Mood): string[] {
  const own = switchSets(lines, post)
  if (segment === 'hater') return own.hate
  if (mood === 'negative') return own.from
  if (mood === 'praise' || mood === 'flirty') return rng() < 0.7 ? own.to : own.pair
  return rng() < 0.6 ? own.from : own.pair
}

export function generateComments(account: Account, post: Post, settings: Pick<Settings, 'fanLanguage'>): Comment[] {
  const tags = postTags(post, account).filter((t) => CORPUS.en.tags[t] || CORPUS.zh.tags[t])
  const weights = commenterWeights(account, post.day)
  // What your posts up to then drew in: degradation brings misogynists and creeps (posts.ts).
  const attracts = tagAttracts(account, post.day)
  const lastDay = Math.max(post.day + 1, Math.min(account.clock.day, post.day + preset.post.heat.length))
  const comments: Comment[] = []
  // No line twice under one post (2026-10-15). Comments are made in order, so earlier
  // ones never change when more arrive.
  const used = new Set<string>()
  const fresh = (lines: string[]) => lines.filter((l) => !used.has(l))

  for (let i = 0; i < Math.min(post.stats.comments, MAX_COMMENTS); i++) {
    const rng = rngFor(account.meta.seed, post.day, `comment:${post.id}:${i}`)
    const segment = pickWeighted(rng, weights)
    const mood = pickWeighted(rng, preset.segments[segment].moods as Record<Mood, number>)
    const language = pickLanguage(rng, settings.fanLanguage)
    const corpus = CORPUS[language]
    // His style, rolled like a new regular's (on its own dice): a misogynist talks like one.
    const styleRng = rngFor(account.meta.seed, post.day, `comment-style:${post.id}:${i}`)
    const traits = rollTraits(styleRng, segment, attracts)
    const styles = [traits.personality, ...traits.behaviours].filter((id) => STYLES[language][id]?.length)
    const style = styles.length ? pick(styleRng, styles) : null
    const tagLines = tags.length ? corpus.tags[pick(rng, tags)] : undefined
    const lines = post.transition
      ? switchLines(rng, transitions.comments[language], post, segment, mood)
      : style && styleRng() < preset.post.styleCommentShare
        ? STYLES[language][style]
        : tagLines?.length && rng() < preset.post.tagCommentShare
          ? tagLines
          : corpus.segments[segment][mood]

    const { name, handle } = fanIdentity(rng, language)
    // Unused lines of the chosen kind (under a switch post, then its other switch lines), else
    // the same mood from other fan types (haters only borrow from haters and vice versa), else
    // any unused line of his type, else repeat.
    const sw = post.transition ? switchSets(transitions.comments[language], post) : null
    const otherSwitch = sw ? (segment === 'hater' ? sw.hate : [...sw.to, ...sw.from, ...sw.pair]) : []
    const sameMood = SEGMENTS.filter((s) => (s === 'hater') === (segment === 'hater')).flatMap((s) => corpus.segments[s][mood])
    const own = Object.values(corpus.segments[segment]).flat()
    const pool = [fresh(lines), fresh(otherSwitch), fresh(sameMood), fresh(own)].find((l) => l.length) ?? (lines.length ? lines : corpus.segments.regular.casual)
    const line = pick(rng, pool)

    comments.push({
      id: `${post.id}:${i}`,
      day: Math.min(lastDay, post.day + 1 + Math.floor(rng() ** 2 * preset.post.heat.length)),
      segment,
      mood: MOODS.includes(mood) ? mood : 'casual',
      language,
      name,
      handle,
      text: traits.personality === 'lowercase' && language === 'en' ? sloppy(line) : line,
      who: `${preset.segments[segment].label} · ${traitLabel(style ?? traits.personality)}`,
    })
    used.add(line)
  }
  return comments.sort((a, b) => a.day - b.day)
}
