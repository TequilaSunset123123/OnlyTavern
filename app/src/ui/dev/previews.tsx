import { Alert, Button, Chip, ClockIcon, GiftIcon } from '@fanvue/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DayEventView } from '../../api'
import { count } from '../format'
import { Panel } from '../Panel'
import { EventArt } from '../time/DayEventDialog'
import { LevelUpHost } from '../time/LevelUp'
import { type DirectionId, GALLERY_ID, type HomeView, levelSeenKey, levelUpDirections, type Outcome } from './galleryData'

// The event gallery's look-alikes (EventGallery.tsx): the popup (ui/time/DayEventDialog.tsx)
// and the Home card (TodaysEvent in ui/pages/HomePage.tsx), drawn in the page so many can be
// seen at once. Same parts and classes as the real ones; if those change, change these too
// (the gallery's "Real popup" button opens the real one to compare). And the real level-up
// popup (ui/time/LevelUp.tsx), fed sample data.

/** Text with any {placeholder} left unfilled marked in red: a typo in the JSON, or a value the gallery does not know. */
export function Txt({ children }: { children: string }) {
  const parts = children.split(/(\{\w+\})/g)
  return parts.map((p, i) =>
    /^\{\w+\}$/.test(p) ? (
      <mark key={i} className="rounded bg-error-surface px-0.5 text-error-content">
        {p}
      </mark>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  )
}

const CATEGORY: Record<DayEventView['category'], string> = { default: 'Nothing special today', common: 'Changes the odds', rare: 'Rare event', special: 'Special event' }

/** The Home card (HomePage.tsx TodaysEvent), with its buttons drawn but doing nothing. */
export function HomeCardPreview({ home }: { home: HomeView }) {
  return (
    <Panel icon={<GiftIcon />} title="Today's event" subtitle={CATEGORY[home.category]} className="w-full max-w-[380px]">
      <EventArt kind={home.kind} banner />
      <div className="font-display text-xl">{home.title}</div>
      <p className="text-sm text-content-secondary">
        <Txt>{home.text}</Txt>
      </p>
      {(home.chip || home.endLabel || home.decide) && (
        <div className="flex flex-wrap items-center gap-2">
          {home.chip && (
            <span className="flex w-fit items-center gap-2 rounded-full bg-(--color-brand-primary-muted) px-3 py-1 text-sm text-(--color-brand-primary-default)">
              <ClockIcon size={16} /> {home.chip}
            </span>
          )}
          {home.endLabel && (
            <Button variant="secondary" size="32">
              {home.endLabel}
            </Button>
          )}
          {home.decide && (
            <Button variant="brand" size="32">
              Decide
            </Button>
          )}
        </div>
      )}
    </Panel>
  )
}

/** What the popup shows: the choices, Routing Error's picker, or how it turned out. */
export type PopupStage = { at: 'open' } | { at: 'picking' } | { at: 'done'; outcome: Outcome }

/**
 * The popup (DayEventDialog.tsx), drawn in the page: the same header, picture, text or email,
 * choices and footer. Clicking a choice shows how it turns out (`onChoose`: the gallery picks
 * the result).
 */
export function PopupPreview({ view, stage, onChoose, onBack }: { view: DayEventView; stage: PopupStage; onChoose: (choice: string) => void; onBack: () => void }) {
  const fallback = view.options.find((o) => o.choice === view.fallback)
  const done = stage.at === 'done' ? stage.outcome : null
  return (
    // DialogContent (size sm, card) as a box in the page.
    <div className="flex w-full max-w-[400px] flex-col overflow-hidden rounded-lg border border-modal-stroke bg-modal-background p-6 shadow-blur-menu backdrop-blur-[4px]">
      <div className="flex shrink-0 items-start justify-end gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h3 className="typography-header-heading-xs text-content-primary">{view.title}</h3>
          <p className="typography-body-default-16px-regular text-content-secondary">
            {view.category === 'special' ? 'Special' : 'Rare'} event · day {view.day}
          </p>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 py-4">
        <EventArt kind={view.kind} />
        {view.email ? <EmailPreview email={view.email} /> : <p className="text-sm"><Txt>{view.text}</Txt></p>}
        {done ? (
          <Alert variant={done.bad || done.lost ? 'warning' : 'success'}>
            <Txt>{done.text}</Txt>
            {done.lost ? ` ${count(done.lost)} subscriber${done.lost === 1 ? '' : 's'} left.` : ''}
          </Alert>
        ) : stage.at === 'picking' && view.pick ? (
          <SwapPickerPreview pick={view.pick} onBack={onBack} onConfirm={() => onChoose('correct')} />
        ) : (
          <div className="flex flex-col gap-2">
            {view.options.map((o) => (
              <button
                key={o.choice}
                type="button"
                onClick={() => onChoose(o.choice)}
                className="flex flex-col gap-0.5 rounded-xl border border-border-primary bg-surface-primary p-3 text-left hover:border-brand-primary-default disabled:opacity-50"
              >
                <span className="typography-body-small-14px-semibold">{o.label}</span>
                <span className="text-xs text-content-secondary">
                  <Txt>{o.help}</Txt>
                </span>
              </button>
            ))}
            {fallback && <p className="text-xs text-content-tertiary">Not decided by the end of day {view.answerBy}: “{fallback.label}”.</p>}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 [&>*]:min-w-0 [&>*]:flex-1">
        {done ? (
          <Button variant="brand" onClick={onBack}>
            OK
          </Button>
        ) : (
          <Button variant="secondary">Decide later</Button>
        )}
      </div>
    </div>
  )
}

/** DayEventDialog's Email. */
function EmailPreview({ email }: { email: NonNullable<DayEventView['email']> }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border-primary bg-surface-primary p-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-content-tertiary">From</dt>
        <dd className="break-words text-content-secondary">{email.from}</dd>
        <dt className="text-content-tertiary">To</dt>
        <dd className="break-words text-content-secondary">
          <Txt>{email.to}</Txt>
        </dd>
        <dt className="text-content-tertiary">Subject</dt>
        <dd className="typography-body-small-14px-semibold break-words">{email.subject}</dd>
      </dl>
      <hr className="border-border-primary" />
      <p className="whitespace-pre-line">
        <Txt>{email.body}</Txt>
      </p>
    </div>
  )
}

/** DayEventDialog's SwapPicker (Routing Error), with sample regulars. */
function SwapPickerPreview({ pick, onBack, onConfirm }: { pick: NonNullable<DayEventView['pick']>; onBack: () => void; onConfirm: () => void }) {
  const [regularId, setRegularId] = useState<string | null>(null)
  const [segment, setSegment] = useState<string | null>(null)
  const fan = pick.fans.find((f) => f.id === regularId)
  const label = (s: string) => pick.types.find((t) => t.id === s)?.label ?? s
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-primary bg-surface-primary p-3">
      <span className="typography-body-small-14px-semibold">Who goes?</span>
      <div className="flex flex-wrap gap-2">
        {pick.fans.map((f) => (
          <Chip key={f.id} size="32" selected={f.id === regularId} onClick={() => setRegularId(f.id)}>
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
        <Button variant="secondary" size="32" onClick={onBack}>
          Back
        </Button>
        <Button variant="brand" size="32" onClick={onConfirm}>
          Make the correction
        </Button>
      </div>
    </div>
  )
}

/**
 * The real level-up popup (LevelUp.tsx), from `level - 1` to `level`. It reads your account
 * through the query cache, so it gets its own cache holding a made-up account at that level,
 * and the browser's "last level celebrated" for it is set one lower so it pops up (the
 * gallery deletes that record when you leave it).
 */
export function RealLevelUp({ direction, level }: { direction: DirectionId; level: number }) {
  const [client] = useState(() => {
    try {
      localStorage.setItem(levelSeenKey, JSON.stringify({ [direction]: level - 1 }))
    } catch {
      // No storage: the popup takes it for a first visit and stays shut.
    }
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false } } })
    qc.setQueryData(['accounts'], { accounts: [{ id: GALLERY_ID }], activeId: GALLERY_ID })
    qc.setQueryData(['account', GALLERY_ID, 'directions'], levelUpDirections(direction, level))
    qc.setQueryData(['account', GALLERY_ID, 'incidents'], [])
    return qc
  })
  // On the page itself, not inside it: the page's slide-in transform would pin its full-screen
  // backdrop to the top of the gallery instead of the screen.
  return createPortal(
    <QueryClientProvider client={client}>
      <LevelUpHost />
    </QueryClientProvider>,
    document.body,
  )
}

