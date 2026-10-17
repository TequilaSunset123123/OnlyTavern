import { Navigate, type RouteObject } from 'react-router'
import { HomePage } from './pages/HomePage'
import { PostsPage } from './pages/PostsPage'
import { MessagesPage } from './pages/MessagesPage'
import { MorePage } from './pages/MorePage'
import { NewPostPage } from './pages/NewPostPage'
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
      { path: '/posts', element: <PostsPage /> },
      { path: '/messages', element: <MessagesPage /> },
      { path: '/messages/:regularId', element: <MessagesPage /> },
      { path: '/requests', element: <RequestsPage /> },
      { path: '/vault', element: <VaultPage /> },
      // Pages with charts load on first visit, so recharts stays out of the startup bundle.
      { path: '/statements', lazy: () => import('./pages/StatementsPage').then((m) => ({ Component: m.StatementsPage })) },
      // Statistics is part of Statements since 2026-10-17.
      { path: '/statistics', element: <Navigate to="/statements" replace /> },
      // Fans is part of Statements since 2026-10-17 (who your fans are, your regulars).
      { path: '/fans', element: <Navigate to="/statements" replace /> },
      { path: '/profile', element: <ProfilePage /> },
      // Accounts is the top card of Settings since 2026-10-17.
      { path: '/accounts', element: <Navigate to="/settings" replace /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/more', element: <MorePage /> },
      // Developer: the event gallery (Settings → Developer). Remove with ui/dev/ (see DevConsole.tsx).
      { path: '/dev/events', lazy: () => import('./dev/EventGallery').then((m) => ({ Component: m.EventGallery })) },
    ],
  },
]
