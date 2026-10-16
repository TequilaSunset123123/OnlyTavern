// Shared by the popups after time passes (ui/time/).
import { useEffect, useState } from 'react'
import type { MeetupReport } from '../../api'

/** Popups after time passes blur the app behind them. */
export const BLUR = { className: 'backdrop-blur-md' }
export const SPRING = { stiffness: 60, damping: 18 }

/** False on the first frame, then true: numbers start at 0 and count up to their value. */
export function useRevealed() {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 80)
    return () => clearTimeout(t)
  }, [])
  return shown
}

export const OUTCOME: Record<MeetupReport['outcome'], { icon: string; title: (name: string) => string }> = {
  smooth: { icon: '💋', title: (n) => `A good night with ${n}` },
  bonus: { icon: '💎', title: (n) => `${n} paid extra` },
  noShow: { icon: '👻', title: (n) => `${n} did not show up` },
  creep: { icon: '⚠️', title: (n) => `${n} got creepy` },
  wife: { icon: '💥', title: (n) => `${n}'s wife caught you` },
}
