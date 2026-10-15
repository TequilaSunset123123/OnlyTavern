import { Alert, Button, Card, CardContent, EmptyState, SegmentedControl, TextArea, TextField } from '@fanvue/ui'
import { useEffect, useState } from 'react'
import type { Profile } from '../../api'
import { useAccount, useActiveAccount, useDispatch } from '../../hooks/useAccounts'
import { DirectionCard } from '../DirectionCard'
import { errorText } from '../format'

const TYPES = [
  { value: 'paid', label: 'Paid subscription' },
  { value: 'free', label: 'Free' },
]

/** Basic profile settings. Price and account type drive the engine (plan.md §4.3). */
export function ProfilePage() {
  const { data: active } = useActiveAccount()
  const { data: account } = useAccount(active?.id)
  const dispatch = useDispatch()
  const [form, setForm] = useState<{ name: string; handle: string; bio: string; accountType: Profile['accountType']; price: string } | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (account) {
      const p = account.profile
      setForm({ name: p.name, handle: p.handle, bio: p.bio, accountType: p.accountType, price: (p.priceCents / 100).toFixed(2) })
    }
  }, [account])

  if (!active) return <EmptyState className="p-6" title="No account" description="Create an account first (Accounts page)." />
  if (!form) return null

  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch })
  const save = () => {
    setMessage(null)
    dispatch
      .mutateAsync({
        type: 'profile.update',
        id: active.id,
        patch: {
          name: form.name,
          handle: form.handle,
          bio: form.bio,
          accountType: form.accountType,
          ...(form.accountType === 'paid' ? { priceCents: Math.round(Number(form.price) * 100) } : {}),
        },
      })
      .then(() => setMessage({ ok: true, text: 'Saved' }))
      .catch((e) => setMessage({ ok: false, text: errorText(e) }))
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-4 pt-[calc(env(safe-area-inset-top,0px)+16px)]">
      <h1 className="typography-header-heading-sm">My Profile</h1>
      <DirectionCard accountId={active.id} />
      <Card>
        <CardContent className="flex flex-col gap-4">
          <TextField label="Display name" value={form.name} onChange={(e) => set({ name: e.target.value })} />
          <TextField label="Handle" leftLabel="@" value={form.handle} onChange={(e) => set({ handle: e.target.value })} />
          <TextArea label="Bio" minRows={3} fullWidth value={form.bio} onChange={(e) => set({ bio: e.target.value })} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <SegmentedControl
            options={TYPES}
            value={form.accountType}
            onChange={(v) => set({ accountType: v as Profile['accountType'] })}
          />
          {form.accountType === 'paid' ? (
            <TextField
              label="Subscription price (USD / month)"
              inputMode="decimal"
              value={form.price}
              onChange={(e) => set({ price: e.target.value })}
              helperText="Between $4.99 and $49.99. Higher prices bring fewer but richer fans."
            />
          ) : (
            <p className="text-content-tertiary">
              Free pages get many more subscribers but earn only from tips (and later PPV and customs).
            </p>
          )}
        </CardContent>
      </Card>
      {message && <Alert variant={message.ok ? 'success' : 'error'}>{message.text}</Alert>}
      <Button variant="brand" loading={dispatch.isPending} onClick={save}>
        Save
      </Button>
    </div>
  )
}
