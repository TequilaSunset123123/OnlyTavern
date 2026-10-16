import {
  AddIcon,
  Avatar,
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
import { AnimatePresence, motion, MotionConfig, type Variants } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useOutlet } from 'react-router'
import { closeApp } from '../../bridge/st'
import { useActiveAccount } from '../../hooks/useAccounts'
import { TimeTravelProvider } from '../time/TimeTravel'
import { ClockControl } from './ClockControl'
import { NAV_ITEMS, NEW_POST_PATH } from './nav'

const GRADIENT = 'bg-linear-to-r from-(--cs-gradient-start) to-(--cs-gradient-end)'

// Mobile bottom bar: Fanzly layout (four tabs + floating "+" in the middle).
const MOBILE_TABS = ['/', '/notifications', '/messages']
const MORE_PATH = '/more'

/**
 * Where a page sits in the nav (NAV_ITEMS order) for the page transition: a conversation
 * belongs to Messages, a new post sits just below Home, More (phones) at the bottom.
 */
function navOrder(pathname: string): number {
  if (pathname.startsWith(NEW_POST_PATH)) return 0.5
  if (pathname === MORE_PATH) return NAV_ITEMS.length
  const i = NAV_ITEMS.findIndex((item) => isActive(pathname, item.path))
  return i < 0 ? NAV_ITEMS.length : i
}

/** The page's section: a new conversation within Messages is not a page change. */
const section = (pathname: string) => `/${pathname.split('/')[1] ?? ''}`

// Switching pages (after Motion's AnimatePresence docs, motion.dev/docs/react-animate-presence):
// the old page fades out and the new one fades in, sliding the way you moved in the nav.
// Going down the list slides up (the new page comes from below), going up slides down.
const SLIDE = 24
const PAGE: Variants = {
  enter: (dir: number) => ({ opacity: 0, y: dir * SLIDE }),
  shown: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } },
  leave: (dir: number) => ({ opacity: 0, y: -dir * SLIDE, transition: { duration: 0.14, ease: [0.4, 0, 1, 1] } }),
}

/** The current page, sliding in and out as you move between pages. */
function PageTransition() {
  const { pathname } = useLocation()
  const outlet = useOutlet()
  const key = section(pathname)
  const order = navOrder(pathname)
  // Direction from the page we left to this one: +1 down the nav, -1 up.
  const [last, setLast] = useState({ key, order, dir: 1 })
  if (last.key !== key) setLast({ key, order, dir: order >= last.order ? 1 : -1 })
  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait" initial={false} custom={last.dir}>
        {/* h-full: Messages fills the screen with its own scrolling panes; other pages just run on and <main> scrolls. */}
        <motion.div key={key} className="h-full" custom={last.dir} variants={PAGE} initial="enter" animate="shown" exit="leave">
          {outlet}
        </motion.div>
      </AnimatePresence>
    </MotionConfig>
  )
}

function isActive(current: string, path: string) {
  return path === '/' ? current === '/' : current.startsWith(path)
}

/** Which account you are working in; tap to manage accounts. */
export function ActiveAccount() {
  const navigate = useNavigate()
  const { data: account, isLoading } = useActiveAccount()
  if (isLoading) return null
  const initials = account?.name.trim().slice(0, 2).toUpperCase() || '?'
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-buttons-tertiary-hover"
      onClick={() => navigate('/accounts')}
    >
      <Avatar size={40} alt={account?.name ?? 'No account'} fallback={initials} />
      <span className="min-w-0">
        <span className="typography-body-default-16px-semibold block truncate">{account?.name ?? 'No account'}</span>
        <span className="typography-body-small-14px-regular block truncate text-content-tertiary">
          {account ? `@${account.handle}` : 'Create one to start'}
        </span>
      </span>
    </button>
  )
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
  const main = useRef<HTMLElement>(null)

  // <main> is the scroll container, so reset it when the page changes.
  useEffect(() => {
    main.current?.scrollTo(0, 0)
  }, [pathname])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeApp()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const tab = MOBILE_TABS.find((p) => isActive(pathname, p)) ?? (pathname === MORE_PATH ? MORE_PATH : '')

  return (
    <TimeTravelProvider>
      <div className="flex h-full">
        {/* Desktop: left sidebar */}
        <aside className="hidden w-64 shrink-0 flex-col gap-4 border-r border-border-primary p-4 md:flex">
          <div className="flex items-center justify-between">
            <span className={`${GRADIENT} bg-clip-text text-2xl font-bold text-transparent`}>OnlyTavern</span>
            <IconButton variant="tertiary" size="32" icon={<CloseIcon />} aria-label="Close" onClick={closeApp} />
          </div>
          <ActiveAccount />
          <ClockControl />
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
        <main ref={main} className="min-w-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom,0px)+80px)] md:pb-0">
          <PageTransition />
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
    </TimeTravelProvider>
  )
}
