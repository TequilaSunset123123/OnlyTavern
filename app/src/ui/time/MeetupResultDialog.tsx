import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@fanvue/ui'
import type { MeetupReport } from '../../api'
import { count, freebieText, money } from '../format'
import { AnimatedNumber } from '../motion/AnimatedNumber'
import { BLUR, OUTCOME, SPRING, useRevealed } from './shared'

// One popup per meetup that happened while time passed (engine/meetups.ts rolled it).

const AFTER: Record<MeetupReport['outcome'], (m: MeetupReport) => string> = {
  smooth: () => 'He paid what he offered, in cash. He is more loyal to you now.',
  bonus: () => 'He loved it so much he paid half as much again. He is more loyal to you now.',
  noShow: () => 'You waited; he never came. No money.',
  creep: () => 'He got too pushy, so you left early with part of the cash. He may fixate on you now.',
  wife: (m) =>
    `No money, and the scandal cost you ${count(m.lost ?? 0)} subscriber${m.lost === 1 ? '' : 's'}. ${m.returns ? 'He is lying low; he was devoted enough to come back once things calm down.' : 'He blocked you for good.'}`,
}

export function MeetupResultDialog({ meetup: m, onClose }: { meetup: MeetupReport; onClose: () => void }) {
  const shown = useRevealed()
  const freebie = freebieText(m.terms, m.outcome, m.paid)
  const o = freebie ?? OUTCOME[m.outcome]
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm" mobilePresentation="card" overlayProps={BLUR}>
        <DialogHeader>
          <DialogTitle>
            {o.icon} {o.title(m.name)}
          </DialogTitle>
          <DialogDescription>Meetup on day {m.day}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col items-center gap-3 text-center">
          <AnimatedNumber
            className={`typography-header-heading-xl ${m.paid ? 'text-success-content' : 'text-content-tertiary'}`}
            value={shown ? m.paid : 0}
            format={(n) => money(Math.round(n))}
            springOptions={SPRING}
          />
          <p className="text-sm text-content-secondary">{freebie?.line ?? AFTER[m.outcome](m)}</p>
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
