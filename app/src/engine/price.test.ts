import { describe, expect, it } from 'vitest'
import preset from '../presets/audience.json'
import economy from '../presets/economy.json'
import { createAccount } from '../store/account'
import type { Profile } from '../store/schema'
import { makePersona } from './personas'
import { priceAttracts, priceFreeloaders, priceLevel, priceRenewal, priceSpend } from './price'
import { rngFor } from './rng'

const base = createAccount({ id: 'x', seed: 's', now: 0, name: 'Mia', handle: 'mia' }).profile
const at = (priceCents: number): Profile => ({ ...base, accountType: 'paid', priceCents })
const top = at(economy.maxPriceCents)

describe('subscription price', () => {
  it('does nothing at the starting price or on a free page, and the most at the highest', () => {
    expect(priceLevel(at(preset.price.referenceCents))).toBe(0)
    expect(priceLevel(at(economy.minPriceCents))).toBe(0)
    expect(priceLevel({ ...top, accountType: 'free' })).toBe(0)
    expect(priceLevel(top)).toBe(1)
    expect(priceSpend(at(preset.price.referenceCents))).toBe(1)
    expect(priceSpend(top)).toBe(preset.price.spend)
    expect(priceFreeloaders(top)).toBe(preset.price.freeloaders)
    expect(priceAttracts(top)).toEqual(preset.price.attracts)
  })

  it('the more price-sensitive his type, the less he renews at a high price', () => {
    const s = preset.segments
    expect(priceRenewal(top, s.freeloader.priceSensitivity)).toBeLessThan(priceRenewal(top, s.regular.priceSensitivity))
    expect(priceRenewal(top, s.regular.priceSensitivity)).toBeLessThan(priceRenewal(top, s.whale.priceSensitivity))
    expect(priceRenewal(at(preset.price.referenceCents), s.freeloader.priceSensitivity)).toBe(1)
  })

  it('new big spenders are more often Old money at a high price; behaviours mix freely', () => {
    const count = (attracts: Record<string, number>) => {
      const all = Array.from({ length: 2000 }, (_, i) => makePersona(rngFor('p', i, 'w'), 'whale', 'en', attracts).behaviours)
      return { old: all.filter((b) => b.includes('older_gentleman')).length, oldCreepy: all.filter((b) => b.includes('older_gentleman') && b.includes('creepy_compliments')).length }
    }
    const cheap = count({})
    const dear = count(priceAttracts(top))
    expect(dear.old).toBeGreaterThan(cheap.old * 1.6)
    expect(dear.oldCreepy).toBeGreaterThan(0)
  })
})
