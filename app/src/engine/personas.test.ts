import { describe, expect, it } from 'vitest'
import personas from '../presets/personas.json'
import { createAccount } from '../store/account'
import { migrate } from '../store/migrate'
import { SEGMENTS } from '../store/schema'
import { dmBehaviour, fanIdentity, makePersona } from './personas'
import { sendDm } from './regulars'
import { rngFor } from './rng'
import { simulate } from './simulate'

const MEN_EN = new Set(personas.en.firstNames)
const MEN_ZH = personas.zh.surnames.map((s) => s.zh)

describe('fan personas', () => {
  it('are men only, from our own name lists, with a matching handle', () => {
    for (let i = 0; i < 300; i++) {
      const en = fanIdentity(rngFor('s', i, 'id'), 'en')
      expect(MEN_EN.has(en.name)).toBe(true)
      expect(en.handle).toMatch(/^[a-z0-9_]+$/)
      expect(en.handle).toContain(en.name.toLowerCase())
      const zh = fanIdentity(rngFor('s', i, 'id'), 'zh')
      expect(MEN_ZH.some((s) => zh.name.includes(s))).toBe(true)
    }
  })

  it('every type gets a job, a place, a relationship and a way of writing; simps often obsess, haters always hate', () => {
    for (const segment of SEGMENTS) {
      const people = Array.from({ length: 200 }, (_, i) => makePersona(rngFor('s', i, segment), segment, 'en'))
      for (const p of people) {
        expect(p.bio).toMatch(new RegExp(`^${p.age}, .+ from .+, .+, .+$`))
        expect(p.traits.length).toBeGreaterThan(0)
      }
      if (segment === 'simp') {
        const obsessed = people.filter((p) => p.traits.includes('obsessive') || p.traits.includes('stalker')).length
        expect(obsessed / people.length).toBeGreaterThan(0.4)
      }
      if (segment === 'hater') expect(people.every((p) => p.traits[0] === 'misogynist' || p.traits[0] === 'troll')).toBe(true)
    }
    expect(makePersona(rngFor('s', 1, 'x'), 'whale', 'zh').bio).toMatch(/^\d+岁，/)
  })

  it('obsessed fans and haters keep writing when ignored', () => {
    expect(dmBehaviour(['pet_names'])).toEqual({ dmFactor: 1, maxUnanswered: 2, ignoredFactor: 0.3 })
    expect(dmBehaviour(['pet_names', 'stalker']).maxUnanswered).toBe(4)
    expect(dmBehaviour(['misogynist']).maxUnanswered).toBe(3)
  })

  it('haters message you to insult you', () => {
    let haterOpeners = 0
    for (const seed of ['a', 'b', 'c', 'd']) {
      const a = simulate(createAccount({ id: 'x', seed, now: 0, name: 'Mia', handle: 'mia' }), 120, seed).account
      for (const r of a.regulars.filter((x) => x.segment === 'hater')) {
        const t = a.threads.find((x) => x.regularId === r.id)!
        haterOpeners += t.messages.filter((m) => m.intent?.topic === 'harass').length
      }
    }
    expect(haterOpeners).toBeGreaterThan(0)
  })
})

describe('schema 6', () => {
  it('gives the regulars of an older save a new identity and traits, keeping everything else', () => {
    let a = simulate(createAccount({ id: 'x', seed: 'b', now: 0, name: 'Mia', handle: 'mia' }), 60, 'b').account
    const r0 = a.regulars[0]
    a = sendDm(a, r0.id, { text: 'hi' }, 'b').account
    const old = {
      ...a,
      meta: { ...a.meta, schemaVersion: 5 },
      regulars: a.regulars.map(({ traits: _, ...r }) => ({ ...r, name: 'Stephanie', handle: 'stephanie_rippin', bio: 'senior solutions supervisor' })),
    }
    const up = migrate(old)
    expect(up.regulars).toHaveLength(a.regulars.length)
    for (const [i, r] of up.regulars.entries()) {
      expect(r.name).not.toBe('Stephanie')
      expect(r.traits.length).toBeGreaterThan(0)
      expect({ ...r, name: '', handle: '', bio: '', age: 0, country: '', traits: [] }).toEqual({ ...a.regulars[i], name: '', handle: '', bio: '', age: 0, country: '', traits: [] })
    }
    expect(up.threads).toEqual(a.threads)
  })
})
