// The pictures for daily events (plan.md §10.2): app/src/assets/events/<kind>.webp, picked
// up by file name. Events without one get a gradient instead (EventArt).
const files = import.meta.glob<string>('../assets/events/*.webp', { eager: true, import: 'default' })

const ART: Record<string, string> = Object.fromEntries(Object.entries(files).map(([path, url]) => [path.split('/').pop()!.replace('.webp', ''), url]))

/** Events that share a picture: the arrest is Human ATM's, the wedding follow-ups the rings. */
const SAME_AS: Record<string, string> = { humanAtmArrest: 'humanAtm', honeymoonFund: 'rings', saveTheDate: 'rings' }

/** Where to crop a picture in the short Home banner, when its middle is the wrong part (the cake's dolls are near the top). */
const FOCUS: Record<string, string> = { marryMe: 'center 20%' }
export const eventArtFocus = (kind: string): string => FOCUS[kind] ?? 'center'

/** The picture for an event kind ('ordinary' on a day without one), or null. */
export const eventArt = (kind: string): string | null => ART[SAME_AS[kind] ?? kind] ?? null
