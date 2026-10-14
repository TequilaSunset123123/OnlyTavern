import type { RouteObject } from 'react-router'
import { AccountsPage } from './pages/AccountsPage'
import { MorePage } from './pages/MorePage'
import { Placeholder } from './pages/Placeholder'
import { ProfilePage } from './pages/ProfilePage'
import { SettingsPage } from './pages/SettingsPage'
import { AppShell } from './shell/AppShell'

// Which step fills each page: plan.md §10.
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <Placeholder title="Home" step="step 3" /> },
      { path: '/posts/new', element: <Placeholder title="New Post" step="step 3" /> },
      { path: '/notifications', element: <Placeholder title="Notifications" step="step 3" /> },
      { path: '/messages', element: <Placeholder title="Messages" step="step 4" /> },
      { path: '/vault', element: <Placeholder title="Vault" step="step 3" /> },
      // Pages with charts load on first visit, so recharts stays out of the startup bundle.
      { path: '/statements', lazy: () => import('./pages/StatementsPage').then((m) => ({ Component: m.StatementsPage })) },
      { path: '/statistics', lazy: () => import('./pages/StatisticsPage').then((m) => ({ Component: m.StatisticsPage })) },
      { path: '/fans', element: <Placeholder title="Fans" step="step 4" /> },
      { path: '/profile', element: <ProfilePage /> },
      { path: '/accounts', element: <AccountsPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/more', element: <MorePage /> },
    ],
  },
]
