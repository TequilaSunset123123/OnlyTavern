import { AddIcon, Alert, Button, Card, CardContent, Chip, EmptyState, SegmentedControl, TextArea, TextField } from '@fanvue/ui'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { CaptionKind, PostInput, Settings, Tag, TagDraw } from '../../api'
import { useActiveAccount, useDispatch } from '../../hooks/useAccounts'
import { useCaptions, useFeed, useSettings, useTags, useVault } from '../../hooks/useContent'
import { useCurrentDirection } from '../direction'
import { errorText } from '../format'
import { MediaTile } from '../MediaTile'
import { VaultPickerDialog } from '../VaultPickerDialog'
import { PageTitle } from '../shell/PageTitle'

const IDEAS: { kind: CaptionKind; label: string }[] = [
  { kind: 'tease', label: 'Tease' },
  { kind: 'newSet', label: 'New set' },
  { kind: 'locked', label: 'Locked' },
  { kind: 'chat', label: 'Chatty' },
]

/** Caption ideas are a typing shortcut, not game logic: plain randomness is fine here. */
const randomItem = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)]
const chineseCaption = (language: Settings['fanLanguage'] | undefined) => language === 'zh' || (language === 'mix' && Math.random() < 0.3)

/** The strongest few draws over the picked items' tags (each label once, at its strongest). */
function strongest(lists: TagDraw[][], n: number): string[] {
  const best = new Map<string, number>()
  for (const d of lists.flat()) best.set(d.label, Math.max(best.get(d.label) ?? 0, d.factor))
  return [...best].sort(([, a], [, b]) => b - a).slice(0, n).map(([label]) => label)
}

/** “Draws more: Freeloaders, Haters · Misogynist, Creepy”: who your recent posts bring in (presets/tags.json). */
function DrawsLine({ tags }: { tags: Tag[] }) {
  const types = strongest(tags.map((t) => t.draws.types), 3)
  const traits = strongest(tags.map((t) => t.draws.traits), 4)
  if (!types.length && !traits.length) return null
  return (
    <p className="text-xs text-content-tertiary">
      Draws more: <span className="text-content-secondary">{[types.join(', '), traits.join(', ')].filter(Boolean).join(' · ')}</span>
    </p>
  )
}

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
  const { data: captions } = useCaptions()
  const { data: tags = [] } = useTags()
  const { data: settings } = useSettings()
  const direction = useCurrentDirection(active?.id)
  const dispatch = useDispatch()
  const [text, setText] = useState('')
  const [vaultIds, setVaultIds] = useState<string[]>([])
  const [access, setAccess] = useState<PostInput['access']>('free')
  const [price, setPrice] = useState('9.99')
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!active) return <EmptyState className="p-6" title="No account" description="Create an account first (Accounts page)." />

  const canLock = feed?.canLockPosts ?? false
  // A paid page can only post for subscribers (the engine refuses locked posts there).
  const postAccess = canLock ? access : 'free'
  const chosen = vaultIds.map((id) => vault.find((v) => v.id === id) ?? null)
  const chosenTags = tags.filter((t) => chosen.some((v) => v?.tags.includes(t.id)))

  // Ready-made captions in your direction's voice and your fans' language (mixed: mostly English), so you don't have to type.
  const suggest = (kind: CaptionKind) => {
    if (!captions) return
    const list = captions[chineseCaption(settings?.fanLanguage) ? 'zh' : 'en'][direction?.id ?? 'girl_next_door'][kind].filter((c) => c !== text)
    setText(randomItem(list))
  }

  const publish = () => {
    setError(null)
    dispatch
      .mutateAsync({
        type: 'post.publish',
        id: active.id,
        post: { text, vaultIds, access: postAccess, priceCents: postAccess === 'locked' ? Math.round(Number(price) * 100) : 0 },
      })
      .then(() => navigate('/'))
      .catch((e) => setError(errorText(e)))
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <PageTitle title="New post" />
      <Card>
        <CardContent className="flex flex-col gap-4">
          <TextArea label="Caption" placeholder="Say something to your fans" minRows={3} fullWidth value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-content-tertiary">Caption ideas</span>
            {IDEAS.filter((i) => i.kind !== 'locked' || postAccess === 'locked').map((i) => (
              <Chip key={i.kind} size="32" onClick={() => suggest(i.kind)}>
                {i.label}
              </Chip>
            ))}
          </div>
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
          <DrawsLine tags={chosenTags} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          {/* SegmentedControl cannot disable one option, so a paid page does not get the choice at all. */}
          {canLock ? (
            <SegmentedControl options={ACCESS} value={access} onChange={(v) => setAccess(v as PostInput['access'])} />
          ) : (
            <div className="flex flex-col items-start gap-2">
              <p className="typography-body-small-14px-semibold">Free for subscribers</p>
              <p className="text-xs text-content-tertiary">
                Your page is paid, so every post is included in the subscription. Like on real OnlyFans, only free pages can lock posts (pay to view);
                paid pages sell extras as paid messages.
              </p>
              <Button size="32" variant="tertiary" onClick={() => navigate('/profile')}>
                Switch to a free page in My Profile
              </Button>
            </div>
          )}
          {postAccess === 'locked' && (
            <TextField label="Price (USD)" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} helperText="$3–$200" />
          )}
        </CardContent>
      </Card>

      {error && <Alert variant="error">{error}</Alert>}
      <Button variant="brand" size="48" loading={dispatch.isPending} onClick={publish}>
        Post now
      </Button>

      <VaultPickerDialog open={picking} onOpenChange={setPicking} vault={vault} selected={vaultIds} onChange={setVaultIds} />
    </div>
  )
}
