import { describe, expect, it } from 'vitest'
import personas from '../presets/personas.json'
import { createAccount } from '../store/account'
import { migrate } from '../store/migrate'
import { SEGMENTS } from '../store/schema'
import { fanProfile } from './fans'
import { fanIdentity, makePersona, modifiers } from './personas'
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

  it('every type gets a job, a place, a relationship and a personality; simps often obsess, haters always hate', () => {
    for (const segment of SEGMENTS) {
      const people = Array.from({ length: 200 }, (_, i) => makePersona(rngFor('s', i, segment), segment, 'en'))
      for (const p of people) {
        expect(p.bio).toMatch(new RegExp(`^${p.age}, .+ from .+, .+, .+$`))
        expect(p.personality in personas.personalities).toBe(true)
        expect(p.behaviours.every((b) => b in personas.behaviours)).toBe(true)
      }
      if (segment === 'simp') {
        const obsessed = people.filter((p) => p.behaviours.includes('obsessive') || p.behaviours.includes('stalker')).length
        expect(obsessed / people.length).toBeGreaterThan(0.4)
      }
      if (segment === 'hater') expect(people.every((p) => p.personality === 'misogynist' || p.personality === 'troll')).toBe(true)
    }
    // Submissive and misogynist fans are not only haters.
    const whales = Array.from({ length: 300 }, (_, i) => makePersona(rngFor('s', i, 'w'), 'whale', 'en').personality)
    expect(whales).toContain('submissive')
    expect(whales).toContain('misogynist')
    expect(makePersona(rngFor('s', 1, 'x'), 'whale', 'zh').bio).toMatch(/^\d+岁，/)
  })

  it('only behaviours and conditions change the odds; obsessed fans and haters keep writing when ignored', () => {
    expect(modifiers({ behaviours: [], conditions: [] })).toEqual({
      dmFactor: 1,
      maxUnanswered: 0,
      ignoredFactor: 0,
      meetupFactor: 1,
      meetupMinLoyalty: 5,
      meetupDaily: 0,
      meetupCooldownDays: Infinity,
      events: {},
      turnsHater: null,
      haterHalfLifeDays: null,
      fame: 1,
      incidents: 0,
      comesBackAs: [],
    })
    expect(modifiers({ behaviours: ['stalker'], conditions: [] })).toMatchObject({ maxUnanswered: 4, meetupFactor: 2.5 })
    expect(modifiers({ behaviours: ['obsessive'], conditions: [] }).meetupFactor).toBe(2)
    expect(modifiers({ behaviours: ['creepy_compliments'], conditions: [] }).turnsHater).toEqual({ afterDays: 14, daily: 0.08 })
    expect(modifiers({ behaviours: [], conditions: [{ id: 'unhinged', since: 0 }] }).incidents).toBe(2)
    // A personality is words only: a misogynist whale writes as often as any whale.
    const a = simulate(createAccount({ id: 'x', seed: 'p', now: 0, name: 'Mia', handle: 'mia' }), 60, 'p').account
    const r = { ...a.regulars[0], segment: 'whale' as const, behaviours: [], conditions: [] }
    expect(fanProfile({ ...r, personality: 'misogynist' })).toEqual(fanProfile({ ...r, personality: 'shy' }))
    // A hater keeps going when ignored (his type), and so does a hostile fan (he acts as one).
    expect(fanProfile({ ...r, segment: 'hater' }).dm.maxUnanswered).toBe(3)
    expect(fanProfile({ ...r, conditions: [{ id: 'hostile', since: 0, level: 1 }] }).dm.maxUnanswered).toBe(3)
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

describe('what fans like (2026-10-16)', () => {
  it('bossy and misogynist fans like domination, degradation and BDSM; submissive ones femdom', () => {
    const a = simulate(createAccount({ id: 'x', seed: 'k', now: 0, name: 'Mia', handle: 'mia' }), 200, 'k', { fanLanguage: 'en', connectionProfile: null }).account
    const kink = (r: (typeof a.regulars)[number]) => r.likes.some((t) => ['bdsm', 'degradation', 'domination', 'femdom'].includes(t))
    const into = a.regulars.filter((r) => ['dominant', 'misogynist', 'submissive'].includes(r.personality))
    const rest = a.regulars.filter((r) => !['dominant', 'misogynist', 'submissive', 'negging'].includes(r.personality))
    expect(into.length).toBeGreaterThan(2)
    expect(into.filter(kink).length / into.length).toBeGreaterThan(0.6)
    expect(into.filter(kink).length / into.length).toBeGreaterThan(rest.filter(kink).length / Math.max(1, rest.length))
  })
})

describe('ignored fans turn on you', () => {
  it('ignored fans become haters, obsessed ones much sooner; talking to them again wins them back', () => {
    let turned = 0
    let hornyTurned = 0
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      let a = simulate(createAccount({ id: 'x', seed, now: 0, name: 'Mia', handle: 'mia' }), 60, seed).account
      // Half of them obsessed, half just horny; nobody gets an answer.
      a = { ...a, regulars: a.regulars.map((r, i) => ({ ...r, segment: 'simp' as const, personality: 'horny_direct', behaviours: i % 2 ? [] : ['obsessive'], conditions: [] })) }
      const ids = new Set(a.regulars.filter((r) => r.behaviours.includes('obsessive')).map((r) => r.id))
      const horny = new Set(a.regulars.filter((r) => !r.behaviours.length).map((r) => r.id))
      const after = simulate(a, 25, seed).account
      // Only the fans set up above: new ones may arrive meanwhile with anything.
      for (const r of after.regulars.filter((x) => ids.has(x.id) || horny.has(x.id))) {
        const hostile = r.conditions.find((c) => c.id === 'hostile')
        if (!hostile) continue
        if (horny.has(r.id)) hornyTurned++
        else turned++
        // He keeps his type, personality and behaviours; the condition makes him a hater.
        expect(r).toMatchObject({ segment: 'simp', personality: 'horny_direct' })
        const t = after.threads.find((x) => x.regularId === r.id)!
        expect(t.messages.some((m) => m.intent?.topic === 'harass' && m.day === hostile.since)).toBe(true)
        expect(after.events.some((e) => e.type === 'regular-turned' && e.regularId === r.id)).toBe(true)

        // Win him back: write to him every day.
        let b = after
        const isHostile = (acc: typeof b) => acc.regulars.find((x) => x.id === r.id)!.conditions.some((c) => c.id === 'hostile')
        for (let i = 0; i < 20 && isHostile(b); i++) {
          b = simulate(sendDm(b, r.id, { text: 'sorry, missed you' }, seed).account, 1, seed).account
        }
        const back = b.regulars.find((x) => x.id === r.id)!
        expect(back).toMatchObject({ segment: 'simp', personality: 'horny_direct', behaviours: horny.has(r.id) ? [] : ['obsessive'], conditions: [] })
        expect(b.events.some((e) => e.type === 'regular-back' && e.regularId === r.id)).toBe(true)
      }
    }
    expect(turned).toBeGreaterThan(0)
    // A plain simp turns too (after two weeks), but obsessed ones far more often.
    expect(turned).toBeGreaterThan(hornyTurned * 2)
  })
})

describe('schema 6', () => {
  it('gives the regulars of an older save a new identity and a personality, keeping everything else', () => {
    let a = simulate(createAccount({ id: 'x', seed: 'b', now: 0, name: 'Mia', handle: 'mia' }), 60, 'b').account
    const r0 = a.regulars[0]
    a = sendDm(a, r0.id, { text: 'hi' }, 'b').account
    const old = {
      ...a,
      meta: { ...a.meta, schemaVersion: 5 },
      regulars: a.regulars.map(({ personality: _, behaviours: __, conditions: ___, ...r }) => ({ ...r, name: 'Stephanie', handle: 'stephanie_rippin', bio: 'senior solutions supervisor' })),
    }
    const up = migrate(old)
    expect(up.regulars).toHaveLength(a.regulars.length)
    for (const [i, r] of up.regulars.entries()) {
      expect(r.name).not.toBe('Stephanie')
      expect(r.personality in personas.personalities).toBe(true)
      // Identity is new; loyalty is rebuilt from what you two did, so it matches what was earned.
      const blank = { name: '', handle: '', bio: '', age: 0, country: '', personality: '', behaviours: [], conditions: [], relationship: '' }
      expect({ ...r, ...blank }).toEqual({ ...a.regulars[i], ...blank })
    }
    expect(up.threads).toEqual(a.threads)
  })
})

describe('schema 11', () => {
  it('splits old traits into personality, behaviours and conditions', () => {
    const a = simulate(createAccount({ id: 'x', seed: 'c', now: 0, name: 'Mia', handle: 'mia' }), 90, 'c').account
    const [r0, r1, r2] = a.regulars
    const old = (r: (typeof a.regulars)[number], patch: object) => {
      const { personality: _, behaviours: __, conditions: ___, ...rest } = r
      return { ...rest, ...patch }
    }
    const v10 = {
      ...a,
      meta: { ...a.meta, schemaVersion: 10 },
      regulars: [
        // A stalker who turned (misogynist came with turning) and got blocked.
        old(r0, { segment: 'hater', traits: ['pet_names', 'stalker', 'misogynist'], turned: { from: 'simp', day: 5, trait: 'misogynist', level: 2 }, away: { reason: 'blocked', day: 9 } }),
        // Creepy was his way of writing; now a behaviour, so he gets a personality from his type.
        old(r1, { segment: 'regular', traits: ['creepy_compliments', 'unhinged'], away: { reason: 'wife', day: 3, until: a.clock.day + 5 } }),
        // Lying low is over.
        old(r2, { segment: 'whale', traits: ['dominant'], away: { reason: 'wife', day: 3, until: a.clock.day - 1 } }),
        ...a.regulars.slice(3).map((r) => old(r, { traits: [r.personality, ...r.behaviours] })),
      ],
    }
    const [x0, x1, x2] = migrate(v10).regulars
    expect(x0).toMatchObject({ segment: 'simp', personality: 'pet_names', behaviours: ['stalker'] })
    expect(x0.conditions).toEqual([
      { id: 'hostile', since: 5, level: 2 },
      { id: 'blocked', since: 9, by: 'you' },
    ])
    expect(x1.personality in personas.segments.regular.personalities).toBe(true)
    expect(x1.behaviours).toEqual(['creepy_compliments'])
    expect(x1.conditions).toEqual([
      { id: 'unhinged', since: r1.since },
      { id: 'lyingLow', since: 3, until: a.clock.day + 5 },
    ])
    expect(x2).toMatchObject({ personality: 'dominant', behaviours: [], conditions: [] })
    expect('traits' in x0 || 'turned' in x0 || 'away' in x0).toBe(false)
  })
})

describe('schema 13', () => {
  it('an entitled fan from the build before becomes a freeloader and keeps Entitled', () => {
    const a = simulate(createAccount({ id: 'x', seed: 'c', now: 0, name: 'Mia', handle: 'mia' }), 90, 'c').account
    const r0 = a.regulars[0]
    const v12 = {
      ...a,
      meta: { ...a.meta, schemaVersion: 12 },
      regulars: a.regulars.map((r, i) => (i === 0 ? { ...r, segment: 'whale', conditions: [{ id: 'entitled', since: 30 }] } : r)),
      events: [...a.events, { day: 30, type: 'regular-entitled', regularId: r0.id }],
    }
    const up = migrate(v12)
    expect(up.regulars[0]).toMatchObject({ segment: 'freeloader', conditions: [{ id: 'entitled', since: 30 }] })
    expect(up.events.at(-1)).toEqual({ day: 30, type: 'regular-entitled', regularId: r0.id, from: 'whale' })
  })
})
