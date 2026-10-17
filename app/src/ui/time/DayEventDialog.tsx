import { Alert, Button, Chip, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@fanvue/ui'
import { useState } from 'react'
import type { DayEventOption, DayEventView, EngineEvent, Segment } from '../../api'
import { useDispatch } from '../../hooks/useAccounts'
import { eventArt, eventArtFocus } from '../eventArt'
import { count, errorText } from '../format'
import { BLUR } from './shared'

// A rare (or special) daily event (engine/events.ts, engine/specials.ts): its picture and story, your options with the odds
// the engine will roll, then what came of it. Unlike a stalker incident you can put it off
// for a day; left too long, it settles itself with its default choice.

type Done = Extract<EngineEvent, { type: 'day-event-done' }>

/** The event's picture, or a gradient for events that have none. `banner`: a short strip, cropped (the Home card). */
export function EventArt({ kind, banner = false }: { kind: string; banner?: boolean }) {
  const src = eventArt(kind)
  const shape = `${banner ? 'aspect-[18/5]' : 'aspect-video'} w-full rounded-xl`
  return src ? (
    <img src={src} alt="" className={`${shape} object-cover`} style={{ objectPosition: eventArtFocus(kind) }} />
  ) : (
    <div className={`${shape} bg-linear-to-br from-(--cs-gradient-start) to-(--cs-gradient-end) opacity-80`} />
  )
}

/**
 * `onChoose` runs before the choice is sent: once it is resolved the event leaves the open
 * list, so the caller keeps showing this one until `onDone`. `onLater` closes it undecided.
 */
export function DayEventDialog({
  accountId,
  view,
  onChoose,
  onDone,
  onLater,
}: {
  accountId: string
  view: DayEventView
  onChoose?: () => void
  onDone: () => void
  onLater: () => void
}) {
  const dispatch = useDispatch()
  const [done, setDone] = useState<Done | null>(null)
  const [error, setError] = useState<string | null>(null)
  // An option that also needs a fan and a fan type (Routing Error) opens a picker first.
  const [picking, setPicking] = useState<DayEventOption | null>(null)
  const fallback = view.options.find((o) => o.choice === view.fallback)

  const choose = (choice: string, target?: { regularId: string; segment: Segment }) => {
    if (!view.id) return
    setError(null)
    onChoose?.()
    dispatch
      .mutateAsync({ type: 'dayEvent.choose', id: accountId, eventId: view.id, choice, ...(target ? { target } : {}) })
      .then((res) => setDone((res.events.find((e) => e.type === 'day-event-done') as Done | undefined) ?? null))
      .catch((e) => setError(errorText(e)))
  }

  return (
    <Dialog open onOpenChange={(open) => !open && (done ? onDone() : onLater())}>
      <DialogContent size="sm" mobilePresentation="card" overlayProps={BLUR}>
        <DialogHeader showClose={false}>
          <DialogTitle>{view.title}</DialogTitle>
          <DialogDescription>
            {view.category === 'special' ? 'Special' : 'Rare'} event · day {view.day}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <EventArt kind={view.kind} />
          {view.email ? <Email email={view.email} /> : <p className="text-sm">{view.text}</p>}
          {error && <Alert variant="error">{error}</Alert>}
          {done ? (
            <Alert variant={done.bad || done.lost ? 'warning' : 'success'}>
              {done.text}
              {done.lost ? ` ${count(done.lost)} subscriber${done.lost === 1 ? '' : 's'} left.` : ''}
            </Alert>
          ) : picking && view.pick ? (
            <SwapPicker pick={view.pick} busy={dispatch.isPending} onBack={() => setPicking(null)} onConfirm={(target) => choose(picking.choice, target)} />
          ) : (
            <div className="flex flex-col gap-2">
              {view.options.map((o) => (
                <button
                  key={o.choice}
                  type="button"
                  disabled={dispatch.isPending}
                  onClick={() => (o.pick ? setPicking(o) : choose(o.choice))}
                  className="flex flex-col gap-0.5 rounded-xl border border-border-primary bg-surface-primary p-3 text-left hover:border-brand-primary-default disabled:opacity-50"
                >
                  <span className="typography-body-small-14px-semibold">{o.label}</span>
                  <span className="text-xs text-content-secondary">{o.help}</span>
                </button>
              ))}
              {fallback && <p className="text-xs text-content-tertiary">Not decided by the end of day {view.answerBy}: “{fallback.label}”.</p>}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {done ? (
            <Button variant="brand" onClick={onDone}>
              OK
            </Button>
          ) : (
            <Button variant="secondary" disabled={dispatch.isPending} onClick={onLater}>
              Decide later
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** An event that arrives as an email (Routing Error): the header lines, then the body as written. */
function Email({ email }: { email: NonNullable<DayEventView['email']> }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border-primary bg-surface-primary p-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-content-tertiary">From</dt>
        <dd className="break-words text-content-secondary">{email.from}</dd>
        <dt className="text-content-tertiary">To</dt>
        <dd className="break-words text-content-secondary">{email.to}</dd>
        <dt className="text-content-tertiary">Subject</dt>
        <dd className="typography-body-small-14px-semibold break-words">{email.subject}</dd>
      </dl>
      <hr className="border-border-primary" />
      <p className="whitespace-pre-line">{email.body}</p>
    </div>
  )
}

/** Routing Error: which regular goes, and what kind of fan comes in his place. */
function SwapPicker({
  pick,
  busy,
  onBack,
  onConfirm,
}: {
  pick: NonNullable<DayEventView['pick']>
  busy: boolean
  onBack: () => void
  onConfirm: (target: { regularId: string; segment: Segment }) => void
}) {
  const [regularId, setRegularId] = useState<string | null>(null)
  const [segment, setSegment] = useState<Segment | null>(null)
  const fan = pick.fans.find((f) => f.id === regularId)
  const label = (s: Segment) => pick.types.find((t) => t.id === s)?.label ?? s
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-primary bg-surface-primary p-3">
      <span className="typography-body-small-14px-semibold">Who goes?</span>
      <div className="flex flex-wrap gap-2">
        {pick.fans.map((f) => (
          <Chip
            key={f.id}
            size="32"
            selected={f.id === regularId}
            onClick={() => {
              setRegularId(f.id)
              if (segment === f.type) setSegment(null)
            }}
          >
            {f.name} · {label(f.type)}
          </Chip>
        ))}
      </div>
      <span className="typography-body-small-14px-semibold">What kind of fan comes instead?</span>
      <div className="flex flex-wrap gap-2">
        {pick.types.map((t) => (
          <Chip key={t.id} size="32" selected={t.id === segment} disabled={t.id === fan?.type} onClick={() => setSegment(t.id)}>
            {t.label}
          </Chip>
        ))}
      </div>
      <p className="text-xs text-content-tertiary">Everything else about the new fan is random. He keeps the loyalty of the one who goes (a freeloader tops out at level 1).</p>
      <div className="flex gap-2">
        <Button variant="secondary" size="32" disabled={busy} onClick={onBack}>
          Back
        </Button>
        <Button variant="brand" size="32" loading={busy} disabled={!regularId || !segment} onClick={() => regularId && segment && onConfirm({ regularId, segment })}>
          Make the correction
        </Button>
      </div>
    </div>
  )
}

/** Shows open rare events one at a time; `onEmpty` once you have gone through them (decided or put off). */
export function DayEventHost({ accountId, events, onEmpty }: { accountId: string; events: DayEventView[]; onEmpty: () => void }) {
  // Snapshot on mount: deciding one takes it off the open list, putting it off does not.
  const [queue] = useState(events)
  const [index, setIndex] = useState(0)
  const view = queue[index]
  if (!view) return null
  const next = () => (index + 1 < queue.length ? setIndex(index + 1) : onEmpty())
  return <DayEventDialog key={view.id} accountId={accountId} view={view} onDone={next} onLater={next} />
}
