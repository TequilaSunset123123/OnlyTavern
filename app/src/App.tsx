import { createMemoryRouter, RouterProvider } from 'react-router'
import { useTheme } from './hooks/useTheme'
import { routes } from './ui/routes'

// Memory router: the app lives in an iframe, so there is no URL to sync with.
const router = createMemoryRouter(routes)

function App() {
  useTheme() // applies the saved theme on startup
  return <RouterProvider router={router} />
}

export default App
