import { useEffect, useState } from 'react'

const SHOW_MS = 2400

/** What just happened to the card while you were looking at it. */
export type Celebration = 'accepted' | 'completed' | 'failed' | null

/**
 * `status` is what the card shows now; `next` is what to celebrate if it changes while the
 * card is on screen (not when it is first shown). Cleared after a moment.
 */
export function useCelebration(status: string, next: Celebration): Celebration {
  const [seen, setSeen] = useState(status)
  const [now, setNow] = useState<Celebration>(null)
  if (seen !== status) {
    setSeen(status)
    setNow(next)
  }
  useEffect(() => {
    if (!now) return
    const t = setTimeout(() => setNow(null), SHOW_MS)
    return () => clearTimeout(t)
  }, [now])
  return now
}
