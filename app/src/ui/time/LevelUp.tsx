import { Button } from '@fanvue/ui'
import confetti from 'canvas-confetti'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { Directions } from '../../api'
import { useActiveAccount } from '../../hooks/useAccounts'
import { useDirections } from '../../hooks/useMessages'
import { useIncidents } from '../../hooks/useTime'
import { useTimeTravel } from './context'

// The level-up popup (2026-10-17): "Creator Success Program", from your old level to the new
// one, with what the new level gives (more reach, more fans writing to you) and what it takes
// (a bigger platform cut: directions.ts platformFee), and confetti.
// It shows whenever your current direction is a level higher than the last one celebrated in
// this browser (posting, a paid custom, a meetup, the developer button), once the time-passing
// screens and any stalker incident are out of the way. The first time an account is seen, its
// level is just noted.
// Confetti: canvas-confetti (the library Magic UI's Confetti wraps, magicui.design). The way the
// card tilts in follows Aceternity's Animated Modal (ui.aceternity.com), written with Motion here.

const key = (accountId: string) => `onlytavern:levelSeen:${accountId}`

function seenLevels(accountId: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(key(accountId)) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

function saveSeen(accountId: string, direction: string, level: number) {
  try {
    localStorage.setItem(key(accountId), JSON.stringify({ ...seenLevels(accountId), [direction]: level }))
  } catch {
    // Storage unavailable: the popup may show again, nothing worse.
  }
}

type LevelUp = { from: number; to: number; title: string }

/** Watches your level and shows the popup when it rises. */
export function LevelUpHost() {
  const { data: active } = useActiveAccount()
  const { data: directions } = useDirections(active?.id)
  const { data: incidents = [] } = useIncidents(active?.id)
  const { busy } = useTimeTravel()
  // Re-read the browser's record after you close the popup.
  const [, closed] = useState(0)
  const current = directions?.all.find((d) => d.id === directions.current)
  const seen = active && current ? seenLevels(active.id)[current.id] : undefined

  // The first time this account (or direction) is seen, or after a switch to a lower level: just note it.
  useEffect(() => {
    if (active && current && (seen === undefined || current.level < seen)) saveSeen(active.id, current.id, current.level)
  }, [active, current, seen])

  const up: LevelUp | null =
    current && seen !== undefined && current.level > seen && !busy && !incidents.length ? { from: seen, to: current.level, title: current.title } : null
  const close = () => {
    if (active && current) saveSeen(active.id, current.id, current.level)
    closed((n) => n + 1)
  }

  return <AnimatePresence>{up && directions && <LevelUpModal key={`${up.from}-${up.to}`} up={up} perks={directions.perks} onClose={close} />}</AnimatePresence>
}

const percent = (x: number) => `${Math.round(x * 100)}%`
const gain = (now: number, before: number) => `+${Math.round((now / before - 1) * 100)}%`

/** Two bursts from the sides, for a moment (Magic UI's "side cannons"). */
function cannons() {
  const end = Date.now() + 2200
  const colors = ['#ff6aa9', '#c93dbb', '#ffd1e8', '#ffffff']
  const frame = () => {
    if (Date.now() > end) return
    confetti({ particleCount: 3, angle: 60, spread: 55, startVelocity: 60, origin: { x: 0, y: 0.6 }, colors, zIndex: 1000, disableForReducedMotion: true })
    confetti({ particleCount: 3, angle: 120, spread: 55, startVelocity: 60, origin: { x: 1, y: 0.6 }, colors, zIndex: 1000, disableForReducedMotion: true })
    requestAnimationFrame(frame)
  }
  frame()
}

function LevelUpModal({ up, perks, onClose }: { up: LevelUp; perks: Directions['perks']; onClose: () => void }) {
  const reduced = useReducedMotion()
  const button = useRef<HTMLButtonElement>(null)
  const [from, to] = [up.from - 1, up.to - 1]
  // The latest onClose for Escape, without re-running the confetti when the parent re-renders.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  // Once, when it opens: confetti, focus on the button, Escape closes it.
  useEffect(() => {
    cannons()
    button.current?.focus()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('keydown', esc)
      confetti.reset()
    }
  }, [])

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-md [perspective:900px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="level-up-title"
        className="w-full max-w-sm overflow-hidden rounded-3xl border border-white/15 bg-[#160a16] text-white shadow-2xl"
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5, rotateX: 40, y: 40 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, rotateX: 0, y: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8, rotateX: 10 }}
        transition={{ type: 'spring', stiffness: 260, damping: 15 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-linear-to-br from-(--cs-gradient-start) to-(--cs-gradient-end) px-6 pt-5 pb-6 text-center">
          <p className="text-[11px] font-semibold tracking-[0.25em] opacity-90">CREATOR SUCCESS PROGRAM</p>
          <h2 id="level-up-title" className="mt-3 font-display text-3xl">
            Congratulations!
          </h2>
          <p className="mt-1 text-sm opacity-90">Your hard work has been recognized.</p>
          <motion.p
            className="mt-4 text-2xl font-bold tracking-wide"
            initial={reduced ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.25, type: 'spring', stiffness: 300, damping: 12 }}
          >
            LV. {up.from} → LV. {up.to}
          </motion.p>
          <p className="mt-1 text-sm italic opacity-90">“{up.title}”</p>
        </div>
        <div className="flex flex-col gap-3 px-6 py-5">
          <p className="text-xs font-semibold tracking-widest text-white/60">YOUR UPGRADED BENEFITS</p>
          <Row label="Organic reach" value={gain(perks.visitors[to], perks.visitors[from])} good />
          <Row label="Audience discovery" value="Boosted" note={`${gain(perks.dms[to], perks.dms[from])} fans writing to you`} good />
          <hr className="border-white/10" />
          <Row label="Platform service fee" value={`${percent(perks.fee[from])} → ${percent(perks.fee[to])}`} />
          <Button ref={button} variant="brand" size="48" className="mt-2" onClick={onClose}>
            Keep going
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function Row({ label, value, note, good = false }: { label: string; value: string; note?: string; good?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-white/80">{label}</span>
      <span className="text-right">
        <span className={`text-base font-semibold ${good ? 'text-[#7dffb0]' : 'text-[#ff8fa3]'}`}>{value}</span>
        {note && <span className="block text-xs text-white/50">{note}</span>}
      </span>
    </div>
  )
}
