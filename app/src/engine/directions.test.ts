import { describe, expect, it } from 'vitest'
import D from '../presets/directions.json'
import tags from '../presets/tags.json'
import transitions from '../presets/transitions.json'
import { createAccount } from '../store/account'
import { migrate } from '../store/migrate'
import { type Account, DIRECTIONS, type DirectionId } from '../store/schema'
import { subscriberCount } from './audience'
import { generateComments } from './comments'
import { addVaultItem, publishPost } from './content'
import { levelUpForTesting } from './dev'
import { directionEffects, directionInfo, LEVEL_PERKS, levelOf, platformFee, setDirection } from './directions'
import { makePersona } from './personas'
import { rngFor } from './rng'
import { simulate } from './simulate'

const fresh = (direction?: DirectionId, seed = 'a') => createAccount({ id: 'x', seed, now: 0, name: 'Mia', handle: 'mia', direction })
const withPoints = (a: Account, points: number) => ({ ...a, direction: { ...a.direction, points: { ...a.direction.points, [a.direction.id]: points } } })

describe('platform fee by level (2026-10-17)', () => {
  it('the platform takes more the higher your level: 20% at level 1, then 30, 40, 50, 60%', () => {
    let a = createAccount({ id: 'x', seed: 'fee', now: 0, name: 'Mia', handle: 'mia' })
    const fees = [platformFee(a)]
    for (let i = 0; i < 4; i++) {
      a = levelUpForTesting(a)
      fees.push(platformFee(a))
    }
    expect(fees).toEqual([0.2, 0.3, 0.4, 0.5, 0.6])
    expect(LEVEL_PERKS.fee).toEqual(fees)
  })

  it("what the crowd pays is cut at your level's rate", () => {
    const base = { ...createAccount({ id: 'x', seed: 'fee', now: 0, name: 'Mia', handle: 'mia' }) }
    const at = (levels: number) => {
      let a = base
      for (let i = 0; i < levels; i++) a = levelUpForTesting(a)
      const b = simulate({ ...a, events: [] }, 10, 'fee').account
      return b.ledger.filter((l) => l.kind === 'subscription' || l.kind === 'renewal')
    }
    for (const [levels, rate] of [[0, 0.2], [2, 0.4]] as const) {
      const lines = at(levels)
      expect(lines.length).toBeGreaterThan(0)
      for (const l of lines) expect(l.fee).toBe(Math.round(l.gross * rate))
    }
  })
})

describe('directions', () => {
  it('the preset covers every direction, with real tags and five titles', () => {
    expect(Object.keys(D.directions).sort()).toEqual([...DIRECTIONS].sort())
    const ids = new Set(tags.map((t) => t.id))
    for (const d of Object.values(D.directions)) {
      expect(d.signatureTags.every((t) => ids.has(t))).toBe(true)
      expect(d.titles).toHaveLength(5)
    }
  })

  it('a new account starts with the direction you pick; without one it is girl next door, not yet chosen', () => {
    expect(fresh('egirl').direction).toMatchObject({ id: 'egirl', chosen: true })
    expect(fresh().direction).toMatchObject({ id: 'girl_next_door', chosen: false })
  })

  it('posts earn points for every direction whose tags they carry, and level up the current one', () => {
    let a = fresh('egirl')
    a = addVaultItem(a, 'v1', { description: 'maid cosplay with a voice note', tags: ['cosplay', 'voice_note', 'feet', 'roleplay'], intensity: 2, cast: 'me' })
    a = publishPost(a, 'p1', { text: '', vaultIds: ['v1'], access: 'free', priceCents: 0 })
    expect(a.direction.points.egirl).toBe(3) // capped at 3 a post
    expect(a.direction.points.escort).toBe(0)
    for (let i = 2; i <= 4; i++) a = publishPost(a, `p${i}`, { text: '', vaultIds: ['v1'], access: 'free', priceCents: 0 })
    expect(a.direction.points.egirl).toBe(12)
    expect(levelOf(12)).toBe(2)
    expect(a.events.filter((e) => e.type === 'level-up')).toEqual([{ day: 0, type: 'level-up', direction: 'egirl', level: 2 }])
    expect(directionInfo(a, 'egirl')).toMatchObject({ level: 2, title: 'Discord kitten', from: 10, next: 35 })
  })

  it('the first pick is free; switching later loses about half the subscribers and keeps the points', () => {
    const grown = simulate(fresh(), 60).account
    const before = subscriberCount(grown.audience)
    const picked = setDirection(grown, 'escort', 's')
    expect(subscriberCount(picked.account.audience)).toBe(before)
    expect(picked.account.direction).toMatchObject({ id: 'escort', chosen: true })
    const scored = { ...picked.account, direction: { ...picked.account.direction, points: { ...picked.account.direction.points, escort: 40 } } }
    const switched = setDirection(scored, 'porn_star', 's')
    const after = subscriberCount(switched.account.audience)
    expect(after).toBeLessThan(before * 0.65)
    expect(after).toBeGreaterThan(before * 0.35)
    expect(switched.events).toEqual([{ day: 60, type: 'direction', direction: 'porn_star', lost: before - after }])
    expect(switched.account.direction.points.escort).toBe(40)
    expect(setDirection(switched.account, 'porn_star', 's').account).toBe(switched.account)
  })

  it('switching posts an announcement for you, and fans comment on the switch', () => {
    const base = simulate(createAccount({ id: 'x', seed: 's', now: 0, name: 'Mia', handle: 'mia' }), 40, 's').account
    const picked = setDirection(base, 'girl_next_door', 's').account
    expect(picked.posts).toHaveLength(base.posts.length) // the first pick is not a switch
    for (const language of ['en', 'zh'] as const) {
      const switched = setDirection(picked, 'escort', 's', language).account
      const post = switched.posts[0]
      expect(post).toMatchObject({ day: base.clock.day, vaultIds: [], access: 'free', transition: { from: 'girl_next_door', to: 'escort' } })
      expect(transitions.posts[language]['girl_next_door>escort']).toContain(post.text)
      // A few days later the comments (say 20 of them: the switch has about that many lines) are about the switch.
      const later = simulate(switched, 3, 's').account
      const seen = later.posts.find((p) => p.id === post.id)!
      expect(seen.stats.views).toBeGreaterThan(0)
      const comments = generateComments(later, { ...seen, stats: { ...seen.stats, comments: 20 } }, { fanLanguage: language })
      expect(comments).toHaveLength(20)
      const c = transitions.comments[language]
      // Sloppy typers lowercase the line and drop its punctuation.
      const plain = (text: string) => text.toLowerCase().replace(/[.,!?;:'’]/g, '')
      const switchLines = new Set([...c.to.escort, ...c.from.girl_next_door, ...c.hate.escort, ...c.pair['girl_next_door>escort']].map(plain))
      expect(comments.filter((x) => switchLines.has(plain(x.text))).length / comments.length).toBeGreaterThan(0.8)
    }
    // Every switch has its posts and remarks, in both languages.
    for (const from of DIRECTIONS) for (const to of DIRECTIONS) {
      if (from === to) continue
      for (const language of ['en', 'zh'] as const) {
        expect(transitions.posts[language][`${from}>${to}` as keyof (typeof transitions.posts)['en']].length).toBeGreaterThanOrEqual(3)
        expect(transitions.comments[language].pair[`${from}>${to}` as keyof (typeof transitions.comments)['en']['pair']].length).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('effects grow with the level', () => {
    const low = directionEffects(fresh('escort'))
    const high = directionEffects(withPoints(fresh('escort'), 500))
    expect(low.mix.whale).toBeCloseTo(1 + 3.5 * 0.4)
    expect(high.mix.whale).toBeCloseTo(4.5)
    expect(high.meetups.rate).toBeGreaterThan(low.meetups.rate)
    expect(high.mix.freeloader).toBeLessThan(low.mix.freeloader)
  })

  it('shapes who subscribes: escorts get whales, e-girls get simps, porn stars get more of everyone', () => {
    const subs = (d: DirectionId, s: Parameters<typeof subscriberCount>[1]) => {
      let n = 0
      for (const seed of ['a', 'b', 'c']) n += subscriberCount(simulate(withPoints(fresh(d, seed), 200), 90, seed).account.audience, s)
      return n
    }
    const share = (d: DirectionId, s: Parameters<typeof subscriberCount>[1]) => subs(d, s) / subs(d, undefined)
    expect(share('escort', 'whale')).toBeGreaterThan(share('girl_next_door', 'whale') * 2)
    expect(share('egirl', 'simp')).toBeGreaterThan(share('girl_next_door', 'simp') * 1.5)
    expect(subs('porn_star', undefined)).toBeGreaterThan(subs('girl_next_door', undefined))
    expect(subs('porn_star', 'hater')).toBeGreaterThan(subs('girl_next_door', 'hater'))
  })

  it('e-girls attract obsessed fans', () => {
    const obsessed = (factors: Record<string, number>) =>
      Array.from({ length: 400 }, (_, i) => makePersona(rngFor('s', i, 'p'), 'simp', 'en', factors)).filter((p) => p.behaviours.includes('obsessive')).length
    expect(obsessed(directionEffects(withPoints(fresh('egirl'), 200)).attracts)).toBeGreaterThan(obsessed({}) * 1.3)
  })

  it('subs draw haters, freeloaders and misogynists; dominatrixes whales, simps and submissive men (2026-10-16)', () => {
    const subs = (d: DirectionId, s: Parameters<typeof subscriberCount>[1]) => {
      let n = 0
      for (const seed of ['a', 'b', 'c']) n += subscriberCount(simulate(withPoints(fresh(d, seed), 200), 90, seed).account.audience, s)
      return n
    }
    const share = (d: DirectionId, s: Parameters<typeof subscriberCount>[1]) => subs(d, s) / subs(d, undefined)
    expect(share('sub', 'hater')).toBeGreaterThan(share('girl_next_door', 'hater') * 1.5)
    expect(share('sub', 'freeloader')).toBeGreaterThan(share('girl_next_door', 'freeloader') * 1.4)
    expect(share('domme', 'whale')).toBeGreaterThan(share('girl_next_door', 'whale') * 1.6)
    expect(share('domme', 'simp')).toBeGreaterThan(share('girl_next_door', 'simp') * 1.5)
    const styles = (d: DirectionId, segment: 'regular' | 'simp', id: string) =>
      Array.from({ length: 400 }, (_, i) => makePersona(rngFor('s', i, 'p'), segment, 'en', directionEffects(withPoints(fresh(d), 200)).attracts)).filter((p) => p.personality === id || p.behaviours.includes(id)).length
    expect(styles('sub', 'regular', 'misogynist')).toBeGreaterThan(styles('girl_next_door', 'regular', 'misogynist') * 2)
    expect(styles('domme', 'simp', 'submissive')).toBeGreaterThan(styles('girl_next_door', 'simp', 'submissive') * 2)
    expect(styles('domme', 'simp', 'creepy_compliments')).toBeGreaterThan(styles('girl_next_door', 'simp', 'creepy_compliments') * 1.4)
  })

  it('every level brings more visitors and DMs, whatever the direction; the dev button levels you up (2026-10-16)', () => {
    let a = fresh('girl_next_door')
    expect(directionEffects(a)).toMatchObject({ visitors: 1, dms: 1 })
    for (let i = 0; i < 4; i++) a = levelUpForTesting(a)
    expect(levelOf(a.direction.points.girl_next_door)).toBe(5)
    expect(levelUpForTesting(a)).toBe(a)
    expect(a.events.filter((e) => e.type === 'level-up').map((e) => e.type === 'level-up' && e.level)).toEqual([2, 3, 4, 5])
    expect(directionEffects(a)).toMatchObject({ visitors: 1.8, dms: 1.6 })
    // In play: more visitors and more regulars writing.
    const run = (acc: Account) => simulate(acc, 60, 'lv').account
    const low = run(fresh('girl_next_door', 'lv'))
    const high = run(a)
    const visits = (acc: Account) => acc.history.reduce((s, h) => s + h.visitors, 0)
    expect(visits(high)).toBeGreaterThan(visits(low) * 1.4)
  })

  it('saves from before Sub and Dominatrix get them with no points (schema 12)', () => {
    const a = withPoints(fresh('escort'), 40)
    const { sub: _, domme: __, ...old } = a.direction.points
    const up = migrate({ ...a, meta: { ...a.meta, schemaVersion: 11 }, direction: { ...a.direction, points: old } })
    expect(up.direction.points).toMatchObject({ escort: 40, sub: 0, domme: 0 })
  })

  it('older saves start as girl next door, not yet chosen, with no points', () => {
    const { direction: _, ...rest } = fresh()
    const up = migrate({ ...rest, meta: { ...rest.meta, schemaVersion: 6 } })
    expect(up.direction).toEqual({ id: 'girl_next_door', chosen: false, points: Object.fromEntries(DIRECTIONS.map((d) => [d, 0])) })
  })
})
