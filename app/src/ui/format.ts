const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const int = new Intl.NumberFormat('en-US')

/** Cents to "$1,234.56". */
export const money = (cents: number) => usd.format(cents / 100)
export const count = (n: number) => int.format(n)
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** "+12.5%" style change between two values; null when there is nothing to compare. */
export function trend(now: number, before: number) {
  if (before === 0) return null
  const pct = ((now - before) / Math.abs(before)) * 100
  return { label: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`, trend: pct >= 0 ? ('positive' as const) : ('negative' as const) }
}
