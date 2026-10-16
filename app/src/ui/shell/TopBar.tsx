import { Button, CalendarIcon, ClockIcon, CrownIcon, PeopleIcon, ProgressBar, WalletIcon } from '@fanvue/ui'
import type { ReactNode } from 'react'
import type { DailyStat } from '../../api'
import { useAccount, useActiveAccount, useStatements, useStatistics } from '../../hooks/useAccounts'
import { progress, useCurrentDirection } from '../direction'
import { count, money } from '../format'
import { useTimeTravel } from '../time/context'
import { ACCENT } from './accent'
import { HistoryButton } from './History'

// The game's status bar across the top of every page (2026-10-16): the day, your balance,
// your direction level, your fans, the history and the clock. Each number shows what the
// last day changed.

/** Platform money the last day brought in (meetup cash and payouts are not platform earnings). */
const lastDayNet = (d: DailyStat) => Object.entries(d.net).reduce((s, [kind, cents]) => (kind === 'offline' || kind === 'payout' ? s : s + cents), 0)

function Stat({ icon, children, change, className = '' }: { icon: ReactNode; children: ReactNode; change?: string; className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <span className="text-(--color-brand-primary-default)">{icon}</span>
      <span className="typography-body-default-16px-semibold whitespace-nowrap">{children}</span>
      {change && <span className="typography-body-small-14px-semibold text-success-content">{change}</span>}
    </span>
  )
}

const plus = (n: number, show: (n: number) => string) => (n > 0 ? `+${show(n)}` : n < 0 ? `−${show(-n)}` : undefined)

export function TopBar() {
  const { data: active } = useActiveAccount()
  const { data: account } = useAccount(active?.id)
  const { data: statements } = useStatements(active?.id)
  const { data: stats } = useStatistics(active?.id)
  const direction = useCurrentDirection(active?.id)
  const { advance, busy } = useTimeTravel()
  if (!active || !account) return null

  const last = stats?.history.at(-1)
  const balance = statements ? statements.balances.available + statements.balances.pending : 0
  return (
    <header className="glass flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
      <Stat icon={<CalendarIcon />}>Day {account.clock.day}</Stat>
      <Stat icon={<WalletIcon />} change={last && plus(lastDayNet(last), money)}>
        {money(balance)}
      </Stat>
      {direction && (
        <Stat icon={<CrownIcon />} className="hidden sm:flex">
          <span className="flex items-center gap-3">
            Lv {direction.level}
            <span className="w-28">
              <ProgressBar variant="brand" size="small" value={progress(direction)} ariaLabel="Level progress" />
            </span>
            <span className="typography-body-small-14px-regular text-content-tertiary">
              {direction.next === null ? 'Max' : `${direction.points} / ${direction.next}`}
            </span>
          </span>
        </Stat>
      )}
      {last && (
        <Stat icon={<PeopleIcon />} change={plus(last.newSubscribers - last.churned, count)} className="hidden sm:flex">
          {count(last.subscribers)}
        </Stat>
      )}
      <span className="ml-auto flex items-center gap-2">
        <HistoryButton />
        <Button variant="secondary" size="40" className={ACCENT} leftIcon={<ClockIcon />} disabled={busy} onClick={() => advance(1)}>
          Next day
        </Button>
        <Button variant="tertiary" size="40" disabled={busy} onClick={() => advance(7)}>
          +7
        </Button>
      </span>
    </header>
  )
}
