import {
  BellIcon,
  ChartIcon,
  FolderIcon,
  HomeIcon,
  MessageIcon,
  UsersIcon,
  SettingsIcon,
  UserIcon,
  VaultIcon,
  WalletIcon,
} from '@fanvue/ui'
import type { ComponentType } from 'react'

type NavIcon = ComponentType<{ filled?: boolean; className?: string }>

export type NavItem = { path: string; label: string; icon: NavIcon }

// Order follows the real OF creator nav (docs/ref/onlyfans-creator.md §1.1),
// trimmed to the first-version pages in plan.md §8.1.
export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Home', icon: HomeIcon },
  { path: '/notifications', label: 'Notifications', icon: BellIcon },
  { path: '/messages', label: 'Messages', icon: MessageIcon },
  { path: '/vault', label: 'Vault', icon: VaultIcon },
  { path: '/statements', label: 'Statements', icon: WalletIcon },
  { path: '/statistics', label: 'Statistics', icon: ChartIcon },
  { path: '/fans', label: 'Fans', icon: UsersIcon },
  { path: '/profile', label: 'My Profile', icon: UserIcon },
  { path: '/accounts', label: 'Accounts', icon: FolderIcon },
  { path: '/settings', label: 'Settings', icon: SettingsIcon },
]

export const NEW_POST_PATH = '/posts/new'
