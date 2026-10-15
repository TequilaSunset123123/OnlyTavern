import {
  Alert,
  Badge,
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
  ProgressBar,
  Select,
  SelectContent,
  SelectItem,
} from '@fanvue/ui'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { DirectionId, DirectionInfo } from '../api'
import { useDispatch, useStatistics } from '../hooks/useAccounts'
import { useTags } from '../hooks/useContent'
import { useDirections } from '../hooks/useMessages'
import { count, errorText } from './format'

// Your direction (plan.md §10.1): what you are building, how far along, and what counts.

const progress = (d: DirectionInfo) => (d.next === null ? 100 : Math.round(((d.points - d.from) / (d.next - d.from)) * 100))
const levelLine = (d: DirectionInfo) => (d.next === null ? 'Max level' : `${d.next - d.points} points to level ${d.level + 1}`)

/** Compact strip for the Home page; tap to open My Profile. */
export function DirectionStrip({ accountId }: { accountId: string }) {
  const navigate = useNavigate()
  const { data } = useDirections(accountId)
  const d = data?.all.find((x) => x.id === data.current)
  if (!d) return null
  return (
    <button type="button" className="w-full text-left" onClick={() => navigate('/profile')}>
      <ProgressBar variant="brand" value={progress(d)} title={`${d.label} · Lv ${d.level} “${d.title}”`} helperRight={levelLine(d)} />
    </button>
  )
}

export function DirectionCard({ accountId }: { accountId: string }) {
  const { data } = useDirections(accountId)
  const { data: stats } = useStatistics(accountId)
  const { data: tags = [] } = useTags()
  const dispatch = useDispatch()
  const [switching, setSwitching] = useState<DirectionId | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!data) return null

  const d = data.all.find((x) => x.id === data.current)!
  const subscribers = stats?.segments.reduce((a, s) => a + s.count, 0) ?? 0
  const choose = (direction: DirectionId) => {
    setError(null)
    dispatch
      .mutateAsync({ type: 'direction.set', id: accountId, direction })
      .then(() => setSwitching(null))
      .catch((e) => setError(errorText(e)))
  }
  const target = data.all.find((x) => x.id === switching)

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="typography-body-default-16px-semibold">Direction</span>
          <span className="text-sm text-content-tertiary">{d.blurb}</span>
        </div>
        <ProgressBar variant="brand" value={progress(d)} title={`${d.label} · Lv ${d.level} “${d.title}”`} helperLeft={`${d.points} points`} helperRight={levelLine(d)} />
        <div className="flex flex-col gap-2">
          <span className="text-xs text-content-tertiary">
            Posts with these tags earn points (up to 3 a post), paid customs that ask for them earn 2
            {d.id === 'escort' ? ', every meetup earns 5' : ''}
            {d.id === 'couple' ? ', content with your partner earns 1 more' : ''}. Higher levels make the direction show more.
          </span>
          <div className="flex flex-wrap gap-1">
            {d.signatureTags.map((id) => (
              <Badge key={id} variant="brandLight">
                {tags.find((t) => t.id === id)?.en ?? id}
              </Badge>
            ))}
          </div>
        </div>
        <Select
          label={data.chosen ? 'Change direction' : 'Pick your direction (free the first time)'}
          value={data.current}
          onValueChange={(v) => (data.chosen ? setSwitching(v as DirectionId) : choose(v as DirectionId))}
          fullWidth
        >
          <SelectContent>
            {data.all.map((x) => (
              <SelectItem key={x.id} value={x.id}>
                {x.label} · Lv {x.level}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error && <Alert variant="error">{error}</Alert>}
      </CardContent>

      <Dialog open={!!switching} onOpenChange={(o) => !o && setSwitching(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Switch to {target?.label}?</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <p className="text-sm">{target?.blurb}</p>
            <Alert variant="warning">
              About {Math.round(data.switchLoss * 100)}% of your subscribers (around {count(Math.round(subscribers * data.switchLoss))}) came for what you did before and will leave.
              Your points for every direction are kept.
            </Alert>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="brand" loading={dispatch.isPending} onClick={() => switching && choose(switching)}>
              Switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
