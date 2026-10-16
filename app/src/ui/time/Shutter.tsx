import { motion } from 'motion/react'

// The shutter curtain between the app and the loading screen, after Motion's "Curtains:
// Shutter" example (motion.dev/examples/react-curtains-shutter; its code is paid, so this
// is our own, from watching it): seven vertical strips, every other one dropping from
// the top or rising from the bottom, all at once, closing in about half a second with a
// strong ease-in-out and leaving the way they came. Ours are the brand violets.

const STRIPS = 7
const EASE = [0.76, 0, 0.24, 1] as const
export const SHUTTER_SECONDS = 0.45

/** `closed`: the strips cover the screen. `onSettled` runs each time they finish moving. */
export function Shutter({ closed, onSettled }: { closed: boolean; onSettled: () => void }) {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[210] overflow-hidden">
      {Array.from({ length: STRIPS }, (_, i) => {
        const away = i % 2 ? '101%' : '-101%'
        return (
          <motion.div
            key={i}
            className="absolute top-0 h-full will-change-transform"
            style={{
              left: `${(i * 100) / STRIPS}%`,
              width: `calc(${100 / STRIPS}% + 1px)`,
              background: i % 2 ? 'var(--cs-gradient-end)' : 'var(--cs-gradient-start)',
            }}
            initial={{ y: away }}
            animate={{ y: closed ? '0%' : away }}
            transition={{ duration: SHUTTER_SECONDS, ease: EASE }}
            onAnimationComplete={i === 0 ? onSettled : undefined}
          />
        )
      })}
    </div>
  )
}
