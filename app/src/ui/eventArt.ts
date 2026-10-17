// The pictures for daily events (plan.md §10.2): app/src/assets/events/<kind>.webp, picked
// up by file name. Events without one get a gradient instead (EventArt).
const files = import.meta.glob<string>('../assets/events/*.webp', { eager: true, import: 'default' })

const ART: Record<string, string> = Object.fromEntries(Object.entries(files).map(([path, url]) => [path.split('/').pop()!.replace('.webp', ''), url]))

/** The picture for an event kind ('ordinary' on a day without one), or null. */
export const eventArt = (kind: string): string | null => ART[kind] ?? null
