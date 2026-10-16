import { Button, ClockIcon } from '@fanvue/ui'
import { useAccount, useActiveAccount } from '../../hooks/useAccounts'
import { useTimeTravel } from '../time/context'

/** Game day of the active account, with the manual "next day" clock (plan.md §4.1; the show around it: ui/time/). */
export function ClockControl() {
  const { data: active } = useActiveAccount()
  const { data: account } = useAccount(active?.id)
  const { advance, busy } = useTimeTravel()
  if (!active || !account) return null

  return (
    <div className="flex items-center gap-2">
      <span className="typography-body-small-14px-semibold mr-auto flex items-center gap-1 text-content-secondary">
        <ClockIcon size={16} /> Day {account.clock.day}
      </span>
      <Button variant="secondary" size="32" disabled={busy} onClick={() => advance(1)}>
        Next day
      </Button>
      <Button variant="tertiary" size="32" disabled={busy} onClick={() => advance(7)}>
        +7
      </Button>
    </div>
  )
}
