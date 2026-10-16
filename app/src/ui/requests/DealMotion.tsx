import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import type { Celebration } from './celebration'

// How custom and meetup cards move (2026-10-15, after your RequestBubble snippets),
// in the app's own colors:
//   - spring reveal: the card rises 24px from 94% with a spring, its parts follow one by one;
//   - highlight pulse: while it waits for your answer, its edge glows brand violet once;
//   - when it is done: the buttons fold away, the card dips to 97% and springs back, a soft
//     light sweeps across it, and "✓ Completed" pops up next to the amount, then goes.

const EASE = [0.22, 1, 0.36, 1] as const
const SPRING = { type: 'spring', stiffness: 330, damping: 22 } as const

export function DealCard({ pulse, celebrate, children }: { pulse: boolean; celebrate: Celebration; children: ReactNode }) {
  const reduced = useReducedMotion()
  const done = celebrate === 'completed' && !reduced
  return (
    <motion.div
      className="relative w-full max-w-md origin-bottom overflow-hidden rounded-lg"
      initial={reduced ? false : { opacity: 0, y: 24, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: done ? [1, 0.97, 1.012, 1] : 1 }}
      transition={{ opacity: { duration: 0.3 }, y: SPRING, scale: done ? { duration: 0.55, times: [0, 0.4, 0.75, 1] } : SPRING }}
    >
      {children}
      {pulse && !reduced && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-lg border-2 border-brand-primary-default shadow-[inset_0_0_28px_var(--color-brand-primary-muted)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: 1.1, delay: 0.45, times: [0, 0.5, 1] }}
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
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 7 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: reduced ? 0 : delay, ease: EASE }}
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
