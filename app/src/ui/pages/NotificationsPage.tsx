import { BellIcon, Card, CardContent, EmptyState, Tabs, TabsList, TabsTrigger } from '@fanvue/ui'
import { useState } from 'react'
import type { EngineEvent } from '../../api'
import { useActiveAccount } from '../../hooks/useAccounts'
import { useFeed, useNotifications } from '../../hooks/useContent'
import { count, money } from '../format'
import { ClockControl } from '../shell/ClockControl'

const s = (n: number) => (n === 1 ? '' : 's')

// Notification texts are templates over engine events (plan.md §4.5); no model involved.
function describe(e: EngineEvent, postText: (id: string) => string): string {
  switch (e.type) {
    case 'subscribers':
      return `${count(e.count)} new subscriber${s(e.count)}`
    case 'churn':
      return `${count(e.count)} subscription${s(e.count)} expired`
    case 'tips':
      return `${count(e.count)} tip${s(e.count)}, ${money(e.gross)} in total`
    case 'milestone':
      return `You reached ${count(e.subscribers)} subscribers 🎉`
    case 'payout':
      return `Withdrawal of ${money(e.amount)} requested`
    case 'post':
      return `${postText(e.postId)}: ${count(e.views)} view${s(e.views)}, ${count(e.likes)} like${s(e.likes)}, ${count(e.comments)} comment${s(e.comments)}`
    case 'purchases':
      return `${count(e.count)} fan${s(e.count)} unlocked ${postText(e.postId)} (${money(e.gross)})`
  }
}

const FILTERS: Record<string, EngineEvent['type'][]> = {
  all: ['subscribers', 'churn', 'tips', 'milestone', 'payout', 'post', 'purchases'],
  subscriptions: ['subscribers', 'churn', 'milestone'],
  tips: ['tips'],
  posts: ['post', 'purchases'],
}

export function NotificationsPage() {
  const { data: active } = useActiveAccount()
  const { data: events = [] } = useNotifications(active?.id)
  const { data: feed } = useFeed(active?.id)
  const [filter, setFilter] = useState('all')

  if (!active) return <EmptyState className="p-6" title="No account" description="Create an account first (Accounts page)." />

  const postText = (id: string) => {
    const p = feed?.posts.find((x) => x.id === id)
    if (!p) return 'a deleted post'
    const t = p.text || p.items.find(Boolean)?.description || 'your post'
    return `“${t.length > 40 ? `${t.slice(0, 40)}…` : t}”`
  }
  const shown = events.filter((e) => FILTERS[filter].includes(e.type))
  const days = [...new Set(shown.map((e) => e.day))]

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 pt-[calc(env(safe-area-inset-top,0px)+16px)]">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="typography-header-heading-sm mr-auto">Notifications</h1>
        <div className="w-full sm:w-auto">
          <ClockControl />
        </div>
      </div>
      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
          <TabsTrigger value="tips">Tips</TabsTrigger>
          <TabsTrigger value="posts">Posts</TabsTrigger>
        </TabsList>
      </Tabs>
      {shown.length === 0 && <EmptyState title="Nothing yet" description="Notifications from the last 30 days show up here." />}
      {days.map((day) => (
        <Card key={day}>
          <CardContent className="flex flex-col gap-3">
            <div className="typography-body-small-14px-semibold text-content-tertiary">Day {day}</div>
            {shown
              .filter((e) => e.day === day)
              .map((e, i) => (
                <div key={i} className="flex items-start gap-3">
                  <BellIcon size={16} className="mt-1 shrink-0 text-(--color-brand-primary-default)" />
                  <span>{describe(e, postText)}</span>
                </div>
              ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
