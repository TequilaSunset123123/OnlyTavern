import type { ReactNode } from 'react'

/**
 * The title at the top of every page (2026-10-16): the display serif, an optional line
 * under it, and buttons on the right. One component, so every page reads the same.
 */
export function PageTitle({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="mr-auto min-w-0">
        <h1 className="font-display text-4xl leading-tight">{title}</h1>
        {subtitle && <p className="text-content-secondary">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}
