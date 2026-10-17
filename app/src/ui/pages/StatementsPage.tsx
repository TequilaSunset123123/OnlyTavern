import {
  Alert,
  ArrowDownIcon,
  ArrowUpIcon,
  BankIcon,
  Button,
  Card,
  CardContent,
  CardIcon,
  ChevronRightIcon,
  CoinIcon,
  CrownIcon,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  EmptyState,
  GiftIcon,
  HeartIcon,
  HourglassIcon,
  IconButton,
  InfoCircleIcon,
  LockerIcon,
  MessageIcon,
  PeopleIcon,
  ReceiveMoneyIcon,
  RepeatIcon,
  ReverseIcon,
  SegmentedControl,
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScrollArea,
  Tabs,
  TabsList,
  TabsTrigger,
  TextField,
  UserAddIcon,
} from '@fanvue/ui'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@fanvue/ui/charts'
import { type ReactNode, useEffect, useState } from 'react'
import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import type { DailyStat, LedgerEntry, LedgerKind, Statistics } from '../../api'
import balanceArt from '../../assets/statements/balance.webp'
import { useActiveAccount, useDispatch, useStatements, useStatistics } from '../../hooks/useAccounts'
import { useDirections } from '../../hooks/useMessages'
import { count, errorText, money } from '../format'
import { AnimatedNumber } from '../motion/AnimatedNumber'
import { useTimeTravel } from '../time/context'
import { BLUR, useRevealed } from '../time/shared'
import { PageTitle } from '../shell/PageTitle'

// Statements (2026-10-17: the Statistics page merged in, then laid out after your mock-up):
// your balance, then what you made over the period you pick (on the platform and in cash,
// and the platform part by kind), then earnings over time and your audience. Every
// transaction is behind the history button, in a drawer; the subscriber chart and who your
// fans are behind the audience card's info button, in a popup.

// The numbers you last saw on this page, per account (2026-10-16), so coming back shows
// them rising to what you have now. Kept in this browser only.
const seenKey = (accountId: string) => `onlytavern:statementsSeen:${accountId}`
function lastSeen(accountId: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(seenKey(accountId)) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}
function saveSeen(accountId: string, name: string, cents: number) {
  try {
    localStorage.setItem(seenKey(accountId), JSON.stringify({ ...lastSeen(accountId), [name]: cents }))
  } catch {
    // Storage unavailable: the numbers just show as they are.
  }
}

/**
 * A balance or total that rolls to its new value (motion-primitives' Animated number): on
 * entering the page, from what you saw last time, so you watch your earnings go up; and
 * whenever it changes while you are here (a new day, a withdrawal). While time passes (the
 * shutter, the loader, the report) it holds, so the roll plays when you are back.
 */
function Money({ accountId, name, cents }: { accountId: string; name: string; cents: number }) {
  const { busy } = useTimeTravel()
  const revealed = useRevealed()
  const [shown, setShown] = useState(() => lastSeen(accountId)[name] ?? cents)
  if (revealed && !busy && shown !== cents) setShown(cents)
  useEffect(() => {
    if (shown === cents) saveSeen(accountId, name, cents)
  }, [accountId, name, shown, cents])
  return <AnimatedNumber value={shown} format={(n) => money(Math.round(n))} springOptions={{ stiffness: 70, damping: 20 }} />
}

// Lines from daily events (engine/events.ts), told apart by their id's ending.
const EVENT_LINES: [RegExp, string][] = [
  [/-brand$/, 'Brand deal (paid to you directly, not in your balance)'],
  [/-cost$/, 'Paid out of your own pocket (not from your balance)'],
  [/-admirer$|-thank$/, 'Anonymous tip from a secret admirer'],
]

// Crowd payments are stored per day and kind, so rows read "from N fans" (plan.md §2.4).
const describe = (e: LedgerEntry) =>
  EVENT_LINES.find(([re]) => re.test(e.id))?.[1] ??
  ({
    subscription: `Subscriptions from ${e.count} new fan${e.count === 1 ? '' : 's'}`,
    renewal: `Recurring subscriptions from ${e.count} fan${e.count === 1 ? '' : 's'}`,
    tip: `Tips from ${e.count} fan${e.count === 1 ? '' : 's'}`,
    post: `Locked post bought by ${e.count} fan${e.count === 1 ? '' : 's'}`,
    message: `Paid message${e.count === 1 ? '' : 's'} unlocked by ${e.count} fan${e.count === 1 ? '' : 's'}`,
    custom: 'Custom request paid',
    offline: 'Cash from a meetup (off the platform, not in your balance)',
    payout: 'Payout request',
  })[e.kind]

const FILTERS: Record<string, LedgerKind[]> = {
  all: ['subscription', 'renewal', 'tip', 'post', 'message', 'custom', 'offline', 'payout'],
  subscriptions: ['subscription', 'renewal'],
  tips: ['tip'],
  posts: ['post'],
  messages: ['message'],
  customs: ['custom'],
  cash: ['offline'],
  payouts: ['payout'],
}

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'all', label: 'All time' },
]

/** On the platform, by kind (the breakdown's rows). */
const KINDS: { label: string; icon: ReactNode; net: (d: DailyStat) => number }[] = [
  { label: 'Subscriptions', icon: <CrownIcon size={24} />, net: (d) => d.net.subscription + d.net.renewal },
  { label: 'Tips', icon: <HeartIcon size={24} />, net: (d) => d.net.tip },
  { label: 'Locked posts', icon: <LockerIcon size={24} />, net: (d) => d.net.post },
  { label: 'Messages', icon: <MessageIcon size={24} />, net: (d) => d.net.message },
  { label: 'Customs', icon: <GiftIcon size={24} />, net: (d) => d.net.custom },
]
const onPlatform = (d: DailyStat) => KINDS.reduce((s, k) => s + k.net(d), 0)
const cash = (d: DailyStat) => d.net.offline
const sum = (days: DailyStat[], f: (d: DailyStat) => number) => days.reduce((a, d) => a + f(d), 0)

/** The period you picked, and the one before it (for "vs previous 30 days"; none for all time). */
function periodOf(history: DailyStat[], range: string) {
  const all = range === 'all'
  const n = all ? history.length : Number(range)
  return { days: history.slice(-n), previous: all ? null : history.slice(-2 * n, -n), versus: all ? null : `vs previous ${n} days` }
}

export function StatementsPage() {
  const { data: active } = useActiveAccount()
  const { data } = useStatements(active?.id)
  const { data: stats } = useStatistics(active?.id)
  const { data: directions } = useDirections(active?.id)
  const [range, setRange] = useState('30')
  const [withdrawing, setWithdrawing] = useState(false)
  // The transactions drawer, with the tab it opens on (null: closed).
  const [ledger, setLedger] = useState<string | null>(null)
  const [info, setInfo] = useState<'balance' | 'revenue' | 'audience' | null>(null)

  if (!active) return <EmptyState className="p-6" title="No account" description="Create an account first (Accounts page)." />
  if (!data || !stats) return null

  const { balances: b } = data
  const { days, previous, versus } = periodOf(stats.history, range)
  const current = directions?.all.find((d) => d.id === directions.current)
  const fee = current && directions ? directions.perks.fee[current.level - 1] : null

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <PageTitle
        title="Statements"
        actions={<IconButton variant="tertiary" size="40" icon={<ReverseIcon />} aria-label="Transactions" onClick={() => setLedger('all')} />}
      />

      <BalanceCard
        accountId={active.id}
        available={b.available}
        pending={b.pending}
        minimum={b.minPayout}
        onInfo={() => setInfo('balance')}
        onWithdraw={() => setWithdrawing(true)}
      />

      {stats.history.length === 0 ? (
        <EmptyState title="No data yet" description="Press Next day to start the simulation." />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Revenue overview" onInfo={() => setInfo('revenue')}>
              <div className="grid grid-cols-2 gap-3">
                <Tile icon={<CoinIcon size={16} />} label="Earned on platform">
                  <Big>{money(sum(days, onPlatform))}</Big>
                  <Change now={sum(days, onPlatform)} before={previous && sum(previous, onPlatform)} versus={versus} />
                </Tile>
                <Tile icon={<ReceiveMoneyIcon size={16} />} label="Cash (off platform)">
                  <Big>{money(sum(days, cash))}</Big>
                  <Change now={sum(days, cash)} before={previous && sum(previous, cash)} versus={versus} />
                </Tile>
              </div>
              <button
                type="button"
                className="flex w-full items-center gap-3 border-t border-border-primary pt-4 text-left"
                onClick={() => setLedger('payouts')}
              >
                <span className="text-(--color-brand-primary-default)">
                  <BankIcon size={24} />
                </span>
                <span className="mr-auto">Paid out</span>
                <span className="typography-body-default-16px-semibold">
                  <Money accountId={active.id} name="paidOut" cents={b.paidOut} />
                </span>
                <ChevronRightIcon size={24} />
              </button>
            </Section>

            <Section title="Revenue breakdown" aside="On-platform earnings">
              <Breakdown days={days} />
            </Section>
          </div>

          <SegmentedControl className="self-start" options={RANGES} value={range} onChange={setRange} />

          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <EarningsCard days={days} previous={previous} versus={versus} />
            <Section title="Audience & retention" onInfo={() => setInfo('audience')}>
              <Audience stats={stats} days={days} previous={previous} versus={versus} />
            </Section>
          </div>
        </>
      )}

      <Transactions entries={data.entries} filter={ledger} onFilter={setLedger} />
      <InfoDialog open={info === 'balance'} onClose={() => setInfo(null)} title="Your balance">
        <p>
          <b>Current balance</b> is what you can withdraw now: what you earned on the platform more than 7 days ago, minus what you have
          paid out. <b>Pending</b> is the last 7 days, still held by the platform.
        </p>
        <p>Cash from meetups and brand deals is paid to you directly, so it never shows here.</p>
      </InfoDialog>
      <InfoDialog open={info === 'revenue'} onClose={() => setInfo(null)} title="Revenue overview">
        <p>
          <b>Earned on platform</b> is what fans paid you on the site, after the platform's cut
          {fee !== null && current ? ` (${Math.round(fee * 100)}% at Lv ${current.level}; it grows as you level up)` : ''}.
        </p>
        <p>
          <b>Cash (off platform)</b> is paid to you in person or by brands: the platform takes nothing, and it is not in your balance.
        </p>
        <p>Both are for the period you pick below the cards; the breakdown splits the platform part by kind.</p>
      </InfoDialog>
      <AudienceDialog open={info === 'audience'} onClose={() => setInfo(null)} stats={stats} days={days} />
      <WithdrawDialog accountId={active.id} available={b.available} minimum={b.minPayout} open={withdrawing} onOpenChange={setWithdrawing} />
    </div>
  )
}

/** A titled card (display serif), with an info button or a note on the right. */
function Section({ title, onInfo, aside, children }: { title: string; onInfo?: () => void; aside?: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <CardContent className="flex h-full flex-col gap-4 px-0 py-0">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-2xl">{title}</h2>
          {onInfo && <IconButton variant="tertiary" size="24" icon={<InfoCircleIcon className="size-4" />} aria-label={`About ${title}`} onClick={onInfo} />}
          {aside && <span className="ml-auto text-sm text-content-tertiary">{aside}</span>}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

/** A figure inside a section: a small icon by its label, the number and a line under it. */
function Tile({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-border-primary bg-surface-primary p-4">
      <div className="flex items-center gap-2 text-sm text-content-secondary">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-(--color-brand-primary-muted) text-(--color-brand-primary-default)">{icon}</span>
        <span className="min-w-0 leading-tight">{label}</span>
      </div>
      {children}
    </div>
  )
}

const Big = ({ children }: { children: ReactNode }) => <div className="typography-header-heading-xs mt-2">{children}</div>

/** "↑ +12% vs previous 30 days", "— No change"; nothing to compare for all time. Green when it went the good way (`fewerIsBetter`: expired subscribers). */
function Change({
  now,
  before,
  versus,
  as = 'percent',
  fewerIsBetter = false,
}: {
  now: number
  before: number | null
  versus: string | null
  as?: 'percent' | 'count'
  fewerIsBetter?: boolean
}) {
  if (before === null || versus === null) return null
  const diff = now - before
  const text =
    diff === 0 ? null : as === 'count' ? `${diff > 0 ? '+' : ''}${count(diff)}` : before === 0 ? 'New' : `${diff > 0 ? '+' : ''}${Math.round((diff / Math.abs(before)) * 100)}%`
  return (
    <div className="mt-1 text-xs text-content-tertiary">
      {text ? (
        <span className={`flex items-center gap-1 text-sm font-semibold ${diff > 0 !== fewerIsBetter ? 'text-[#7dffb0]' : 'text-[#ff8fa3]'}`}>
          {diff > 0 ? <ArrowUpIcon size={16} /> : <ArrowDownIcon size={16} />}
          {text}
        </span>
      ) : (
        <span className="text-sm">—</span>
      )}
      <div>{text ? versus : 'No change'}</div>
    </div>
  )
}

/** Your balance on the night-city picture: what you can withdraw, what is pending, the button. */
function BalanceCard(props: { accountId: string; available: number; pending: number; minimum: number; onInfo: () => void; onWithdraw: () => void }) {
  return (
    <Card className="relative overflow-hidden p-5">
      <img
        src={balanceArt}
        alt=""
        className="pointer-events-none absolute inset-0 size-full object-cover object-right opacity-50 [mask-image:linear-gradient(to_right,transparent_10%,black_75%)] sm:opacity-100 sm:[mask-image:linear-gradient(to_right,transparent_35%,black_70%)]"
      />
      <CardContent className="relative flex flex-col gap-4 px-0 py-0">
        <div className="flex items-center gap-2">
          <span className="typography-body-default-16px-semibold">Your balance</span>
          <IconButton variant="tertiary" size="24" icon={<InfoCircleIcon className="size-4" />} aria-label="About your balance" onClick={props.onInfo} />
        </div>
        <div className="flex gap-6">
          <div className="border-l border-border-primary pl-4">
            <div className="typography-header-heading-xs text-(--color-brand-primary-default) sm:typography-header-heading-md">
              <Money accountId={props.accountId} name="available" cents={props.available} />
            </div>
            <div className="text-content-secondary">Current balance</div>
          </div>
          <div className="border-l border-border-primary pl-4">
            <div className="typography-header-heading-xs text-(--color-brand-primary-default) sm:typography-header-heading-md">
              <Money accountId={props.accountId} name="pending" cents={props.pending} />
            </div>
            <div className="text-content-secondary">Pending balance</div>
          </div>
        </div>
        <p className="typography-body-small-14px-regular text-content-secondary">
          Earnings stay pending for 7 days. Minimum withdrawal is {money(props.minimum)}.
        </p>
        <Button variant="brand" className="self-start" leftIcon={<CardIcon size={24} />} disabled={props.available < props.minimum} onClick={props.onWithdraw}>
          Request withdrawal
        </Button>
      </CardContent>
    </Card>
  )
}

/** One line of a breakdown: (icon,) label, a bar for its share, the figure, the share. */
function ShareRow({ icon, label, value, share }: { icon?: ReactNode; label: string; value: string; share: number }) {
  return (
    <div className={`grid ${icon ? 'grid-cols-[24px_minmax(0,7rem)_1fr_auto_2.5rem]' : 'grid-cols-[minmax(0,6rem)_1fr_auto_2.5rem]'} items-center gap-3`}>
      {icon && <span className="text-(--color-brand-primary-default)">{icon}</span>}
      <span className="truncate text-sm">{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-surface-primary">
        <span className="block h-full rounded-full bg-(--color-brand-primary-default)" style={{ width: `${share * 100}%` }} />
      </span>
      <span className="typography-body-small-14px-semibold text-right">{value}</span>
      <span className="text-right text-xs text-content-tertiary">{Math.round(share * 100)}%</span>
    </div>
  )
}

/** The platform part of the period by kind: amount and share. */
function Breakdown({ days }: { days: DailyStat[] }) {
  const total = sum(days, onPlatform)
  return (
    <div className="flex flex-col gap-3">
      {KINDS.map((k) => (
        <ShareRow key={k.label} icon={k.icon} label={k.label} value={money(sum(days, k.net))} share={total > 0 ? sum(days, k.net) / total : 0} />
      ))}
    </div>
  )
}

const earningsConfig = { total: { label: 'Earned', color: 'var(--color-brand-primary-default)' } } satisfies ChartConfig
const subscribersConfig = { subscribers: { label: 'Subscribers', color: 'var(--color-brand-primary-default)' } } satisfies ChartConfig

/** Everything you made in the period, platform and cash, day by day. */
function EarningsCard({ days, previous, versus }: { days: DailyStat[]; previous: DailyStat[] | null; versus: string | null }) {
  const total = (d: DailyStat) => onPlatform(d) + cash(d)
  const chartData = days.map((d) => ({ day: `D${d.day}`, total: total(d) / 100 }))
  return (
    <Card className="p-5">
      <CardContent className="flex flex-col gap-3 px-0 py-0">
        <div className="typography-body-default-16px-semibold">Total earned</div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="typography-header-heading-md">{money(sum(days, total))}</div>
          <Change now={sum(days, total)} before={previous && sum(previous, total)} versus={versus} />
        </div>
        <ChartContainer config={earningsConfig} className="h-56 w-full">
          <AreaChart accessibilityLayer data={chartData}>
            <defs>
              <linearGradient id="statements-earned" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-total)" stopOpacity={0.45} />
                <stop offset="100%" stopColor="var(--color-total)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="5 3" />
            <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
            <YAxis tickLine={false} axisLine={false} width={40} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area dataKey="total" type="monotone" stroke="var(--color-total)" strokeWidth={2} fill="url(#statements-earned)" />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

/** Subscribers now and over the period: who joined, who left, how many stayed. */
function Audience({ stats, days, previous, versus }: { stats: Statistics; days: DailyStat[]; previous: DailyStat[] | null; versus: string | null }) {
  const now = stats.history.at(-1)?.subscribers ?? 0
  // Subscribers when the period started (0 when it starts with the page).
  const before = stats.history[stats.history.length - days.length - 1]?.subscribers ?? 0
  const joined = sum(days, (d) => d.newSubscribers)
  const left = sum(days, (d) => d.churned)
  const kept = before + joined > 0 ? 1 - left / (before + joined) : 1
  return (
    <div className="grid grid-cols-2 gap-3">
      <Tile icon={<PeopleIcon className="size-4" />} label="Total subscribers">
        <Big>{count(now)}</Big>
        <Change now={now} before={previous ? before : null} versus={versus} as="count" />
      </Tile>
      <Tile icon={<UserAddIcon size={16} />} label="New subscribers">
        <Big>{count(joined)}</Big>
        <Change now={joined} before={previous && sum(previous, (d) => d.newSubscribers)} versus={versus} as="count" />
      </Tile>
      <Tile icon={<HourglassIcon size={16} />} label="Expired">
        <Big>{count(left)}</Big>
        <Change now={left} before={previous && sum(previous, (d) => d.churned)} versus={versus} as="count" fewerIsBetter />
      </Tile>
      <Tile icon={<RepeatIcon size={16} />} label="Retention">
        <Big>{Math.round(kept * 100)}%</Big>
        <div className="mt-1 text-xs text-content-tertiary">stayed this period</div>
      </Tile>
    </div>
  )
}

/** Behind the audience card's info button: subscribers over the period, and who your fans are. */
function AudienceDialog({ open, onClose, stats, days }: { open: boolean; onClose: () => void; stats: Statistics; days: DailyStat[] }) {
  const totalSubs = Math.max(1, stats.segments.reduce((a, s) => a + s.count, 0))
  const chartData = days.map((d) => ({ day: `D${d.day}`, subscribers: d.subscribers }))
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md" mobilePresentation="card" overlayProps={BLUR}>
        <DialogHeader>
          <DialogTitle>Audience</DialogTitle>
          <DialogDescription>{days.length ? `Day ${days[0].day} – ${days.at(-1)!.day}` : 'No days yet'}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="typography-body-small-14px-semibold">Subscribers</div>
            <ChartContainer config={subscribersConfig} className="h-44 w-full">
              <LineChart accessibilityLayer data={chartData}>
                <CartesianGrid vertical={false} strokeDasharray="5 3" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line dataKey="subscribers" type="monotone" stroke="var(--color-subscribers)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </div>
          <div className="flex flex-col gap-3">
            <div className="typography-body-small-14px-semibold">Who your fans are</div>
            {stats.segments.map((s) => (
              <ShareRow key={s.id} label={s.label} value={count(s.count)} share={s.count / totalSubs} />
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="brand" onClick={onClose}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A short explanation behind an info button, in the same popup as the day's report. */
function InfoDialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" mobilePresentation="card" overlayProps={BLUR}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3 text-sm text-content-secondary [&_b]:text-content-primary">{children}</DialogBody>
        <DialogFooter>
          <Button variant="brand" onClick={onClose}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Every transaction, newest first, by kind: a drawer from the history button (or Paid out, on its tab). */
function Transactions({ entries, filter, onFilter }: { entries: LedgerEntry[]; filter: string | null; onFilter: (f: string | null) => void }) {
  const tab = filter ?? 'all'
  const rows = entries.filter((e) => FILTERS[tab].includes(e.kind))
  return (
    <Drawer open={filter !== null} onOpenChange={(o) => !o && onFilter(null)}>
      <DrawerContent position="right" size="lg">
        <DrawerHeader>
          <DrawerTitle>Transactions</DrawerTitle>
        </DrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 pt-0">
          <Tabs value={tab} onValueChange={onFilter}>
            <TabsList scrollable>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
              <TabsTrigger value="tips">Tips</TabsTrigger>
              <TabsTrigger value="posts">Locked posts</TabsTrigger>
              <TabsTrigger value="messages">Messages</TabsTrigger>
              <TabsTrigger value="customs">Customs</TabsTrigger>
              <TabsTrigger value="cash">Cash</TabsTrigger>
              <TabsTrigger value="payouts">Payouts</TabsTrigger>
            </TabsList>
          </Tabs>
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-content-tertiary">
              {tab === 'payouts' ? 'No withdrawals yet. Request one under Your balance.' : 'Nothing here yet. Press Next day to let your fans do something.'}
            </p>
          ) : (
            <TableCard size="condensed">
              <TableScrollArea>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Fee</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell intent="sideLabel" className="whitespace-nowrap">
                          Day {e.day}
                        </TableCell>
                        <TableCell>{describe(e)}</TableCell>
                        <TableCell className="text-right">{e.gross ? money(e.gross) : '—'}</TableCell>
                        <TableCell className="text-right">{e.fee ? money(e.fee) : '—'}</TableCell>
                        <TableCell className="text-right font-semibold">{money(e.net)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableScrollArea>
            </TableCard>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function WithdrawDialog(props: {
  accountId: string
  available: number
  minimum: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const dispatch = useDispatch()
  const [dollars, setDollars] = useState('')
  const [error, setError] = useState<string | null>(null)
  const amount = Math.round(Number(dollars || props.available / 100) * 100)

  const submit = () => {
    setError(null)
    dispatch
      .mutateAsync({ type: 'payout.request', id: props.accountId, amount })
      .then(() => {
        setDollars('')
        props.onOpenChange(false)
      })
      .catch((e) => setError(errorText(e)))
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Request withdrawal</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <TextField
            label="Amount (USD)"
            inputMode="decimal"
            placeholder={(props.available / 100).toFixed(2)}
            value={dollars}
            onChange={(e) => setDollars(e.target.value)}
            helperText={`Available ${money(props.available)} · minimum ${money(props.minimum)}`}
          />
          {error && <Alert variant="error">{error}</Alert>}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button variant="brand" loading={dispatch.isPending} onClick={submit}>
            Withdraw
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
