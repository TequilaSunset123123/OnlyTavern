// Vault items and publishing (plan.md §4.3). Pure: ids and the day come in.
import economy from '../presets/economy.json'
import type { Account, Post, VaultItem } from '../store/schema'

export class ContentError extends Error {}

export type VaultInput = Pick<VaultItem, 'description' | 'tags' | 'intensity' | 'cast'> & { source?: VaultItem['source'] }

function checkItem(input: Partial<VaultInput>) {
  if (input.description !== undefined && !input.description.trim()) throw new ContentError('Description cannot be empty')
  if (input.intensity !== undefined && !(Number.isInteger(input.intensity) && input.intensity >= 1 && input.intensity <= 5)) {
    throw new ContentError('Intensity must be 1–5')
  }
}

export function addVaultItem(account: Account, id: string, input: VaultInput): Account {
  checkItem(input)
  const item: VaultItem = {
    id,
    description: input.description.trim(),
    tags: [...new Set(input.tags)],
    intensity: input.intensity,
    cast: input.cast,
    source: input.source ?? 'manual',
    createdDay: account.clock.day,
  }
  return { ...account, vault: [item, ...account.vault] }
}

export function updateVaultItem(account: Account, itemId: string, patch: Partial<VaultInput>): Account {
  checkItem(patch)
  if (!account.vault.some((v) => v.id === itemId)) throw new ContentError('Vault item not found')
  return {
    ...account,
    vault: account.vault.map((v) =>
      v.id === itemId
        ? { ...v, ...patch, description: patch.description?.trim() ?? v.description, tags: patch.tags ? [...new Set(patch.tags)] : v.tags }
        : v,
    ),
  }
}

/** Posts keep their references; a deleted item shows as "removed from vault". */
export function deleteVaultItem(account: Account, itemId: string): Account {
  return { ...account, vault: account.vault.filter((v) => v.id !== itemId) }
}

export type PostInput = Pick<Post, 'text' | 'vaultIds' | 'access' | 'priceCents'>

export function canLockPosts(account: Account): boolean {
  return !economy.lockedPostsOnlyOnFreePages || account.profile.accountType === 'free'
}

export function publishPost(account: Account, id: string, input: PostInput, author = 'owner'): Account {
  if (!input.text.trim() && input.vaultIds.length === 0) throw new ContentError('Write something or add content from the vault')
  const missing = input.vaultIds.filter((v) => !account.vault.some((i) => i.id === v))
  if (missing.length) throw new ContentError('Some vault items no longer exist')
  let priceCents = 0
  if (input.access === 'locked') {
    // Real OF only shows the post price button on free pages (docs/ref/onlyfans-creator.md).
    if (!canLockPosts(account)) throw new ContentError('Locked posts are only available on free pages; paid pages sell extras in messages')
    if (input.vaultIds.length === 0) throw new ContentError('A locked post needs content from the vault')
    priceCents = input.priceCents
    if (!Number.isInteger(priceCents) || priceCents < economy.minPostPriceCents || priceCents > economy.maxPostPriceCents) {
      throw new ContentError(`Price must be $${economy.minPostPriceCents / 100}–$${economy.maxPostPriceCents / 100}`)
    }
  }
  const post: Post = {
    id,
    day: account.clock.day,
    text: input.text.trim(),
    vaultIds: [...input.vaultIds],
    access: input.access,
    priceCents,
    author,
    stats: { views: 0, likes: 0, comments: 0, purchases: 0, earned: 0 },
  }
  return { ...account, posts: [post, ...account.posts] }
}

export function deletePost(account: Account, postId: string): Account {
  return { ...account, posts: account.posts.filter((p) => p.id !== postId) }
}
