import {
  ChartIcon,
  FolderIcon,
  GalleryIcon,
  HomeIcon,
  MessageIcon,
  UsersIcon,
  SettingsIcon,
  TaskIcon,
  UserIcon,
  VaultIcon,
  WalletIcon,
} from '@fanvue/ui'
import type { ComponentType } from 'react'

type NavIcon = ComponentType<{ filled?: boolean; className?: string }>

export type NavItem = { path: string; label: string; icon: NavIcon }

// Order follows the real OF creator nav (docs/ref/onlyfans-creator.md §1.1), trimmed to
// the first-version pages in plan.md §8.1. Since 2026-10-16 Home is the game's "today"
// page, your feed is Posts, and the event history is a drawer in the top bar (TopBar).
export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Home', icon: HomeIcon },
  { path: '/posts', label: 'Posts', icon: GalleryIcon },
  { path: '/messages', label: 'Messages', icon: MessageIcon },
  { path: '/requests', label: 'Requests', icon: TaskIcon },
  { path: '/vault', label: 'Vault', icon: VaultIcon },
  { path: '/statements', label: 'Statements', icon: WalletIcon },
  { path: '/statistics', label: 'Statistics', icon: ChartIcon },
  { path: '/fans', label: 'Fans', icon: UsersIcon },
  { path: '/profile', label: 'My Profile', icon: UserIcon },
  { path: '/accounts', label: 'Accounts', icon: FolderIcon },
  { path: '/settings', label: 'Settings', icon: SettingsIcon },
]

export const NEW_POST_PATH = '/posts/new'
