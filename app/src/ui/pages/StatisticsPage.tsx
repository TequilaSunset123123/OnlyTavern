import { Card, CardContent, CardHeader, CardTitle, EmptyState, ProgressBar, SegmentedControl } from '@fanvue/ui'
import {
  ChartCard,
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@fanvue/ui/charts'
import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import type { DailyStat } from '../../api'
import { useActiveAccount, useStatistics } from '../../hooks/useAccounts'
import { count, money, trend } from '../format'
import { PageTitle } from '../shell/PageTitle'

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'all', label: 'All' },
]

const earningsConfig = {
  subscriptions: { label: 'Subscriptions', color: 'var(--color-brand-primary-default)' },
  tips: { label: 'Tips', color: 'var(--color-special-chart-pink)' },
  paid: { label: 'Paid posts & messages', color: 'var(--color-special-chart-purple)' },
  customs: { label: 'Customs', color: 'var(--color-special-chart-sky)' },
  cash: { label: 'Cash', color: 'var(--color-special-chart-orange)' },
} satisfies ChartConfig

const subscribersConfig = {
  subscribers: { label: 'Subscribers', color: 'var(--color-brand-primary-default)' },
} satisfies ChartConfig

/** Everything you made that day, as on Statements: the platform (after its fee) and cash off it; payouts are not earnings. */
const earned = (d: DailyStat) => Object.entries(d.net).reduce((s, [kind, cents]) => (kind === 'payout' ? s : s + cents), 0)
const sum = (days: DailyStat[], f: (d: DailyStat) => number) => days.reduce((a, d) => a + f(d), 0)

export function StatisticsPage() {
  const { data: active } = useActiveAccount()
  const { data } = useStatistics(active?.id)
  const [range, setRange] = useState('30')

  if (!active) return <EmptyState className="p-6" title="No account" description="Create an account first (Accounts page)." />
  if (!data) return null

  const n = range === 'all' ? data.history.length : Number(range)
  const days = data.history.slice(-n)
  const previous = data.history.slice(-2 * n, -n)
  const subsNow = data.history.at(-1)?.subscribers ?? data.segments.reduce((a, s) => a + s.count, 0)
  const subsBefore = previous.at(-1)?.subscribers ?? 0
  const totalSubs = Math.max(1, data.segments.reduce((a, s) => a + s.count, 0))
  const chartData = days.map((d) => ({
    day: `D${d.day}`,
    subscriptions: (d.net.subscription + d.net.renewal) / 100,
    tips: d.net.tip / 100,
    paid: (d.net.post + d.net.message) / 100,
    customs: d.net.custom / 100,
    cash: d.net.offline / 100,
    subscribers: d.subscribers,
  }))
  const dateInfo = days.length ? `Day ${days[0].day} – ${days.at(-1)!.day}` : undefined

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <PageTitle title="Statistics" />

      <SegmentedControl className="self-start" options={RANGES} value={range} onChange={setRange} />

      {data.history.length === 0 ? (
        <EmptyState title="No data yet" description="Press Next day to start the simulation." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <ChartCard
              title="Net earnings"
              subtitle={money(sum(days, earned))}
              trendChip={previous.length ? (trend(sum(days, earned), sum(previous, earned)) ?? undefined) : undefined}
              dateInfo={dateInfo}
            />
            <ChartCard title="Subscribers" subtitle={count(subsNow)} trendChip={trend(subsNow, subsBefore) ?? undefined} dateInfo={`Day ${data.day}`} />
            <ChartCard title="New subscribers" subtitle={count(sum(days, (d) => d.newSubscribers))} dateInfo={dateInfo} />
            <ChartCard title="Expired" subtitle={count(sum(days, (d) => d.churned))} dateInfo={dateInfo} />
          </div>

          <ChartCard title="Earnings" subtitle={money(sum(days, earned))} dateInfo={dateInfo}>
            <ChartContainer config={earningsConfig} className="h-56 w-full">
              <AreaChart accessibilityLayer data={chartData}>
                <CartesianGrid vertical={false} strokeDasharray="5 3" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} width={40} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Area dataKey="subscriptions" stackId="a" type="monotone" stroke="var(--color-subscriptions)" fill="var(--color-subscriptions)" fillOpacity={0.3} />
                {(['tips', 'paid', 'customs', 'cash'] as const).map((k) => (
                  <Area key={k} dataKey={k} stackId="a" type="monotone" stroke={`var(--color-${k})`} fill={`var(--color-${k})`} fillOpacity={0.3} />
                ))}
              </AreaChart>
            </ChartContainer>
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Subscribers" subtitle={count(subsNow)} dateInfo={dateInfo}>
              <ChartContainer config={subscribersConfig} className="h-48 w-full">
                <LineChart accessibilityLayer data={chartData}>
                  <CartesianGrid vertical={false} strokeDasharray="5 3" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line dataKey="subscribers" type="monotone" stroke="var(--color-subscribers)" strokeWidth={2} dot={false} />
                </LineChart>
              </ChartContainer>
            </ChartCard>

            <Card>
              <CardHeader>
                <CardTitle>Who your fans are</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {data.segments.map((s) => (
                  <ProgressBar
                    key={s.id}
                    variant="brand"
                    value={Math.round((s.count / totalSubs) * 100)}
                    title={s.label}
                    helperRight={count(s.count)}
                  />
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
