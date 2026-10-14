import {
  AddIcon,
  Alert,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  SegmentedControl,
  TextArea,
  TextField,
} from '@fanvue/ui'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { PostInput } from '../../api'
import { useActiveAccount, useDispatch } from '../../hooks/useAccounts'
import { useFeed, useVault } from '../../hooks/useContent'
import { errorText } from '../format'
import { MediaTile } from '../MediaTile'

const ACCESS = [
  { value: 'free', label: 'Free for subscribers' },
  { value: 'locked', label: 'Locked (pay to view)' },
]

/** Compose a post from vault items (plan.md §8.1 New Post). Scheduling comes later (Queue). */
export function NewPostPage() {
  const navigate = useNavigate()
  const { data: active } = useActiveAccount()
  const { data: vault = [] } = useVault(active?.id)
  const { data: feed } = useFeed(active?.id)
  const dispatch = useDispatch()
  const [text, setText] = useState('')
  const [vaultIds, setVaultIds] = useState<string[]>([])
  const [access, setAccess] = useState<PostInput['access']>('free')
  const [price, setPrice] = useState('9.99')
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!active) return <EmptyState className="p-6" title="No account" description="Create an account first (Accounts page)." />

  const canLock = feed?.canLockPosts ?? false
  const chosen = vaultIds.map((id) => vault.find((v) => v.id === id) ?? null)

  const publish = () => {
    setError(null)
    dispatch
      .mutateAsync({
        type: 'post.publish',
        id: active.id,
        post: { text, vaultIds, access, priceCents: access === 'locked' ? Math.round(Number(price) * 100) : 0 },
      })
      .then(() => navigate('/'))
      .catch((e) => setError(errorText(e)))
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 pt-[calc(env(safe-area-inset-top,0px)+16px)]">
      <h1 className="typography-header-heading-sm">New post</h1>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <TextArea label="Caption" placeholder="Say something to your fans" minRows={3} fullWidth value={text} onChange={(e) => setText(e.target.value)} />
          <div className="grid grid-cols-3 gap-2">
            {chosen.map((item, i) => (
              <MediaTile key={vaultIds[i]} item={item} onClick={() => setVaultIds(vaultIds.filter((_, j) => j !== i))} />
            ))}
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="flex aspect-[4/5] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border-strong text-content-secondary hover:bg-buttons-tertiary-hover"
            >
              <AddIcon /> From vault
            </button>
          </div>
          {chosen.length > 0 && <p className="text-xs text-content-tertiary">Tap an item to remove it.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <SegmentedControl
            options={ACCESS.map((o) => ({ ...o, disabled: o.value === 'locked' && !canLock }))}
            value={access}
            onChange={(v) => setAccess(v as PostInput['access'])}
          />
          {!canLock && (
            <p className="text-xs text-content-tertiary">
              Like on real OnlyFans, only free pages can lock posts. Paid pages sell extras in messages.
            </p>
          )}
          {access === 'locked' && (
            <TextField label="Price (USD)" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} helperText="$3–$200" />
          )}
        </CardContent>
      </Card>

      {error && <Alert variant="error">{error}</Alert>}
      <Button variant="brand" size="48" loading={dispatch.isPending} onClick={publish}>
        Post now
      </Button>

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Add from vault</DialogTitle>
          </DialogHeader>
          <DialogBody>
            {vault.length === 0 ? (
              <EmptyState
                title="Your vault is empty"
                description="Add items in the Vault first."
                primaryAction={<Button onClick={() => navigate('/vault')}>Open vault</Button>}
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {vault.map((v) => (
                  <MediaTile
                    key={v.id}
                    item={v}
                    selected={vaultIds.includes(v.id)}
                    onClick={() => setVaultIds(vaultIds.includes(v.id) ? vaultIds.filter((id) => id !== v.id) : [...vaultIds, v.id])}
                  />
                ))}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="brand" onClick={() => setPicking(false)}>
              Done ({vaultIds.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
