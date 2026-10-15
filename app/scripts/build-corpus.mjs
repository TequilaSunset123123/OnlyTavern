// Builds presets/tags.json and presets/corpus/{en,zh}.json from the raw answers that
// docs/prompts/run-in-st.js saved (onlytavern-gen-*.txt in SillyTavern's user files).
// Usage: node scripts/build-corpus.mjs <folder with onlytavern-gen-*.txt>
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { jsonrepair } from 'jsonrepair'

const dir = process.argv[2]
if (!dir) throw new Error('Usage: node scripts/build-corpus.mjs <folder>')
const out = new URL('../src/presets/', import.meta.url)

const SEGMENTS = ['regular', 'lurker', 'simp', 'whale', 'hater', 'freeloader']
const MOODS = ['praise', 'flirty', 'casual', 'request', 'negative']

function parse(name) {
  const text = readFileSync(join(dir, `onlytavern-gen-${name}.txt`), 'utf8').replace(/^```(json)?|```$/gm, '').trim()
  return JSON.parse(jsonrepair(text))
}

// Lines by key when the model broke the JSON (it sometimes drops a "["): take every
// quoted string after each key, up to the next key.
function parseKeyed(name, ids) {
  try {
    return parse(name)
  } catch {
    const text = readFileSync(join(dir, `onlytavern-gen-${name}.txt`), 'utf8')
    const marks = [...text.matchAll(new RegExp(`"(${ids.join('|')})"\\s*:`, 'g'))]
    console.warn(`  ${name}: broken JSON, reading it line by line`)
    return Object.fromEntries(
      marks.map((m, i) => [m[1], [...text.slice(m.index + m[0].length, marks[i + 1]?.index ?? text.length).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1])]),
    )
  }
}

// Lenient cleanup: strings only, trimmed, no @mentions, no duplicates.
function clean(lines) {
  return [...new Set((Array.isArray(lines) ? lines : []).filter((l) => typeof l === 'string').map((l) => l.replace(/@\w+/g, '').trim()).filter(Boolean))]
}

const tags = parse('tags')
  .filter((t) => t && /^[a-z0-9_]+$/.test(t.id) && t.en && t.zh)
  .map((t) => ({ id: t.id, en: String(t.en).trim(), zh: String(t.zh).trim(), intensity: Math.min(5, Math.max(1, Math.round(Number(t.intensity) || 1))) }))
writeFileSync(new URL('tags.json', out), JSON.stringify(tags, null, 2) + '\n')
console.log(`tags: ${tags.length}`)

mkdirSync(new URL('corpus/', out), { recursive: true })
for (const lang of ['en', 'zh']) {
  const segments = {}
  for (const s of SEGMENTS) {
    const raw = parseKeyed(`comments-${lang}-${s}`, MOODS)
    segments[s] = Object.fromEntries(MOODS.map((m) => [m, clean(raw[m])]))
    const short = MOODS.filter((m) => segments[s][m].length < 20)
    if (short.length) console.warn(`  ${lang}/${s}: few lines for ${short.join(', ')}`)
  }
  const rawTags = parseKeyed(`tagcomments-${lang}`, tags.map((t) => t.id))
  // The provider sometimes refuses explicit tags (it answers with a moderation notice
  // instead of lines): keep the previous lines for those.
  const file = new URL(`corpus/${lang}.json`, out)
  const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).tags ?? {} : {}
  const tagLines = Object.fromEntries(
    tags.map((t) => [t.id, clean(rawTags[t.id]).length ? clean(rawTags[t.id]) : clean(previous[t.id])]).filter(([, l]) => l.length),
  )
  const kept = tags.filter((t) => !clean(rawTags[t.id]).length && tagLines[t.id]).length
  if (kept) console.warn(`  ${lang}: kept previous lines for ${kept} tags the model left out`)
  writeFileSync(new URL(`corpus/${lang}.json`, out), JSON.stringify({ segments, tags: tagLines }, null, 1) + '\n')
  const n = Object.values(segments).flatMap((m) => Object.values(m)).flat().length
  console.log(`${lang}: ${n} comments, tag lines for ${Object.keys(tagLines).length}/${tags.length} tags`)
}
