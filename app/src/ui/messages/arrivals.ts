// Regulars you have already seen in All Chats (2026-10-16), per account: a new one gets a
// card-toss entrance the first time his conversation shows up (MessagesPage), then he is
// just another row. Kept in this browser only; losing it just means one more toss (and
// only for fans whose conversation you have never opened).

// tossedFans, not the first build's seenFans: that one filed fans away unseen on the first visit.
const key = (accountId: string) => `onlytavern:tossedFans:${accountId}`

export function seenFans(accountId: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key(accountId)) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

export function markSeenFans(accountId: string, ids: string[]) {
  try {
    localStorage.setItem(key(accountId), JSON.stringify([...new Set([...seenFans(accountId), ...ids])]))
  } catch {
    // Storage unavailable: no tosses, nothing worse.
  }
}

// Who All Chats showed last time, per account: a fan who has since gone dormant (you left
// him alone too long) is shown once more and tossed out of the list (MessagesPage).
const listedKey = (accountId: string) => `onlytavern:listedFans:${accountId}`

export function listedBefore(accountId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(listedKey(accountId)) ?? '[]') as string[]
  } catch {
    return []
  }
}

export function saveListed(accountId: string, ids: string[]) {
  try {
    localStorage.setItem(listedKey(accountId), JSON.stringify(ids))
  } catch {
    // Storage unavailable: no exits, nothing worse.
  }
}
