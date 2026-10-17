import { describe, expect, it } from 'vitest'
import { buildFanPrompt } from '../llm/fanMessage'
import E from '../presets/events.json'
import personas from '../presets/personas.json'
import templates from '../presets/templates.json'
import { createAccount } from '../store/account'
import type { Account, DayEvent, Regular } from '../store/schema'
import { conditionOf, hasCondition } from './conditions'
import { eventEffects } from './eventEffects'
import { dayEventView, endDayEvent, openDayEvents, resolveDayEvent, rollDayEvent } from './events'
import { loyaltyLevel } from './fans'
import { fallbackText } from './regulars'
import { rngFor } from './rng'
import { answerDeal, simulateDealsDay } from './deals'
import { simulateHatersDay } from './haters'
import { simulate } from './simulate'
import { openSpecial, rollSpecial, type SpecialKind } from './specials'

const SETTINGS = { fanLanguage: 'en' as const, connectionProfile: null }
const S = E.special
const P = personas.loyalty.points

function grown(seed = 'sp', days = 60): Account {
  const a = createAccount({ id: 'x', seed, now: 0, name: 'Mia', handle: 'mia' })
  return simulate({ ...a, profile: { ...a.profile, accountType: 'free' } }, days, seed, SETTINGS).account
}

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

/** One active regular changed to order (the rest as they are); `others`: the rest leave him alone. */
function withFan(a: Account, change: (r: Regular) => Regular): [Account, Regular] {
  const r = change({ ...a.regulars.find((x) => x.status === 'active')!, conditions: [], status: 'active' })
  return [{ ...a, regulars: a.regulars.map((x) => (x.id === r.id ? r : x)) }, r]
}

/** A special event starting today (no other event on). */
function open(a: Account, kind: SpecialKind, fan?: Regular): Account {
  const day = a.clock.day
  const base = { ...a, dayEvents: [] }
  const o = openSpecial(rngFor(a.meta.seed, day, `t:${kind}`), base, kind, fan, day)
  return { ...o.account, dayEvents: [...o.account.dayEvents, o.event] }
}

/** The start of the next day: only the event roll (specials included), the clock moved on. */
function nextDay(a: Account): Account {
  const day = a.clock.day + 1
  return { ...rollDayEvent(a, a.meta.seed, day).account, clock: { day } }
}
const days = (a: Account, n: number) => Array.from({ length: n }).reduce<Account>((x) => nextDay(x), a)

const lastMessage = (a: Account, id: string) => a.threads.find((t) => t.regularId === id)!.messages.at(-1)!
const eventOfKind = (a: Account, kind: string) => a.dayEvents.findLast((e) => e.kind === kind)!
const tipsFrom = (a: Account, regularId: string) =>
  a.threads.find((t) => t.regularId === regularId)!.messages.reduce((n, m) => n + (m.from === 'fan' ? (m.tipCents ?? 0) : 0), 0)

/** Which special kinds roll over `n` days for this account as it is (no time passing). */
function rolled(a: Account, n = 200): Set<string> {
  const out = new Set<string>()
  for (let d = a.clock.day + 1; d <= a.clock.day + n; d++) {
    const o = rollSpecial(a, a.meta.seed, d)
    if (o) out.add(o.event.kind)
  }
  return out
}

/** Whether a rare event about one of your fans could come (its gate lets someone through). */
function rolledRare(a: Account, kind: string): boolean {
  for (let d = a.clock.day + 1; d <= a.clock.day + 200; d++) {
    const r = rollDayEvent({ ...a, dayEvents: a.dayEvents.filter((e) => e.category === 'special') }, a.meta.seed, d)
    if (r.account.dayEvents.some((e) => e.kind === kind)) return true
  }
  return false
}

describe('The Charity', () => {
  it('comes to a Sub who has been had for free often enough; left alone it is declined and may come back a month later', () => {
    const a = { ...grown('charity'), dayEvents: [] }
    const domme = freeSub(a, 8)
    expect(rolled({ ...domme, direction: { ...domme.direction, id: 'domme' } }).has('charity')).toBe(false)
    expect(rolled(freeSub(a, 7)).has('charity')).toBe(false)
    expect(rolled(freeSub(a, 8)).has('charity')).toBe(true)
    const b = simulate(freeSub(a, 8), 150, 'charity', SETTINGS).account
    const charity = b.dayEvents.filter((e) => e.kind === 'charity')
    expect(charity.length).toBeGreaterThan(1)
    for (const e of charity) expect(e).toMatchObject({ category: 'special', status: 'done', choice: 'decline', result: 'declined' })
    for (let i = 1; i < charity.length; i++) expect(charity[i].day - charity[i - 1].day).toBeGreaterThanOrEqual(S.charity.repeatDays)
  })

  it('opening the doors turns every regular, earns nothing and sends old money away, and it runs until you close them', () => {
    const [withRich, rich] = withFan(freeSub(grown('charity'), 8), (r) => ({ ...r, behaviours: ['older_gentleman'] }))
    const a = open(withRich, 'charity')
    const day = a.clock.day
    const id = a.dayEvents.at(-1)!.id
    expect(openDayEvents(a)[0]).toMatchObject({ category: 'special', title: 'The Charity', options: [{ choice: 'open' }, { choice: 'decline' }] })
    expect(openDayEvents(a)[0].text).toContain('8 men')

    const r = resolveDayEvent(a, id, 'open', a.meta.seed)
    let b = r.account
    expect(b.ledger).toEqual(a.ledger)
    expect(eventOfKind(b, 'charity')).toMatchObject({ status: 'active', choice: 'open', days: 1, leftIds: [rich.id] })
    expect(b.regulars.find((x) => x.id === rich.id)!.conditions).toContainEqual({ id: 'blocked', since: day, by: 'him' })
    const there = a.regulars.filter((x) => x.id !== rich.id && !hasCondition(x, 'blocked') && !hasCondition(x, 'lyingLow'))
    for (const x of there) {
      expect(b.regulars.find((y) => y.id === x.id)).toMatchObject({ segment: 'freeloader', personality: 'misogynist' })
      expect(lastMessage(b, x.id).intent?.event).toEqual({ kind: 'charity', step: 'after', id })
    }
    expect(lastMessage(b, rich.id).intent?.event).toEqual({ kind: 'charity', step: 'left', id })
    expect(r.events.find((e) => e.type === 'day-event-done')).toMatchObject({ result: 'openedRich', bad: true })
    expect(b.posts[0].text).toBe(S.charity.openPost)
    expect(dayEventView(b)).toMatchObject({ ongoing: true, endLabel: 'Close the doors' })

    // A new regular turns up while the doors are open: he goes through them too, the next day.
    const newcomer: Regular = { ...there[0], id: 'r-new', segment: 'simp', personality: 'shy', behaviours: [], since: day }
    b = { ...b, regulars: [...b.regulars, newcomer], threads: [...b.threads, { regularId: 'r-new', read: 0, messages: [] }] }
    const first = eventOfKind(b, 'charity').count!
    b = days(b, 3)
    const running = eventOfKind(b, 'charity')
    expect(running).toMatchObject({ status: 'active', days: 4 })
    expect(running.count!).toBeGreaterThan(first)
    expect(b.regulars.find((x) => x.id === 'r-new')).toMatchObject({ segment: 'freeloader', personality: 'misogynist' })
    expect(lastMessage(b, 'r-new').intent?.event?.step).toBe('after')
    // Nothing else happens while it runs; freeloaders flock in.
    expect(b.dayEvents.filter((e) => e.day > day)).toEqual([])
    expect(eventEffects(b, b.clock.day).regularMix.freeloader).toBe(3)
    expect(dayEventView(b).result).toContain('day 4')

    const end = endDayEvent(b, id)
    expect(end.events[0]).toMatchObject({ type: 'day-event-done', result: 'ended' })
    expect(end.events[0].type === 'day-event-done' && end.events[0].text).toContain('after 4 days')
    expect(eventOfKind(end.account, 'charity')).toMatchObject({ status: 'done', result: 'ended', closedDay: b.clock.day })
    expect(end.account.posts[0].text).toContain(`${running.count!.toLocaleString('en-US')} of you`)
    expect(eventEffects(end.account, b.clock.day + 1).regularMix.freeloader).toBe(3)
    expect(eventEffects(end.account, b.clock.day + S.charity.afterDays + 1).regularMix.freeloader).toBeUndefined()
    expect(() => endDayEvent(end.account, id)).toThrow()
    // Once the doors have opened, it never comes again.
    expect(rolled({ ...end.account, clock: { day: b.clock.day + 60 } }).has('charity')).toBe(false)
  })

  it('every regular writes to you about it: the freeloaders after it, old money to say goodbye', () => {
    const [withRich, rich] = withFan(freeSub(grown('charity'), 8), (r) => ({ ...r, behaviours: ['older_gentleman'] }))
    const a = open(withRich, 'charity')
    const id = a.dayEvents.at(-1)!.id
    const done = resolveDayEvent(a, id, 'open', a.meta.seed).account
    // Without the model: a line of its own.
    expect(templates.en.charityLeft).toContain(fallbackText({ ...done, regulars: done.regulars.map((x) => ({ ...x, language: 'en' as const })) }, rich.id, lastMessage(done, rich.id).id))
    // For the model: what happened, with the number of men.
    const fan = done.regulars.find((x) => x.id !== rich.id && lastMessage(done, x.id).intent?.event?.id === id)!
    const t = done.threads.find((x) => x.regularId === fan.id)!
    const [, user] = buildFanPrompt(view(done, fan), t.messages.at(-1)!.id)
    expect(user.content).toContain(`${done.dayEvents.at(-1)!.count!.toLocaleString('en-US')} men have had her so far, and today you were one of them`)
    expect(user.content).not.toContain('You message her on your own')
  })
})

/** Just enough of a conversation for the prompt. */
function view(a: Account, fan: Regular) {
  const t = a.threads.find((x) => x.regularId === fan.id)!
  return {
    day: a.clock.day,
    regular: fan,
    messages: t.messages,
    read: 0,
    items: {},
    creator: { name: 'Mia', handle: 'mia', accountType: 'free' as const, priceCents: 0, subscribers: 100, direction: 'a creator' },
    loyalty: { points: 0, level: 1, cap: 1, name: 'Curious', from: 0, next: null },
    away: null,
    personality: { id: 'shy', label: 'Awkward', prompt: 'awkward' },
    behaviours: [],
    conditions: [],
    requests: [],
    meetups: [],
    incidents: [],
    dayEvents: a.dayEvents,
  }
}

describe('Routing Error', () => {
  it('comes rarely to anyone with a regular (dormant ones count), and not again for two months', () => {
    let seen = 0
    for (const seed of ['r1', 'r2', 'r3']) {
      const a = simulate(grown(seed, 30), 300, seed, SETTINGS).account
      const errors = a.dayEvents.filter((e) => e.kind === 'routingError')
      seen += errors.length
      for (let i = 1; i < errors.length; i++) expect(errors[i].day - errors[i - 1].day).toBeGreaterThanOrEqual(S.routingError.repeatDays)
    }
    expect(seen).toBeGreaterThan(0)
    expect(rolled({ ...grown('route', 30), regulars: [], dayEvents: [] }, 400).has('routingError')).toBe(false)
  }, 20_000)

  it('a correction swaps one regular for a new fan of the kind you pick, who keeps his loyalty', () => {
    const [b, old] = withFan(grown('route'), (r) => ({ ...r, segment: 'regular', loyalty: P[2] + 3 }))
    const a = open(b, 'routingError')
    const id = a.dayEvents.at(-1)!.id
    const pick = openDayEvents(a)[0].pick!
    expect(pick.fans.map((f) => f.id)).toContain(old.id)
    expect(pick.types.map((t) => t.id)).toContain('whale')
    expect(openDayEvents(a)[0].options.find((o) => o.choice === 'correct')?.pick).toBe(true)
    // It comes as an email, addressed to you.
    expect(openDayEvents(a)[0].email).toMatchObject({ subject: 'Regarding a customer allocation error', to: `${a.profile.name} <@${a.profile.handle}>` })
    expect(openDayEvents(a)[0].email!.body).toMatch(/^Hi there!\n\n/)

    expect(() => resolveDayEvent(a, id, 'correct', a.meta.seed)).toThrow()
    expect(() => resolveDayEvent(a, id, 'correct', a.meta.seed, { regularId: old.id, segment: 'regular' })).toThrow()
    const done = resolveDayEvent(a, id, 'correct', a.meta.seed, { regularId: old.id, segment: 'whale' })
    const c = done.account
    expect(c.regulars.find((x) => x.id === old.id)!.conditions).toContainEqual({ id: 'blocked', since: a.clock.day, by: 'moved' })
    const fresh = c.regulars.find((x) => x.id === eventOfKind(c, 'routingError').regularId)!
    expect(fresh).toMatchObject({ segment: 'whale', loyalty: old.loyalty, status: 'active', spent: 0 })
    expect(fresh.name === old.name && fresh.handle === old.handle).toBe(false)
    expect(lastMessage(c, fresh.id).intent?.event).toEqual({ kind: 'routingError', step: 'arrived', id })
    expect(eventOfKind(c, 'routingError')).toMatchObject({ result: 'corrected', leftIds: [old.id], variant: 'whale' })
    expect(done.events.find((e) => e.type === 'day-event-done')!.type === 'day-event-done' && done.events.find((e) => e.type === 'day-event-done')).toMatchObject({
      text: `${old.name} has been moved to the creator he meant to subscribe to. ${fresh.name}, a whale, has finally found his way to you, and keeps the loyalty ${old.name} had.`,
    })

    // A freeloader keeps the points but tops out at level 1.
    const free = resolveDayEvent(a, id, 'correct', a.meta.seed, { regularId: old.id, segment: 'freeloader' }).account
    const freeloader = free.regulars.find((x) => x.id === eventOfKind(free, 'routingError').regularId)!
    expect(freeloader.loyalty).toBe(old.loyalty)
    expect(loyaltyLevel(freeloader)).toBe(1)

    // Or keep things as they are.
    const kept = resolveDayEvent(a, id, 'decline', a.meta.seed).account
    expect(kept.regulars).toEqual(a.regulars)
  })
})

describe('Human ATM', () => {
  const atm = (r: Regular): Regular => ({ ...r, segment: 'whale', personality: 'submissive', behaviours: ['older_gentleman'], loyalty: P[3] })

  it('only for a Dominatrix whose submissive old-money regular is at loyalty 4 or more', () => {
    const [a] = withFan(grown('atm'), atm)
    const domme = { ...a, direction: { ...a.direction, id: 'domme' as const, chosen: true }, dayEvents: [] }
    expect(rolled(domme).has('humanAtm')).toBe(true)
    expect(rolled({ ...domme, direction: { ...domme.direction, id: 'sub' } }).has('humanAtm')).toBe(false)
    const [cooler] = withFan(domme, (r) => ({ ...r, loyalty: P[2] }))
    expect(rolled(cooler).has('humanAtm')).toBe(false)
  })

  it('three days of $5,000, then the news: he is gone and the money stays with you', () => {
    const [b, fan] = withFan(grown('atm'), atm)
    let a = open(b, 'humanAtm', fan)
    const start = a.clock.day
    // It pops up (one button); the money comes every day whether or not you have clicked it.
    expect(eventOfKind(a, 'humanAtm')).toMatchObject({ status: 'open', until: start + 3, amountCents: S.humanAtm.tributeCents })
    expect(openDayEvents(a)[0]).toMatchObject({ kind: 'humanAtm', title: 'Human ATM', options: [{ choice: 'ok', label: 'Accept the tribute' }] })
    expect(eventOfKind(a, 'humanAtmArrest')).toMatchObject({ status: 'scheduled', day: start + 3 })
    a = days(a, 2)
    expect(tipsFrom(a, fan.id) - tipsFrom(b, fan.id)).toBe(3 * S.humanAtm.tributeCents)
    expect(lastMessage(a, fan.id).intent).toMatchObject({ tip: S.humanAtm.tributeCents, event: { kind: 'humanAtm', step: 'tribute' } })
    expect(dayEventView(a).result).toContain('$15,000 so far')
    a = nextDay(a)
    const news = openDayEvents(a)[0]
    expect(news).toMatchObject({ kind: 'humanAtmArrest', category: 'special', title: 'Breaking News', options: [{ choice: 'close' }] })
    const done = resolveDayEvent(a, news.id!, 'close', a.meta.seed)
    expect(done.account.regulars.find((x) => x.id === fan.id)!.conditions).toContainEqual({ id: 'blocked', since: a.clock.day, by: 'arrested' })
    expect(done.account.ledger).toEqual(a.ledger)
    expect(done.events[0]).toMatchObject({ type: 'day-event-done', result: 'arrested' })
    expect(done.events[0].type === 'day-event-done' && done.events[0].text).toContain('The $15,000 he sent you was dirty money')
    expect(done.events[0].type === 'day-event-done' && done.events[0].text).toContain('nobody ever came to recover it')
  })
})

describe('Human ATM holds him', () => {
  const atm = (r: Regular): Regular => ({ ...r, segment: 'whale', personality: 'submissive', behaviours: ['older_gentleman'], loyalty: P[4], relationship: 'married' })

  it('no customs or meetups from the first $5,000 until you have read the news, so the arrest is how it ends', () => {
    const [b, fan] = withFan(grown('atm'), atm)
    const day = b.clock.day
    // He had a meetup lined up: it is off.
    const before: Account = { ...b, meetups: [...b.meetups, { id: 'm-x', regularId: fan.id, day, offerCents: 50000, replyBy: day + 5, status: 'accepted', meetDay: day + 2, hidden: false, messageId: 'x' }] }
    let a = open(before, 'humanAtm', fan)
    expect(a.meetups.find((m) => m.id === 'm-x')).toMatchObject({ status: 'cancelled', closedDay: day })
    for (let d = 1; d <= 4; d++) {
      // He would ask every day (Fanatic, married, old money), but does not.
      for (let i = 0; i < 20; i++) expect(simulateDealsDay(a, `s${d}-${i}`, a.clock.day + 1).account.meetups.filter((m) => m.regularId === fan.id && m.status === 'open')).toEqual([])
      expect(answerDeal(a, a.regulars.find((x) => x.id === fan.id)!, 'meetup', 'x', 'reply').deal.step).toBe('no')
      a = nextDay(a)
    }
    // The news is waiting: still no deals, and then he is gone.
    expect(openDayEvents(a)[0].kind).toBe('humanAtmArrest')
    expect(answerDeal(a, a.regulars.find((x) => x.id === fan.id)!, 'custom', 'x', 'reply').deal.step).toBe('no')
  })
})

describe('Marry Me?', () => {
  const suitor = (r: Regular): Regular => ({ ...r, segment: 'simp', behaviours: ['obsessive', 'stalker'], loyalty: P[4] })

  it('only for an e-girl whose obsessed stalker is at loyalty 5', () => {
    const [a] = withFan(grown('marry'), suitor)
    const egirl = { ...a, direction: { ...a.direction, id: 'egirl' as const, chosen: true }, dayEvents: [] }
    expect(rolled(egirl).has('marryMe')).toBe(true)
    expect(rolled({ ...egirl, direction: { ...egirl.direction, id: 'girl_next_door' } }).has('marryMe')).toBe(false)
    const [stalkerOnly] = withFan(egirl, (r) => ({ ...r, behaviours: ['stalker'] }))
    expect(rolled(stalkerOnly).has('marryMe')).toBe(false)
  })

  it('he proposes in a message; say yes and he is your fiancé, the honeymoon fund starts a month later, then the invitation', () => {
    const [b, fan] = withFan(grown('marry'), suitor)
    let a = open(b, 'marryMe', fan)
    const proposalDay = a.clock.day
    expect(lastMessage(a, fan.id).intent?.event?.step).toBe('proposal')
    const id = a.dayEvents.at(-1)!.id
    const yes = resolveDayEvent(a, id, 'yes', a.meta.seed)
    a = yes.account
    const gift = tipsFrom(a, fan.id) - tipsFrom(b, fan.id)
    expect(gift).toBeGreaterThanOrEqual(S.marryMe.gift[0] * 100)
    expect(gift).toBeLessThanOrEqual(S.marryMe.gift[1] * 100)
    expect(conditionOf(a.regulars.find((x) => x.id === fan.id)!, 'fiancee')).toEqual({ id: 'fiancee', since: proposalDay })
    expect(eventOfKind(a, 'honeymoonFund')).toMatchObject({ status: 'scheduled', day: proposalDay + S.marryMe.honeymoonAfterDays })
    expect(yes.events.find((e) => e.type === 'day-event-done')).toMatchObject({ result: 'yes' })

    // A month later it pops up (one button), and a transfer comes every day for a week, each with the note.
    a = days(a, S.marryMe.honeymoonAfterDays)
    const fund = eventOfKind(a, 'honeymoonFund')
    expect(fund).toMatchObject({ status: 'open', day: a.clock.day, until: a.clock.day + S.honeymoonFund.days })
    expect(openDayEvents(a)[0]).toMatchObject({ kind: 'honeymoonFund', title: 'The Honeymoon Fund', options: [{ choice: 'ok' }] })
    expect(lastMessage(a, fan.id).intent?.event?.step).toBe('fund')
    a = resolveDayEvent(a, fund.id, 'ok', a.meta.seed).account
    expect(eventOfKind(a, 'honeymoonFund')).toMatchObject({ status: 'active', result: 'running' })
    const before = tipsFrom(a, fan.id)
    a = days(a, S.honeymoonFund.days - 1)
    expect(tipsFrom(a, fan.id) - before).toBeGreaterThanOrEqual((S.honeymoonFund.days - 1) * S.honeymoonFund.transfer[0] * 100)
    expect(eventOfKind(a, 'saveTheDate')).toMatchObject({ status: 'scheduled', day: fund.day + S.honeymoonFund.saveTheDateAfterDays })

    // Then the invitation.
    a = days(a, S.honeymoonFund.saveTheDateAfterDays - S.honeymoonFund.days + 1)
    const invite = openDayEvents(a)[0]
    expect(invite).toMatchObject({ kind: 'saveTheDate', options: [{ choice: 'mom' }, { choice: 'decline' }] })
    expect(lastMessage(a, fan.id).intent?.event?.step).toBe('invite')
    const mom = resolveDayEvent(a, invite.id!, 'mom', a.meta.seed).account
    expect(lastMessage(mom, fan.id).intent).toMatchObject({ event: { step: 'mom' } })
    expect(tipsFrom(mom, fan.id)).toBeGreaterThan(tipsFrom(a, fan.id))
    const no = resolveDayEvent(a, invite.id!, 'decline', a.meta.seed)
    expect(no.events[0]).toMatchObject({ result: 'therapist' })
    expect(lastMessage(no.account, fan.id).intent?.event?.step).toBe('therapist')
  })

  it("you're delusional: he deflates or turns on you; block: he is gone, and nothing follows", () => {
    const [b, fan] = withFan(grown('marry'), suitor)
    const a = open(b, 'marryMe', fan)
    const id = a.dayEvents.at(-1)!.id
    const results = new Set<string>()
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const r = resolveDayEvent(a, id, 'delusional', seed)
      const him = r.account.regulars.find((x) => x.id === fan.id)!
      const result = (r.account.dayEvents.at(-1) as DayEvent).result!
      results.add(result)
      if (result === 'deflated') expect(him.behaviours).not.toContain('obsessive')
      else expect(hasCondition(him, 'hostile')).toBe(true)
      expect(r.account.dayEvents.some((e) => e.kind === 'honeymoonFund')).toBe(false)
    }
    expect(results).toEqual(new Set(['deflated', 'enraged']))
    const blocked = resolveDayEvent(a, id, 'block', a.meta.seed).account
    expect(blocked.regulars.find((x) => x.id === fan.id)!.conditions).toContainEqual({ id: 'blocked', since: a.clock.day, by: 'you' })
  })

  it('once he has proposed he never turns on you, however long you ignore him (until you call him delusional)', () => {
    // Loyalty 2: a Fanatic hardly ever turns, so this one would, if nothing held him.
    const [b, fan] = withFan(grown('marry'), (r) => ({ ...suitor(r), loyalty: P[1], since: 0 }))
    const turned = (a: Account) => {
      let x = a
      for (let d = 1; d <= 60; d++) x = simulateHatersDay(x, `ignore-${d}`, a.clock.day + d).account
      return hasCondition(x.regulars.find((r) => r.id === fan.id)!, 'hostile')
    }
    // A stalker you ignore for two months turns on you...
    const ignored = { ...b, threads: b.threads.map((t) => (t.regularId === fan.id ? { ...t, messages: t.messages.filter((m) => m.from === 'fan') } : t)) }
    expect(turned(ignored)).toBe(true)
    // ...but not while his proposal waits for your answer, and not once you said yes.
    const proposed = open(ignored, 'marryMe', ignored.regulars.find((r) => r.id === fan.id))
    expect(turned(proposed)).toBe(false)
    const engaged = resolveDayEvent(proposed, proposed.dayEvents.at(-1)!.id, 'yes', proposed.meta.seed).account
    expect(turned(engaged)).toBe(false)
    // No stalker scenes or Too Close for Comfort about him either.
    expect(rolledRare(engaged, 'tooClose')).toBe(false)
  })

  it('skipping ahead stops on the day the honeymoon fund starts, so you see it', () => {
    const [b, fan] = withFan(grown('marry'), suitor)
    let a = open(b, 'marryMe', fan)
    a = resolveDayEvent(a, a.dayEvents.at(-1)!.id, 'yes', a.meta.seed).account
    const due = eventOfKind(a, 'honeymoonFund').day
    a = { ...a, clock: { day: due - 3 } }
    const r = simulate(a, 7, a.meta.seed, SETTINGS, { stopAtRare: true }).account
    expect(r.clock.day).toBe(due)
    expect(openDayEvents(r).map((e) => e.kind)).toContain('honeymoonFund')
  })

  it('if he is gone before the honeymoon, it is off', () => {
    const [b, fan] = withFan(grown('marry'), suitor)
    let a = open(b, 'marryMe', fan)
    a = resolveDayEvent(a, a.dayEvents.at(-1)!.id, 'yes', a.meta.seed).account
    a = { ...a, regulars: a.regulars.map((x) => (x.id === fan.id ? { ...x, conditions: [...x.conditions, { id: 'blocked' as const, since: a.clock.day, by: 'you' as const }] } : x)) }
    a = days(a, S.marryMe.honeymoonAfterDays + 1)
    expect(a.dayEvents.some((e) => e.kind === 'honeymoonFund')).toBe(false)
  })
})
