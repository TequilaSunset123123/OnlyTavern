import { FlameIcon, LockerIcon } from '@fanvue/ui'
import type { VaultItem } from '../api'
import { money } from './format'

// No images in this game (plan.md §1): a vault item is a gradient block, seeded by its
// id, with its text description. Locked posts get Fanzly's lock + white price pill.

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function gradient(id: string): string {
  const h = hash(id)
  const a = 255 + (h % 70) // violet … pink
  const b = a + 20 + ((h >> 8) % 40)
  const angle = (h >> 16) % 360
  return `linear-gradient(${angle}deg, hsl(${a} 70% 38%), hsl(${b % 360} 75% 52%))`
}

const CAST = { me: 'Me', partner: 'Partner', both: 'Together' }

export function MediaTile({
  item,
  locked,
  onClick,
  selected,
}: {
  item: VaultItem | null
  /** Price in cents for a locked post. */
  locked?: number
  onClick?: () => void
  selected?: boolean
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`relative flex aspect-[4/5] w-full flex-col justify-end overflow-hidden rounded-xl p-3 text-left text-white ${selected ? 'ring-2 ring-(--color-brand-primary-default) ring-offset-2 ring-offset-(--color-background-primary)' : ''}`}
      style={{ background: item ? gradient(item.id) : 'var(--color-surface-secondary)' }}
    >
      {item ? (
        <>
          <div className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/35 px-2 py-0.5 text-xs">
            <FlameIcon size={16} /> {item.intensity} · {CAST[item.cast]}
          </div>
          <p className="line-clamp-5 text-sm leading-snug drop-shadow">{item.description}</p>
        </>
      ) : (
        <p className="text-sm text-content-tertiary">Removed from vault</p>
      )}
      {locked !== undefined && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold text-black">
            <LockerIcon size={16} /> Unlock for {money(locked)}
          </span>
        </div>
      )}
    </Tag>
  )
}
