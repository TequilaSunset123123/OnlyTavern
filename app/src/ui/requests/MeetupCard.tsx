import {
  Alert,
  Badge,
  Button,
  CalendarIcon,
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
import { errorText, freebieText, money } from '../format'
import { useCelebration, useHoldBack } from './celebration'
import { Actions, DealCard, Pop, Rise } from './DealMotion'
import { DealAmount, DealHeader, type DealTone } from './DealParts'

// An offline meetup (plan.md §4.3, step 5): cash, off the platform. Shown in the chat
// (under his invitation; once it has happened, before his message after it) and on the
// Requests page. Layout: DealParts.tsx; motion: DealMotion.tsx.

/** Same as meetups.maxAheadDays in the preset; the engine rejects anything further. */
const MAX_AHEAD = 14
const HIDE_HELP = 'Leave it out of what co-creators know. Takes effect once the account has one.'

/** Where he is since the scandal (only on the Requests page; the chat says it under the conversation). */
function afterScandal(r: Regular | undefined, day: number): string {
  if (!r) return ''
  const blocked = r.conditions.find((c) => c.id === 'blocked')
  const low = r.conditions.find((c) => c.id === 'lyingLow')
  if (blocked) return blocked.by === 'him' ? ' He blocked you.' : ' You blocked him.'
  if (low && low.until > day) return ' He is lying low for a while.'
  return ' He came back.'
}

const inDays = (target: number, day: number) => (target - day === 1 ? 'tomorrow' : `in ${target - day} days`)

/** What happened when you met (engine/meetups.ts rolled it). */
const OUTCOME: Record<NonNullable<Meetup['outcome']>, (m: Meetup) => string> = {
  smooth: () => 'A good night.',
  bonus: () => 'He loved it and paid extra.',
  noShow: () => 'He did not show up.',
  creep: () => 'He got creepy; you left early with part of the cash. He may fixate on you now.',
  wife: () => 'His wife caught you. The scandal cost you subscribers.',
}

/** What he offered: as a client, or (you asked, he does not think you worth it) a few dollars or nothing. */
const OFFER_LABEL = { paid: 'Cash offered, no platform fee', lowball: 'All he thinks you are worth', free: 'He wants it for free', worship: 'He is thrilled, but will not pay' }

/** Status chip, tone, the day line and the money label for each state. */
function look(m: Meetup, day: number): { status: string; tone: DealTone; subtitle: string; label: string; cents: number } {
  switch (m.status) {
    case 'open':
      return { status: m.askedBy ? 'You asked' : 'Invitation', tone: 'waiting', subtitle: `Day ${m.day} · answer by day ${m.replyBy}`, label: OFFER_LABEL[m.terms ?? 'paid'], cents: m.offerCents }
    case 'accepted':
      return { status: 'Accepted', tone: 'pending', subtitle: `Meeting on day ${m.meetDay} · ${inDays(m.meetDay ?? day, day)}`, label: m.terms === 'free' || m.terms === 'worship' ? 'He will not pay' : 'Cash on the day', cents: m.offerCents }
    case 'done': {
      const paid = m.paidCents ?? m.offerCents
      if ((m.terms === 'free' || m.terms === 'worship') && m.outcome !== 'noShow' && m.outcome !== 'wife') return { status: 'Freebie', tone: 'failed', subtitle: `Met on day ${m.meetDay}`, label: 'He paid nothing', cents: 0 }
      return paid
        ? { status: 'Paid', tone: 'paid', subtitle: `Met on day ${m.meetDay}`, label: 'Cash received', cents: paid }
        : { status: m.outcome === 'noShow' ? 'No-show' : 'No money', tone: 'failed', subtitle: `Day ${m.meetDay}`, label: 'Cash offered', cents: m.offerCents }
    }
    case 'declined':
      return { status: 'Declined', tone: 'closed', subtitle: `Day ${m.closedDay ?? m.day}`, label: 'Cash offered', cents: m.offerCents }
    case 'cancelled':
      return { status: 'Cancelled', tone: 'closed', subtitle: 'You cancelled', label: 'Cash offered', cents: m.offerCents }
    case 'expired':
      return { status: 'Expired', tone: 'closed', subtitle: 'You did not answer in time', label: 'Cash offered', cents: m.offerCents }
  }
}

export function MeetupCard({
  accountId,
  day,
  meetup,
  regular,
  message,
  delay = 0,
  replayAt = null,
  still = false,
}: {
  accountId: string
  day: number
  meetup: Meetup
  regular?: Regular
  message?: Message | null
  /** Seconds before the card comes in (in the chat: after its bubble). */
  delay?: number
  /** In the chat, a meetup that happened shows how it went again, this many seconds in. */
  replayAt?: number | null
  /** No entrance of its own: it comes in with the chat (a settled card you already watched settle). */
  still?: boolean
}) {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Replaying: shown as still to come until the moment it happened.
  const held = useHoldBack(replayAt)
  const m: Meetup = held ? { ...meetup, status: 'accepted', outcome: undefined, paidCents: undefined } : meetup
  const l = look(m, day)
  const run = (action: Parameters<typeof dispatch.mutateAsync>[0]) => dispatch.mutateAsync(action).catch((e) => setError(errorText(e)))
  const celebrate = useCelebration(m.status, m.status === 'accepted' ? 'accepted' : m.status === 'done' ? (m.paidCents ? 'completed' : 'failed') : null)
  const pop = { accepted: '✓ Accepted', completed: `✓ Completed · ${money(m.paidCents ?? 0)} cash`, failed: '✗ No money' }

  return (
    <DealCard pulse={m.status === 'open'} celebrate={celebrate} delay={delay} still={still}>
      <Card className="w-full rounded-2xl">
        <CardContent className="flex flex-col gap-4">
          <Rise delay={0.15}>
            <DealHeader
              icon={<CalendarIcon className="size-6" />}
              title={
                <>
                  Meetup
                  {regular && (
                    <>
                      {' with '}
                      <button type="button" className="underline" onClick={() => navigate(`/messages/${regular.id}`)}>
                        {regular.name}
                      </button>
                    </>
                  )}
                  {m.hidden && m.status !== 'declined' && (
                    <Badge className="ml-2">Hidden</Badge>
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
          {m.status === 'done' && m.outcome && (
            <Rise delay={0.23}>
              <p className="text-sm text-content-secondary">
                {freebieText(m.terms, m.outcome, m.paidCents ?? 0)?.line ?? OUTCOME[m.outcome](m)}
                {m.outcome === 'wife' ? afterScandal(regular, day) : ''}
              </p>
            </Rise>
          )}
          <Rise delay={0.31}>
            <DealAmount label={l.label} cents={l.cents} tone={l.tone}>
              <Pop celebrate={celebrate} label={celebrate ? pop[celebrate] : ''} />
            </DealAmount>
          </Rise>

          {error && <Alert variant="error">{error}</Alert>}
          <Rise delay={0.39}>
            <Actions step={m.status}>
              {m.status === 'open' && (
                <div className="flex gap-2">
                  <Button size="40" variant="brand" className="flex-1" onClick={() => setAccepting(true)}>
                    Accept
                  </Button>
                  <Button
                    size="40"
                    variant="secondary"
                    className="flex-1"
                    disabled={dispatch.isPending}
                    onClick={() => run({ type: 'meetup.decline', id: accountId, meetupId: m.id })}
                  >
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
                    disabled={held || dispatch.isPending}
                    onCheckedChange={(hidden) => run({ type: 'meetup.hide', id: accountId, meetupId: m.id, hidden })}
                  />
                  <Button
                    size="40"
                    variant="secondary"
                    className="self-start"
                    disabled={held || dispatch.isPending}
                    onClick={() => run({ type: 'meetup.cancel', id: accountId, meetupId: m.id })}
                  >
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
