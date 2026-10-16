import { useEffect, useState } from 'react'
import { Shutter } from './Shutter'

// The loading screen when the app opens (2026-10-15, after a mock-up you gave): the
// wordmark fills in left to right with the bar, then the same shutter as Next day / +7
// closes over it and opens on the app. Brand pinks, so it matches the shutter and the
// rest of the app. The app loads underneath meanwhile.

const MS = 2800
/** [time, progress %]: uneven steps, smoothed in between (from the mock-up). */
const STEPS = [
  [0, 0],
  [0.12, 5],
  [0.25, 18],
  [0.4, 39],
  [0.54, 43],
  [0.63, 66],
  [0.73, 72],
  [0.84, 91],
  [0.92, 96],
  [1, 100],
] as const
const LINES = [
  "Look who's back.",
  'Back for more?',
  'Your fans missed you.',
  'Business as usual.',
  'What could go wrong?',
  'Tips appreciated.',
  'Just another Tuesday.',
]

function progressAt(t: number): number {
  for (let i = 1; i < STEPS.length; i++) {
    const [t1, p1] = STEPS[i]
    if (t > t1) continue
    const [t0, p0] = STEPS[i - 1]
    const x = (t - t0) / (t1 - t0)
    return p0 + (p1 - p0) * x * x * (3 - 2 * x)
  }
  return 100
}

const status = (p: number) =>
  p < 22 ? 'Initializing' : p < 49 ? 'Restoring session' : p < 78 ? 'Loading your world' : p < 100 ? 'Almost there' : 'Ready'

type Stage = 'loading' | 'cover' | 'reveal' | 'done'

export function Splash() {
  const [stage, setStage] = useState<Stage>('loading')
  const [line] = useState(() => LINES[Math.floor(Math.random() * LINES.length)])
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    let frame = 0
    let timer = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - start) / MS, 1)
      setProgress(progressAt(t))
      if (t < 1) frame = requestAnimationFrame(tick)
      else timer = window.setTimeout(() => setStage('cover'), 250)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [])

  if (stage === 'done') return null
  const clip = `inset(0 ${100 - progress}% 0 0)`
  return (
    <>
      {stage !== 'reveal' && (
        <div className="fixed inset-0 z-[205] flex flex-col items-center justify-center overflow-hidden bg-(--app-backdrop) text-white" role="progressbar" aria-label="Loading OnlyTavern" aria-valuenow={Math.floor(progress)}>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_55%,rgba(232,71,154,0.16),transparent_65%)]" />
          <div className="relative w-full px-2.5 text-center">
            <div className="text-[clamp(31px,7.2vw,61px)] leading-[1.2] font-bold tracking-[-0.055em] whitespace-nowrap text-[#5a2a48] opacity-60">onlytavern</div>
            <div
              aria-hidden="true"
              className="absolute inset-0 text-[clamp(31px,7.2vw,61px)] leading-[1.2] font-bold tracking-[-0.055em] whitespace-nowrap text-[#ffc8e3] [text-shadow:0_0_24px_rgba(232,71,154,0.55)]"
              style={{ clipPath: clip }}
            >
              onlytavern
            </div>
          </div>
          <p className="relative mt-4 font-mono text-[10px] tracking-[0.26em] text-white/50 uppercase">{line}</p>
          <div className="relative mt-10 h-0.5 w-[min(67%,260px)] bg-white/10">
            <div
              className="h-full bg-linear-to-r from-(--cs-gradient-start) to-(--cs-gradient-end) shadow-[0_0_12px_rgba(232,71,154,0.6)]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="relative mt-3 flex w-[min(67%,260px)] justify-between gap-2 font-mono text-[10px] tracking-[0.04em] text-white/40 uppercase">
            <span>{status(progress)}{progress < 100 ? '...' : ''}</span>
            <span>{Math.floor(progress)}%</span>
          </div>
          <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent_0px,transparent_3px,rgba(0,0,0,0.13)_4px)] opacity-35" />
        </div>
      )}
      {stage !== 'loading' && <Shutter closed={stage === 'cover'} onSettled={() => setStage(stage === 'cover' ? 'reveal' : 'done')} />}
    </>
  )
}
