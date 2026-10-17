import { Alert, Badge, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@fanvue/ui'
import type { PeriodReport } from '../../api'
import { count, money, trend } from '../format'
import { AnimatedNumber } from '../motion/AnimatedNumber'
import { BLUR, OUTCOME, SPRING, useRevealed } from './shared'

// The report after "Next day" or "+7" (2026-10-15): the background blurs and the numbers
// count up from zero (motion-primitives' AnimatedNumber).

function Stat({ label, value, format, sub, shown }: { label: string; value: number; format?: (n: number) => string; sub?: React.ReactNode; shown: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border-primary bg-surface-primary p-3">
      <span className="text-xs text-content-tertiary">{label}</span>
      <AnimatedNumber className="typography-header-heading-sm" value={shown ? value : 0} format={format} springOptions={SPRING} />
      {sub && <span className="text-xs">{sub}</span>}
    </div>
  )
}

const dollars = (cents: number) => money(Math.round(cents))

export function ReportDialog({ report: r, onClose }: { report: PeriodReport; onClose: () => void }) {
  const shown = useRevealed()
  const len = r.to - r.from + 1
  const week = len === 7
  const earned = r.earned.platform + r.earned.cash
  const vs = r.previous ? trend(earned, r.previous.earned) : null
  const delta = r.subscribers.after - r.subscribers.before
  const fans = [
    r.regulars.new && `${r.regulars.new} new regular${r.regulars.new === 1 ? '' : 's'}`,
    r.regulars.levelUps && `${r.regulars.levelUps} loyalty level-up${r.regulars.levelUps === 1 ? '' : 's'}`,
    r.regulars.turned && `${r.regulars.turned} turned on you`,
    r.regulars.back && `${r.regulars.back} came back`,
    r.regulars.left && `${r.regulars.left} hater${r.regulars.left === 1 ? '' : 's'} gave up`,
    r.incidents && `${r.incidents} stalker incident${r.incidents === 1 ? '' : 's'}`,
  ].filter(Boolean)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md" mobilePresentation="card" overlayProps={BLUR}>
        <DialogHeader>
          <DialogTitle>{week ? 'Your week' : len > 1 ? `${len} days` : `Day ${r.to}`}</DialogTitle>
          <DialogDescription>{len > 1 ? `Days ${r.from}–${r.to}` : 'How the day went'}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {r.stoppedFor && <Alert variant="info">Stopped on day {r.to}: {r.stoppedFor} came up.</Alert>}
          <div className="grid grid-cols-2 gap-2">
            <Stat
              label="Earned"
              value={earned}
              format={dollars}
              shown={shown}
              sub={vs ? <Badge variant={vs.trend === 'positive' ? 'success' : 'error'}>{vs.label} vs last {week ? 'week' : len > 1 ? `${len} days` : 'day'}</Badge> : r.earned.cash ? `${money(r.earned.cash)} of it cash` : undefined}
            />
            <Stat
              label="Subscribers"
              value={r.subscribers.after}
              format={(n) => count(Math.round(n))}
              shown={shown}
              sub={<span className={delta >= 0 ? 'text-success-content' : 'text-error-content'}>{`${delta >= 0 ? '+' : ''}${count(delta)} (${count(r.newSubscribers)} new, ${count(r.churned)} left)`}</span>}
            />
            <Stat label="Visitors" value={r.visitors} format={(n) => count(Math.round(n))} shown={shown} />
            <Stat label="Messages from fans" value={r.regulars.messages + r.regulars.new} format={(n) => count(Math.round(n))} shown={shown} />
          </div>
          {len > 1 && r.dayEvents.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="typography-body-small-14px-semibold">Events</span>
              {r.dayEvents.map((e) => (
                <div key={e.day} className="flex justify-between text-sm">
                  <span>{e.title}</span>
                  <span className="text-content-tertiary">Day {e.day}</span>
                </div>
              ))}
            </div>
          )}
          {r.meetups.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="typography-body-small-14px-semibold">Meetups</span>
              {r.meetups.map((m) => (
                <div key={`${m.regularId}-${m.day}`} className="flex justify-between text-sm">
                  <span>
                    {OUTCOME[m.outcome].icon} {OUTCOME[m.outcome].title(m.name)}
                  </span>
                  <span className="font-semibold">{money(m.paid)}</span>
                </div>
              ))}
            </div>
          )}
          {fans.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="typography-body-small-14px-semibold">Fans</span>
              <p className="text-sm text-content-secondary">{fans.join(' · ')}</p>
            </div>
          )}
          {r.haters.active > 0 && (
            <p className="text-sm text-error-content">
              {r.haters.active} hater{r.haters.active === 1 ? ' is' : 's are'} badmouthing you: {Math.round(r.haters.visitorHit * 100)}% fewer visitors.
            </p>
          )}
          {r.levelUps.map((l) => (
            <p key={l.direction} className="text-sm">
              ⭐ Your direction reached level {l.level}
            </p>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button variant="brand" onClick={onClose}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
