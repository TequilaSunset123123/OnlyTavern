// The developer console's cheats (engine/dev.ts): delete with it.
import { describe, expect, it } from 'vitest'
import { createAccount } from '../store/account'
import { DEV_SPECIALS, forceRare, forceSpecial } from './dev'
import { openDayEvents } from './events'
import { isHumanAtm, isSuitor } from './specials'

const SETTINGS = { fanLanguage: 'en' as const, connectionProfile: null }
const empty = () => createAccount({ id: 'x', seed: 'dev', now: 0, name: 'Mia', handle: 'mia' })

describe('developer console: special events', () => {
  it('starts each one today, making up the regular it needs when nobody fits', () => {
    for (const kind of DEV_SPECIALS) {
      const a = forceSpecial(empty(), kind, 'dev', SETTINGS)
      const e = a.dayEvents.at(-1)!
      expect(e).toMatchObject({ kind, category: 'special', day: 0 })
      const fan = a.regulars.find((r) => r.id === e.regularId)
      if (kind === 'humanAtm') expect(fan && isHumanAtm(fan)).toBe(true)
      if (kind === 'marryMe') expect(fan && isSuitor(fan)).toBe(true)
      if (kind === 'routingError') expect(openDayEvents(a)[0].pick!.fans).toHaveLength(1)
      if (kind === 'charity') expect(a.regulars).toHaveLength(0)
    }
  })

  it("starts a brand deal for your direction's brand, at any level", () => {
    const a = forceRare(empty(), 'brandDeal', 'dev')
    const view = openDayEvents(a)[0]
    expect(view).toMatchObject({ kind: 'brandDeal', category: 'rare', options: [{ choice: 'accept' }, { choice: 'negotiate' }, { choice: 'decline' }] })
    expect(a.dayEvents.at(-1)).toMatchObject({ variant: 'girl_next_door', status: 'open' })
    expect(view.text).toContain('BLACKFLAG')
    expect(() => forceRare(a, 'brandDeal', 'dev')).toThrow()
  })

  it('has no button for what follows an event: that only comes in its own time', () => {
    expect(DEV_SPECIALS).not.toContain('honeymoonFund')
    expect(DEV_SPECIALS).not.toContain('saveTheDate')
    expect(DEV_SPECIALS).not.toContain('humanAtmArrest')
  })

  it('uses a regular who already fits, and will not start one while another waits for you', () => {
    const first = forceSpecial(empty(), 'humanAtm', 'dev', SETTINGS)
    const again = forceSpecial({ ...first, dayEvents: [] }, 'humanAtm', 'dev', SETTINGS)
    expect(again.regulars).toHaveLength(first.regulars.length)
    const waiting = forceSpecial(empty(), 'marryMe', 'dev', SETTINGS)
    expect(() => forceSpecial(waiting, 'charity', 'dev', SETTINGS)).toThrow()
  })
})
