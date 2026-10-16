import { describe, expect, it } from 'vitest'
import personas from '../presets/personas.json'
import { createAccount } from '../store/account'
import type { Account, Regular } from '../store/schema'
import { ghostRule, haterFame, haterHalfLife, simulateHatersDay, turnHater, winBackRule } from './haters'
import { meetupOdds } from './meetups'
import { sendDm } from './regulars'
import { simulate } from './simulate'

const grown = (seed = 'a') => simulate(createAccount({ id: 'x', seed, now: 0, name: 'TestCreator', handle: 'test' }), 60, seed).account
const set = (a: Account, id: string, patch: Partial<Regular>): Account => ({ ...a, regulars: a.regulars.map((r) => (r.id === id ? { ...r, ...patch } : r)) })
const reg = (a: Account, id: string) => a.regulars.find((r) => r.id === id)!
const plain = (r: Regular): Regular => {
  const { turned: _, away: __, ...rest } = r
  return rest
}

describe('ghosting', () => {
  it('the more loyal he is, the longer he waits and the less likely he turns', () => {
    const r = plain(grown().regulars[0])
    const cold = ghostRule({ ...r, segment: 'simp', traits: ['horny_direct'], loyalty: 0 })!
    const fanatic = ghostRule({ ...r, segment: 'simp', traits: ['horny_direct'], loyalty: 100 })!
    expect(cold).toEqual(personas.segments.simp.fan.ghosted)
    expect(fanatic.afterDays).toBe(cold.afterDays + 14)
    expect(fanatic.daily).toBeCloseTo(cold.daily * 0.08)
    // Lurkers never turn; obsessed fans turn faster than their type.
    expect(ghostRule({ ...r, segment: 'lurker', traits: ['shy'], loyalty: 0 })).toBeNull()
    expect(ghostRule({ ...r, segment: 'simp', traits: ['obsessive'], loyalty: 0 })!.afterDays).toBe(10)
  })

  it('in play: ignored cold fans turn far more often than ignored devoted ones', () => {
    const turned = (loyalty: number) => {
      let n = 0
      for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
        let a = grown(seed)
        // Obsessed simps who just arrived (so none goes dormant at once), all ignored from now on.
        a = { ...a, regulars: a.regulars.map((r) => ({ ...plain(r), segment: 'simp' as const, traits: ['obsessive'], loyalty, status: 'active' as const, since: a.clock.day })) }
        const ids = new Set(a.regulars.map((r) => r.id))
        n += simulate(a, 40, seed).account.regulars.filter((r) => ids.has(r.id) && r.turned).length
      }
      return n
    }
    expect(turned(0)).toBeGreaterThan(turned(40) * 2)
  })
})

describe('haters', () => {
  const turnedFan = (patch: Partial<Regular>, level?: number) => {
    const a = grown()
    const id = a.regulars[0].id
    const acc = set(a, id, { ...plain(a.regulars[0]), status: 'active', ...patch })
    const t = turnHater(acc, reg(acc, id), acc.clock.day)
    return { acc: level ? set(t.account, id, { turned: { ...reg(t.account, id).turned!, level } }) : t.account, id }
  }

  it('one who was Devoted or more stays a hater twice as long; a stalker longest', () => {
    const plainOne = turnedFan({ segment: 'regular', traits: ['horny_direct'], loyalty: 10 })
    const devoted = turnedFan({ segment: 'regular', traits: ['horny_direct'], loyalty: 40 })
    const stalker = turnedFan({ segment: 'simp', traits: ['stalker'], loyalty: 10 })
    expect(reg(devoted.acc, devoted.id).turned!.level).toBe(4)
    expect(haterHalfLife(reg(plainOne.acc, plainOne.id))).toBe(personas.segments.regular.fan.asHater.halfLifeDays)
    expect(haterHalfLife(reg(devoted.acc, devoted.id))).toBe(personas.segments.regular.fan.asHater.halfLifeDays * 2)
    expect(haterHalfLife(reg(stalker.acc, stalker.id))).toBe(30)
  })

  it('haters give up over time: half within their half-life', () => {
    const left = (patch: Partial<Regular>, days: number) => {
      let n = 0
      for (let i = 0; i < 40; i++) {
        let { acc, id } = turnedFan(patch)
        for (let d = 1; d <= days; d++) acc = simulateHatersDay(acc, `h${i}`, acc.clock.day + d).account
        if (reg(acc, id).status === 'dormant') n++
      }
      return n / 40
    }
    // A plain regular (half-life 6 days) is mostly gone after two weeks; a stalker (30) mostly is not.
    expect(left({ segment: 'regular', traits: ['horny_direct'], loyalty: 0 }, 14)).toBeGreaterThan(0.6)
    expect(left({ segment: 'simp', traits: ['stalker'], loyalty: 0 }, 14)).toBeLessThan(0.5)
  })

  it('every hater at it keeps some visitors away; stalkers more; capped', () => {
    const a = grown()
    // Six regulars and their threads (copies of the first).
    const r0 = plain(a.regulars[0])
    const t0 = a.threads.find((t) => t.regularId === r0.id)!
    const six = Array.from({ length: 6 }, (_, i) => ({ ...r0, id: `f${i}`, segment: 'regular' as const, traits: ['horny_direct'], status: 'active' as const }))
    const clean = { ...a, regulars: six, threads: six.map((r) => ({ ...t0, regularId: r.id, messages: [] })) }
    expect(haterFame(clean)).toBe(1)
    const three = { ...clean, regulars: clean.regulars.map((r, i) => (i < 3 ? { ...r, segment: 'hater' as const, traits: ['misogynist'] } : r)) }
    expect(haterFame(three)).toBeCloseTo(1 - 3 * 0.03)
    const stalkers = { ...clean, regulars: clean.regulars.map((r, i) => (i < 3 ? { ...r, segment: 'hater' as const, traits: ['stalker'] } : r)) }
    expect(haterFame(stalkers)).toBeLessThan(haterFame(three))
    const many = { ...clean, regulars: Array.from({ length: 30 }, (_, i) => ({ ...r0, id: `h${i}`, segment: 'hater' as const, traits: ['unhinged'], status: 'active' as const })) }
    expect(haterFame(many)).toBeCloseTo(0.7)
    // In play: the same days with haters around bring fewer visitors.
    const visitors = (acc: Account) => simulate(acc, 10, 'v').account.history.slice(-10).reduce((s, h) => s + h.visitors, 0)
    expect(visitors(stalkers)).toBeLessThan(visitors(clean))
  })

  it('a whale needs more making up to; a stalker comes back unhinged and more dangerous to meet', () => {
    expect(winBackRule(reg(turnedFan({ segment: 'whale', traits: ['dominant'] }).acc, turnedFan({ segment: 'whale', traits: ['dominant'] }).id))!.messages).toBeGreaterThan(
      winBackRule(reg(turnedFan({ segment: 'regular', traits: ['dominant'] }).acc, turnedFan({ segment: 'regular', traits: ['dominant'] }).id))!.messages,
    )
    let { acc, id } = turnedFan({ segment: 'simp', traits: ['stalker'], relationship: 'single' })
    const before = meetupOdds(set(acc, id, { segment: 'simp', traits: ['stalker'] }), { ...reg(acc, id), segment: 'simp', traits: ['stalker'] })
    for (let i = 0; i < 40 && reg(acc, id).turned; i++) acc = simulate(sendDm(acc, id, { text: 'sorry' }, 'w').account, 1, 'w').account
    const back = reg(acc, id)
    expect(back.turned).toBeUndefined()
    expect(back.segment).toBe('simp')
    expect(back.traits).toEqual(['stalker', 'unhinged'])
    expect(meetupOdds(acc, back).creep!).toBeGreaterThan(before.creep! * 2)
  })
})
