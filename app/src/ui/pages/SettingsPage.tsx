import { Card, CardContent, CardHeader, CardTitle, SegmentedControl, SwitchField, TextField } from '@fanvue/ui'
import type { Settings } from '../../api'
import { useDispatch } from '../../hooks/useAccounts'
import { useSettings } from '../../hooks/useContent'
import { getStContext } from '../../bridge/st'
import { useTheme } from '../../hooks/useTheme'

// Global settings (shared by all accounts), plus the step-0 checks: whether the
// iframe can reach parent.SillyTavern, and a text field to test the iOS keyboard.
const FAN_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'mix', label: 'Mixed' },
]

export function SettingsPage() {
  const { theme, toggle } = useTheme()
  const { data: settings } = useSettings()
  const dispatch = useDispatch()
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
          <CardTitle>Fans</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <span className="typography-body-small-14px-semibold">Language of fan comments and messages</span>
          <SegmentedControl
            options={FAN_LANGUAGES}
            value={settings?.fanLanguage ?? 'en'}
            onChange={(v) => dispatch.mutate({ type: 'settings.update', patch: { fanLanguage: v as Settings['fanLanguage'] } })}
          />
          <p className="text-xs text-content-tertiary">Mixed: mostly English with some Chinese-speaking fans. Applies to all accounts.</p>
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
