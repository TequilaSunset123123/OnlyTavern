import { describe, expect, it } from 'vitest'
import D from '../presets/directions.json'
import tags from '../presets/tags.json'
import { createAccount } from '../store/account'
import { migrate } from '../store/migrate'
import { type Account, DIRECTIONS, type DirectionId } from '../store/schema'
import { subscriberCount } from './audience'
import { addVaultItem, publishPost } from './content'
import { directionEffects, directionInfo, levelOf, setDirection } from './directions'
import { makePersona } from './personas'
import { rngFor } from './rng'
import { simulate } from './simulate'

const fresh = (direction?: DirectionId, seed = 'a') => createAccount({ id: 'x', seed, now: 0, name: 'Mia', handle: 'mia', direction })
const withPoints = (a: Account, points: number) => ({ ...a, direction: { ...a.direction, points: { ...a.direction.points, [a.direction.id]: points } } })

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
      Array.from({ length: 400 }, (_, i) => makePersona(rngFor('s', i, 'p'), 'simp', 'en', factors)).filter((p) => p.traits.includes('obsessive')).length
    expect(obsessed(directionEffects(withPoints(fresh('egirl'), 200)).traits)).toBeGreaterThan(obsessed({}) * 1.3)
  })

  it('older saves start as girl next door, not yet chosen, with no points', () => {
    const { direction: _, ...rest } = fresh()
    const up = migrate({ ...rest, meta: { ...rest.meta, schemaVersion: 6 } })
    expect(up.direction).toEqual({ id: 'girl_next_door', chosen: false, points: Object.fromEntries(DIRECTIONS.map((d) => [d, 0])) })
  })
})
