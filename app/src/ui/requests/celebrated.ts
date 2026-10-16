// Settled customs and meetups whose completion you have already watched in the chat
// (2026-10-15): the chat plays it once, then they just come in like any message.
// Kept in this browser only; losing it just means seeing the animation once more.

const KEY = 'onlytavern:celebrated'
const MAX = 300

export function celebratedIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

export function markCelebrated(ids: string[]) {
  if (!ids.length) return
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set([...celebratedIds(), ...ids])].slice(-MAX)))
  } catch {
    // Storage unavailable: it will play again next time, nothing worse.
  }
}
