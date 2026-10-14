// Writes ../licenses/bundled.txt: name, version, license and full license text of
// every production dependency (what can end up in dist/). Run: npm run licenses
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dirs = [
  ...new Set(execSync('npm ls --omit=dev --all --parseable', { encoding: 'utf8' }).trim().split('\n').slice(1)),
]

const entries = dirs
  .map((dir) => {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'UNKNOWN'
    const file = existsSync(dir) && readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f))
    const text = file ? readFileSync(join(dir, file), 'utf8').trim() : '(no license file in package)'
    return { id: `${pkg.name}@${pkg.version}`, license, text }
  })
  .sort((a, b) => a.id.localeCompare(b.id))

const out = entries.map((e) => `${'='.repeat(78)}\n${e.id} (${e.license})\n${'='.repeat(78)}\n\n${e.text}\n`).join('\n')
writeFileSync(new URL('../../licenses/bundled.txt', import.meta.url), out)
console.log(`licenses/bundled.txt: ${entries.length} packages`)
