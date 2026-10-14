import { Card, CardContent, CardHeader, CardTitle, SwitchField, TextField } from '@fanvue/ui'
import { getStContext } from '../../bridge/st'
import { useTheme } from '../../hooks/useTheme'

// Step 0 only needs the theme switch and a check that the iframe can reach
// parent.SillyTavern (plan.md §10, step 0 acceptance). The text field is there
// to test the iOS keyboard.
export function SettingsPage() {
  const { theme, toggle } = useTheme()
  const ctx = getStContext()
  const status = ctx
    ? `Connected. ${Array.isArray(ctx.characters) ? ctx.characters.length : '?'} characters, persona: ${ctx.name1 ?? '?'}`
    : 'Not connected (opened outside SillyTavern)'

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-4 pt-[calc(env(safe-area-inset-top,0px)+16px)]">
      <h1 className="typography-header-heading-sm">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <SwitchField label="Dark mode" checked={theme === 'dark'} onCheckedChange={toggle} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>SillyTavern</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className={ctx ? 'text-content-primary' : 'text-content-tertiary'}>{status}</p>
          <TextField label="Keyboard test" placeholder="Type here" />
        </CardContent>
      </Card>
    </div>
  )
}
