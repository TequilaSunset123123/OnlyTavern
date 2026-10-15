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
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import type { InboxThread, Message, ThreadView } from '../../api'
import { useActiveAccount, useDispatch } from '../../hooks/useAccounts'
import { useTags, useVault } from '../../hooks/useContent'
import { useFanWriter, useInbox, useThread } from '../../hooks/useMessages'
import { errorText, money } from '../format'
import { BulkPane } from '../messages/BulkPane'
import { MediaTile } from '../MediaTile'
import { MeetupCard } from '../requests/MeetupCard'
import { NOT_PAID } from '../requests/labels'
import { RequestCard } from '../requests/RequestCard'
import { VaultPickerDialog } from '../VaultPickerDialog'

// Layout: Fanzly's Messages (All Chats / Bulk Message, filter chips) with Fastt's
// fan profile column on wide screens (plan.md §8.3). Phones show one pane at a time.

const SEGMENT_BADGE: Record<string, string> = { whale: 'VIP', simp: 'Superfan', hater: 'Hater', freeloader: 'Freebie hunter' }
const FILTERS = ['All', 'Unread', 'Tipped', 'Dormant'] as const
const WHY_NOT = { price: 'too pricey for them', taste: 'not their taste', mood: 'not in the mood', liked: '' }

/** The engine decides on the spot; the fan's reply carries the reason. */
function whyNot(view: ThreadView, messageId: string): string {
  const d = view.messages.flatMap((x) => x.intent?.ppv ?? []).find((x) => x.messageId === messageId)
  return d && WHY_NOT[d.reason] ? ` · ${WHY_NOT[d.reason]}` : ''
}

export function MessagesPage() {
  const { regularId } = useParams()
  const navigate = useNavigate()
  const { data: active } = useActiveAccount()
  const { data: inbox } = useInbox(active?.id)
  const [tab, setTab] = useState(regularId === 'bulk' ? 'bulk' : 'chats')
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All')

  if (!active) return <EmptyState className="p-6" title="No account" description="Create an account first (Accounts page)." />

  const threads = (inbox?.threads ?? []).filter((t) =>
    filter === 'Unread' ? t.unread > 0 : filter === 'Tipped' ? t.tipped > 0 : filter === 'Dormant' ? t.regular.status === 'dormant' : t.regular.status === 'active',
  )
  const open = regularId && regularId !== 'bulk' ? regularId : undefined
  const showList = !open && tab === 'chats'

  return (
    <div className="flex h-full min-h-0">
      {/* Inbox column (always on desktop; on phones only when nothing is open) */}
      <section className={`${showList || tab === 'bulk' ? 'flex' : 'hidden'} w-full min-w-0 flex-col border-border-primary md:flex md:w-80 md:shrink-0 md:border-r`}>
        <div className="flex flex-col gap-3 p-4 pt-[calc(env(safe-area-inset-top,0px)+16px)]">
          <h1 className="typography-header-heading-sm">Messages</h1>
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
          <div className="min-h-0 flex-1 overflow-y-auto">
            {threads.length === 0 && (
              <EmptyState
                className="p-6"
                title={inbox?.threads.length ? 'Nothing here' : 'No messages yet'}
                description="Fans who like you start messaging after a while. Keep posting and press Next day."
              />
            )}
            {threads.map((t) => (
              <ThreadRow key={t.regular.id} thread={t} active={t.regular.id === open} onClick={() => navigate(`/messages/${t.regular.id}`)} />
            ))}
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
  if (m.intent?.request?.phase === 'ask') return `📝 Custom request: ${m.text}`
  if (m.intent?.meetup?.phase === 'invite') return `📅 Meetup invite: ${m.text}`
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
        <header className="flex items-center gap-3 border-b border-border-primary p-3 pt-[calc(env(safe-area-inset-top,0px)+12px)]">
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
          <div className="flex flex-col gap-3">
            {view.messages.map((m) => (
              <MessageBubble key={m.id} accountId={accountId} view={view} message={m} writer={writer} />
            ))}
          </div>
        </div>
        <Composer accountId={accountId} regularId={regularId} />
      </div>
      <FanPanel view={view} />
    </div>
  )
}

function MessageBubble({ accountId, view, message: m, writer }: { accountId: string; view: ThreadView; message: Message; writer: ReturnType<typeof useFanWriter> }) {
  const user = m.from === 'me' ? 'sender' : 'receiver'
  const time = `Day ${m.day}`
  if (m.state === 'pending') {
    const failed = writer.failed[m.id]
    if (!failed) return <ChatMessage user="receiver" variant="typing" avatarFallback={view.regular.name.slice(0, 1)} />
    return (
      <Alert variant="error" title="The model could not write this reply">
        <div className="flex flex-col gap-2">
          <span className="text-sm">{failed}</span>
          <Button size="32" variant="secondary" className="self-start" onClick={() => writer.retry(m.id)}>
            Retry
          </Button>
        </div>
      </Alert>
    )
  }
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
      {m.text && <ChatMessage user={user} message={m.text} time={time} showAvatar={m.from === 'fan'} avatarFallback={view.regular.name.slice(0, 1)} />}
      {m.writtenBy === 'corpus' && <span className="pl-12 text-xs text-content-tertiary">Preset line: the model was not available</span>}
      {m.tipCents ? <Badge variant="success">💰 Tipped {money(m.tipCents)}</Badge> : null}
      <Extras accountId={accountId} view={view} message={m} />
    </div>
  )
}

/** What you sent for a custom request, and whether the fan paid. */
function Delivery({ view, delivery }: { view: ThreadView; delivery: NonNullable<Message['delivery']> }) {
  const q = view.requests.find((x) => x.id === delivery.requestId)
  return (
    <>
      <div className="flex max-w-full flex-wrap justify-end gap-1">
        {delivery.vaultIds.map((id) => (
          <div key={id} className="w-32">
            <MediaTile item={view.items[id] ?? null} />
          </div>
        ))}
      </div>
      {q?.delivery && (
        <span className="text-xs text-content-tertiary">
          📝 Custom · {q.delivery.paid ? `Paid ${money(q.offerCents)}` : `Not paid · ${NOT_PAID[q.delivery.reason]}`}
        </span>
      )}
    </>
  )
}

/** The request or invitation a fan message carries, with its buttons. */
function Extras({ accountId, view, message: m }: { accountId: string; view: ThreadView; message: Message }) {
  if (m.from !== 'fan') return null
  const q = m.intent?.request?.phase === 'ask' && view.requests.find((x) => x.id === m.intent!.request!.requestId)
  if (q) return <RequestCard accountId={accountId} day={view.day} request={q} items={(q.delivery?.vaultIds ?? []).map((id) => view.items[id] ?? null)} />
  const o = m.intent?.meetup?.phase === 'invite' && view.meetups.find((x) => x.id === m.intent!.meetup!.meetupId)
  if (o) return <MeetupCard accountId={accountId} day={view.day} meetup={o} />
  return null
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
  const warmth = Math.round(((view.closeness - 0.7) / 0.6) * 100)
  return (
    <div className="flex flex-col gap-4">
      {SEGMENT_BADGE[r.segment] && <Badge className="self-center">{SEGMENT_BADGE[r.segment]}</Badge>}
      <p className="text-sm text-content-secondary">{r.bio}</p>
      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-content-tertiary">Spent</dt>
        <dd className="text-right font-semibold">{money(r.spent)}</dd>
        <dt className="text-content-tertiary">Purchases</dt>
        <dd className="text-right">{purchases.length}</dd>
        <dt className="text-content-tertiary">Regular since</dt>
        <dd className="text-right">Day {r.since}</dd>
        <dt className="text-content-tertiary">Status</dt>
        <dd className="text-right">{r.status === 'active' ? 'Active' : 'Dormant'}</dd>
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
        value={warmth}
        title="Warmth"
        helperRight={`×${view.closeness.toFixed(2)}`}
        helperLeft="Chat with them first: warmer fans buy more often. Content they like sells better."
      />
    </div>
  )
}
