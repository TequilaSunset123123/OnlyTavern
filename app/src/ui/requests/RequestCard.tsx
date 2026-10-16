import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FlameIcon,
  TextArea,
  VideoIcon,
} from '@fanvue/ui'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { Message, Regular, Request, Tag, VaultItem } from '../../api'
import { useDispatch } from '../../hooks/useAccounts'
import { useDeliveryCheck, useTags, useVault } from '../../hooks/useContent'
import { errorText, money } from '../format'
import { MediaTile } from '../MediaTile'
import { useCelebration, useHoldBack } from './celebration'
import { Actions, DealCard, Pop, Rise } from './DealMotion'
import { DealAmount, DealHeader, type DealTone } from './DealParts'
import { NOT_PAID } from './labels'

// A custom request (plan.md §4.3, step 5), shown in the chat (under his ask while it is
// open; after your delivery once it is settled) and on the Requests page. The engine
// decides what they want and whether what you send matches; this card only shows it and
// sends your choices. Layout: DealParts.tsx; motion: DealMotion.tsx.

const left = (due: number, day: number) => (due === day ? 'due today' : `${due - day} day${due - day === 1 ? '' : 's'} left`)

/** Status chip, tone, the day line and the money label for each state. */
function look(q: Request, day: number): { status: string; tone: DealTone; subtitle: string; label: string } {
  switch (q.status) {
    case 'open':
      return { status: 'New', tone: 'waiting', subtitle: `Day ${q.day} · answer by day ${q.dueDay}`, label: 'Offers, paid on delivery' }
    case 'accepted':
      return { status: 'Accepted', tone: 'pending', subtitle: `Due day ${q.dueDay} · ${left(q.dueDay, day)}`, label: 'Paid on delivery' }
    case 'delivered':
      return q.delivery?.paid
        ? { status: 'Paid', tone: 'paid', subtitle: `Delivered · Day ${q.delivery.day}`, label: 'Payment received' }
        : { status: 'Not paid', tone: 'failed', subtitle: `Delivered · Day ${q.delivery?.day ?? q.day}`, label: 'Not paid' }
    case 'declined':
      return { status: 'Declined', tone: 'closed', subtitle: `Day ${q.closedDay ?? q.day}`, label: 'Offered' }
    case 'expired':
      return { status: 'Expired', tone: 'closed', subtitle: q.acceptedDay !== undefined ? 'You did not deliver in time' : 'You did not answer in time', label: 'Offered' }
  }
}

export function RequestCard({
  accountId,
  day,
  request,
  regular,
  message,
  items,
  delay = 0,
  replayAt = null,
  still = false,
}: {
  accountId: string
  day: number
  request: Request
  /** Shown on the Requests page; in the chat the fan is obvious. */
  regular?: Regular
  message?: Message | null
  items: (VaultItem | null)[]
  /** Seconds before the card comes in (in the chat: after its bubble). */
  delay?: number
  /** In the chat, a settled custom shows how it was settled again, this many seconds in. */
  replayAt?: number | null
  /** No entrance of its own: it comes in with the chat (a settled card you already watched settle). */
  still?: boolean
}) {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const { data: tags = [] } = useTags()
  const [delivering, setDelivering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Replaying: shown as still waiting for your delivery until the moment it was paid (or not).
  const held = useHoldBack(replayAt)
  const q: Request = held ? { ...request, status: 'accepted', delivery: undefined } : request
  const l = look(q, day)
  const act = (type: 'request.accept' | 'request.decline') =>
    dispatch.mutateAsync({ type, id: accountId, requestId: q.id }).catch((e) => setError(errorText(e)))
  const celebrate = useCelebration(
    `${q.status}:${q.delivery?.paid ?? ''}`,
    q.status === 'accepted' ? 'accepted' : q.status === 'delivered' ? (q.delivery?.paid ? 'completed' : 'failed') : null,
  )
  const pop = { accepted: '✓ Accepted', completed: `✓ Completed · ${money(q.offerCents)} earned`, failed: '✗ Not paid' }

  return (
    <DealCard pulse={q.status === 'open'} celebrate={celebrate} delay={delay} still={still}>
      <Card className="w-full rounded-2xl">
        <CardContent className="flex flex-col gap-4">
          <Rise delay={0.15}>
            <DealHeader
              icon={<VideoIcon className="size-6" />}
              title={
                <>
                  Custom request
                  {regular && (
                    <>
                      {' from '}
                      <button type="button" className="underline" onClick={() => navigate(`/messages/${regular.id}`)}>
                        {regular.name}
                      </button>
                    </>
                  )}
                </>
              }
              subtitle={l.subtitle}
              status={l.status}
              tone={l.tone}
            />
          </Rise>
          {regular && (
            <Rise delay={0.2}>
              <p className="text-sm text-content-secondary">{message ? `“${message.text}”` : 'Open the chat to read their message.'}</p>
            </Rise>
          )}
          <Rise delay={0.23} className="flex flex-wrap items-center gap-1">
            {q.tags.map((id) => (
              <Badge key={id} variant="brandLight">
                {tags.find((t) => t.id === id)?.en ?? id}
              </Badge>
            ))}
            <Badge leftIcon={<FlameIcon size={16} />}>{q.intensity}</Badge>
          </Rise>
          {/* On the Requests page the delivery shows here; in the chat your message above shows it. */}
          {regular && q.status === 'delivered' && (
            <div className="flex flex-wrap gap-1">
              {items.map((item, i) => (
                <div key={item?.id ?? i} className="w-20">
                  <MediaTile item={item} />
                </div>
              ))}
            </div>
          )}
          <Rise delay={0.31}>
            <DealAmount label={l.label} cents={q.offerCents} tone={l.tone}>
              {q.status === 'delivered' && q.delivery?.tipCents ? <span className="text-sm text-success-content">+ {money(q.delivery.tipCents)} tip</span> : null}
              {q.status === 'delivered' && q.delivery && !q.delivery.paid && <span className="text-sm text-error-content">{NOT_PAID[q.delivery.reason]}</span>}
              <Pop celebrate={celebrate} label={celebrate ? pop[celebrate] : ''} />
            </DealAmount>
          </Rise>

          {error && <Alert variant="error">{error}</Alert>}
          <Rise delay={0.39}>
            <Actions step={q.status}>
              {q.status === 'open' && (
                <div className="flex gap-2">
                  <Button size="40" variant="brand" className="flex-1" loading={dispatch.isPending} onClick={() => act('request.accept')}>
                    Accept
                  </Button>
                  <Button size="40" variant="secondary" className="flex-1" disabled={dispatch.isPending} onClick={() => act('request.decline')}>
                    Decline
                  </Button>
                </div>
              )}
              {q.status === 'accepted' && (
                <div className="flex gap-2">
                  <Button size="40" variant="brand" className="flex-1" disabled={held} onClick={() => setDelivering(true)}>
                    Deliver
                  </Button>
                  <Button size="40" variant="secondary" className="flex-1" disabled={held || dispatch.isPending} onClick={() => act('request.decline')}>
                    Back out
                  </Button>
                </div>
              )}
            </Actions>
          </Rise>
        </CardContent>
        {q.status === 'accepted' && !held && <DeliverDialog accountId={accountId} request={q} open={delivering} onOpenChange={setDelivering} />}
      </Card>
    </DealCard>
  )
}

const tagName = (tags: Tag[], id: string) => tags.find((t) => t.id === id)?.en ?? id

/** Before you send: will he pay? The same fixed rule the engine applies on delivery (requests.ts). */
function Verdict({ accountId, request: q, picked, chosen }: { accountId: string; request: Request; picked: string[]; chosen: VaultItem[] }) {
  const { data: tags = [] } = useTags()
  const { data: check } = useDeliveryCheck(accountId, q.id, picked)
  if (!picked.length || !check) return null
  if (check.paid) {
    return (
      <Alert variant="success">
        He will pay {money(q.offerCents)}.{check.score >= 0.9 ? ' A perfect match: he may tip on top.' : check.level !== q.intensity ? ` Close enough on explicitness (${check.level} for ${q.intensity}).` : ''}
      </Alert>
    )
  }
  const has = [...new Set(chosen.flatMap((v) => v.tags))]
  const problems = [
    check.missing.length > 0 &&
      `Missing ${check.missing.map((id) => tagName(tags, id)).join(' + ')}${has.length ? `: what you picked is tagged ${has.map((id) => tagName(tags, id)).join(', ')}` : ': what you picked has no tags'}.`,
    check.intensity < 0.8 && `Explicitness ${check.level}; he asked for ${q.intensity}.`,
    check.reused.length > 0 && `He has seen ${check.reused.map((id) => `“${chosen.find((v) => v.id === id)?.description ?? 'it'}”`).join(', ')} before (posted, mass-messaged or sent to him).`,
  ].filter(Boolean)
  return (
    <Alert variant="warning" title="He will not pay for this">
      <ul className="list-disc pl-4 text-sm">
        {problems.map((p) => (
          <li key={p as string}>{p}</li>
        ))}
      </ul>
    </Alert>
  )
}

/** Pick what to send. Shows what was asked for next to what you picked, and whether he will pay. */
function DeliverDialog({ accountId, request: q, open, onOpenChange }: { accountId: string; request: Request; open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const { data: vault = [] } = useVault(accountId)
  const { data: tags = [] } = useTags()
  const [picked, setPicked] = useState<string[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const chosen = vault.filter((v) => picked.includes(v.id))
  const level = Math.max(0, ...chosen.map((v) => v.intensity))
  const send = () => {
    setError(null)
    dispatch
      .mutateAsync({ type: 'request.deliver', id: accountId, requestId: q.id, vaultIds: picked, text })
      .then(() => onOpenChange(false))
      .catch((e) => setError(errorText(e)))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Deliver custom</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1 text-sm">
            <span className="mr-1 text-content-tertiary">They want</span>
            {q.tags.map((id) => (
              <Badge key={id} variant={chosen.some((v) => v.tags.includes(id)) ? 'success' : 'brandLight'}>
                {tags.find((t) => t.id === id)?.en ?? id}
              </Badge>
            ))}
            <Badge leftIcon={<FlameIcon size={16} />} variant={level === q.intensity ? 'success' : 'default'}>
              {q.intensity}
              {level && level !== q.intensity ? ` (yours: ${level})` : ''}
            </Badge>
          </div>
          <p className="text-xs text-content-tertiary">
            It has to be new to them: anything you posted, mass-messaged or sent them before does not count as a custom. Add a new item in the Vault if you need one.
          </p>
          {vault.length === 0 ? (
            <EmptyState title="Your vault is empty" description="Add the custom in the Vault first." primaryAction={<Button onClick={() => navigate('/vault')}>Open vault</Button>} />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {vault.map((v) => (
                <MediaTile
                  key={v.id}
                  item={v}
                  selected={picked.includes(v.id)}
                  onClick={() => setPicked(picked.includes(v.id) ? picked.filter((id) => id !== v.id) : [...picked, v.id])}
                />
              ))}
            </div>
          )}
          <Verdict accountId={accountId} request={q} picked={picked} chosen={chosen} />
          <TextArea label="Message (optional)" value={text} onChange={(e) => setText(e.target.value)} rows={2} />
          {error && <Alert variant="error">{error}</Alert>}
        </DialogBody>
        <DialogFooter>
          <Button variant="brand" disabled={picked.length === 0} loading={dispatch.isPending} onClick={send}>
            Send ({picked.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
