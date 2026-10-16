import {
  AddIcon,
  Avatar,
  BottomNavigation,
  BottomNavigationAction,
  Button,
  CloseIcon,
  Count,
  FloatingActionButton,
  GalleryIcon,
  HeartIcon,
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
import { useInbox, useRequests } from '../../hooks/useMessages'
import { TimeTravelProvider } from '../time/TimeTravel'
import { ACCENT } from './accent'
import { NAV_ITEMS, NEW_POST_PATH } from './nav'
import { TopBar } from './TopBar'

const GRADIENT = 'bg-linear-to-r from-(--cs-gradient-start) to-(--cs-gradient-end)'

// Mobile bottom bar: Fanzly layout (four tabs + floating "+" in the middle).
const MOBILE_TABS = ['/', '/posts', '/messages']
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
        {/* Messages fills the screen with its own scrolling panes (h-full). Every other page grows with
            its content (min-h-full), so <main> scrolls it all, its bottom padding above the phone tab bar
            included: a fixed-height wrapper let pages overflow it and stopped them scrolling on phones. */}
        <motion.div key={key} className={key === '/messages' ? 'h-full' : 'min-h-full'} custom={last.dir} variants={PAGE} initial="enter" animate="shown" exit="leave">
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

/** What is waiting on a page: unread conversations, open customs and meetup invitations. */
function useWaiting(): Record<string, number> {
  const { data: active } = useActiveAccount()
  const { data: inbox } = useInbox(active?.id)
  const { data: requests } = useRequests(active?.id)
  return {
    '/messages': inbox?.threads.filter((t) => t.unread > 0).length ?? 0,
    '/requests': (requests?.requests.filter((r) => r.request.status === 'open').length ?? 0) + (requests?.meetups.filter((m) => m.meetup.status === 'open').length ?? 0),
  }
}

export function NavList({ onPick }: { onPick?: () => void }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const waiting = useWaiting()
  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
        const active = isActive(pathname, path)
        return (
          <Button
            key={path}
            variant="tertiary"
            size="48"
            fullWidth
            className={`justify-start ${active ? ACCENT : ''}`}
            leftIcon={<Icon filled={active} />}
            rightIcon={waiting[path] ? <Count value={waiting[path]} variant="brand" size="24" /> : undefined}
            aria-current={active ? 'page' : undefined}
            onClick={() => {
              navigate(path)
              onPick?.()
            }}
          >
            <span className="flex-1 text-left">{label}</span>
          </Button>
        )
      })}
    </nav>
  )
}

/** OnlyTavern in the display serif, with a heart. */
function Logo() {
  return (
    <span className="flex items-center gap-2 text-(--color-brand-primary-default)">
      <span className="font-display text-3xl">OnlyTavern</span>
      <HeartIcon size={24} />
    </span>
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
      {/* Glass panels over the background picture (index.css `glass`, ui/background.ts): the
          sidebar, the top bar and the page. On phones the bottom bar stands in for the sidebar. */}
      <div className="flex h-full gap-4 p-2 pt-[calc(env(safe-area-inset-top,0px)+8px)] pb-[calc(env(safe-area-inset-bottom,0px)+80px)] md:p-4">
        <aside className="glass hidden w-64 shrink-0 flex-col gap-4 p-4 md:flex">
          <div className="flex items-center justify-between">
            <Logo />
            <IconButton variant="tertiary" size="32" icon={<CloseIcon />} aria-label="Close" onClick={closeApp} />
          </div>
          <ActiveAccount />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NavList />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-2 md:gap-4">
          <TopBar />
          <main ref={main} className="glass min-h-0 flex-1 overflow-y-auto">
            <PageTransition />
          </main>
        </div>

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
          <BottomNavigationAction value="/posts" icon={<GalleryIcon />} label="Posts" />
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
