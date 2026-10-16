import {
  Button,
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
import { useActiveAccount, useDispatch } from '../../hooks/useAccounts'
import { useDirections } from '../../hooks/useMessages'
import { useSettings } from '../../hooks/useContent'
import { getConnectionProfiles, getStContext } from '../../bridge/st'
import { useTheme } from '../../hooks/useTheme'
import { useRef, useState } from 'react'
import { type Backdrop, useBackdrop } from '../background'
import { errorText } from '../format'
import { PageTitle } from '../shell/PageTitle'

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
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-4">
      <PageTitle title="Settings" />
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SwitchField label="Dark mode" checked={theme === 'dark'} onCheckedChange={toggle} />
          <BackdropPicker />
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
      <DeveloperCard />
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

/** Testing shortcuts while the game is being built (2026-10-16): level up without posting for days. */
function DeveloperCard() {
  const dispatch = useDispatch()
  const { data: active } = useActiveAccount()
  const { data: directions } = useDirections(active?.id)
  const direction = directions?.all.find((d) => d.id === directions.current)
  if (!active || !direction) return null
  const maxed = direction.level >= 5
  return (
    <Card>
      <CardHeader>
        <CardTitle>Developer</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <span className="typography-body-small-14px-semibold">
          {direction.label} · Lv {direction.level} “{direction.title}”
        </span>
        <Button variant="secondary" disabled={maxed} loading={dispatch.isPending} onClick={() => dispatch.mutate({ type: 'dev.levelUp', id: active.id })}>
          {maxed ? 'Max level' : `Level up to ${direction.level + 1}`}
        </Button>
        <p className="text-xs text-content-tertiary">For testing: adds just enough points for the next level of this account's direction, with the usual level-up notification.</p>
      </CardContent>
    </Card>
  )
}

const BACKDROPS = [
  { value: 'default', label: 'Night room' },
  { value: 'none', label: 'None' },
  { value: 'custom', label: 'My picture' },
]

/** The picture behind the glass (ui/background.ts): kept in this browser only. */
function BackdropPicker() {
  const { kind, hasCustom, choose, upload } = useBackdrop()
  const file = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-2">
      <span className="typography-body-small-14px-semibold">Background</span>
      <SegmentedControl
        options={BACKDROPS}
        value={kind}
        onChange={(v) => (v === 'custom' && !hasCustom ? file.current?.click() : choose(v as Backdrop))}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="32" onClick={() => file.current?.click()}>
          {hasCustom ? 'Change my picture' : 'Upload a picture'}
        </Button>
        <span className="text-xs text-content-tertiary">Kept in this browser only. Large pictures are scaled down.</span>
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          setError(null)
          upload(f).catch((err) => setError(errorText(err)))
        }}
      />
      {error && <p className="text-sm text-error-content">{error}</p>}
    </div>
  )
}
