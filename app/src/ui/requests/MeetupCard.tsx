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
  Select,
  SelectContent,
  SelectItem,
  SwitchField,
} from '@fanvue/ui'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { Meetup, Message, Regular } from '../../api'
import { useDispatch } from '../../hooks/useAccounts'
import { errorText, money } from '../format'
import { useCelebration } from './celebration'
import { Actions, DealCard, Pop, Rise } from './DealMotion'

// An offline meetup (plan.md §4.3, step 5): cash, off the platform. Shown under
// the fan's invitation in the chat and on the Requests page.

/** Same as meetups.maxAheadDays in the preset; the engine rejects anything further. */
const MAX_AHEAD = 14
const HIDE_HELP = 'Leave it out of what co-creators know. Takes effect once the account has one.'

const STATUS: Record<Meetup['status'], [string, BadgeVariant]> = {
  open: ['Invitation', 'brandLight'],
  accepted: ['Accepted', 'brand'],
  declined: ['Declined', 'default'],
  done: ['Done', 'success'],
  expired: ['Expired', 'default'],
  cancelled: ['Cancelled', 'default'],
}

/** Where he is since the scandal (only on the Requests page; the chat says it under the conversation). */
const afterScandal = (r: Regular | undefined, day: number) =>
  !r?.away ? '' : r.away.until === undefined ? ' He blocked you.' : r.away.until > day ? ' He is lying low for a while.' : ` He came back on day ${r.away.until}.`

const inDays = (target: number, day: number) => (target - day === 1 ? 'tomorrow' : `in ${target - day} days`)

export function MeetupCard({
  accountId,
  day,
  meetup: m,
  regular,
  message,
}: {
  accountId: string
  day: number
  meetup: Meetup
  regular?: Regular
  message?: Message | null
}) {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [label, variant] = STATUS[m.status]
  const run = (action: Parameters<typeof dispatch.mutateAsync>[0]) => dispatch.mutateAsync(action).catch((e) => setError(errorText(e)))
  const celebrate = useCelebration(m.status, m.status === 'accepted' ? 'accepted' : m.status === 'done' ? (m.paidCents ? 'completed' : 'failed') : null)
  const pop = { accepted: '✓ Accepted', completed: `✓ Completed · ${money(m.paidCents ?? 0)} cash`, failed: '✗ No money' }

  return (
    <DealCard pulse={m.status === 'open'} celebrate={celebrate}>
      <Card className="w-full">
        <CardContent className="flex flex-col gap-3">
          <Rise delay={0.15} className="flex items-center gap-2">
            <span className="typography-body-small-14px-semibold mr-auto">
              Meetup
              {regular && (
                <>
                  {' with '}
                  <button type="button" className="underline" onClick={() => navigate(`/messages/${regular.id}`)}>
                    {regular.name}
                  </button>
                </>
              )}
            </span>
            {m.hidden && m.status !== 'declined' && <Badge>Hidden</Badge>}
            <Badge variant={variant}>{label}</Badge>
          </Rise>
          {regular && (
            <Rise delay={0.23}>
              <p className="text-sm text-content-secondary">{message ? `“${message.text}”` : 'Open the chat to read their message.'}</p>
            </Rise>
          )}
          <Rise delay={0.31} className="flex flex-wrap items-center gap-x-2 text-sm">
            <span>
              Offers <span className="font-semibold">{money(m.offerCents)}</span> in cash, off the platform (no fee)
              {m.status === 'open' && <span className="text-content-tertiary"> · answer by day {m.replyBy}</span>}
            </span>
            <Pop celebrate={celebrate} label={celebrate ? pop[celebrate] : ''} />
          </Rise>
          {m.status === 'accepted' && m.meetDay !== undefined && (
            <div className="text-sm">
              Meeting on day {m.meetDay} ({inDays(m.meetDay, day)})
            </div>
          )}
          {m.status === 'done' && (
            <div className="text-sm text-content-secondary">
              {
                {
                  smooth: `Met on day ${m.meetDay}: ${money(m.paidCents ?? m.offerCents)} cash.`,
                  bonus: `Met on day ${m.meetDay}: he paid extra, ${money(m.paidCents ?? 0)} cash.`,
                  noShow: `Day ${m.meetDay}: he did not show up. No money.`,
                  creep: `Day ${m.meetDay}: he got creepy and you left early with ${money(m.paidCents ?? 0)}. He may fixate on you now.`,
                  wife: `Day ${m.meetDay}: his wife caught you. No money, and the scandal cost you subscribers.${afterScandal(regular, day)}`,
                }[m.outcome ?? 'smooth']
              }
            </div>
          )}
          {m.status === 'cancelled' && <div className="text-sm text-content-tertiary">You cancelled.</div>}
          {m.status === 'expired' && <div className="text-sm text-content-tertiary">You did not answer in time.</div>}

          {error && <Alert variant="error">{error}</Alert>}
          <Rise delay={0.39}>
            <Actions step={m.status}>
              {m.status === 'open' && (
                <div className="flex gap-2">
                  <Button size="32" variant="brand" onClick={() => setAccepting(true)}>
                    Accept
                  </Button>
                  <Button size="32" variant="secondary" disabled={dispatch.isPending} onClick={() => run({ type: 'meetup.decline', id: accountId, meetupId: m.id })}>
                    Decline
                  </Button>
                </div>
              )}
              {m.status === 'accepted' && (
                <div className="flex flex-col gap-3">
                  <SwitchField
                    size="small"
                    label="Keep it from co-creators"
                    helperText={HIDE_HELP}
                    checked={m.hidden}
                    disabled={dispatch.isPending}
                    onCheckedChange={(hidden) => run({ type: 'meetup.hide', id: accountId, meetupId: m.id, hidden })}
                  />
                  <Button size="32" variant="secondary" className="self-start" disabled={dispatch.isPending} onClick={() => run({ type: 'meetup.cancel', id: accountId, meetupId: m.id })}>
                    Cancel meeting
                  </Button>
                </div>
              )}
            </Actions>
          </Rise>
        </CardContent>
        {m.status === 'open' && <AcceptDialog accountId={accountId} day={day} meetup={m} open={accepting} onOpenChange={setAccepting} />}
      </Card>
    </DealCard>
  )
}

function AcceptDialog({ accountId, day, meetup: m, open, onOpenChange }: { accountId: string; day: number; meetup: Meetup; open: boolean; onOpenChange: (open: boolean) => void }) {
  const dispatch = useDispatch()
  const [when, setWhen] = useState(String(day + 1))
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const days = Array.from({ length: MAX_AHEAD }, (_, i) => day + 1 + i)

  const accept = () => {
    setError(null)
    dispatch
      .mutateAsync({ type: 'meetup.accept', id: accountId, meetupId: m.id, day: Number(when), hidden })
      .then(() => onOpenChange(false))
      .catch((e) => setError(errorText(e)))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Accept meetup</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <p className="text-sm text-content-secondary">
            {money(m.offerCents)} in cash. It happens when the game reaches that day; the money is counted as cash, not in your platform balance.
          </p>
          <Select label="Day" value={when} onValueChange={setWhen} fullWidth>
            <SelectContent>
              {days.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  Day {d} ({inDays(d, day)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SwitchField label="Keep it from co-creators" helperText={HIDE_HELP} checked={hidden} onCheckedChange={setHidden} />
          {error && <Alert variant="error">{error}</Alert>}
        </DialogBody>
        <DialogFooter>
          <Button variant="brand" loading={dispatch.isPending} onClick={accept}>
            Accept
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
