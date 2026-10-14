import type { RouteObject } from 'react-router'
import { MorePage } from './pages/MorePage'
import { Placeholder } from './pages/Placeholder'
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
      { path: '/statements', element: <Placeholder title="Statements" step="step 2" /> },
      { path: '/statistics', element: <Placeholder title="Statistics" step="step 2" /> },
      { path: '/fans', element: <Placeholder title="Fans" step="step 4" /> },
      { path: '/profile', element: <Placeholder title="My Profile" step="step 1" /> },
      { path: '/accounts', element: <Placeholder title="Accounts" step="step 1" /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/more', element: <MorePage /> },
    ],
  },
]
