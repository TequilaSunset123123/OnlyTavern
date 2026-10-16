import { AnimatePresence, motion, useSpring } from 'motion/react'
import { useEffect, useState } from 'react'
import type { MeetupReport } from '../../api'
import { SlidingNumber } from '../motion/SlidingNumber'

// The black screen while days go by. The bar follows Motion's "Loading progress bar"
// example (motion.dev/examples/react-loading-progress-bar; paid code, so ours is built
// from watching it): progress jumps in steps, and a spring (useSpring) smooths every
// jump, overshooting a little. The day counts up with motion-primitives' SlidingNumber.
// A meetup gets its own short bar when the days reach it. The engine has long finished
// by then; the screen just takes its time so the days feel like they pass.

const DAY_MS = { 1: 900, 7: 1500 } as Record<number, number>
const MEETUP_MS = 1300
const CAPTIONS = [
  'Fans are scrolling your page',
  'New faces are checking you out',
  'Your regulars are typing',
  'Tips are coming in',
  'Subscriptions are renewing',
  'Comments are piling up',
  'Someone is screenshotting your post',
]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A spring-smoothed bar: brand gradient on a dim track. */
function Bar({ progress, thin }: { progress: number; thin?: boolean }) {
  const scaleX = useSpring(0, { stiffness: 110, damping: 14 })
  useEffect(() => {
    scaleX.set(progress)
  }, [scaleX, progress])
  return (
    <div className={`w-full max-w-[300px] overflow-hidden rounded-full bg-white/10 ${thin ? 'h-1.5' : 'h-2.5'}`}>
      <motion.div className="h-full w-full origin-left rounded-full bg-linear-to-r from-(--cs-gradient-start) to-(--cs-gradient-end)" style={{ scaleX }} />
    </div>
  )
}

/** `meetups` is null until the engine has answered; the days start ticking then. */
export function Loader({ fromDay, days, meetups, onDone }: { fromDay: number; days: number; meetups: MeetupReport[] | null; onDone: () => void }) {
  const [day, setDay] = useState(fromDay)
  const [progress, setProgress] = useState(0.06)
  const [caption, setCaption] = useState('Getting the day started')
  const [meeting, setMeeting] = useState<{ name: string; progress: number } | null>(null)

  useEffect(() => {
    if (!meetups) return
    let stopped = false
    const run = async () => {
      const perDay = (DAY_MS[days] ?? 1500) / days
      for (let d = 1; d <= days && !stopped; d++) {
        const today = fromDay + d
        setDay(today)
        // A little uneven, like the reference: each day is a chunk of the bar.
        setProgress(Math.min(1, (d - 0.15 * Math.random()) / days))
        setCaption(CAPTIONS[(today * 7 + d) % CAPTIONS.length])
        await sleep(perDay)
        for (const m of meetups.filter((x) => x.day === today)) {
          if (stopped) return
          setCaption(`Meeting ${m.name} in person`)
          setMeeting({ name: m.name, progress: 0.05 })
          await sleep(60)
          setMeeting({ name: m.name, progress: 1 })
          await sleep(MEETUP_MS)
          setMeeting(null)
        }
      }
      setProgress(1)
      await sleep(350)
      if (!stopped) onDone()
    }
    run()
    return () => {
      stopped = true
    }
    // Runs once the engine has answered (the caller keeps onDone, fromDay and days stable for the run).
  }, [meetups, days, fromDay, onDone])

  return (
    <motion.div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-6 bg-[#0a0a0a] px-8 text-white"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <span className="text-xs font-semibold tracking-[0.24em] text-white/45 uppercase">{days === 1 ? 'Next day' : `Skipping ${days} days`}</span>
      <div className="flex items-baseline gap-3 text-6xl font-bold tracking-tight">
        <span className="text-white/60">Day</span>
        <SlidingNumber value={day} />
      </div>
      <Bar progress={progress} />
      <div className="h-12 text-center">
        <AnimatePresence mode="wait">
          <motion.p
            key={caption}
            className="text-sm text-white/60"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            {caption}…
          </motion.p>
        </AnimatePresence>
        <AnimatePresence>
          {meeting && (
            <motion.div className="mt-3 flex justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="w-48">
                <Bar progress={meeting.progress} thin />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
