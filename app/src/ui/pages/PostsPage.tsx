import {
  AddIcon,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CommentIcon,
  EmptyState,
  EyeIcon,
  HeartIcon,
  LockerIcon,
  TrashIcon,
  WalletIcon,
} from '@fanvue/ui'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { FeedPost } from '../../api'
import { useActiveAccount, useDispatch } from '../../hooks/useAccounts'
import { useComments, useFeed } from '../../hooks/useContent'
import { directionLine, useCurrentDirection } from '../direction'
import { count, money } from '../format'
import { MediaTile } from '../MediaTile'
import { ProductCard } from '../ProductCard'
import { NEW_POST_PATH } from '../shell/nav'
import { PageTitle } from '../shell/PageTitle'

/** Your own feed: every post with how it performed (plan.md §8.1; the Home page until 2026-10-16). */
export function PostsPage() {
  const navigate = useNavigate()
  const { data: active } = useActiveAccount()
  const { data: feed } = useFeed(active?.id)
  const direction = useCurrentDirection(active?.id)

  if (!active) return <EmptyState className="p-6" title="No account" description="Create an account first (Accounts page)." />

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <PageTitle
        title="Posts"
        subtitle={direction && directionLine(direction)}
        actions={
          <Button variant="brand" size="40" leftIcon={<AddIcon />} onClick={() => navigate(NEW_POST_PATH)}>
            New post
          </Button>
        }
      />
      {feed && feed.posts.length === 0 && (
        <EmptyState title="No posts yet" description="Post something, then press Next day to see how your fans react." />
      )}
      {feed?.posts.map((p) => (
        <PostCard key={p.id} post={p} accountId={active.id} name={active.name} handle={active.handle} today={feed.day} />
      ))}
    </div>
  )
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-content-secondary" title={label}>
      {icon}
      <span className="typography-body-small-14px-semibold">{value}</span>
    </span>
  )
}

function PostCard({ post, accountId, name, handle, today }: { post: FeedPost; accountId: string; name: string; handle: string; today: number }) {
  const dispatch = useDispatch()
  const [showComments, setShowComments] = useState(false)
  const { data: comments } = useComments(accountId, post.id, showComments)
  const locked = post.access === 'locked'
  const fresh = post.day === today

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Avatar size={40} alt={name} fallback={name.slice(0, 2).toUpperCase()} />
          <div className="mr-auto min-w-0">
            <div className="typography-body-default-16px-semibold truncate">{name}</div>
            <div className="text-xs text-content-tertiary">
              @{handle} · Day {post.day}
            </div>
          </div>
          {locked && (
            <Badge variant="brandLight" leftIcon={<LockerIcon size={16} />}>
              {money(post.priceCents)}
            </Badge>
          )}
        </div>

        {post.text && <p className="whitespace-pre-wrap">{post.text}</p>}
        {post.product && <ProductCard product={post.product} />}
        {post.items.length > 0 && (
          <div className={`grid gap-2 ${post.items.length === 1 ? 'grid-cols-1 sm:w-2/3' : 'grid-cols-2 sm:grid-cols-3'}`}>
            {post.items.map((item, i) => (
              <MediaTile key={i} item={item} locked={locked && i === 0 ? post.priceCents : undefined} />
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <Stat icon={<EyeIcon size={16} />} value={count(post.stats.views)} label="Views" />
          <Stat icon={<HeartIcon size={16} />} value={count(post.stats.likes)} label="Likes" />
          <Stat icon={<CommentIcon size={16} />} value={count(post.stats.comments)} label="Comments" />
          {locked && <Stat icon={<WalletIcon size={16} />} value={`${post.stats.purchases} · ${money(post.stats.earned)}`} label="Purchases · net" />}
          <Button
            variant="tertiaryDestructive"
            size="24"
            className="ml-auto"
            leftIcon={<TrashIcon size={16} />}
            onClick={() => dispatch.mutate({ type: 'post.delete', id: accountId, postId: post.id })}
          >
            Delete
          </Button>
        </div>
        {fresh && <p className="text-xs text-content-tertiary">Just posted. Fans react from the next day on.</p>}

        {post.stats.comments > 0 && (
          <Button variant="tertiary" size="32" className="self-start" onClick={() => setShowComments(!showComments)}>
            {showComments ? 'Hide comments' : `Show ${count(post.stats.comments)} comment${post.stats.comments === 1 ? '' : 's'}`}
          </Button>
        )}
        {showComments && comments && (
          <ul className="flex flex-col gap-3 border-t border-border-primary pt-3">
            {comments.map((c) => (
              <li key={c.id} className="flex gap-3">
                <Avatar size={32} alt={c.name} fallback={c.name.slice(0, 1).toUpperCase()} />
                <div className="min-w-0">
                  <div className="text-xs text-content-tertiary">
                    <span className="typography-body-small-14px-semibold text-content-primary">{c.name}</span> @{c.handle} · {c.who} · Day {c.day}
                  </div>
                  <p className="break-words">{c.text}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
