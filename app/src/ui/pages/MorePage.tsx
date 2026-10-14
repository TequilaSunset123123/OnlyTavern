import { Button, CloseIcon } from '@fanvue/ui'
import { closeApp } from '../../bridge/st'
import { ActiveAccount, NavList } from '../shell/AppShell'

/** Mobile "More" tab: the full nav list (the desktop sidebar's content) plus Close. */
export function MorePage() {
  return (
    <div className="flex flex-col gap-4 p-4 pt-[calc(env(safe-area-inset-top,0px)+16px)]">
      <ActiveAccount />
      <NavList />
      <Button variant="secondary" size="48" fullWidth leftIcon={<CloseIcon />} onClick={closeApp}>
        Close
      </Button>
    </div>
  )
}
