// Your direction at a glance (2026-10-16): the top bar, page titles and the direction card.
import type { DirectionInfo } from '../api'
import { useDirections } from '../hooks/useMessages'

/** Your current direction and level, or undefined while loading. */
export function useCurrentDirection(accountId: string | undefined) {
  const { data } = useDirections(accountId)
  return data?.all.find((x) => x.id === data.current)
}

/** “Girl next door · Lv 5 “America's sweetheart”” */
export const directionLine = (d: DirectionInfo) => `${d.label} · Lv ${d.level} “${d.title}”`

/** How far into the current level, 0–100 (100 at the top level). */
export const progress = (d: DirectionInfo) => (d.next === null ? 100 : Math.round(((d.points - d.from) / (d.next - d.from)) * 100))
