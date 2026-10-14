import {
  AddIcon,
  BellIcon,
  BottomNavigation,
  BottomNavigationAction,
  Button,
  CloseIcon,
  FloatingActionButton,
  HomeIcon,
  IconButton,
  MenuIcon,
  MessageIcon,
} from '@fanvue/ui'
import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { closeApp } from '../../bridge/st'
import { NAV_ITEMS, NEW_POST_PATH } from './nav'

const GRADIENT = 'bg-linear-to-r from-(--cs-gradient-start) to-(--cs-gradient-end)'

// Mobile bottom bar: Fanzly layout (four tabs + floating "+" in the middle).
const MOBILE_TABS = ['/', '/notifications', '/messages']
const MORE_PATH = '/more'

function isActive(current: string, path: string) {
  return path === '/' ? current === '/' : current.startsWith(path)
}

export function NavList({ onPick }: { onPick?: () => void }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
        const active = isActive(pathname, path)
        return (
          <Button
            key={path}
            variant={active ? 'secondary' : 'tertiary'}
            size="48"
            fullWidth
            className="justify-start"
            leftIcon={<Icon filled={active} />}
            aria-current={active ? 'page' : undefined}
            onClick={() => {
              navigate(path)
              onPick?.()
            }}
          >
            {label}
          </Button>
        )
      })}
    </nav>
  )
}

export function AppShell() {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeApp()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const tab = MOBILE_TABS.find((p) => isActive(pathname, p)) ?? (pathname === MORE_PATH ? MORE_PATH : '')

  return (
    <div className="flex h-full">
      {/* Desktop: left sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col gap-4 border-r border-border-primary p-4 md:flex">
        <div className="flex items-center justify-between">
          <span className={`${GRADIENT} bg-clip-text text-2xl font-bold text-transparent`}>CreatorSim</span>
          <IconButton variant="tertiary" size="32" icon={<CloseIcon />} aria-label="Close" onClick={closeApp} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NavList />
        </div>
        <Button
          variant="brand"
          size="48"
          fullWidth
          className={`${GRADIENT} text-white`}
          leftIcon={<AddIcon />}
          onClick={() => navigate(NEW_POST_PATH)}
        >
          Create
        </Button>
      </aside>

      {/* Content; on mobile leave room for the bottom bar */}
      <main className="min-w-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom,0px)+80px)] md:pb-0">
        <Outlet />
      </main>

      {/* Mobile: bottom bar */}
      <BottomNavigation
        hideOnDesktop
        hasInformationArchitectureNav
        value={tab}
        onValueChange={(v) => navigate(v)}
        aria-label="Main navigation"
        className="bg-background-primary"
      >
        <BottomNavigationAction value="/" icon={<HomeIcon filled={tab === '/'} />} label="Home" />
        <BottomNavigationAction
          value="/notifications"
          icon={<BellIcon filled={tab === '/notifications'} />}
          label="Alerts"
        />
        <div className="flex flex-1 items-center justify-center">
          <FloatingActionButton aria-label="New post" className={`${GRADIENT} text-white`} onClick={() => navigate(NEW_POST_PATH)}>
            <AddIcon />
          </FloatingActionButton>
        </div>
        <BottomNavigationAction
          value="/messages"
          icon={<MessageIcon filled={tab === '/messages'} />}
          label="Messages"
        />
        <BottomNavigationAction value={MORE_PATH} icon={<MenuIcon filled={tab === MORE_PATH} />} label="More" />
      </BottomNavigation>
    </div>
  )
}
