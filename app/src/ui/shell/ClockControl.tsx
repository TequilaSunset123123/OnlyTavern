import { Button, ClockIcon } from '@fanvue/ui'
import { useAccount, useActiveAccount, useDispatch } from '../../hooks/useAccounts'

/** Game day of the active account, with the manual "next day" clock (plan.md §4.1). */
export function ClockControl() {
  const { data: active } = useActiveAccount()
  const { data: account } = useAccount(active?.id)
  const dispatch = useDispatch()
  if (!active || !account) return null

  const advance = (days: number) => dispatch.mutate({ type: 'clock.advance', id: active.id, days })
  return (
    <div className="flex items-center gap-2">
      <span className="typography-body-small-14px-semibold mr-auto flex items-center gap-1 text-content-secondary">
        <ClockIcon size={16} /> Day {account.clock.day}
      </span>
      <Button variant="secondary" size="32" loading={dispatch.isPending} onClick={() => advance(1)}>
        Next day
      </Button>
      <Button variant="tertiary" size="32" disabled={dispatch.isPending} onClick={() => advance(7)}>
        +7
      </Button>
    </div>
  )
}
