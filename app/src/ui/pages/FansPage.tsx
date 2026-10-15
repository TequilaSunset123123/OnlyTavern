import {
  Avatar,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ProgressBar,
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScrollArea,
} from '@fanvue/ui'
import { useNavigate } from 'react-router'
import { useActiveAccount, useStatistics } from '../../hooks/useAccounts'
import { useInbox } from '../../hooks/useMessages'
import { count, money } from '../format'

/** Simple Fans page (plan.md §8.1): the crowd by type, and your regulars. */
export function FansPage() {
  const navigate = useNavigate()
  const { data: active } = useActiveAccount()
  const { data: stats } = useStatistics(active?.id)
  const { data: inbox } = useInbox(active?.id)

  if (!active) return <EmptyState className="p-6" title="No account" description="Create an account first (Accounts page)." />

  const total = Math.max(1, stats?.segments.reduce((a, s) => a + s.count, 0) ?? 0)
  const regulars = [...(inbox?.threads ?? [])].sort((a, b) => b.regular.spent - a.regular.spent)

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 pt-[calc(env(safe-area-inset-top,0px)+16px)]">
      <h1 className="typography-header-heading-sm">Fans</h1>
      <Card>
        <CardHeader>
          <CardTitle>Subscribers by type · {count(total)}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {stats?.segments.map((s) => (
            <ProgressBar key={s.id} variant="brand" value={Math.round((s.count / total) * 100)} title={s.label} helperRight={count(s.count)} />
          ))}
        </CardContent>
      </Card>

      <h2 className="typography-body-default-16px-semibold">Regulars</h2>
      {regulars.length === 0 ? (
        <EmptyState title="No regulars yet" description="Fans who start messaging you show up here." />
      ) : (
        <TableCard size="condensed">
          <TableScrollArea>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fan</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Spent</TableHead>
                  <TableHead>Since</TableHead>
                  <TableHead>Loyalty</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {regulars.map(({ regular: r, loyalty: l }) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/messages/${r.id}`)}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar size={32} alt={r.name} fallback={r.name.slice(0, 2).toUpperCase()} />
                        <span className="truncate">{r.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>{stats?.segments.find((s) => s.id === r.segment)?.label ?? r.segment}</TableCell>
                    <TableCell className="text-right font-semibold">{money(r.spent)}</TableCell>
                    <TableCell>Day {r.since}</TableCell>
                    <TableCell>
                      Lv {l.level} {l.name}
                      {l.cap < 5 ? <span className="text-content-tertiary"> (max {l.cap})</span> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.status === 'active' ? 'success' : 'default'}>{r.status === 'active' ? 'Active' : 'Dormant'}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScrollArea>
        </TableCard>
      )}
    </div>
  )
}
