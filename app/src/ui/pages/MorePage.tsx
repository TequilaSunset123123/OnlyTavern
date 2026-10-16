import { Button, CloseIcon } from '@fanvue/ui'
import { closeApp } from '../../bridge/st'
import { ActiveAccount, NavList } from '../shell/AppShell'

/** Mobile "More" tab: the full nav list (the desktop sidebar's content) plus Close. The clock is in the top bar. */
export function MorePage() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <ActiveAccount />
      <NavList />
      <Button variant="secondary" size="48" fullWidth leftIcon={<CloseIcon />} onClick={closeApp}>
        Close
      </Button>
    </div>
  )
}
