// plan.md §9.1 rule 1: the UI only talks to api/, never to engine/ or store/ directly.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '.')
const UI_DIRS = ['ui', 'hooks']

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : []
  })
}

describe('layering', () => {
  it('UI code does not import engine/ or store/', () => {
    const offenders = UI_DIRS.flatMap((d) => files(join(SRC, d)))
      .concat(join(SRC, 'App.tsx'))
      .filter((f) => /from\s+['"][^'"]*\/(engine|store)(\/|['"])/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
