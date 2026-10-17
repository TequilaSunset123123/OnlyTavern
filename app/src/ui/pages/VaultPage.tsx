import {
  AddIcon,
  Alert,
  Button,
  Chip,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  SearchField,
  SegmentedControl,
  TextArea,
} from '@fanvue/ui'
import { useState } from 'react'
import type { VaultInput, VaultItem } from '../../api'
import { useActiveAccount, useDispatch } from '../../hooks/useAccounts'
import { useTags, useVault } from '../../hooks/useContent'
import { errorText } from '../format'
import { MediaTile } from '../MediaTile'
import { PageTitle } from '../shell/PageTitle'

/** The vault: text descriptions of content you can post (plan.md §4.3). */
export function VaultPage() {
  const { data: active } = useActiveAccount()
  const { data: items = [] } = useVault(active?.id)
  const { data: tags = [] } = useTags()
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [editing, setEditing] = useState<VaultItem | 'new' | null>(null)

  if (!active) return <EmptyState className="p-6" title="No account" description="Create an account first (Settings → Accounts)." />

  const label = (id: string) => tags.find((t) => t.id === id)?.en ?? id
  const q = query.trim().toLowerCase()
  const shown = items.filter(
    (i) =>
      (!tagFilter || i.tags.includes(tagFilter)) &&
      (!q || i.description.toLowerCase().includes(q) || i.tags.some((t) => label(t).toLowerCase().includes(q))),
  )
  const usedTags = tags.filter((t) => items.some((i) => i.tags.includes(t.id)))

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <PageTitle
        title="Vault"
        actions={
          <Button variant="brand" size="40" leftIcon={<AddIcon />} onClick={() => setEditing('new')}>
            Add item
          </Button>
        }
      />

      {items.length > 0 && (
        <>
          <SearchField placeholder="Search descriptions and tags" value={query} onChange={(e) => setQuery(e.target.value)} />
          {usedTags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Chip selected={!tagFilter} onClick={() => setTagFilter(null)}>
                All
              </Chip>
              {usedTags.map((t) => (
                <Chip key={t.id} selected={tagFilter === t.id} onClick={() => setTagFilter(tagFilter === t.id ? null : t.id)}>
                  {t.en}
                </Chip>
              ))}
            </div>
          )}
        </>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="Your vault is empty"
          description="Describe a photo set, video or voice note in words. Everything in this game is text."
          primaryAction={
            <Button variant="brand" leftIcon={<AddIcon />} onClick={() => setEditing('new')}>
              Add item
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((i) => (
            <div key={i.id} className="flex flex-col gap-1">
              <MediaTile item={i} onClick={() => setEditing(i)} />
              <div className="truncate text-xs text-content-tertiary">{i.tags.map(label).join(' · ') || 'No tags'}</div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <VaultItemDialog accountId={active.id} item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

const CASTS = [
  { value: 'me', label: 'Me' },
  { value: 'partner', label: 'Partner' },
  { value: 'both', label: 'Together' },
]
const LEVELS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))

export function VaultItemDialog({ accountId, item, onClose }: { accountId: string; item: VaultItem | null; onClose: () => void }) {
  const dispatch = useDispatch()
  const { data: tags = [] } = useTags()
  const [form, setForm] = useState<VaultInput>(
    item ? { description: item.description, tags: item.tags, intensity: item.intensity, cast: item.cast } : { description: '', tags: [], intensity: 2, cast: 'me' },
  )
  const [error, setError] = useState<string | null>(null)

  const run = (p: Promise<unknown>) => {
    setError(null)
    p.then(onClose).catch((e) => setError(errorText(e)))
  }
  const toggleTag = (id: string) =>
    setForm({ ...form, tags: form.tags.includes(id) ? form.tags.filter((t) => t !== id) : [...form.tags, id] })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{item ? 'Edit vault item' : 'Add to vault'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <TextArea
            label="Description"
            placeholder="What is in it? A few sentences, as if describing the photos or video to someone."
            minRows={4}
            fullWidth
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="flex flex-col gap-2">
            <span className="typography-body-small-14px-semibold">Explicitness (1 = safe for work, 5 = most explicit)</span>
            <SegmentedControl options={LEVELS} value={String(form.intensity)} onChange={(v) => setForm({ ...form, intensity: Number(v) })} />
          </div>
          <div className="flex flex-col gap-2">
            <span className="typography-body-small-14px-semibold">Who is in it</span>
            <SegmentedControl options={CASTS} value={form.cast} onChange={(v) => setForm({ ...form, cast: v as VaultInput['cast'] })} />
          </div>
          <div className="flex flex-col gap-2">
            <span className="typography-body-small-14px-semibold">Tags</span>
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => (
                <Chip key={t.id} size="32" selected={form.tags.includes(t.id)} onClick={() => toggleTag(t.id)}>
                  {t.en}
                </Chip>
              ))}
            </div>
          </div>
          {error && <Alert variant="error">{error}</Alert>}
        </DialogBody>
        <DialogFooter>
          {item && (
            <Button
              variant="tertiaryDestructive"
              className="mr-auto"
              onClick={() => run(dispatch.mutateAsync({ type: 'vault.delete', id: accountId, itemId: item.id }))}
            >
              Delete
            </Button>
          )}
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            variant="brand"
            loading={dispatch.isPending}
            onClick={() =>
              run(
                dispatch.mutateAsync(
                  item
                    ? { type: 'vault.update', id: accountId, itemId: item.id, patch: form }
                    : { type: 'vault.add', id: accountId, item: form },
                ),
              )
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
