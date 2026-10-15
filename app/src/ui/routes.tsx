import type { RouteObject } from 'react-router'
import { AccountsPage } from './pages/AccountsPage'
import { FansPage } from './pages/FansPage'
import { HomePage } from './pages/HomePage'
import { MessagesPage } from './pages/MessagesPage'
import { MorePage } from './pages/MorePage'
import { NewPostPage } from './pages/NewPostPage'
import { NotificationsPage } from './pages/NotificationsPage'
import { ProfilePage } from './pages/ProfilePage'
import { RequestsPage } from './pages/RequestsPage'
import { SettingsPage } from './pages/SettingsPage'
import { VaultPage } from './pages/VaultPage'
import { AppShell } from './shell/AppShell'

// Which step fills each page: plan.md §10.
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/posts/new', element: <NewPostPage /> },
      { path: '/notifications', element: <NotificationsPage /> },
      { path: '/messages', element: <MessagesPage /> },
      { path: '/messages/:regularId', element: <MessagesPage /> },
      { path: '/requests', element: <RequestsPage /> },
      { path: '/vault', element: <VaultPage /> },
      // Pages with charts load on first visit, so recharts stays out of the startup bundle.
      { path: '/statements', lazy: () => import('./pages/StatementsPage').then((m) => ({ Component: m.StatementsPage })) },
      { path: '/statistics', lazy: () => import('./pages/StatisticsPage').then((m) => ({ Component: m.StatisticsPage })) },
      { path: '/fans', element: <FansPage /> },
      { path: '/profile', element: <ProfilePage /> },
      { path: '/accounts', element: <AccountsPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/more', element: <MorePage /> },
    ],
  },
]
