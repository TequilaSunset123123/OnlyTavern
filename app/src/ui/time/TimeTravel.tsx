import { Alert, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@fanvue/ui'
import { AnimatePresence } from 'motion/react'
import { type ReactNode, useCallback, useState } from 'react'
import type { DispatchResult, Lapse, MeetupReport } from '../../api'
import { useAccount, useActiveAccount, useDispatch } from '../../hooks/useAccounts'
import { useIncidents, useLapsingCheck, useOpenDayEvents } from '../../hooks/useTime'
import { errorText } from '../format'
import { TimeTravelContext } from './context'
import { DayEventHost } from './DayEventDialog'
import { IncidentHost } from './IncidentDialog'
import { Loader } from './Loader'
import { MeetupResultDialog } from './MeetupResultDialog'
import { ReportDialog } from './ReportDialog'
import { BLUR } from './shared'
import { Shutter } from './Shutter'

// Time passing as a game moment (2026-10-15). "Next day" or "+7":
//   1. if something would lapse, ask first;
//   2. the shutter closes over the app, opens on a black loading screen, the days tick
//      by (meetups get their own bar), the shutter closes and opens on the app again;
//   3. a popup for each meetup, then any stalker incident to decide, then any rare daily
//      event (engine/events.ts; you can put those off), then the report. A rare event
//      stops a skip on its day (the loader only ticks the days that were simulated).
// The engine runs as soon as you click; the screens only pace what it already decided.

type Stage = 'idle' | 'confirm' | 'coverIn' | 'revealLoader' | 'loading' | 'coverOut' | 'revealApp' | 'meetups' | 'incidents' | 'events' | 'report'

type Run = { days: number; fromDay: number; lapses: Lapse[]; result: DispatchResult | null; error: string | null; meetup: number }

function LapseDialog({ run, onCancel, onGo }: { run: Run; onCancel: () => void; onGo: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent size="sm" mobilePresentation="card" overlayProps={BLUR}>
        <DialogHeader>
          <DialogTitle>{run.days === 1 ? 'Go to the next day?' : `Skip ${run.days} days?`}</DialogTitle>
          <DialogDescription>These will lapse:</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-2">
          {run.lapses.map((l) => (
            <div key={l.id} className="rounded-xl border border-border-primary bg-surface-primary p-3 text-sm">
              {l.kind === 'custom'
                ? l.accepted
                  ? `${l.name}'s custom is due on day ${l.deadline}. You said yes: he will not pay and will be upset.`
                  : `${l.name}'s custom request expires after day ${l.deadline}.`
                : l.kind === 'meetup'
                  ? `${l.name}'s meetup invitation needs an answer by day ${l.deadline}.`
                  : `${l.name}: not decided by day ${l.deadline}, it settles itself with the default choice.`}
            </div>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel}>
            Go back
          </Button>
          <Button variant="brand" onClick={onGo}>
            {run.days === 1 ? 'Next day anyway' : 'Skip anyway'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TimeTravelProvider({ children }: { children: ReactNode }) {
  const { data: active } = useActiveAccount()
  const { data: account } = useAccount(active?.id)
  const { data: incidents = [] } = useIncidents(active?.id)
  const { data: dayEvents = [] } = useOpenDayEvents(active?.id)
  const dispatch = useDispatch()
  const check = useLapsingCheck()
  const [stage, setStage] = useState<Stage>('idle')
  const [run, setRun] = useState<Run | null>(null)

  const go = useCallback(
    (r: Run) => {
      if (!active) return
      setRun(r)
      setStage('coverIn')
      dispatch
        .mutateAsync({ type: 'clock.advance', id: active.id, days: r.days })
        .then((result) => setRun((x) => x && { ...x, result }))
        .catch((e) => setRun((x) => x && { ...x, error: errorText(e) }))
    },
    [active, dispatch],
  )

  const advance = useCallback(
    (days: number) => {
      if (!active || !account || stage !== 'idle') return
      const base: Run = { days, fromDay: account.clock.day, lapses: [], result: null, error: null, meetup: 0 }
      setStage('confirm') // blocks a second click while we look
      check(active.id, days)
        .then((lapses) => {
          if (lapses.length) setRun({ ...base, lapses })
          else go(base)
        })
        .catch(() => go(base))
    },
    [active, account, stage, check, go],
  )

  const loaded = useCallback(() => setStage('coverOut'), [])
  // Each step is skipped when there is nothing in it, checked as you reach it (deciding
  // the last one empties its list, and its result should stay up until you close it).
  const toEvents = () => setStage(dayEvents.length ? 'events' : 'report')
  const toIncidents = () => (incidents.length ? setStage('incidents') : toEvents())
  const afterShutter = () => {
    if (stage === 'coverIn') setStage('revealLoader')
    else if (stage === 'revealLoader') setStage('loading')
    else if (stage === 'coverOut') setStage('revealApp')
    else if (stage === 'revealApp') {
      if (run?.result?.report?.meetups.length) setStage('meetups')
      else toIncidents()
    }
  }
  const finish = () => {
    setStage('idle')
    setRun(null)
  }

  const curtain = stage === 'coverIn' || stage === 'revealLoader' || stage === 'loading' || stage === 'coverOut' || stage === 'revealApp'
  const loader = stage === 'revealLoader' || stage === 'loading' || stage === 'coverOut'
  const report = run?.result?.report

  return (
    <TimeTravelContext.Provider value={{ advance, busy: stage !== 'idle' }}>
      {children}
      {curtain && <Shutter closed={stage === 'coverIn' || stage === 'coverOut'} onSettled={afterShutter} />}
      <AnimatePresence>
        {loader && run && <Loader key="loader" fromDay={run.fromDay} days={report ? report.to - report.from + 1 : run.days} meetups={run.error ? NONE : (report?.meetups ?? null)} onDone={loaded} />}
      </AnimatePresence>
      {stage === 'confirm' && run?.lapses.length ? <LapseDialog run={run} onCancel={finish} onGo={() => go({ ...run, lapses: [] })} /> : null}
      {stage === 'meetups' && report && run && (
        <MeetupResultDialog
          key={run.meetup}
          meetup={report.meetups[run.meetup]}
          onClose={() => (run.meetup + 1 < report.meetups.length ? setRun({ ...run, meetup: run.meetup + 1 }) : toIncidents())}
        />
      )}
      {active && (stage === 'idle' || stage === 'incidents') && <IncidentHost accountId={active.id} incidents={incidents} onEmpty={stage === 'incidents' ? toEvents : undefined} />}
      {active && stage === 'events' && <DayEventHost accountId={active.id} events={dayEvents} onEmpty={() => setStage('report')} />}
      {stage === 'report' && report && <ReportDialog report={report} onClose={finish} />}
      {stage === 'report' && !report && run?.error && <ErrorDialog error={run.error} onClose={finish} />}
    </TimeTravelContext.Provider>
  )
}

/** When the engine failed, the loader still finishes and the error shows afterwards. */
const NONE: MeetupReport[] = []

function ErrorDialog({ error, onClose }: { error: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm" mobilePresentation="card">
        <DialogHeader>
          <DialogTitle>Time did not pass</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Alert variant="error">{error}</Alert>
        </DialogBody>
        <DialogFooter>
          <Button variant="brand" onClick={onClose}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
