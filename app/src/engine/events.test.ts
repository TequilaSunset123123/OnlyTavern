import { describe, expect, it } from 'vitest'
import { buildFanPrompt } from '../llm/fanMessage'
import E from '../presets/events.json'
import templates from '../presets/templates.json'
import { createAccount } from '../store/account'
import { migrate } from '../store/migrate'
import type { Account, DayEvent, Regular } from '../store/schema'
import { hasCondition } from './conditions'
import { eventEffects } from './eventEffects'
import { dayEventView, openDayEvents, resolveDayEvent, rollDayEvent } from './events'
import { fallbackText } from './regulars'
import { lapsing, periodReport } from './report'
import { simulate } from './simulate'

const SETTINGS = { fanLanguage: 'en' as const, connectionProfile: null }

function grown(seed = 'ev', days = 60): Account {
  const a = createAccount({ id: 'x', seed, now: 0, name: 'Mia', handle: 'mia' })
  return simulate({ ...a, profile: { ...a.profile, accountType: 'free' } }, days, seed, SETTINGS).account
}

/** A rare event waiting for you today. */
function withRare(a: Account, kind: string, extra: Partial<DayEvent> = {}): Account {
  const day = a.clock.day
  const e: DayEvent = { id: `ev${day}`, kind, category: 'rare', day, until: day + 1, status: 'open', ...extra }
  return { ...a, dayEvents: [...a.dayEvents, e] }
}

const fanWith = (a: Account, change: (r: Regular) => Regular): [Account, Regular] => {
  const r = change({ ...a.regulars.find((x) => x.status === 'active')!, conditions: [] })
  return [{ ...a, regulars: a.regulars.map((x) => (x.id === r.id ? r : x)) }, r]
}

describe('daily events', () => {
  it('at most one a day, mostly common, the same for the same seed', () => {
    const a = grown('ev', 200)
    expect(new Set(a.dayEvents.map((e) => e.day)).size).toBe(a.dayEvents.length)
    const common = a.dayEvents.filter((e) => e.category === 'common').length
    expect(common).toBeGreaterThan(5)
    expect(grown('ev', 200).dayEvents).toEqual(a.dayEvents)
    expect(a.events.some((e) => e.type === 'day-event' && e.title.length > 0)).toBe(true)
  })

  it('at least one common event a week', () => {
    for (const seed of ['w1', 'w2', 'w3']) {
      const a = grown(seed, 120)
      const days = a.dayEvents.filter((e) => e.category === 'common').map((e) => e.day)
      // Rare days and multi-day events can push one back a little, never past a week and a bit.
      for (let i = 1; i < days.length; i++) expect(days[i] - days[i - 1]).toBeLessThanOrEqual(E.daily.commonEveryDays + 3)
    }
  })

  it('a multi-day event blocks new ones while it is on', () => {
    const a = grown()
    const day = a.clock.day + 1
    const on: DayEvent = { id: `ev${day - 1}`, kind: 'algorithmShift', category: 'common', day: day - 1, until: day + 2, status: 'active' }
    const r = rollDayEvent({ ...a, dayEvents: [on] }, 'ev', day)
    expect(r.account.dayEvents).toEqual([on])
  })

  it('rare events need the right fans: an Old money regular brings Whale Watching', () => {
    const a = grown()
    const plain: Account = { ...a, regulars: a.regulars.map((r) => ({ ...r, behaviours: [], personality: 'shy' })), direction: { ...a.direction, chosen: false } }
    const rares = (acc: Account) =>
      Array.from({ length: 400 }, (_, i) => rollDayEvent({ ...acc, dayEvents: [] }, `s${i}`, acc.clock.day + 1).account.dayEvents).flat().filter((e) => e.category === 'rare')
    expect(rares(plain)).toEqual([])
    const [rich, whale] = fanWith(plain, (r) => ({ ...r, segment: 'whale', behaviours: ['older_gentleman'], loyalty: 20 }))
    const got = rares(rich)
    expect(got.length).toBeGreaterThan(5)
    expect(got.every((e) => e.kind === 'whaleWatching' && e.regularId === whale.id && e.status === 'open')).toBe(true)
  })

  it('effects multiply while the event is on, and what you chose applies from the next day', () => {
    const a = grown()
    const day = a.clock.day
    const on: DayEvent = { id: 'e1', kind: 'fanAppreciation', category: 'common', day, until: day + 1, status: 'active' }
    const fx = eventEffects({ ...a, dayEvents: [on] }, day)
    expect(fx.crowdTips).toBe(E.common.fanAppreciation.effects.crowdTips)
    expect(eventEffects({ ...a, dayEvents: [on] }, day + 1).crowdTips).toBe(1)

    const leaked = resolveDayEvent(withRare(a, 'leakedContent', { regularId: a.regulars[0].id }), `ev${day}`, 'ignore', 'ev').account
    expect(eventEffects(leaked, day).renewal).toBe(1)
    expect(eventEffects(leaked, day + 1).renewal).toBe(E.rare.leakedContent.after.ignored.effects.renewal)
    expect(eventEffects(leaked, day + 1 + E.rare.leakedContent.after.ignored.days).renewal).toBe(1)
  })

  it('a whale in the spotlight is the only one it applies to', () => {
    const a = grown()
    const day = a.clock.day
    const fx = eventEffects(withRare(a, 'whaleWatching', { regularId: 'him', until: day + 3 }), day + 2)
    expect(fx.target).toEqual({ regularId: 'him', ...E.rare.whaleWatching.target })
  })

  it('a brand deal pays off the platform and posts your #ad', () => {
    const a = withRare(grown(), 'brandDeal', { variant: 'egirl', amountCents: 40000 })
    const view = openDayEvents(a)[0]
    expect(view.options.map((o) => o.choice)).toEqual(['accept', 'negotiate', 'decline'])
    expect(view.text).toContain('Gamer Girl Bathwater')
    expect(view.options[1].help).toContain('50%')
    const r = resolveDayEvent(a, view.id!, 'accept', 'ev')
    expect(r.account.ledger.at(-1)).toMatchObject({ kind: 'offline', gross: 40000, fee: 0 })
    expect(r.account.posts[0].text).toContain('#ad')
    expect(r.events[0]).toMatchObject({ type: 'day-event-done', result: 'accepted', gross: 40000 })
    expect(dayEventView(r.account).result).toContain('$400')
    expect(() => resolveDayEvent(r.account, view.id!, 'accept', 'ev')).toThrow(/already/)
  })

  it('a guest star brings a scene post; if it goes badly, the most devoted fan turns on you', () => {
    const [a, simp] = fanWith(grown(), (x) => ({ ...x, segment: 'simp', behaviours: ['obsessive'], loyalty: 40 }))
    const open = withRare(a, 'guestStar', { variant: 'Dax Thornfield' })
    const view = openDayEvents(open)[0]
    expect(view.text).toContain('Dax Thornfield')
    expect(view.options.map((o) => o.choice)).toEqual(['accept', 'decline'])
    const runs = Array.from({ length: 12 }, (_, i) => resolveDayEvent(open, view.id!, 'accept', `g${i}`))
    const bad = runs.find((r) => r.events[0].type === 'day-event-done' && r.events[0].result === 'jealous')!
    const good = runs.find((r) => r.events[0].type === 'day-event-done' && r.events[0].result === 'shot')!
    expect(bad && good).toBeTruthy()
    expect(good.account.posts[0].text).toContain('Dax Thornfield')
    expect(hasCondition(bad.account.regulars.find((x) => x.id === simp.id)!, 'hostile')).toBe(true)
    expect(dayEventView(bad.account).result).toContain(simp.name)
    expect(resolveDayEvent(open, view.id!, 'decline', 'g').account.posts).toEqual(open.posts)
  })

  it('taking down a leak costs money and blocks the man who did it', () => {
    const [a, r] = fanWith(grown(), (x) => ({ ...x, personality: 'misogynist' }))
    const after = resolveDayEvent(withRare(a, 'leakedContent', { regularId: r.id }), `ev${a.clock.day}`, 'takedown', 'ev').account
    expect(after.ledger.at(-1)).toMatchObject({ kind: 'offline', gross: -E.rare.leakedContent.costCents })
    expect(hasCondition(after.regulars.find((x) => x.id === r.id)!, 'blocked')).toBe(true)
  })

  it('left unanswered, a rare event settles itself with its default choice', () => {
    const a = withRare(grown(), 'secretAdmirer', { regularId: 'nobody', amountCents: 5000 })
    const later = rollDayEvent(a, 'ev', a.clock.day + E.daily.answerDays).account
    expect(later.dayEvents.find((e) => e.kind === 'secretAdmirer')).toMatchObject({ status: 'done', choice: 'keepQuiet', result: 'quiet' })
  })

  it('a skip stops on the day a rare event comes up; the report says so and lists the events', () => {
    // A level 5 direction qualifies for a Brand Deal, so a rare event comes up sooner or later.
    const base = grown()
    const a: Account = { ...base, dayEvents: [], direction: { ...base.direction, chosen: true, points: { ...base.direction.points, [base.direction.id]: 1000 } } }
    const r = simulate(a, 90, 'ev', SETTINGS, { stopAtRare: true })
    expect(r.account.clock.day).toBeLessThan(a.clock.day + 90)
    const rares = r.account.dayEvents.filter((e) => e.category === 'rare')
    expect(rares).toHaveLength(1)
    const first = rares[0]
    expect(first).toMatchObject({ day: r.account.clock.day, status: 'open' })
    const report = periodReport(a, r.account, r.events, 90)
    expect(report.stoppedFor).toBe(E.rare[first.kind as keyof typeof E.rare].title)
    expect(report.dayEvents.at(-1)).toMatchObject({ day: first.day })
    expect(periodReport(a, simulate(a, 3, 'ev', SETTINGS).account, [], 3).stoppedFor).toBeUndefined()
  })

  it('skipping past an undecided rare event warns you first', () => {
    const a = withRare(grown(), 'brandDeal', { variant: 'egirl', amountCents: 40000 })
    expect(lapsing(a, 1).filter((l) => l.kind === 'event')).toEqual([])
    expect(lapsing(a, 7).find((l) => l.kind === 'event')).toMatchObject({ name: 'Brand Deal', deadline: a.clock.day + E.daily.answerDays - 1 })
  })

  it('an ordinary day when nothing is on', () => {
    const view = dayEventView({ ...grown(), dayEvents: [] })
    expect(view).toMatchObject({ id: null, kind: 'ordinary', category: 'default', options: [] })
  })
})

/** A Sub who has been had for free `n` times (done meetups on her terms: free). */
function freeSub(a: Account, n: number): Account {
  const fan = a.regulars[0]
  const meetups = Array.from({ length: n }, (_, i) => ({
    id: `m-free-${i}`,
    regularId: fan.id,
    day: 1,
    offerCents: 0,
    replyBy: 2,
    status: 'done' as const,
    meetDay: 2,
    hidden: false,
    outcome: 'smooth' as const,
    paidCents: 0,
    closedDay: 2,
    messageId: `${fan.id}-m0`,
    askedBy: 'you' as const,
    terms: 'free' as const,
  }))
  return { ...a, direction: { ...a.direction, id: 'sub', chosen: true }, meetups: [...a.meetups, ...meetups] }
}

describe('The Charity (special)', () => {
  it('comes to a Sub who has been had for free often enough, and only once', () => {
    const a = grown('charity', 60)
    const quiet = { ...a, dayEvents: [] }
    // Not a Sub, or not had for free enough: never.
    const domme = freeSub(quiet, 8)
    expect(simulate({ ...domme, direction: { ...domme.direction, id: 'domme' } }, 40, 'charity', SETTINGS).account.dayEvents.some((e) => e.kind === 'charity')).toBe(false)
    expect(simulate(freeSub(quiet, 7), 40, 'charity', SETTINGS).account.dayEvents.some((e) => e.kind === 'charity')).toBe(false)
    const b = simulate(freeSub(quiet, 8), 120, 'charity', SETTINGS).account
    const charity = b.dayEvents.filter((e) => e.kind === 'charity')
    expect(charity).toHaveLength(1)
    expect(charity[0]).toMatchObject({ category: 'special', status: 'done', result: expect.stringMatching(/^opened/) })
  })

  it('turns every regular into a freeloading, creepy misogynist, makes nothing, and old money walks out', () => {
    const base = freeSub(grown('charity', 60), 8)
    const [withRich, rich] = fanWith(base, (r) => ({ ...r, behaviours: ['older_gentleman'], status: 'active' }))
    const day = withRich.clock.day
    const a: Account = { ...withRich, dayEvents: [{ id: `ev${day}`, kind: 'charity', category: 'special', day, until: day + 1, status: 'open' }] }
    const view = openDayEvents(a)[0]
    expect(view).toMatchObject({ category: 'special', title: 'The Charity', options: [{ choice: 'open' }] })
    expect(view.text).toContain('8 men')
    const r = resolveDayEvent(a, `ev${day}`, 'open', 'charity')
    expect(r.account.ledger).toEqual(a.ledger)
    const gone = r.account.regulars.find((x) => x.id === rich.id)!
    expect(gone.conditions).toContainEqual({ id: 'blocked', since: day, by: 'him' })
    for (const x of r.account.regulars.filter((x) => x.id !== rich.id && !hasCondition(x, 'blocked') && !hasCondition(x, 'lyingLow'))) {
      expect(x).toMatchObject({ segment: 'freeloader', personality: 'misogynist' })
      expect(x.behaviours).toContain('creepy_compliments')
    }
    const done = r.events.find((e) => e.type === 'day-event-done')!
    expect(done).toMatchObject({ result: 'openedRich', bad: true })
    expect(done.type === 'day-event-done' && done.text).toContain(`${rich.name} pulled up his trousers`)
    expect(r.account.posts[0].text).toMatch(/Thank you to all [\d,]+ of you/)
    // Freeloaders flock in for two weeks after.
    expect(eventEffects(r.account, day + 1).regularMix.freeloader).toBe(3)
  })

  it('every regular writes to you about it: the freeloaders after it, old money to say goodbye', () => {
    const base = freeSub(grown('charity', 60), 8)
    const [withRich, rich] = fanWith(base, (r) => ({ ...r, behaviours: ['older_gentleman'], status: 'active' }))
    const day = withRich.clock.day
    const a: Account = { ...withRich, dayEvents: [{ id: `ev${day}`, kind: 'charity', category: 'special', day, until: day + 1, status: 'open' }] }
    const done = resolveDayEvent(a, `ev${day}`, 'open', 'charity').account
    const last = (id: string) => done.threads.find((t) => t.regularId === id)!.messages.at(-1)!
    const there = a.regulars.filter((x) => !hasCondition(x, 'blocked') && !hasCondition(x, 'lyingLow'))
    expect(there.length).toBeGreaterThan(1)
    for (const x of there) {
      expect(last(x.id)).toMatchObject({ from: 'fan', state: 'pending', day, intent: { kind: 'opener', event: { kind: 'charity', step: x.id === rich.id ? 'left' : 'after', id: `ev${day}` } } })
    }
    // Without the model: a line of its own.
    expect(templates.en.charityLeft).toContain(fallbackText({ ...done, regulars: done.regulars.map((x) => ({ ...x, language: 'en' as const })) }, rich.id, last(rich.id).id))
    // For the model: what happened, with the number of men.
    const fan = done.regulars.find((x) => x.id === there.find((y) => y.id !== rich.id)!.id)!
    const t = done.threads.find((x) => x.regularId === fan.id)!
    const view = {
      day,
      regular: fan,
      messages: t.messages,
      read: 0,
      items: {},
      creator: { name: 'Mia', handle: 'mia', accountType: 'free' as const, priceCents: 0, subscribers: 100, direction: 'a submissive creator' },
      loyalty: { points: 0, level: 1, cap: 1, name: 'Curious', from: 0, next: null },
      away: null,
      personality: { id: 'misogynist', label: 'Misogynist', prompt: 'misogynistic' },
      behaviours: [],
      conditions: [],
      requests: [],
      meetups: [],
      incidents: [],
      dayEvents: done.dayEvents,
    }
    const [, user] = buildFanPrompt(view, t.messages.at(-1)!.id)
    const count = done.dayEvents[0].count!.toLocaleString('en-US')
    expect(user.content).toContain(`${count} men had her, and you were one of them`)
    expect(user.content).not.toContain('You message her on your own')
  })
})

describe('schema 15', () => {
  it('drops events that were taken out', () => {
    const fresh = createAccount({ id: 'a1', seed: 's1', now: 0, name: 'Mia', handle: 'mia' })
    const kept: DayEvent = { id: 'ev3', kind: 'ghostTown', category: 'common', day: 3, until: 4, status: 'active' }
    const gone: DayEvent = { ...kept, id: 'ev2', kind: 'payday', day: 2, until: 3 }
    const up = migrate({ ...fresh, dayEvents: [gone, kept], meta: { ...fresh.meta, schemaVersion: 14 } })
    expect(up.dayEvents).toEqual([kept])
  })
})

describe('schema 14', () => {
  it('upgrades a save without daily events', () => {
    const fresh = createAccount({ id: 'a1', seed: 's1', now: 0, name: 'Mia', handle: 'mia' })
    const { dayEvents: _, ...rest } = fresh
    expect(migrate({ ...rest, meta: { ...fresh.meta, schemaVersion: 13 } }).dayEvents).toEqual([])
  })
})
