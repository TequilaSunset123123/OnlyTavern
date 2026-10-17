import { Button, Card, CardContent, CardHeader, CardTitle } from '@fanvue/ui'
import { useState } from 'react'
import { useActiveAccount, useDispatch } from '../../hooks/useAccounts'
import { useDirections } from '../../hooks/useMessages'
import { errorText } from '../format'

// Developer console (Settings, 2026-10-16/17): testing cheats while the game is being built.
// Its engine side is engine/dev.ts. To remove it later: delete this folder, engine/dev.ts and
// dev.test.ts, the `dev.*` actions in api/types.ts and api/local.ts, and <DevConsole /> in
// SettingsPage.

/** What each trigger starts, and what it makes up if no regular fits (engine/dev.ts forceSpecial). */
const SPECIALS = [
  { kind: 'charity', label: 'The Charity', note: 'Turns all your regulars once you open the doors.' },
  { kind: 'routingError', label: 'Routing Error', note: 'Makes up a regular if you have none.' },
  { kind: 'humanAtm', label: 'Human ATM', note: 'Makes up a submissive old-money whale at loyalty 4. The arrest comes 3 days later.' },
  { kind: 'marryMe', label: 'Marry Me?', note: 'Makes up an obsessed stalker at loyalty 5. Say yes and the honeymoon fund comes 30 days later, then the invitation: they only come that way.' },
] as const

export function DevConsole() {
  const dispatch = useDispatch()
  const { data: active } = useActiveAccount()
  const { data: directions } = useDirections(active?.id)
  const [done, setDone] = useState<string | null>(null)
  const direction = directions?.all.find((d) => d.id === directions.current)
  if (!active || !direction) return null
  const maxed = direction.level >= 5
  const start = (kind: string, label: string) => {
    setDone(null)
    dispatch.mutateAsync({ type: 'dev.special', id: active.id, kind }).then(() => setDone(`${label} is on Home now.`), () => {})
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Developer</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <span className="typography-body-small-14px-semibold">
          {direction.label} · Lv {direction.level} “{direction.title}”
        </span>
        <Button variant="secondary" disabled={maxed} loading={dispatch.isPending} onClick={() => dispatch.mutate({ type: 'dev.levelUp', id: active.id })}>
          {maxed ? 'Max level' : `Level up to ${direction.level + 1}`}
        </Button>
        <p className="text-xs text-content-tertiary">For testing: adds just enough points for the next level of this account's direction, with the usual level-up notification.</p>

        <span className="typography-body-small-14px-semibold mt-2">Special events</span>
        <p className="text-xs text-content-tertiary">
          Starts one today, whatever your direction and history. If no regular fits it, one is made up who does. These change your regulars for good, so try them on a spare account.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SPECIALS.map((s) => (
            <button
              key={s.kind}
              type="button"
              disabled={dispatch.isPending}
              onClick={() => start(s.kind, s.label)}
              className="flex flex-col gap-0.5 rounded-xl border border-border-primary bg-surface-primary p-3 text-left hover:border-brand-primary-default disabled:opacity-50"
            >
              <span className="typography-body-small-14px-semibold">{s.label}</span>
              <span className="text-xs text-content-secondary">{s.note}</span>
            </button>
          ))}
        </div>
        {done && <p className="text-xs text-success-content">{done}</p>}
        {dispatch.error && <p className="text-xs text-error-content">{errorText(dispatch.error)}</p>}
      </CardContent>
    </Card>
  )
}
