import {
  Alert,
  ArrowLeftIcon,
  Avatar,
  Badge,
  Button,
  Chip,
  ChatInput,
  ChatMessage,
  Count,
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  IconButton,
  LockerIcon,
  ProgressBar,
  Tabs,
  TabsList,
  TabsTrigger,
  TextField,
  VaultIcon,
} from '@fanvue/ui'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import type { InboxThread, Meetup, Message, Request, ThreadView } from '../../api'
import { useActiveAccount, useDispatch } from '../../hooks/useAccounts'
import { useTags, useVault } from '../../hooks/useContent'
import { useFanWriter, useInbox, useThread } from '../../hooks/useMessages'
import { errorText, money } from '../format'
import { listedBefore, markSeenFans, saveListed, seenFans } from '../messages/arrivals'
import { BulkPane } from '../messages/BulkPane'
import { MediaTile } from '../MediaTile'
import { SoftRise } from '../motion/SoftRise'
import { celebratedIds, markCelebrated } from '../requests/celebrated'
import { MeetupCard } from '../requests/MeetupCard'
import { RequestCard } from '../requests/RequestCard'
import { useTimeTravel } from '../time/context'
import { VaultPickerDialog } from '../VaultPickerDialog'
import { PageTitle } from '../shell/PageTitle'

// Layout: Fanzly's Messages (All Chats / Bulk Message, filter chips) with Fastt's
// fan profile column on wide screens (plan.md §8.3). Phones show one pane at a time.

const SEGMENT_BADGE: Record<string, string> = { whale: 'VIP', simp: 'Superfan', hater: 'Hater', freeloader: 'Freebie hunter' }
const FILTERS = ['All', 'Unread', 'Tipped', 'Dormant'] as const
/** Personalities and behaviours worth a warning colour on the fan's profile (conditions always get one). */
const RED_FLAGS = ['stalker', 'misogynist', 'obsessive', 'troll']
const WHY_NOT = { price: 'too pricey for them', taste: 'not their taste', mood: 'not in the mood', liked: '' }

/** The engine decides on the spot; the fan's reply carries the reason. */
function whyNot(view: ThreadView, messageId: string): string {
  const d = view.messages.flatMap((x) => x.intent?.ppv ?? []).find((x) => x.messageId === messageId)
  return d && WHY_NOT[d.reason] ? ` · ${WHY_NOT[d.reason]}` : ''
}

/**
 * New regulars in All Chats: fans whose conversation you have never opened and whom this
 * browser has not shown yet (arrivals.ts). They stay out of the list while time is passing,
 * then toss in once you are back; after that they are remembered. (Remembering alone made
 * the first visit after an update file everyone away as seen, new fans included.)
 */
function useArrivals(accountId: string | undefined, threads: InboxThread[]) {
  const { busy } = useTimeTravel()
  const seen = accountId ? seenFans(accountId) : new Set<string>()
  const fresh = new Set(threads.filter((t) => !t.opened && !seen.has(t.regular.id)).map((t) => t.regular.id))
  const key = threads.map((t) => t.regular.id).join(',')
  useEffect(() => {
    if (accountId && !busy && key) markSeenFans(accountId, key.split(','))
  }, [accountId, busy, key])
  return { fresh, hold: busy }
}

/**
 * Regulars who drop out of All Chats because they went dormant (you left them alone too
 * long): the ones All Chats showed last time (arrivals.ts listedBefore) and that are dormant
 * now. They are shown once more where they were, then tossed out of the list, after the
 * time-passing screens if those are up. What All Chats shows is saved once they are gone.
 */
function useDepartures(accountId: string | undefined, all: InboxThread[], listed: InboxThread[], enabled: boolean) {
  const { busy } = useTimeTravel()
  const [gone, setGone] = useState<string[]>([])
  const before = accountId && enabled ? listedBefore(accountId) : []
  const here = new Set(listed.map((t) => t.regular.id))
  const leaving = all.filter((t) => before.includes(t.regular.id) && !here.has(t.regular.id) && t.regular.status === 'dormant' && !gone.includes(t.regular.id))
  const leavingKey = leaving.map((t) => t.regular.id).join(',')
  const listedKey = listed.map((t) => t.regular.id).join(',')
  useEffect(() => {
    if (busy || !leavingKey) return
    const timer = setTimeout(() => setGone((g) => [...g, ...leavingKey.split(',')]), 700)
    return () => clearTimeout(timer)
  }, [busy, leavingKey])
  useEffect(() => {
    if (accountId && enabled && !busy && !leavingKey && all.length) saveListed(accountId, listedKey ? listedKey.split(',') : [])
  }, [accountId, enabled, busy, leavingKey, listedKey, all.length])
  return new Set(leaving.map((t) => t.regular.id))
}

/** A card tossed onto the pile, and off it (after Motion's spring animations, motion.dev/docs/react-animation). */
const TOSS = {
  initial: { opacity: 0, y: -56, x: 28, rotate: -9, scale: 0.86 },
  animate: { opacity: 1, y: 0, x: 0, rotate: 0, scale: 1 },
  exit: { opacity: 0, x: 220, y: 36, rotate: 14, scale: 0.82, transition: { duration: 0.45, ease: [0.55, 0, 0.75, 0.2] as const } },
}

export function MessagesPage() {
  const { regularId } = useParams()
  const navigate = useNavigate()
  const { data: active } = useActiveAccount()
  const { data: inbox } = useInbox(active?.id)
  const [tab, setTab] = useState(regularId === 'bulk' ? 'bulk' : 'chats')
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All')

  const listed = (inbox?.threads ?? []).filter((t) =>
    filter === 'Unread' ? t.unread > 0 : filter === 'Tipped' ? t.tipped > 0 : filter === 'Dormant' ? t.regular.status === 'dormant' : t.regular.status === 'active',
  )
  const arrivals = useArrivals(active?.id, listed)
  const leaving = useDepartures(active?.id, inbox?.threads ?? [], listed, filter === 'All')
  // New ones wait out the time-passing screens; fans going dormant stay a moment, in their
  // place, before they are tossed out.
  const threads = (inbox?.threads ?? []).filter(
    (t) => leaving.has(t.regular.id) || (listed.includes(t) && !(arrivals.hold && arrivals.fresh.has(t.regular.id))),
  )

  if (!active) return <EmptyState className="p-6" title="No account" description="Create an account first (Accounts page)." />
  const open = regularId && regularId !== 'bulk' ? regularId : undefined
  const showList = !open && tab === 'chats'

  return (
    <div className="flex h-full min-h-0">
      {/* Inbox column (always on desktop; on phones only when nothing is open) */}
      <section className={`${showList || tab === 'bulk' ? 'flex' : 'hidden'} w-full min-w-0 flex-col border-border-primary md:flex md:w-80 md:shrink-0 md:border-r`}>
        <div className="flex flex-col gap-3 p-4">
          <PageTitle title="Messages" />
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v)
              navigate(v === 'bulk' ? '/messages/bulk' : '/messages')
            }}
          >
            <TabsList>
              <TabsTrigger value="chats">All Chats</TabsTrigger>
              <TabsTrigger value="bulk">Bulk Message</TabsTrigger>
            </TabsList>
          </Tabs>
          {tab === 'chats' && (
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <Chip key={f} size="32" selected={filter === f} onClick={() => setFilter(f)}>
                  {f}
                </Chip>
              ))}
            </div>
          )}
        </div>
        {tab === 'chats' && (
          <div className="relative min-h-0 flex-1 overflow-y-auto">
            {/* relative: popLayout takes a leaving row out of the flow, positioned in here. */}
            {threads.length === 0 && (
              <EmptyState
                className="p-6"
                title={inbox?.threads.length ? 'Nothing here' : 'No messages yet'}
                description="Fans who like you start messaging after a while. Keep posting and press Next day."
              />
            )}
            <AnimatePresence mode="popLayout">
              {threads.map((t) => {
                const tossed = arrivals.fresh.has(t.regular.id)
                const order = [...arrivals.fresh].indexOf(t.regular.id)
                return (
                  // layout: the other rows slide to make room for a new one, or close the gap a leaving one leaves.
                  <motion.div
                    key={t.regular.id}
                    layout
                    initial={tossed ? TOSS.initial : false}
                    animate={TOSS.animate}
                    exit={TOSS.exit}
                    transition={{ type: 'spring', stiffness: 260, damping: 18, delay: tossed ? 0.15 + order * 0.14 : 0 }}
                  >
                    <ThreadRow thread={t} active={t.regular.id === open} onClick={() => navigate(`/messages/${t.regular.id}`)} />
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
        {tab === 'bulk' && (
          <div className="min-h-0 flex-1 overflow-y-auto md:hidden">
            <BulkPane accountId={active.id} />
          </div>
        )}
      </section>

      {/* Conversation / bulk pane */}
      <section className={`${open ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col md:flex`}>
        {open ? (
          <Conversation key={open} accountId={active.id} regularId={open} onBack={() => navigate('/messages')} />
        ) : tab === 'bulk' ? (
          <div className="hidden min-h-0 flex-1 overflow-y-auto md:block">
            <BulkPane accountId={active.id} />
          </div>
        ) : (
          <EmptyState className="m-auto p-6" title="Select a conversation" description="Or send a message to many fans at once in Bulk Message." />
        )}
      </section>
    </div>
  )
}

function preview(m: Message | null, pending: boolean): string {
  if (pending) return 'New message'
  if (!m) return ''
  const prefix = m.from === 'me' ? 'You: ' : ''
  if (m.intent?.deal?.step === 'ask') return `${m.intent.deal.kind === 'custom' ? '📝 Custom request' : '📅 Meetup invite'}: ${m.text}`
  if (m.delivery) return 'You: 📝 Custom delivered'
  if (m.ppv) return `${prefix}🔒 Paid message ${money(m.ppv.priceCents)}`
  if (m.tipCents) return `💰 Tipped ${money(m.tipCents)}`
  return prefix + m.text
}

function ThreadRow({ thread: t, active, onClick }: { thread: InboxThread; active: boolean; onClick: () => void }) {
  const badge = SEGMENT_BADGE[t.regular.segment]
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-buttons-tertiary-hover ${active ? 'bg-surface-primary' : ''}`}
    >
      <Avatar size={48} alt={t.regular.name} fallback={t.regular.name.slice(0, 2).toUpperCase()} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="typography-body-default-16px-semibold truncate">{t.regular.name}</span>
          {badge && <Badge variant={t.regular.segment === 'whale' ? 'success' : 'default'}>{badge}</Badge>}
        </div>
        <div className={`truncate text-sm ${t.unread || t.pending ? 'text-content-primary' : 'text-content-tertiary'}`}>{preview(t.last, t.pending)}</div>
      </div>
      {(t.unread > 0 || t.pending) && <Count value={Math.max(t.unread, 1)} variant="default" size="24" />}
    </button>
  )
}

function Conversation({ accountId, regularId, onBack }: { accountId: string; regularId: string; onBack: () => void }) {
  const { data: view } = useThread(accountId, regularId)
  const writer = useFanWriter(accountId, view)
  const { mutate } = useDispatch()
  const [profileOpen, setProfileOpen] = useState(false)

  // Seen everything that is written. Once per new message: the view stays stale
  // until the save comes back, and asking again meanwhile would loop.
  const written = view?.messages.filter((m) => m.state === 'sent').length ?? 0
  const marked = useRef('')
  useEffect(() => {
    const key = `${regularId}:${written}`
    if (!view || view.read >= written || marked.current === key) return
    marked.current = key
    mutate({ type: 'dm.read', id: accountId, regularId })
  }, [view, written, accountId, regularId, mutate])

  if (!view) return null
  const r = view.regular

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border-primary p-3">
          <IconButton className="md:hidden" variant="tertiary" size="32" icon={<ArrowLeftIcon />} aria-label="Back" onClick={onBack} />
          {/* Narrow screens have no profile column: tap the fan to see it. */}
          <button type="button" className="flex min-w-0 items-center gap-3 text-left xl:pointer-events-none" onClick={() => setProfileOpen(true)}>
            <Avatar size={40} alt={r.name} fallback={r.name.slice(0, 2).toUpperCase()} />
            <div className="min-w-0">
              <div className="typography-body-default-16px-semibold truncate">{r.name}</div>
              <div className="truncate text-xs text-content-tertiary">
                @{r.handle} · spent {money(r.spent)}
                <span className="xl:hidden"> · profile ›</span>
              </div>
            </div>
          </button>
        </header>
        <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{r.name}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <FanDetails view={view} />
            </DialogBody>
          </DialogContent>
        </Dialog>
        <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto p-4">
          <MessageList accountId={accountId} view={view} writer={writer} />
        </div>
        {view.away ? (
          <div className="border-t border-border-primary p-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)]">
            <Alert variant="warning">{AWAY[view.away]}</Alert>
          </div>
        ) : (
          <Composer accountId={accountId} regularId={regularId} />
        )}
      </div>
      <FanPanel view={view} />
    </div>
  )
}

/** How many of the latest entries come in one after another when you open a chat (older ones are off screen). */
const STAGGERED = 12
/** Seconds between two entries coming in. */
const STEP = 0.08
/** A card under a bubble comes in this long after the bubble. */
const CARD_AFTER = 0.15
/** A settled card shows its earlier look this long after it came in, then how it was settled. */
const SETTLE_AFTER = 0.6
/** And what follows waits for the settling to play. */
const SETTLE_TAKES = 1.1

type Entry =
  | { kind: 'message'; key: string; m: Message }
  | { kind: 'custom'; key: string; q: Request }
  | { kind: 'meetup'; key: string; o: Meetup }
/** When it comes in; for a settled card, when it replays its settling (null: it does not). */
type Timing = { delay: number; replayAt: number | null }
const NOW: Timing = { delay: 0, replayAt: null }

const dealId = (e: Entry) => (e.kind === 'custom' ? e.q.id : e.kind === 'meetup' ? e.o.id : null)

/**
 * The conversation as a timeline. A custom or meetup sits under the fan message that
 * opened it until it is settled; then it moves to where it was settled (after your
 * delivery, or when you met), just before his reaction. Fan messages still queued for
 * the model are not shown yet; only the one being written shows "typing".
 */
function timeline(view: ThreadView, failed: Record<string, string>): Entry[] {
  const writing = view.messages.find((m) => m.state === 'pending' && !failed[m.id])
  const entries: Entry[] = []
  for (const m of view.messages) {
    if (m.state === 'pending' && !failed[m.id] && m !== writing) continue
    const d = m.from === 'fan' ? m.intent?.deal : undefined
    const q = d?.kind === 'custom' && d.step === 'delivered' ? view.requests.find((x) => x.id === d.id && x.status === 'delivered') : undefined
    const o = d?.kind === 'meetup' && d.step === 'met' ? view.meetups.find((x) => x.id === d.id && x.status === 'done') : undefined
    if (q) entries.push({ kind: 'custom', key: `deal:${q.id}`, q })
    if (o) entries.push({ kind: 'meetup', key: `deal:${o.id}`, o })
    entries.push({ kind: 'message', key: `${m.id}:${m.state}`, m })
  }
  return entries
}

/**
 * When each entry comes in, one after another. The latest settled card among them, if you
 * have not watched it settle yet, plays that before the rest follow; the others just come in.
 */
function schedule(entries: Entry[], watched: (id: string) => boolean): [string, Timing][] {
  const latest = entries.findLastIndex((e) => e.kind !== 'message')
  const replay = latest >= 0 && !watched(dealId(entries[latest])!) ? latest : -1
  let t = 0
  return entries.map((e, i) => {
    const timing: Timing = { delay: t, replayAt: i === replay ? t + SETTLE_AFTER : null }
    t += i === replay ? SETTLE_AFTER + SETTLE_TAKES : STEP
    return [e.key, timing]
  })
}

const fanSide = (e: Entry | undefined) => !!e && (e.kind !== 'message' || e.m.from === 'fan')

/**
 * Everything soft-rises in, one by one. When you open the chat the latest entries come in
 * top to bottom, and a settled custom or meetup replays how it was settled before his
 * reaction appears; later entries come in as they arrive. The fan's avatar sits once,
 * beside the last of his entries in a row.
 */
function MessageList({ accountId, view, writer }: { accountId: string; view: ThreadView; writer: ReturnType<typeof useFanWriter> }) {
  const entries = timeline(view, writer.failed)
  // Settled cards whose completion you have already watched here (celebrated.ts).
  const [seen] = useState(() => celebratedIds())
  const watched = (id: string) => seen.has(`${accountId}:${id}`)
  const [plan, setPlan] = useState(() => {
    const recent = entries.slice(-STAGGERED)
    return new Map<string, Timing>([...entries.slice(0, -STAGGERED).map((e) => [e.key, NOW] as [string, Timing]), ...schedule(recent, watched)])
  })
  // Entries that just arrived: scheduled once, in order, from now.
  const fresh = entries.filter((e) => !plan.has(e.key))
  if (fresh.length) setPlan(new Map([...plan, ...schedule(fresh, watched)]))
  const settled = new Set(entries.flatMap((e) => dealId(e) ?? []))
  // Whatever replays now has been watched: next time it just comes in.
  const replaying = entries.flatMap((e) => (plan.get(e.key)?.replayAt != null ? [`${accountId}:${dealId(e)}`] : []))
  const replayKey = replaying.join(',')
  useEffect(() => {
    if (replayKey) markCelebrated(replayKey.split(','))
  }, [replayKey])

  return (
    <div className="flex flex-col gap-3">
      {entries.map((e, i) => {
        const t = plan.get(e.key) ?? NOW
        const avatar = fanSide(e) && !fanSide(entries[i + 1])
        if (e.kind === 'message') {
          return (
            <SoftRise key={e.key} delay={t.delay}>
              <MessageBubble accountId={accountId} view={view} message={e.m} writer={writer} avatar={avatar} cardDelay={t.delay + CARD_AFTER} settled={settled} />
            </SoftRise>
          )
        }
        return (
          <SoftRise key={e.key} delay={t.delay}>
            <FanRow view={view} avatar={avatar}>
              {e.kind === 'custom' ? (
                <RequestCard accountId={accountId} day={view.day} request={e.q} items={[]} delay={t.delay} replayAt={t.replayAt} still={t.replayAt === null} />
              ) : (
                <MeetupCard accountId={accountId} day={view.day} meetup={e.o} delay={t.delay} replayAt={t.replayAt} still={t.replayAt === null} />
              )}
            </FanRow>
          </SoftRise>
        )
      })}
    </div>
  )
}

/** Something on the fan's side that is not a text bubble, lined up with his bubbles; his avatar beside it if it is his last. */
function FanRow({ view, avatar, children }: { view: ThreadView; avatar: boolean; children: ReactNode }) {
  return (
    <div className="flex w-full items-end gap-2">
      <div className="w-10 shrink-0">{avatar && <Avatar size={40} alt={view.regular.name} fallback={view.regular.name.slice(0, 1)} />}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function MessageBubble({
  accountId,
  view,
  message: m,
  writer,
  avatar,
  cardDelay,
  settled,
}: {
  accountId: string
  view: ThreadView
  message: Message
  writer: ReturnType<typeof useFanWriter>
  /** His avatar goes with this message (the last of his in a row). */
  avatar: boolean
  cardDelay: number
  /** Customs and meetups shown where they were settled, not under this message. */
  settled: Set<string>
}) {
  const user = m.from === 'me' ? 'sender' : 'receiver'
  const time = `Day ${m.day}`
  if (m.state === 'pending') {
    const failed = writer.failed[m.id]
    if (!failed) return <ChatMessage user="receiver" variant="typing" showAvatar={avatar} avatarFallback={view.regular.name.slice(0, 1)} />
    return (
      <FanRow view={view} avatar={avatar}>
        <Alert variant="error" title="The model could not write this reply">
          <div className="flex flex-col gap-2">
            <span className="text-sm">{failed}</span>
            <Button size="32" variant="secondary" className="self-start" onClick={() => writer.retry(m.id)}>
              Retry
            </Button>
          </div>
        </Alert>
      </FanRow>
    )
  }
  const card = m.from === 'fan' ? dealCard(accountId, view, m, cardDelay, settled) : null
  return (
    <div className={`flex flex-col gap-1 ${m.from === 'me' ? 'items-end' : 'items-start'}`}>
      {m.ppv && (
        // No "Unlock" pill here: this is your side of the chat; the line below says whether it sold.
        <div className={`flex max-w-full flex-wrap gap-1 ${m.from === 'me' ? 'justify-end' : ''}`}>
          {m.ppv.vaultIds.map((id) => (
            <div key={id} className="w-32">
              <MediaTile item={view.items[id] ?? null} />
            </div>
          ))}
        </div>
      )}
      {m.ppv && (
        <span className="text-xs text-content-tertiary">
          <LockerIcon size={16} className="inline" /> {money(m.ppv.priceCents)} · {m.ppv.paid ? 'Bought' : `Not bought${whyNot(view, m.id)}`}
          {m.massId ? ' · mass message' : ''}
        </span>
      )}
      {m.delivery && <Delivery view={view} delivery={m.delivery} />}
      {m.text && (
        // [&_p]:grow: the library lays text and time out with flex-wrap + justify-end, so a
        // line of text that wraps above the time got pushed to the right. Growing keeps it left.
        <ChatMessage className="[&_p]:grow" user={user} message={m.text} time={time} showAvatar={m.from === 'fan' && avatar && !card} avatarFallback={view.regular.name.slice(0, 1)} />
      )}
      {m.writtenBy === 'corpus' && <span className="pl-12 text-xs text-content-tertiary">Preset line: the model was not available</span>}
      {m.tipCents ? <Badge className={m.from === 'fan' ? 'ml-12' : ''} variant="success">💰 Tipped {money(m.tipCents)}</Badge> : null}
      {card && (
        <FanRow view={view} avatar={avatar}>
          {card}
        </FanRow>
      )}
    </div>
  )
}

/** What you sent for a custom request (the card after it says whether he paid). */
function Delivery({ view, delivery }: { view: ThreadView; delivery: NonNullable<Message['delivery']> }) {
  return (
    <div className="flex max-w-full flex-wrap justify-end gap-1">
      {delivery.vaultIds.map((id) => (
        <div key={id} className="w-32">
          <MediaTile item={view.items[id] ?? null} />
        </div>
      ))}
    </div>
  )
}

/** The request or invitation a fan message opened, with its buttons, until it is settled (then it shows further down); null if none. */
function dealCard(accountId: string, view: ThreadView, m: Message, delay: number, settled: Set<string>): ReactNode {
  const q = view.requests.find((x) => x.messageId === m.id)
  if (q && !settled.has(q.id)) return <RequestCard accountId={accountId} day={view.day} request={q} items={[]} delay={delay} />
  const o = view.meetups.find((x) => x.messageId === m.id)
  if (o && !settled.has(o.id)) return <MeetupCard accountId={accountId} day={view.day} meetup={o} delay={delay} />
  return null
}

const AWAY = {
  gone: 'He blocked you after his wife found out. He will not be back.',
  lyingLow: 'He is lying low since his wife found out. He was devoted enough to come back once things calm down.',
  blocked: 'You blocked him.',
}

function Composer({ accountId, regularId }: { accountId: string; regularId: string }) {
  const dispatch = useDispatch()
  const { data: vault = [] } = useVault(accountId)
  const [text, setText] = useState('')
  const [attached, setAttached] = useState<string[]>([])
  const [price, setPrice] = useState('9.99')
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = (value: string) => {
    setError(null)
    dispatch
      .mutateAsync({
        type: 'dm.send',
        id: accountId,
        regularId,
        message: { text: value, ...(attached.length ? { ppv: { vaultIds: attached, priceCents: Math.round(Number(price) * 100) } } : {}) },
      })
      .then(() => {
        setText('')
        setAttached([])
      })
      .catch((e) => setError(errorText(e)))
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border-primary p-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)]">
      {error && <Alert variant="error">{error}</Alert>}
      {attached.length > 0 && (
        <div className="flex items-end gap-2">
          <div className="flex gap-1">
            {attached.map((id) => (
              <div key={id} className="w-16">
                <MediaTile item={vault.find((v) => v.id === id) ?? null} onClick={() => setAttached(attached.filter((x) => x !== id))} />
              </div>
            ))}
          </div>
          <TextField label="Price (USD)" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="w-32" />
        </div>
      )}
      <ChatInput
        placeholder={attached.length ? 'Say something about it…' : 'Type a message'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onSubmit={send}
        loading={dispatch.isPending}
        showFileButton
        onFileClick={() => setPicking(true)}
        fileButtonAriaLabel="Attach paid content from the vault"
        attachmentPreviews={null}
      />
      <VaultPickerDialog open={picking} onOpenChange={setPicking} vault={vault} selected={attached} onChange={setAttached} />
    </div>
  )
}

function FanPanel({ view }: { view: ThreadView }) {
  const r = view.regular
  return (
    <aside className="hidden w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border-primary p-4 xl:flex">
      <div className="flex flex-col items-center gap-2 text-center">
        <Avatar size={64} alt={r.name} fallback={r.name.slice(0, 2).toUpperCase()} />
        <div className="typography-body-default-16px-semibold">{r.name}</div>
        <div className="text-xs text-content-tertiary">@{r.handle}</div>
      </div>
      <FanDetails view={view} />
      <div className="mt-auto flex items-center gap-2 text-xs text-content-tertiary">
        <VaultIcon size={16} /> Attach vault items with the paperclip to sell a paid message.
      </div>
    </aside>
  )
}

/** Who this fan is and what makes them buy (plan.md §4.4). */
function FanDetails({ view }: { view: ThreadView }) {
  const { data: tags = [] } = useTags()
  const r = view.regular
  const purchases = view.messages.filter((m) => m.ppv?.paid)
  const l = view.loyalty
  const hostile = r.conditions.find((c) => c.id === 'hostile')
  const progress = l.next === null ? 100 : Math.round(((l.points - l.from) / (l.next - l.from)) * 100)
  return (
    <div className="flex flex-col gap-4">
      {SEGMENT_BADGE[r.segment] && <Badge className="self-center">{SEGMENT_BADGE[r.segment]}</Badge>}
      <p className="text-sm text-content-secondary">{r.bio}</p>
      {hostile && !view.away && <Alert variant="warning">Turned on you on day {hostile.since}. Write to him regularly and he may come round.</Alert>}
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
        <dt className="text-content-tertiary">Personality</dt>
        <dd className="flex flex-wrap justify-end gap-1">
          <Badge variant={RED_FLAGS.includes(view.personality.id) ? 'errorColour' : 'default'}>{view.personality.label}</Badge>
        </dd>
        {view.behaviours.length > 0 && (
          <>
            <dt className="text-content-tertiary">Behaviour</dt>
            <dd className="flex flex-wrap justify-end gap-1">
              {view.behaviours.map((b) => (
                <Badge key={b.id} variant={RED_FLAGS.includes(b.id) ? 'errorColour' : 'default'}>
                  {b.label}
                </Badge>
              ))}
            </dd>
          </>
        )}
        {view.conditions.length > 0 && (
          <>
            <dt className="text-content-tertiary">Condition</dt>
            <dd className="flex flex-wrap justify-end gap-1">
              {view.conditions.map((c) => (
                <Badge key={c.id} variant="errorColour">
                  {c.label}
                </Badge>
              ))}
            </dd>
          </>
        )}
      </dl>
      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-content-tertiary">Spent</dt>
        <dd className="text-right font-semibold">{money(r.spent)}</dd>
        <dt className="text-content-tertiary">Purchases</dt>
        <dd className="text-right">{purchases.length}</dd>
        <dt className="text-content-tertiary">Regular since</dt>
        <dd className="text-right">Day {r.since}</dd>
        <dt className="text-content-tertiary">Status</dt>
        <dd className="text-right">{view.away === 'gone' ? 'Blocked you' : view.away === 'lyingLow' ? 'Lying low' : view.away === 'blocked' ? 'Blocked' : r.status === 'active' ? 'Active' : 'Dormant'}</dd>
      </dl>
      <div className="flex flex-col gap-2">
        <span className="typography-body-small-14px-semibold">Likes</span>
        <div className="flex flex-wrap gap-1">
          {r.likes.map((id) => (
            <Badge key={id} variant="brandLight">
              {tags.find((t) => t.id === id)?.en ?? id}
            </Badge>
          ))}
        </div>
      </div>
      <ProgressBar
        variant="brand"
        value={progress}
        title={`Loyalty · Lv ${l.level} “${l.name}”`}
        helperRight={l.next === null ? (l.level < 5 ? `Lv ${l.cap} is his limit` : 'Max level') : `${l.next - l.points} to Lv ${l.level + 1}`}
        helperLeft="Every message, purchase, tip, custom and meetup builds loyalty. Loyal fans tip, order customs and ask to meet more, and buy more readily; a Fanatic buys anything."
      />
    </div>
  )
}
