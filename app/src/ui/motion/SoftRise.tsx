import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'

// Soft rise (2026-10-15, your snippet): fades in while rising 9px, for chat bubbles.

interface SoftRiseProps {
  children: ReactNode
  className?: string
  delay?: number
}

export function SoftRise({ children, className, delay = 0 }: SoftRiseProps) {
  const reducedMotion = useReducedMotion()

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 9 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.45,
        delay,
        ease: [0.22, 1, 0.36, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
