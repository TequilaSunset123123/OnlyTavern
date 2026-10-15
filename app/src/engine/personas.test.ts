import { describe, expect, it } from 'vitest'
import personas from '../presets/personas.json'
import { createAccount } from '../store/account'
import { migrate } from '../store/migrate'
import { SEGMENTS } from '../store/schema'
import { behaviour, fanIdentity, makePersona } from './personas'
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

  it('obsessed fans and haters keep writing when ignored; obsessed fans and stalkers want to meet', () => {
    expect(behaviour(['pet_names'])).toEqual({ dmFactor: 1, maxUnanswered: 2, ignoredFactor: 0.3, meetupFactor: 1, meetupMinLoyalty: 5, events: {}, turnsHater: null })
    expect(behaviour(['pet_names', 'stalker'])).toMatchObject({ maxUnanswered: 4, meetupFactor: 2.5 })
    expect(behaviour(['obsessive']).meetupFactor).toBe(2)
    expect(behaviour(['misogynist']).maxUnanswered).toBe(3)
    expect(behaviour(['creepy_compliments']).turnsHater).toEqual({ afterDays: 14, daily: 0.08 })
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

describe('ignored fans turn on you', () => {
  it('creepy and obsessed fans you ignore become haters; others do not; talking to them again wins them back', () => {
    let turned = 0
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      let a = simulate(createAccount({ id: 'x', seed, now: 0, name: 'Mia', handle: 'mia' }), 60, seed).account
      // Half of them obsessed, half just horny; nobody gets an answer.
      a = { ...a, regulars: a.regulars.map(({ turned: _, ...r }, i) => ({ ...r, segment: 'simp' as const, traits: i % 2 ? ['horny_direct'] : ['obsessive'] })) }
      const ids = new Set(a.regulars.filter((r) => r.traits.includes('obsessive')).map((r) => r.id))
      const horny = new Set(a.regulars.filter((r) => r.traits.includes('horny_direct')).map((r) => r.id))
      const after = simulate(a, 25, seed).account
      // Only the fans set up above: new ones may arrive meanwhile with any traits.
      for (const r of after.regulars.filter((x) => ids.has(x.id) || horny.has(x.id))) {
        if (horny.has(r.id)) {
          expect(r.turned).toBeUndefined()
          continue
        }
        if (!r.turned) continue
        turned++
        expect(r).toMatchObject({ segment: 'hater', turned: { from: 'simp' } })
        expect(r.traits).toContain('misogynist')
        const t = after.threads.find((x) => x.regularId === r.id)!
        expect(t.messages.some((m) => m.intent?.topic === 'harass' && m.day === r.turned!.day)).toBe(true)
        expect(after.events.some((e) => e.type === 'regular-turned' && e.regularId === r.id)).toBe(true)

        // Win him back: write to him every day.
        let b = after
        for (let i = 0; i < 20 && b.regulars.find((x) => x.id === r.id)!.turned; i++) {
          b = simulate(sendDm(b, r.id, { text: 'sorry, missed you' }, seed).account, 1, seed).account
        }
        const back = b.regulars.find((x) => x.id === r.id)!
        expect(back).toMatchObject({ segment: 'simp', traits: ['obsessive'] })
        expect(back.turned).toBeUndefined()
        expect(b.events.some((e) => e.type === 'regular-back' && e.regularId === r.id)).toBe(true)
      }
    }
    expect(turned).toBeGreaterThan(0)
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
      // Identity is new; loyalty is rebuilt from what you two did, so it matches what was earned.
      const blank = { name: '', handle: '', bio: '', age: 0, country: '', traits: [], relationship: '' }
      expect({ ...r, ...blank }).toEqual({ ...a.regulars[i], ...blank })
    }
    expect(up.threads).toEqual(a.threads)
  })
})
