import { BellIcon, Card, CardContent, EmptyState, Tabs, TabsList, TabsTrigger } from '@fanvue/ui'
import { useState } from 'react'
import type { DirectionId, EngineEvent } from '../../api'
import { useActiveAccount } from '../../hooks/useAccounts'
import { useFeed, useNotifications } from '../../hooks/useContent'
import { useInbox } from '../../hooks/useMessages'
import { count, meetupText, money } from '../format'
import { ClockControl } from '../shell/ClockControl'

const s = (n: number) => (n === 1 ? '' : 's')
/** What he was before he turned into a freeloader. */
const SEGMENT_NAME: Record<string, string> = { regular: 'a regular fan', lurker: 'a lurker', simp: 'a superfan', whale: 'a big spender', hater: 'a hater', freeloader: 'a plain freebie hunter' }
const DIRECTION_LABEL: Record<DirectionId, string> = {
  girl_next_door: 'a girl next door',
  porn_star: 'a porn star',
  egirl: 'an anime e-girl',
  escort: 'a high-end escort',
  couple: 'a couple account',
  sub: 'a sub',
  domme: 'a dominatrix',
}

// Notification texts are templates over engine events (plan.md §4.5); no model involved.
function describe(e: EngineEvent, postText: (id: string) => string, fan: (id: string) => string): string {
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
    case 'regular':
      return `${fan(e.regularId)} started talking to you`
    case 'dm':
      return `New message from ${fan(e.regularId)}`
    case 'dm-purchase':
      return `${fan(e.regularId)} unlocked your paid message (${money(e.gross)})`
    case 'dm-tip':
      return `${fan(e.regularId)} tipped you ${money(e.gross)} in messages`
    case 'mass':
      return `Mass message: ${count(e.views)} view${s(e.views)}${e.purchases ? `, ${count(e.purchases)} unlocked (${money(e.gross)})` : ''}`
    case 'request':
      return `${fan(e.regularId)} asked for a custom`
    case 'request-paid':
      return `${fan(e.regularId)} paid ${money(e.gross)} for your custom`
    case 'request-unpaid':
      return `${fan(e.regularId)} did not pay for your custom`
    case 'request-expired':
      return e.accepted ? `You missed the deadline for ${fan(e.regularId)}'s custom` : `${fan(e.regularId)}'s custom request expired`
    case 'meetup':
      if (!e.askedBy) return `${fan(e.regularId)} invited you to meet in person`
      return e.terms === 'worship'
        ? `${fan(e.regularId)} begged to meet you and thanked you like a goddess, but he will not pay`
        : e.terms === 'free'
        ? `${fan(e.regularId)} said yes to meeting you, but he will not pay: you offered yourself`
        : e.terms === 'lowball'
          ? `${fan(e.regularId)} said yes to meeting you, for ${money(e.offerCents ?? 0)}: that is all he thinks you are worth`
          : `${fan(e.regularId)} said yes to meeting you: ${money(e.offerCents ?? 0)} in cash`
    case 'meetup-done': {
      const special = meetupText(e, e.outcome, e.gross)
      if (special) return `${special.title(fan(e.regularId))}: ${special.line}`
      return {
        smooth: `You met ${fan(e.regularId)}: ${money(e.gross)} in cash`,
        bonus: `You met ${fan(e.regularId)} and he paid extra: ${money(e.gross)} in cash`,
        noShow: `${fan(e.regularId)} did not show up to your meeting`,
        creep: `${fan(e.regularId)} got creepy, you left early with ${money(e.gross)}`,
        wife: `${fan(e.regularId)}'s wife caught you: no money, ${count(e.lost ?? 0)} subscriber${s(e.lost ?? 0)} left over the scandal. ${e.returns ? 'He is lying low for now' : 'He blocked you'}`,
      }[e.outcome ?? 'smooth']
    }
    case 'loyalty-up':
      return `${fan(e.regularId)} is now a level ${e.level} fan`
    case 'meetup-expired':
      return `${fan(e.regularId)}'s invitation expired`
    case 'regular-turned':
      return `${fan(e.regularId)} turned on you${(e.level ?? 1) >= 4 ? '. He was one of your most devoted fans, so he will hate you for longer' : ''}`
    case 'hater-left':
      return `${fan(e.regularId)} got bored of hating you and went quiet`
    case 'incident':
      return e.kind === 'courtship' ? `${fan(e.regularId)} is courting you` : `${fan(e.regularId)} will not leave you alone`
    case 'incident-done':
      return {
        gift: `You played along with ${fan(e.regularId)}: he sent you ${money(e.gross ?? 0)}`,
        ok: `${fan(e.regularId)} took no for an answer`,
        turned: `${fan(e.regularId)} did not take no for an answer and turned on you`,
        calmed: `You calmed ${fan(e.regularId)} down`,
        escalated: `${fan(e.regularId)} lost it and posted about you: ${count(e.lost ?? 0)} subscriber${s(e.lost ?? 0)} left`,
        blocked: `You blocked ${fan(e.regularId)}`,
        backlash: `You blocked ${fan(e.regularId)}, but he made a scene first: ${count(e.lost ?? 0)} subscriber${s(e.lost ?? 0)} left`,
      }[e.result]
    case 'regular-entitled':
      return `${fan(e.regularId)} has had you for free too often: no longer ${SEGMENT_NAME[e.from] ?? 'the fan he was'}, he is an entitled freebie hunter now. Say no to him, or ignore him for a few days, and he turns on you`
    case 'regular-back':
      return e.reason === 'wife' ? `${fan(e.regularId)} is back after lying low` : `${fan(e.regularId)} has warmed up to you again`
    case 'direction':
      return `You changed direction: ${count(e.lost)} subscriber${s(e.lost)} left`
    case 'level-up':
      return `Level up! You reached level ${e.level} as ${DIRECTION_LABEL[e.direction]} 🎉`
  }
}

const FILTERS: Record<string, EngineEvent['type'][]> = {
  all: [
    'subscribers',
    'churn',
    'tips',
    'milestone',
    'payout',
    'post',
    'purchases',
    'regular',
    'dm',
    'dm-purchase',
    'dm-tip',
    'mass',
    'request',
    'request-paid',
    'request-unpaid',
    'request-expired',
    'meetup',
    'meetup-done',
    'meetup-expired',
    'regular-turned',
    'regular-entitled',
    'regular-back',
    'hater-left',
    'incident',
    'incident-done',
    'loyalty-up',
    'direction',
    'level-up',
  ],
  subscriptions: ['subscribers', 'churn', 'milestone', 'direction', 'level-up'],
  tips: ['tips', 'dm-tip'],
  messages: ['regular', 'dm', 'dm-purchase', 'mass', 'regular-turned', 'regular-entitled', 'regular-back', 'hater-left', 'incident', 'incident-done', 'loyalty-up'],
  posts: ['post', 'purchases'],
  requests: ['request', 'request-paid', 'request-unpaid', 'request-expired', 'meetup', 'meetup-done', 'meetup-expired'],
}

export function NotificationsPage() {
  const { data: active } = useActiveAccount()
  const { data: events = [] } = useNotifications(active?.id)
  const { data: feed } = useFeed(active?.id)
  const { data: inbox } = useInbox(active?.id)
  const [filter, setFilter] = useState('all')

  if (!active) return <EmptyState className="p-6" title="No account" description="Create an account first (Accounts page)." />

  const postText = (id: string) => {
    const p = feed?.posts.find((x) => x.id === id)
    if (!p) return 'a deleted post'
    const t = p.text || p.items.find(Boolean)?.description || 'your post'
    return `“${t.length > 40 ? `${t.slice(0, 40)}…` : t}”`
  }
  const fan = (id: string) => inbox?.threads.find((t) => t.regular.id === id)?.regular.name ?? 'A fan'
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
        <TabsList scrollable>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
          <TabsTrigger value="tips">Tips</TabsTrigger>
          <TabsTrigger value="posts">Posts</TabsTrigger>
          <TabsTrigger value="messages">Messages</TabsTrigger>
          <TabsTrigger value="requests">Requests</TabsTrigger>
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
                  <span>{describe(e, postText, fan)}</span>
                </div>
              ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
