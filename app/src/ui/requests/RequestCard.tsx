import {
  Alert,
  Badge,
  type BadgeVariant,
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
} from '@fanvue/ui'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { Message, Regular, Request, VaultItem } from '../../api'
import { useDispatch } from '../../hooks/useAccounts'
import { useTags, useVault } from '../../hooks/useContent'
import { errorText, money } from '../format'
import { MediaTile } from '../MediaTile'
import { NOT_PAID } from './labels'

// A custom request (plan.md §4.3, step 5), shown under the fan's message in the
// chat and on the Requests page. The engine decides what they want and whether
// what you send matches; this card only shows it and sends your choices.

const STATUS: Record<Exclude<Request['status'], 'delivered'>, [string, BadgeVariant]> = {
  open: ['New', 'brandLight'],
  accepted: ['Accepted', 'brand'],
  declined: ['Declined', 'default'],
  expired: ['Expired', 'default'],
}

function status(q: Request): [string, BadgeVariant] {
  if (q.status === 'delivered') return q.delivery?.paid ? ['Paid', 'success'] : ['Not paid', 'error']
  return STATUS[q.status]
}

const left = (due: number, day: number) => (due === day ? 'due today' : `${due - day} day${due - day === 1 ? '' : 's'} left`)

export function RequestCard({
  accountId,
  day,
  request: q,
  regular,
  message,
  items,
}: {
  accountId: string
  day: number
  request: Request
  /** Shown on the Requests page; in the chat the fan is obvious. */
  regular?: Regular
  message?: Message | null
  items: (VaultItem | null)[]
}) {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const { data: tags = [] } = useTags()
  const [delivering, setDelivering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [label, variant] = status(q)
  const act = (type: 'request.accept' | 'request.decline') =>
    dispatch.mutateAsync({ type, id: accountId, requestId: q.id }).catch((e) => setError(errorText(e)))

  return (
    <Card className="w-full max-w-md">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="typography-body-small-14px-semibold mr-auto">
            Custom request
            {regular && (
              <>
                {' from '}
                <button type="button" className="underline" onClick={() => navigate(`/messages/${regular.id}`)}>
                  {regular.name}
                </button>
              </>
            )}
          </span>
          <Badge variant={variant}>{label}</Badge>
        </div>
        {regular && <p className="text-sm text-content-secondary">{message ? `“${message.text}”` : 'Open the chat to read their message.'}</p>}
        <div className="flex flex-wrap items-center gap-1">
          {q.tags.map((id) => (
            <Badge key={id} variant="brandLight">
              {tags.find((t) => t.id === id)?.en ?? id}
            </Badge>
          ))}
          <Badge leftIcon={<FlameIcon size={16} />}>{q.intensity}</Badge>
        </div>
        <div className="text-sm">
          Offers <span className="font-semibold">{money(q.offerCents)}</span>, paid on delivery
          {(q.status === 'open' || q.status === 'accepted') && <span className="text-content-tertiary"> · day {q.dueDay}, {left(q.dueDay, day)}</span>}
        </div>

        {q.status === 'delivered' && q.delivery && (
          <>
            {/* In the chat the delivery itself shows the items. */}
            {regular && (
              <div className="flex flex-wrap gap-1">
                {items.map((item, i) => (
                  <div key={item?.id ?? i} className="w-20">
                    <MediaTile item={item} />
                  </div>
                ))}
              </div>
            )}
            <div className="text-sm text-content-secondary">
              {q.delivery.paid
                ? `Delivered on day ${q.delivery.day}: they paid ${money(q.offerCents)}${q.delivery.tipCents ? ` and tipped ${money(q.delivery.tipCents)}` : ''}.`
                : `Delivered on day ${q.delivery.day}: not paid, ${NOT_PAID[q.delivery.reason]}.`}
            </div>
          </>
        )}
        {q.status === 'expired' && (
          <div className="text-sm text-content-tertiary">{q.acceptedDay !== undefined ? 'You accepted but did not deliver in time.' : 'You did not answer in time.'}</div>
        )}

        {error && <Alert variant="error">{error}</Alert>}
        {q.status === 'open' && (
          <div className="flex gap-2">
            <Button size="32" variant="brand" loading={dispatch.isPending} onClick={() => act('request.accept')}>
              Accept
            </Button>
            <Button size="32" variant="secondary" disabled={dispatch.isPending} onClick={() => act('request.decline')}>
              Decline
            </Button>
          </div>
        )}
        {q.status === 'accepted' && (
          <div className="flex gap-2">
            <Button size="32" variant="brand" onClick={() => setDelivering(true)}>
              Deliver
            </Button>
            <Button size="32" variant="secondary" disabled={dispatch.isPending} onClick={() => act('request.decline')}>
              Back out
            </Button>
          </div>
        )}
      </CardContent>
      {q.status === 'accepted' && <DeliverDialog accountId={accountId} request={q} open={delivering} onOpenChange={setDelivering} />}
    </Card>
  )
}

/** Pick what to send. Shows what was asked for next to what you picked; the fan judges on sending. */
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
