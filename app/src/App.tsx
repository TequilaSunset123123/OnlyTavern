import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { useTheme } from './hooks/useTheme'
import { useBackdrop } from './ui/background'
import { routes } from './ui/routes'
import { Splash } from './ui/time/Splash'

// Memory router: the app lives in an iframe, so there is no URL to sync with.
const router = createMemoryRouter(routes)

// Data is local and only changes through api.dispatch, which invalidates what it
// touched (hooks/useAccounts.ts), so nothing needs refetching on its own.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false } },
})

function App() {
  useTheme() // applies the saved theme on startup
  useBackdrop() // and the background picture
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Splash />
    </QueryClientProvider>
  )
}

export default App
