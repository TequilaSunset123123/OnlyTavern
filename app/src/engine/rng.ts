// Seeded randomness. Every draw gets its own stream named by (seed, day, purpose),
// so adding a new kind of draw later never shifts the numbers of existing ones.
import seedrandom from 'seedrandom'

export type Rng = () => number

export function rngFor(seed: string, day: number, purpose: string): Rng {
  return seedrandom(`${seed}|${day}|${purpose}`)
}

/** Standard normal (Box-Muller). */
export function gaussian(rng: Rng): number {
  const u = 1 - rng() // (0, 1]
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

/** Number of successes in n tries with probability p. Exact for small n, normal approximation above. */
export function binomial(rng: Rng, n: number, p: number): number {
  if (n <= 0 || p <= 0) return 0
  if (p >= 1) return n
  if (n < 100) {
    let k = 0
    for (let i = 0; i < n; i++) if (rng() < p) k++
    return k
  }
  const k = Math.round(n * p + Math.sqrt(n * p * (1 - p)) * gaussian(rng))
  return Math.min(n, Math.max(0, k))
}

/** Positive value whose median is `median`; `spread` is the log-scale standard deviation. */
export function logNormal(rng: Rng, median: number, spread: number): number {
  return median * Math.exp(spread * gaussian(rng))
}
