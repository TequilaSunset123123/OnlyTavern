import { Card, CardContent, Chip, EmptyState, Tabs, TabsList, TabsTrigger } from '@fanvue/ui'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useState } from 'react'
import { useActiveAccount, useStatements } from '../../hooks/useAccounts'
import { useRequests } from '../../hooks/useMessages'
import { money } from '../format'
import { MeetupCard } from '../requests/MeetupCard'
import { RequestCard } from '../requests/RequestCard'
import { ClockControl } from '../shell/ClockControl'

/** How long a card you just settled stays under "Active" (its completion plays), before it folds away. */
const LINGER_MS = 2800

/**
 * Ids that just left `active` (you delivered, declined…): kept a moment so the card can
 * show what happened instead of vanishing at once.
 */
function useLinger(active: string[]): Set<string> {
  const key = active.join(',')
  const [prev, setPrev] = useState(key)
  const [kept, setKept] = useState<string[]>([])
  if (prev !== key) {
    const before = prev ? prev.split(',') : []
    const gone = before.filter((id) => !active.includes(id))
    setPrev(key)
    if (gone.length) setKept([...kept, ...gone])
  }
  useEffect(() => {
    if (!kept.length) return
    const t = setTimeout(() => setKept([]), LINGER_MS)
    return () => clearTimeout(t)
  }, [kept])
  return new Set(kept)
}

/** One card in the list: folds away when it leaves. */
function Item({ children }: { children: ReactNode }) {
  return (
    <motion.div className="overflow-hidden" exit={{ opacity: 0, height: 0, marginTop: -16 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  )
}

const isActive = (status: string) => status === 'open' || status === 'accepted'

/** Custom requests and offline meetups from your regulars (plan.md §8.1 Requests, step 5). */
export function RequestsPage() {
  const { data: active } = useActiveAccount()
  const { data } = useRequests(active?.id)
  const { data: statements } = useStatements(active?.id)
  const [tab, setTab] = useState('customs')
  const [showAll, setShowAll] = useState(false)
  const lingering = useLinger([
    ...(data?.requests.filter((r) => isActive(r.request.status)).map((r) => r.request.id) ?? []),
    ...(data?.meetups.filter((m) => isActive(m.meetup.status)).map((m) => m.meetup.id) ?? []),
  ])

  if (!active) return <EmptyState className="p-6" title="No account" description="Create an account first (Accounts page)." />
  if (!data) return null

  const requests = data.requests.filter((r) => showAll || isActive(r.request.status) || lingering.has(r.request.id))
  const meetups = data.meetups.filter((m) => showAll || isActive(m.meetup.status) || lingering.has(m.meetup.id))
  const shown = tab === 'customs' ? requests.length : meetups.length

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 pt-[calc(env(safe-area-inset-top,0px)+16px)]">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="typography-header-heading-sm mr-auto">Requests</h1>
        <div className="w-full sm:w-auto">
          <ClockControl />
        </div>
      </div>
      {statements && (
        // Plain cards: @fanvue/ui/charts would pull the chart library into the startup bundle.
        <div className="grid grid-cols-2 gap-3">
          <Total label="Customs (net)" value={money(statements.totals.custom.net)} />
          <Total label="Cash from meetups" value={money(statements.balances.cash)} />
        </div>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="customs">Custom requests</TabsTrigger>
          <TabsTrigger value="meetups">Meetups</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="flex gap-2">
        <Chip size="32" selected={!showAll} onClick={() => setShowAll(false)}>
          Active
        </Chip>
        <Chip size="32" selected={showAll} onClick={() => setShowAll(true)}>
          All
        </Chip>
      </div>
      {shown === 0 && (
        <EmptyState
          title="Nothing here"
          description={
            tab === 'customs'
              ? 'Regulars you have been chatting with ask for customs now and then.'
              : 'Regulars you write to a lot (5+ messages in two weeks) may invite you to meet in person.'
          }
        />
      )}
      <AnimatePresence initial={false}>
        {tab === 'customs' &&
          requests.map((r) => (
            <Item key={r.request.id}>
              <RequestCard accountId={active.id} day={data.day} request={r.request} regular={r.regular} message={r.message} items={r.items} />
            </Item>
          ))}
        {tab === 'meetups' &&
          meetups.map((m) => (
            <Item key={m.meetup.id}>
              <MeetupCard accountId={active.id} day={data.day} meetup={m.meetup} regular={m.regular} message={m.message} />
            </Item>
          ))}
      </AnimatePresence>
    </div>
  )
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent>
        <div className="typography-header-heading-xs">{value}</div>
        <div className="text-sm text-content-tertiary">{label}</div>
      </CardContent>
    </Card>
  )
}
