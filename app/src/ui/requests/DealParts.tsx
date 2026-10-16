import { CheckCircleIcon, CheckIcon, ClockIcon, CrossCircleIcon, CrossIcon, HourglassIcon, MinusIcon } from '@fanvue/ui'
import type { ReactNode } from 'react'
import { money } from '../format'
import { Swap } from './DealMotion'

// The layout shared by custom and meetup cards (2026-10-15, after the mock-up you sent):
// an icon tile, title and day line, a status in the corner; then, under a divider, the
// money in large type with a status square (green check once paid).

/** waiting: on you; pending: on him or the calendar; paid / failed: settled; closed: nothing happened. */
export type DealTone = 'waiting' | 'pending' | 'paid' | 'failed' | 'closed'

const TEXT: Record<DealTone, string> = {
  waiting: 'text-brand-primary-default',
  pending: 'text-brand-primary-default',
  paid: 'text-success-content',
  failed: 'text-error-content',
  closed: 'text-content-tertiary',
}
const SQUARE: Record<DealTone, string> = {
  waiting: 'bg-brand-primary-muted',
  pending: 'bg-brand-primary-muted',
  paid: 'bg-success-surface',
  failed: 'bg-error-surface',
  closed: 'bg-surface-tertiary',
}
const SQUARE_ICON: Record<DealTone, ReactNode> = {
  waiting: <HourglassIcon className="size-6" />,
  pending: <ClockIcon className="size-6" />,
  paid: <CheckIcon className="size-6" />,
  failed: <CrossIcon className="size-6" />,
  closed: <MinusIcon className="size-6" />,
}

export function DealHeader({ icon, title, subtitle, status, tone }: { icon: ReactNode; title: ReactNode; subtitle: string; status: string; tone: DealTone }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-primary-muted text-brand-primary-default">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="typography-body-default-16px-semibold">{title}</div>
        <div className="text-sm text-content-tertiary">{subtitle}</div>
      </div>
      <Swap id={status} className={`flex shrink-0 items-center gap-1 pt-0.5 text-xs font-semibold tracking-wider uppercase ${TEXT[tone]}`}>
        {tone === 'paid' && <CheckCircleIcon className="size-[18px]" />}
        {tone === 'failed' && <CrossCircleIcon className="size-[18px]" />}
        {status}
      </Swap>
    </div>
  )
}

/** The money: what it is, the amount in large type (struck through if it never came), and the status square. */
export function DealAmount({ label, cents, tone, children }: { label: string; cents: number; tone: DealTone; children?: ReactNode }) {
  const struck = tone === 'failed' || tone === 'closed'
  return (
    <div className="flex items-end justify-between gap-3 border-t border-border-primary pt-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm text-content-tertiary">{label}</span>
        <span className={`typography-header-heading-md tabular-nums ${struck ? 'text-content-tertiary line-through' : 'text-content-primary'}`}>{money(cents)}</span>
        {children}
      </div>
      <Swap id={tone} className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${SQUARE[tone]} ${TEXT[tone]}`}>
        {SQUARE_ICON[tone]}
      </Swap>
    </div>
  )
}
