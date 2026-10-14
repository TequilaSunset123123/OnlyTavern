// Crowd comments (plan.md §4.5): nothing is stored. Each comment is rebuilt from
// (account seed, post, index), so opening a post always shows the same comments,
// and comments that arrive later never change the earlier ones.
import { base, en, Faker, zh_CN } from '@faker-js/faker'
import preset from '../presets/audience.json'
import enCorpus from '../presets/corpus/en.json'
import zhCorpus from '../presets/corpus/zh.json'
import { type Account, MOODS, type Mood, type Post, SEGMENTS, type Segment, type Settings } from '../store/schema'
import { postTags } from './posts'
import { type Rng, rngFor } from './rng'

type Language = 'en' | 'zh'
type Corpus = { segments: Record<Segment, Record<Mood, string[]>>; tags: Record<string, string[]> }
const CORPUS: Record<Language, Corpus> = { en: enCorpus as Corpus, zh: zhCorpus as Corpus }
const FAKERS: Record<Language, Faker> = { en: new Faker({ locale: [en, base] }), zh: new Faker({ locale: [zh_CN, en, base] }) }
const MIX_CHINESE_SHARE = 0.3
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
}

function pickWeighted<T extends string>(rng: Rng, weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][]
  let r = rng() * entries.reduce((a, [, w]) => a + w, 0)
  for (const [k, w] of entries) if ((r -= w) < 0) return k
  return entries[entries.length - 1][0]
}

const pick = <T>(rng: Rng, list: T[]): T => list[Math.floor(rng() * list.length)]

// Who comments: fan types weighted by how common and how chatty they are. Fixed
// weights (not today's audience) so the same comment stays the same tomorrow.
const COMMENTER_WEIGHTS = Object.fromEntries(
  SEGMENTS.map((s) => [s, preset.segments[s].mix * preset.segments[s].commentRate]),
) as Record<Segment, number>

export function generateComments(account: Account, post: Post, settings: Settings): Comment[] {
  const tags = postTags(post, account).filter((t) => CORPUS.en.tags[t] || CORPUS.zh.tags[t])
  const lastDay = Math.max(post.day + 1, Math.min(account.clock.day, post.day + preset.post.heat.length))
  const comments: Comment[] = []

  for (let i = 0; i < Math.min(post.stats.comments, MAX_COMMENTS); i++) {
    const rng = rngFor(account.meta.seed, post.day, `comment:${post.id}:${i}`)
    const segment = pickWeighted(rng, COMMENTER_WEIGHTS)
    const mood = pickWeighted(rng, preset.segments[segment].moods as Record<Mood, number>)
    const language: Language =
      settings.fanLanguage === 'mix' ? (rng() < MIX_CHINESE_SHARE ? 'zh' : 'en') : settings.fanLanguage
    const corpus = CORPUS[language]
    const tagLines = tags.length ? corpus.tags[pick(rng, tags)] : undefined
    const lines = tagLines?.length && rng() < preset.post.tagCommentShare ? tagLines : corpus.segments[segment][mood]

    const faker = FAKERS[language]
    faker.seed(Math.floor(rng() * 2 ** 31))
    const name = language === 'zh' ? faker.person.fullName() : faker.person.firstName()
    FAKERS.en.seed(Math.floor(rng() * 2 ** 31))
    const handle = FAKERS.en.internet.username().toLowerCase()

    comments.push({
      id: `${post.id}:${i}`,
      day: Math.min(lastDay, post.day + 1 + Math.floor(rng() ** 2 * preset.post.heat.length)),
      segment,
      mood: MOODS.includes(mood) ? mood : 'casual',
      language,
      name,
      handle,
      text: pick(rng, lines.length ? lines : corpus.segments.regular.casual),
    })
  }
  return comments.sort((a, b) => a.day - b.day)
}
