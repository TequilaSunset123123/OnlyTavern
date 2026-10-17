// What your subscription price does to who you get (2026-10-16). A high price filters your
// fans: fewer of the cheap ones subscribe at all (conversion, audience.ts), the price-
// sensitive ones you already have renew less, new regulars are more often Old money and
// less often Stalkers, Cheapskates or freebie hunters (Creepy and Obsessed do not care),
// and what fans offer and tip goes up with what they pay. Numbers: presets/audience.json
// `price`, each the effect at the highest price, growing evenly from the starting price.
import preset from '../presets/audience.json'
import economy from '../presets/economy.json'
import type { Profile } from '../store/schema'

const P = preset.price

/** 0 at the starting price or below (and on a free page), 1 at the highest. */
export function priceLevel(profile: Profile): number {
  if (profile.accountType === 'free') return 0
  return Math.min(1, Math.max(0, (profile.priceCents - P.referenceCents) / (economy.maxPriceCents - P.referenceCents)))
}

/** A multiplier that is `top` at the highest price and 1 at the starting price. */
const scaled = (top: number, level: number) => 1 + (top - 1) * level

/** × how likely new regulars get each behaviour (like a direction's `attracts`). */
export function priceAttracts(profile: Profile): Record<string, number> {
  const level = priceLevel(profile)
  return Object.fromEntries(Object.entries(P.attracts).map(([id, m]) => [id, scaled(m, level)]))
}

/** × how many freebie hunters become regulars. */
export const priceFreeloaders = (profile: Profile) => scaled(P.freeloaders, priceLevel(profile))

/** × what fans offer for customs and meetups, and what they tip. */
export const priceSpend = (profile: Profile) => scaled(P.spend, priceLevel(profile))

/** × a subscriber's chance to renew: the more price-sensitive his type, the more a high price puts him off. */
export const priceRenewal = (profile: Profile, priceSensitivity: number) => Math.exp(-P.renewalPenalty * priceSensitivity * priceLevel(profile))

