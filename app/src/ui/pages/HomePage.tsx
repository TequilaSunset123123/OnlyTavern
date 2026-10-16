import { Avatar, ChartIcon, ClockIcon, CommentIcon, EmptyState, EyeIcon, GiftIcon, HeartIcon, MessageIcon, PeopleIcon, TaskIcon, WalletIcon } from '@fanvue/ui'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import type { DailyStat } from '../../api'
import { useAccount, useActiveAccount, useStatistics } from '../../hooks/useAccounts'
import { useTags } from '../../hooks/useContent'
import { useInbox, useRequests } from '../../hooks/useMessages'
import { directionLine, useCurrentDirection } from '../direction'
import { count, money } from '../format'
import { IconTile, Panel, PanelRow } from '../Panel'
import { PageTitle } from '../shell/PageTitle'

// The game's "today" page (2026-10-16; your posts moved to Posts): what is waiting for
// you, today's event, and how the last day went. Today's event is a placeholder until
// events exist (plan.md §10.2).

const initials = (name: string) => name.slice(0, 2).toUpperCase()

export function HomePage() {
  const navigate = useNavigate()
  const { data: active } = useActiveAccount()
  const { data: account } = useAccount(active?.id)
  const direction = useCurrentDirection(active?.id)

  if (!active || !account) return <EmptyState className="p-6" title="No account" description="Create an account first (Accounts page)." />

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <PageTitle
        title={
          <>
            Today <span className="text-2xl text-content-tertiary">Day {account.clock.day}</span>
          </>
        }
        subtitle={direction && directionLine(direction)}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <MessagesPanel accountId={active.id} onOpen={(id) => navigate(id ? `/messages/${id}` : '/messages')} />
        <RequestsPanel accountId={active.id} onOpen={() => navigate('/requests')} />
        <TodaysEvent />
      </div>
      <SummaryPanel accountId={active.id} onOpen={() => navigate('/statistics')} />
    </div>
  )
}

function MessagesPanel({ accountId, onOpen }: { accountId: string; onOpen: (regularId?: string) => void }) {
  const { data: inbox } = useInbox(accountId)
  const waiting = (inbox?.threads ?? []).filter((t) => t.unread > 0 || t.pending)
  return (
    <Panel icon={<MessageIcon />} title="Messages" subtitle="Unread messages from fans" count={waiting.length} onOpen={() => onOpen()}>
      {waiting.length === 0 && <p className="px-2 text-sm text-content-tertiary">Nothing unread.</p>}
      {waiting.slice(0, 3).map((t) => (
        <PanelRow
          key={t.regular.id}
          lead={<Avatar size={40} alt={t.regular.name} fallback={initials(t.regular.name)} />}
          title={t.regular.name}
          line={t.pending ? 'Typing…' : t.last?.text}
          right={t.last && <span className="text-xs text-content-tertiary">Day {t.last.day}</span>}
          onClick={() => onOpen(t.regular.id)}
        />
      ))}
    </Panel>
  )
}

function RequestsPanel({ accountId, onOpen }: { accountId: string; onOpen: () => void }) {
  const { data } = useRequests(accountId)
  const { data: tags = [] } = useTags()
  const label = (id: string) => tags.find((t) => t.id === id)?.en ?? id
  const live = (s: string) => s === 'open' || s === 'accepted'
  const rows = [
    ...(data?.requests ?? [])
      .filter((r) => live(r.request.status))
      .map((r) => ({ id: r.request.id, name: r.regular.name, line: `Custom · ${r.request.tags.map(label).join(' + ')}`, cents: r.request.offerCents })),
    ...(data?.meetups ?? [])
      .filter((m) => live(m.meetup.status))
      .map((m) => ({ id: m.meetup.id, name: m.regular.name, line: m.meetup.meetDay ? `Meetup · day ${m.meetup.meetDay}` : 'Meetup invitation', cents: m.meetup.offerCents })),
  ]
  return (
    <Panel icon={<TaskIcon />} title="Active requests" subtitle="Customs and meetups waiting on you" count={rows.length} onOpen={onOpen}>
      {rows.length === 0 && <p className="px-2 text-sm text-content-tertiary">No open requests.</p>}
      {rows.slice(0, 3).map((r) => (
        <PanelRow
          key={r.id}
          lead={<Avatar size={40} alt={r.name} fallback={initials(r.name)} />}
          title={r.name}
          line={r.line}
          right={<span className="typography-body-default-16px-semibold text-success-content">{money(r.cents)}</span>}
          onClick={onOpen}
        />
      ))}
    </Panel>
  )
}

/** Placeholder: daily events are a new feature still to come (plan.md §10.2); this is how one will look. */
function TodaysEvent() {
  return (
    <Panel icon={<GiftIcon />} title="Today's event">
      {/* The event's picture goes here. */}
      <div className="aspect-video w-full rounded-xl bg-surface-secondary" />
      <div className="font-display text-2xl">Coming soon</div>
      <p className="text-sm text-content-secondary">Each day may bring an event that changes the odds: a fan appreciation day, a platform warning, a brand deal.</p>
      <span className="flex w-fit items-center gap-2 rounded-full bg-(--color-brand-primary-muted) px-3 py-1 text-sm text-(--color-brand-primary-default)">
        <ClockIcon size={16} /> Ends in —
      </span>
    </Panel>
  )
}

/** The last day against the one before: the change in percent, or nothing when there is nothing to compare. */
function change(now: number, before: number | undefined): ReactNode {
  if (before === undefined || before === 0) return null
  const pct = Math.round(((now - before) / before) * 100)
  return <span className={`text-sm ${pct < 0 ? 'text-error-content' : 'text-success-content'}`}>{pct > 0 ? `+${pct}` : pct}%</span>
}

function SummaryPanel({ accountId, onOpen }: { accountId: string; onOpen: () => void }) {
  const { data: stats } = useStatistics(accountId)
  const [before, last] = (stats?.history ?? []).slice(-2) as (DailyStat | undefined)[]
  const today = last ?? before
  if (!today) return null
  const rows = [
    { icon: <EyeIcon />, label: 'Profile views', value: (d: DailyStat) => d.visitors, show: count },
    { icon: <PeopleIcon />, label: 'New fans', value: (d: DailyStat) => d.newSubscribers, show: count },
    { icon: <HeartIcon />, label: 'Tips earned', value: (d: DailyStat) => d.net.tip ?? 0, show: money },
    { icon: <CommentIcon />, label: 'Paid messages', value: (d: DailyStat) => d.net.message ?? 0, show: money },
    { icon: <WalletIcon />, label: 'Customs', value: (d: DailyStat) => d.net.custom ?? 0, show: money },
    { icon: <ChartIcon />, label: 'Subscriptions', value: (d: DailyStat) => (d.net.subscription ?? 0) + (d.net.renewal ?? 0), show: money },
  ]
  return (
    <Panel icon={<ChartIcon />} title="Today's summary" subtitle={`Day ${today.day}, compared with the day before`} onOpen={onOpen}>
      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <PanelRow
            key={r.label}
            lead={<IconTile>{r.icon}</IconTile>}
            title={r.label}
            right={
              <span className="flex items-baseline gap-2">
                <span className="typography-body-default-16px-semibold">{r.show(r.value(today))}</span>
                {last && before && change(r.value(last), r.value(before))}
              </span>
            }
          />
        ))}
      </div>
    </Panel>
  )
}
