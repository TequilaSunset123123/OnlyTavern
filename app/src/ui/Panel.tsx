import { Card, CardContent, ChevronRightIcon, Count, IconButton } from '@fanvue/ui'
import type { ReactNode } from 'react'

// The dashboard's building blocks (Home, 2026-10-16): one card shape and one row shape, so
// every panel looks the same. Plain Fanvue Cards: on the glass they are see-through layers
// (theme/fanzly.css).

/** A small rounded tile in the brand tint holding an icon. */
export function IconTile({ children }: { children: ReactNode }) {
  return <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-(--color-brand-primary-muted) text-(--color-brand-primary-default)">{children}</span>
}

/** A card with an icon, a title and a line under it, a count of what is waiting, and a way to open the full page. */
export function Panel({
  icon,
  title,
  subtitle,
  count,
  onOpen,
  className = '',
  children,
}: {
  icon: ReactNode
  title: string
  subtitle?: string
  count?: number
  onOpen?: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <Card className={className}>
      <CardContent className="flex h-full flex-col gap-3">
        <div className="flex items-center gap-3">
          <IconTile>{icon}</IconTile>
          <div className="mr-auto min-w-0">
            <div className="typography-body-default-16px-semibold truncate">{title}</div>
            {subtitle && <div className="truncate text-sm text-content-tertiary">{subtitle}</div>}
          </div>
          {count ? <Count value={count} variant="brand" size="24" /> : null}
          {onOpen && <IconButton variant="tertiary" size="32" icon={<ChevronRightIcon />} aria-label={`Open ${title}`} onClick={onOpen} />}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

/** One line in a panel: something on the left (an avatar or an icon), a name and a line, something on the right. */
export function PanelRow({ lead, title, line, right, onClick }: { lead: ReactNode; title: ReactNode; line?: ReactNode; right?: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      {lead}
      <span className="mr-auto min-w-0">
        <span className="typography-body-small-14px-semibold block truncate">{title}</span>
        {line && <span className="block truncate text-sm text-content-tertiary">{line}</span>}
      </span>
      {right}
    </>
  )
  const row = 'flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left'
  return onClick ? (
    <button type="button" className={`${row} hover:bg-buttons-tertiary-hover`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={row}>{body}</div>
  )
}
