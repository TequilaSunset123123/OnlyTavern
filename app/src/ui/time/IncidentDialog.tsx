import { Alert, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@fanvue/ui'
import { useState } from 'react'
import type { EngineEvent, IncidentChoice, IncidentView } from '../../api'
import { useDispatch } from '../../hooks/useAccounts'
import { count, errorText, money } from '../format'
import { BLUR } from './shared'

// A stalker incident (engine/incidents.ts): his story, your options with the odds the
// engine will roll, then what came of it. It cannot be dismissed: you have to choose.

type Done = Extract<EngineEvent, { type: 'incident-done' }>

const pct = (x: number) => `${Math.round(x * 100)}%`

function optionText(kind: IncidentView['incident']['kind'], choice: IncidentChoice, chance: number): [string, string] {
  switch (choice) {
    case 'playAlong':
      return ['Play along', 'He sends you a big gift, and gets even more hooked on you.']
    case 'letDown':
      return ['Let him down gently', `${pct(chance)} he takes it. Otherwise he turns on you.`]
    case 'calm':
      return ['Calm him down', `${pct(chance)} he backs off. Otherwise he posts about you, some subscribers leave, and he turns on you.`]
    case 'block':
      return ['Block him', kind === 'courtship' ? 'He is gone for good.' : `${pct(chance)} that is the end of it. Otherwise he makes a scene on his way out.`]
  }
}

function resultText(d: Done, name: string): string {
  const lost = `${count(d.lost ?? 0)} subscriber${d.lost === 1 ? '' : 's'} left`
  return {
    gift: `${name} is over the moon and sent you ${money(d.gross ?? 0)}. He is more attached than ever.`,
    ok: `${name} took it well. For now.`,
    turned: `${name} did not take it well. He has turned on you.`,
    calmed: `${name} calmed down and apologized.`,
    escalated: `${name} lost it and posted about you: ${lost}. He has turned on you.`,
    blocked: `You blocked ${name}. He is gone.`,
    backlash: `You blocked ${name}, but not before he made a scene online: ${lost}.`,
  }[d.result]
}

/**
 * `onChoose` runs before the choice is sent: once it is resolved the incident leaves the
 * open list, so the caller keeps showing this one until `onDone`.
 */
export function IncidentDialog({ accountId, view, onChoose, onDone }: { accountId: string; view: IncidentView; onChoose: () => void; onDone: () => void }) {
  const dispatch = useDispatch()
  const [done, setDone] = useState<Done | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { incident: x, regular: r } = view

  const choose = (choice: IncidentChoice) => {
    setError(null)
    onChoose()
    dispatch
      .mutateAsync({ type: 'incident.resolve', id: accountId, incidentId: x.id, choice })
      .then((res) => setDone((res.events.find((e) => e.type === 'incident-done') as Done | undefined) ?? null))
      .catch((e) => setError(errorText(e)))
  }

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent size="sm" mobilePresentation="card" overlayProps={BLUR} onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader showClose={false}>
          <DialogTitle>{x.kind === 'courtship' ? `💌 ${r.name} is courting you` : `🚨 ${r.name} will not leave you alone`}</DialogTitle>
          <DialogDescription>Day {x.day}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <p className="text-sm">{view.story}</p>
          {error && <Alert variant="error">{error}</Alert>}
          {done ? (
            <Alert variant={done.result === 'gift' || done.result === 'ok' || done.result === 'calmed' || done.result === 'blocked' ? 'success' : 'warning'}>{resultText(done, r.name)}</Alert>
          ) : (
            <div className="flex flex-col gap-2">
              {view.options.map((o) => {
                const [label, help] = optionText(x.kind, o.choice, o.chance)
                return (
                  <button
                    key={o.choice}
                    type="button"
                    disabled={dispatch.isPending}
                    onClick={() => choose(o.choice)}
                    className="flex flex-col gap-0.5 rounded-xl border border-border-primary bg-surface-primary p-3 text-left hover:border-brand-primary-default disabled:opacity-50"
                  >
                    <span className="typography-body-small-14px-semibold">{label}</span>
                    <span className="text-xs text-content-secondary">{help}</span>
                  </button>
                )
              })}
            </div>
          )}
        </DialogBody>
        {done && (
          <DialogFooter>
            <Button variant="brand" onClick={onDone}>
              OK
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Shows open incidents one at a time while `enabled`; `onEmpty` once none are left. */
export function IncidentHost({ accountId, incidents, onEmpty }: { accountId: string; incidents: IncidentView[]; onEmpty?: () => void }) {
  const [pinned, setPinned] = useState<IncidentView | null>(null)
  const view = pinned ?? incidents[0]
  if (!view) return null
  return (
    <IncidentDialog
      key={view.incident.id}
      accountId={accountId}
      view={view}
      onChoose={() => setPinned(view)}
      onDone={() => {
        setPinned(null)
        if (incidents.filter((x) => x.incident.id !== view.incident.id).length === 0) onEmpty?.()
      }}
    />
  )
}
