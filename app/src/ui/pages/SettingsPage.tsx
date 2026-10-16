import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  Slider,
  SwitchField,
  TextField,
} from '@fanvue/ui'
import type { Settings } from '../../api'
import { useDispatch } from '../../hooks/useAccounts'
import { useSettings } from '../../hooks/useContent'
import { getConnectionProfiles, getStContext } from '../../bridge/st'
import { useTheme } from '../../hooks/useTheme'
import { useState } from 'react'

// Global settings (shared by all accounts), plus the step-0 checks: whether the
// iframe can reach parent.SillyTavern, and a text field to test the iOS keyboard.
const FOLLOW_ST = '__sillytavern__'

const FAN_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'mix', label: 'Mixed' },
]

export function SettingsPage() {
  const { theme, toggle } = useTheme()
  const { data: settings } = useSettings()
  const profiles = getConnectionProfiles()
  const selectedName = profiles.profiles.find((p) => p.id === profiles.selected)?.name ?? 'none selected'
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
          {settings?.maxActiveRegulars !== undefined && (
            <RegularsCap key={settings.maxActiveRegulars} value={settings.maxActiveRegulars} onCommit={(n) => dispatch.mutate({ type: 'settings.update', patch: { maxActiveRegulars: n } })} />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Model</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {profiles.profiles.length === 0 ? (
            <p className="text-content-tertiary">
              No connection profiles found. Create one in SillyTavern (Connection Manager) to let fans write messages.
            </p>
          ) : (
            <Select
              label="Connection profile for fan messages"
              value={settings?.connectionProfile ?? FOLLOW_ST}
              onValueChange={(v) => dispatch.mutate({ type: 'settings.update', patch: { connectionProfile: v === FOLLOW_ST ? null : v } })}
              fullWidth
            >
              <SelectContent>
                <SelectItem value={FOLLOW_ST}>Same as SillyTavern ({selectedName})</SelectItem>
                {profiles.profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.model ? ` · ${p.model}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-xs text-content-tertiary">
            Only regulars' messages use the model. Everything with a number (sales, tips) is decided by the game.
          </p>
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

/** Most regulars at once (api fills in the preset's number): the slider moves freely, the setting saves when you let go (the key resets it to the saved number). */
function RegularsCap({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [n, setN] = useState(value)
  return (
    <div className="mt-4 flex flex-col gap-2">
      <span className="typography-body-small-14px-semibold">Active regulars at most: {n}</span>
      <Slider min={3} max={20} step={1} value={[n]} minLabel="3" maxLabel="20" onValueChange={([v]) => setN(v)} onValueCommit={([v]) => onCommit(v)} />
      <p className="text-xs text-content-tertiary">
        At the limit, no new regulars reach out. Above it, the ones you have not written to for longest go dormant the next day (except haters who turned on you and fans with an open custom or meetup). Write to a dormant fan to bring him back.
      </p>
    </div>
  )
}
