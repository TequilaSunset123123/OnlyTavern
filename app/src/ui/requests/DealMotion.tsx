import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { createContext, type ReactNode, useContext } from 'react'
import type { Celebration } from './celebration'

// How custom and meetup cards move (2026-10-15, after your RequestBubble snippets),
// in the app's own colors:
//   - spring reveal: the card rises 24px from 94% with a spring, its parts follow one by one;
//   - highlight pulse: while it waits for your answer, its edge glows brand violet once;
//   - when it is done: the buttons fold away, the card dips to 97% and springs back, a soft
//     light sweeps across it, and "✓ Completed" pops up next to the amount, then goes.
// `delay` holds the whole card (and its parts) back, e.g. until its chat bubble has risen.

const EASE = [0.22, 1, 0.36, 1] as const
const SPRING = { type: 'spring', stiffness: 330, damping: 22 } as const

/** Seconds the card was held back by (its parts count their own delays from there), or null: no entrance. */
const Start = createContext<number | null>(0)

/**
 * `still`: no entrance of its own (a settled card you have already watched settle, which
 * just comes in with the chat).
 */
export function DealCard({ pulse, celebrate, delay = 0, still = false, children }: { pulse: boolean; celebrate: Celebration; delay?: number; still?: boolean; children: ReactNode }) {
  const reduced = useReducedMotion()
  const done = celebrate === 'completed' && !reduced
  const wait = reduced ? 0 : delay
  return (
    <motion.div
      className="relative w-full max-w-md origin-bottom overflow-hidden rounded-2xl"
      initial={reduced || still ? false : { opacity: 0, y: 24, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: done ? [1, 0.97, 1.012, 1] : 1 }}
      transition={{
        opacity: { duration: 0.3, delay: wait },
        y: { ...SPRING, delay: wait },
        scale: done ? { duration: 0.55, times: [0, 0.4, 0.75, 1] } : { ...SPRING, delay: wait },
      }}
    >
      <Start.Provider value={still ? null : wait}>{children}</Start.Provider>
      {pulse && !reduced && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-brand-primary-default shadow-[inset_0_0_28px_var(--color-brand-primary-muted)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: 1.1, delay: wait + 0.45, times: [0, 0.5, 1] }}
        />
      )}
      {done && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-linear-to-r from-transparent via-success-content/20 to-transparent"
          initial={{ x: '-110%' }}
          animate={{ x: '110%' }}
          transition={{ duration: 0.85, ease: 'easeInOut' }}
        />
      )}
    </motion.div>
  )
}

/** One part of the card, coming in a moment after the card itself. */
export function Rise({ delay, className, children }: { delay: number; className?: string; children: ReactNode }) {
  const reduced = useReducedMotion()
  const start = useContext(Start)
  return (
    <motion.div
      className={className}
      initial={reduced || start === null ? false : { opacity: 0, y: 7 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: reduced ? 0 : (start ?? 0) + delay, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}

/** The buttons: they fold away when the card moves on, and the next set (if any) comes in. */
export function Actions({ step, children }: { step: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {children && (
        <motion.div
          key={step}
          className="origin-top overflow-hidden"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0, scaleY: 0.7 }}
          transition={{ duration: 0.25 }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** A status chip or check that springs in when it changes (e.g. to PAID). */
export function Swap({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={id}
        className={className}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        transition={{ type: 'spring', stiffness: 380, damping: 20 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

/** "✓ Completed" and friends, next to the amount; springs in and leaves again. */
export function Pop({ celebrate, label }: { celebrate: Celebration; label: string }) {
  return (
    <AnimatePresence>
      {celebrate && (
        <motion.span
          key={celebrate}
          className={`text-xs font-semibold ${celebrate === 'failed' ? 'text-error-content' : 'text-success-content'}`}
          initial={{ opacity: 0, y: 12, scale: 0.93 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 340, damping: 23 }}
        >
          {label}
        </motion.span>
      )}
    </AnimatePresence>
  )
}
