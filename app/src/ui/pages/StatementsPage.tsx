import {
  Alert,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
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
} from '@fanvue/ui'
import { ChartCard } from '@fanvue/ui/charts'
import { useState } from 'react'
import type { LedgerEntry, LedgerKind } from '../../api'
import { useActiveAccount, useDispatch, useStatements } from '../../hooks/useAccounts'
import { errorText, money } from '../format'
import { ClockControl } from '../shell/ClockControl'

// Crowd payments are stored per day and kind, so rows read "from N fans" (plan.md §2.4).
const describe = (e: LedgerEntry) =>
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

export function StatementsPage() {
  const { data: active } = useActiveAccount()
  const { data } = useStatements(active?.id)
  const [filter, setFilter] = useState('all')
  const [withdrawing, setWithdrawing] = useState(false)

  if (!active) return <EmptyState className="p-6" title="No account" description="Create an account first (Accounts page)." />
  if (!data) return null

  const { balances: b, totals } = data
  const rows = data.entries.filter((e) => FILTERS[filter].includes(e.kind))

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 pt-[calc(env(safe-area-inset-top,0px)+16px)]">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="typography-header-heading-sm mr-auto">Statements</h1>
        <div className="w-full sm:w-auto">
          <ClockControl />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-3">
          <Tabs value={filter} onValueChange={setFilter}>
            <TabsList scrollable>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
              <TabsTrigger value="tips">Tips</TabsTrigger>
              <TabsTrigger value="posts">Posts</TabsTrigger>
              <TabsTrigger value="messages">Messages</TabsTrigger>
              <TabsTrigger value="customs">Customs</TabsTrigger>
              <TabsTrigger value="cash">Cash</TabsTrigger>
              <TabsTrigger value="payouts">Payouts</TabsTrigger>
            </TabsList>
          </Tabs>
          {rows.length === 0 ? (
            <EmptyState title="No data yet" description="Press Next day to let your fans do something." />
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
                        <TableCell intent="sideLabel">Day {e.day}</TableCell>
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

        {/* Balances first on phones, on the right on desktop (like OF). */}
        <div className="order-first flex flex-col gap-3 lg:order-last">
          <Card>
            <CardContent className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="typography-header-heading-xs">{money(b.available)}</div>
                  <div className="text-content-tertiary">Current balance</div>
                </div>
                <div>
                  <div className="typography-header-heading-xs">{money(b.pending)}</div>
                  <div className="text-content-tertiary">Pending balance</div>
                </div>
              </div>
              <p className="typography-body-small-14px-regular text-content-tertiary">
                Earnings stay pending for 7 days. Minimum withdrawal is {money(b.minPayout)}.
              </p>
              <Button variant="brand" fullWidth disabled={b.available < b.minPayout} onClick={() => setWithdrawing(true)}>
                Request withdrawal
              </Button>
            </CardContent>
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <ChartCard title="Subscriptions" subtitle={money(totals.subscription.net + totals.renewal.net)} />
            <ChartCard title="Tips" subtitle={money(totals.tip.net)} />
            <ChartCard title="Posts" subtitle={money(totals.post.net)} />
            <ChartCard title="Messages" subtitle={money(totals.message.net)} />
            <ChartCard title="Customs" subtitle={money(totals.custom.net)} />
            <ChartCard title="Cash (off platform)" subtitle={money(b.cash)} />
            <ChartCard title="Total earned" subtitle={money(b.earned)} />
            <ChartCard title="Paid out" subtitle={money(b.paidOut)} />
          </div>
        </div>
      </div>

      <WithdrawDialog
        accountId={active.id}
        available={b.available}
        minimum={b.minPayout}
        open={withdrawing}
        onOpenChange={setWithdrawing}
      />
    </div>
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
