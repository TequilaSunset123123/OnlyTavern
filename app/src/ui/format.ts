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

/**
 * You asked him to meet and he took you for a freebie (engine/deals.ts, Meetup.terms):
 * how it ended when he did turn up (no-show and his wife catching you read as usual).
 * Free: he pulls his pants up and walks out. Lowball: a few dollars and an insult.
 * Worship: a submissive man thanks you on his knees, and pays nothing either.
 */
export function freebieText(terms: 'lowball' | 'free' | 'worship' | undefined, outcome: string | undefined, paid: number): { icon: string; title: (name: string) => string; line: string } | null {
  if (!terms || (outcome !== 'smooth' && outcome !== 'bonus' && outcome !== 'creep')) return null
  const pushy = outcome === 'creep' ? ' He got pushy first.' : ''
  if (terms === 'worship')
    return { icon: '🙇', title: (n) => `${n} worshipped you, for free`, line: `He thanked you on his knees, called you his goddess and swore he would make it up to you. He did not pay a cent.${pushy}` }
  return terms === 'free'
    ? { icon: '🚪', title: (n) => `${n} walked out`, line: `He pulled his pants up and left without paying a cent.${pushy} You offered yourself, so he took it for free.` }
    : { icon: '🪙', title: (n) => `${n} left you ${money(paid)}`, line: `He tossed ${money(paid)} on the bed on his way out: "that's what a cheap girl is worth."${pushy}` }
}
