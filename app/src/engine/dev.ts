// Developer cheats (Settings → Developer, 2026-10-16/17): testing shortcuts while the game is
// being built. Nothing else depends on them. To remove the console later, delete this file,
// dev.test.ts, ui/dev/, the `dev.*` actions in api/types.ts and api/local.ts, and <DevConsole />
// in ui/pages/SettingsPage.tsx.
import D from '../presets/directions.json'
import personas from '../presets/personas.json'
import type { Account, Regular, Segment, Settings } from '../store/schema'
import { ContentError } from './content'
import { addPoints, levelOf } from './directions'
import { pickLanguage } from './personas'
import { arrivingRegular } from './regulars'
import { rngFor } from './rng'
import { isHumanAtm, isSuitor, openSpecial, reachable, type SpecialKind } from './specials'
import { addFanMessage } from './threads'

/** Just enough points for the next level of your current direction. */
export function levelUpForTesting(account: Account): Account {
  const current = account.direction.id
  const level = levelOf(account.direction.points[current])
  if (level >= D.levels.points.length) return account
  return addPoints(account, { [current]: D.levels.points[level] - account.direction.points[current] })
}

/**
 * The special events the console can start. What follows one comes by itself, in its own time,
 * never on its own (2026-10-17): the arrest three days after Human ATM, the honeymoon fund a
 * month after you say yes to Marry Me?, then the invitation.
 */
export const DEV_SPECIALS = ['charity', 'routingError', 'humanAtm', 'marryMe'] as const satisfies readonly SpecialKind[]
export type DevSpecial = (typeof DEV_SPECIALS)[number]

type FanSpec = { segment: Segment; personality?: string; behaviours?: string[]; level: number }

/** A regular made to order, who has just written to you. */
function insertFan(a: Account, seed: string, day: number, settings: Settings, spec: FanSpec): { account: Account; fan: Regular } {
  const rng = rngFor(seed, day, `dev:fan:${a.regulars.length}`)
  const id = `r${day}-${a.regulars.length}`
  const base = arrivingRegular(a, rng, id, spec.segment, day, pickLanguage(rng, settings.fanLanguage))
  const fan: Regular = {
    ...base,
    ...(spec.personality ? { personality: spec.personality } : {}),
    behaviours: [...new Set([...base.behaviours, ...(spec.behaviours ?? [])])],
    loyalty: personas.loyalty.points[spec.level - 1],
    conditions: [],
  }
  const b = { ...a, regulars: [...a.regulars, fan], threads: [...a.threads, { regularId: id, read: 0, messages: [] }] }
  return { account: addFanMessage(b, id, day, { kind: 'opener', topic: 'chat' }), fan }
}

/**
 * Starts a special event today, whatever led there (the direction it needs, how often you
 * were had for free). If no regular fits it, one is made up who does: Human ATM a submissive
 * old-money whale at loyalty 4, Marry Me? an obsessed stalker at loyalty 5.
 */
export function forceSpecial(account: Account, kind: DevSpecial, seed: string, settings: Settings): Account {
  if (account.dayEvents.some((e) => e.status === 'open')) throw new ContentError('Deal with the event that is waiting first')
  const day = account.clock.day
  let a = account
  const fit = (test: (r: Regular) => boolean, spec: FanSpec): Regular => {
    const found = reachable(a).find(test)
    if (found) return found
    const made = insertFan(a, seed, day, settings, spec)
    a = made.account
    return made.fan
  }
  const suitor: FanSpec = { segment: 'simp', behaviours: ['obsessive', 'stalker'], level: 5 }
  let fan: Regular | undefined
  if (kind === 'routingError') fit(() => true, { segment: 'regular', level: 2 })
  if (kind === 'humanAtm') fan = fit(isHumanAtm, { segment: 'whale', personality: 'submissive', behaviours: ['older_gentleman'], level: 4 })
  if (kind === 'marryMe') fan = fit(isSuitor, suitor)
  const id = `dev-${kind}-${day}-${a.dayEvents.length}`
  const o = openSpecial(rngFor(seed, day, `dev:${id}`), a, kind, fan, day, id)
  return { ...o.account, dayEvents: [...o.account.dayEvents, o.event], events: [...o.account.events, ...o.events] }
}
