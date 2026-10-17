// The event gallery's data (EventGallery.tsx): every event in presets/events.json, filled with
// sample values, in the shapes the popup and the Home card show. Read straight from the JSON,
// so with `npm run dev` an edit there shows up at once. The rules that pick which text shows
// when (which choice leads to which result, what keeps running) follow engine/events.ts and
// engine/specials.ts; if those change, change OUTCOMES and RUNNING here too.
import type { DayEventOption, DayEventView, Directions, Segment } from '../../api'
import audience from '../../presets/audience.json'
import D from '../../presets/directions.json'
import E from '../../presets/events.json'
import tags from '../../presets/tags.json'
import T from '../../presets/templates.json'

/** The account id the gallery's real popups run under: no account has it, nothing is saved. */
export const GALLERY_ID = 'dev-event-gallery'
/** Where LevelUp.tsx keeps the last level it celebrated for that account. */
export const levelSeenKey = `onlytavern:levelSeen:${GALLERY_ID}`

/** What fills the {placeholders}. */
export const SAMPLE = {
  /** {name}: the fan the event is about. */
  name: 'Rick',
  /** {gone}: who leaves (The Charity's old money, the regular Routing Error moves away). */
  gone: 'Harold',
  /** Routing Error: who comes instead ({name} in its result), and as what ({type}). */
  newFan: 'Marcus',
  newType: 'whale' as Segment,
  /** {you}: your name and handle. */
  you: 'Luna <@luna>',
  /** The day it happens. */
  day: 12,
  subscribers: 1200,
  /** "N subscribers left." after a scandal. */
  lost: 36,
  /** One of his tips, in cents; rare events multiply it (events.json `gifts`). */
  tipCents: 15000,
  /** {freebies}: the times men had you for free (The Charity needs `minFreebies`). */
  freebies: E.special.charity.minFreebies + 1,
  /** The Brand Deal's fee is by level (plus $1 a subscriber): this level. */
  brandLevel: 3,
  /** The Charity on its later day, when you close the doors. */
  charityDays: 4,
}

export type DirectionId = keyof typeof D.directions
export const DIRECTION_IDS = Object.keys(D.directions) as DirectionId[]
export const directionLabel = (id: string) => (D.directions as Record<string, { label: string }>)[id]?.label ?? id

/** A rare or special event in events.json (engine/specials.ts EventSpec). */
type Spec = {
  title: string
  text: string
  days: number
  default: string
  options: Record<string, { label: string; help: string; pick?: boolean }>
  odds: Record<string, number>
  results: Record<string, string>
  chained?: boolean
  progress?: string
  endLabel?: string
  email?: { from: string; to: string; subject: string; body: string }
}
const RARE = E.rare as unknown as Record<string, Spec>
const SPECIAL = E.special as unknown as Record<string, Spec>

/**
 * Which result each choice leads to (engine/events.ts settle, engine/specials.ts settleSpecial).
 * Two results: the first if the roll against the choice's odds succeeds, the second if it fails.
 */
const OUTCOMES: Record<string, Record<string, string[]>> = {
  whaleWatching: { pamper: ['pampered'], hardToGet: ['won', 'cooled'], business: ['business'] },
  tooClose: { keepTalking: ['flattered', 'deeper'], boundaries: ['respected', 'turned'], block: ['blocked'] },
  leakedContent: { takedown: ['contained', 'spread'], ignore: ['ignored'], leanIn: ['leaned'] },
  doxxed: { police: ['handled', 'dragged'], move: ['moved'], ignore: ['blewOver', 'escalated'] },
  brandDeal: { accept: ['accepted'], negotiate: ['negotiated', 'walked'], decline: ['declined'] },
  guestStar: { accept: ['shot', 'jealous'], decline: ['declined'] },
  secretAdmirer: { thank: ['thankedMore', 'thanked'], unmask: ['obsessed', 'unmasked'], keepQuiet: ['quiet'] },
  charity: { open: ['opened', 'openedRich'], decline: ['declined'] },
  routingError: { correct: ['corrected'], decline: ['declined'] },
  humanAtm: { ok: ['running'] },
  humanAtmArrest: { close: ['arrested'] },
  marryMe: { yes: ['yes'], delusional: ['deflated', 'enraged'], block: ['blocked'] },
  honeymoonFund: { ok: ['running'] },
  saveTheDate: { mom: ['mom'], decline: ['therapist'] },
}

/** When a result comes, where it is not just the roll. */
const WHEN: Record<string, string> = {
  'charity.opened': 'if none of your regulars is old money',
  'charity.openedRich': 'if old money was among your regulars: he walks out',
  'guestStar.shot': 'if the roll succeeds, or no devoted fan is there to get jealous',
  'guestStar.jealous': 'if the roll fails: subscribers cancel, the most attached fan turns on you',
}

/** Results after which the event keeps running: the popup and the Home card show its `progress` line instead. */
const RUNNING: Record<string, string[]> = { charity: ['opened', 'openedRich'], humanAtm: ['running'], honeymoonFund: ['running'] }

/** Results the popup shows as a warning (engine/events.ts BAD_RESULTS). */
const BAD = new Set(['cooled', 'deeper', 'turned', 'spread', 'ignored', 'dragged', 'escalated', 'walked', 'jealous', 'opened', 'openedRich', 'enraged'])
/** Results that cost subscribers: the popup adds "N subscribers left." */
const LOSES = new Set(['spread', 'leaned', 'dragged', 'escalated', 'jealous'])

/** His messages for each step of a special event: templates.json, used when the model cannot write (engine/regulars.ts templateText). */
const MESSAGES: Record<string, { step: string; when: string }[]> = {
  charity: [
    { step: 'charityAfter', when: 'every regular who went through the door' },
    { step: 'charityLeft', when: 'old money, before he blocks you' },
  ],
  routingError: [{ step: 'event_arrived', when: 'the new fan, when he arrives' }],
  humanAtm: [{ step: 'event_tribute', when: 'with each $5,000' }],
  marryMe: [
    { step: 'event_proposal', when: 'the proposal' },
    { step: 'event_yes', when: 'after you say yes (with his gift)' },
    { step: 'event_deflated', when: "after “You're Delusional”, if he deflates" },
  ],
  honeymoonFund: [{ step: 'event_fund', when: 'with each transfer' }],
  saveTheDate: [
    { step: 'event_invite', when: 'the invitation' },
    { step: 'event_mom', when: 'after you meet his mom (with his gift)' },
    { step: 'event_therapist', when: 'after you decline' },
  ],
}

/** Which event a chained one follows. */
const CHAIN: Record<string, string> = {
  humanAtmArrest: `${E.special.humanAtm.days} days after Human ATM`,
  honeymoonFund: `${E.special.marryMe.honeymoonAfterDays} days after you say yes to Marry Me?`,
  saveTheDate: `${E.special.honeymoonFund.saveTheDateAfterDays} days after The Honeymoon Fund starts`,
}

// Formatting, as engine/events.ts writes it.
export const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', cents % 100 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {})}`
const percent = (x: number) => `${Math.round(x * 100)}%`
const mid = ([lo, hi]: number[]) => Math.round((lo + hi) / 2)
const daysLeftLabel = (n: number) => (n ? `${n} more day${n === 1 ? '' : 's'}` : 'Ends today')

export const fill = (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m)

/** What the Home card shows. */
export type HomeView = {
  kind: string
  category: DayEventView['category']
  title: string
  text: string
  /** The little clock chip: how long it is still on. */
  chip?: string
  /** A rare or special event waiting for you. */
  decide?: boolean
  /** It runs until you end it (The Charity). */
  endLabel?: string
}

/** One way it can turn out: what the popup and the Home card say then. */
export type Outcome = {
  id: string
  /** The option that leads here (null: some other way, like closing The Charity's doors). */
  option: string | null
  /** “if the roll fails (50%)”, “on day 4, …”. */
  when?: string
  /** What the popup shows after you choose. */
  text: string
  /** Where that text is in events.json. */
  path: string
  bad: boolean
  lost?: number
  home: HomeView
  /** The result's own text, when the game shows another line instead (it keeps running). */
  unshown?: { path: string; text: string }
}

export type GalleryEvent = {
  id: string
  kind: string
  category: DayEventView['category']
  path: string
  title: string
  /** Comes by itself after an earlier event. */
  chain?: string
  /** The popup before you choose (rare and special events). */
  view?: DayEventView
  /** The Home card before you choose (or while it is on). */
  waiting: HomeView
  outcomes: Outcome[]
  /** Results in the JSON no option leads to here (probably new: add them to OUTCOMES). */
  unmapped: { path: string; text: string }[]
  messages: { path: string; when: string; en: string[]; zh: string[] }[]
  posts: { path: string; when: string; text: string }[]
  /** Common events: what they change, from the JSON. */
  effects?: string
}

const baseValues = (kind: string): Record<string, string> => ({
  name: SAMPLE.name,
  amount: money(0),
  fee: money(0),
  star: kind === 'guestStar' ? E.rare.guestStar.stars[0] : '',
  tag: tags[0]?.en ?? '',
  freebies: String(SAMPLE.freebies),
  count: '0',
  gone: SAMPLE.gone,
  his: 'his',
  type: '',
  days: '1',
  you: SAMPLE.you,
})

/** The brand deal for a direction: its product, its fee at the sample level, what you get if you push. */
function brand(direction: string) {
  const B = E.rare.brandDeal
  const products = B.products as Record<string, { name: string; pitch: string; ad: string }>
  const product = products[direction] ?? products.girl_next_door
  const fee = B.fee.byLevel[SAMPLE.brandLevel - 1] + SAMPLE.subscribers * B.fee.perSubscriberCents
  return { ...product, fee, pushed: Math.round((fee * B.fee.negotiateFactor) / 100) * 100 }
}

/**
 * Sample money, in cents: what the event carries when it opens (`open`), and what a result
 * brings (`results`), following how the engine works it out.
 */
function amounts(kind: string, direction: string): { open?: number; results?: Record<string, number> } {
  const tip = SAMPLE.tipCents
  const S = E.special
  switch (kind) {
    case 'whaleWatching':
      return { results: { pampered: tip * E.rare.whaleWatching.gifts.pamper, won: tip * E.rare.whaleWatching.gifts.hardToGet } }
    case 'brandDeal': {
      const b = brand(direction)
      return { open: b.fee, results: { accepted: b.fee, negotiated: b.pushed } }
    }
    case 'secretAdmirer':
      return { open: tip * E.rare.secretAdmirer.gifts.arrive, results: { thankedMore: tip * E.rare.secretAdmirer.gifts.more } }
    case 'humanAtm':
      return { open: S.humanAtm.tributeCents }
    case 'humanAtmArrest':
      return { open: S.humanAtm.tributeCents * S.humanAtm.days, results: { arrested: S.humanAtm.tributeCents * S.humanAtm.days } }
    case 'marryMe':
      return { results: { yes: mid(S.marryMe.gift) * 100 } }
    case 'honeymoonFund':
      return { open: mid(S.honeymoonFund.transfer) * 100 }
    case 'saveTheDate':
      return { results: { mom: mid(S.saveTheDate.gift) * 100 } }
    default:
      return {}
  }
}

const charityMen = mid(E.special.charity.men)

/** A rare or special event: its popup, its Home card before and after, every result. */
function rareOrSpecial(category: 'rare' | 'special', kind: string, spec: Spec, direction = 'girl_next_door'): GalleryEvent {
  const path = `${category}.${kind}`
  const money$ = amounts(kind, direction)
  const values = (extra: Record<string, string> = {}) => ({
    ...baseValues(kind),
    ...(kind === 'brandDeal' ? { pitch: brand(direction).pitch, product: brand(direction).name } : {}),
    amount: money(money$.open ?? 0),
    fee: money(money$.open ?? 0),
    ...extra,
  })
  const costs: Record<string, number> = { leakedContent: E.rare.leakedContent.costCents, doxxed: E.rare.doxxed.moveCents }

  const options: DayEventOption[] = Object.entries(spec.options).map(([choice, o]) => {
    const chance = spec.odds[choice]
    return {
      choice,
      label: o.label,
      help: fill(o.help, values({ chance: chance !== undefined ? percent(chance) : '', fee: money(costs[kind] ?? money$.open ?? 0) })),
      ...(chance !== undefined ? { chance } : {}),
      ...(o.pick ? { pick: true } : {}),
    }
  })
  const view: DayEventView = {
    id: null,
    kind,
    category,
    title: spec.title,
    text: fill(spec.text, values()),
    day: SAMPLE.day,
    daysLeft: spec.days - 1,
    status: 'open',
    options,
    fallback: spec.default,
    answerBy: SAMPLE.day + E.daily.answerDays - 1,
    ...(kind === 'routingError'
      ? {
          pick: {
            fans: [
              { id: 'a', name: SAMPLE.name, type: 'simp' as Segment },
              { id: 'b', name: SAMPLE.gone, type: 'whale' as Segment },
              { id: 'c', name: 'Tom', type: 'regular' as Segment },
              { id: 'd', name: 'Dean', type: 'hater' as Segment },
            ],
            types: Object.entries(audience.segments).map(([id, s]) => ({ id: id as Segment, label: s.label })),
          },
        }
      : {}),
    ...(spec.email
      ? { email: { from: spec.email.from, to: fill(spec.email.to, values()), subject: spec.email.subject, body: fill(spec.email.body, values()) } }
      : {}),
  }
  const home = (text: string, more: Partial<HomeView> = {}): HomeView => ({ kind, category, title: spec.title, text, ...more })

  /** The line while it runs: The Charity's door count, the money so far. */
  const progress = (extra: Record<string, string>) => fill(spec.progress ?? '', values(extra))
  const runningHome = (text: string, daysLeft: number) =>
    kind === 'charity' ? home(text, { chip: 'Until you end it', endLabel: spec.endLabel }) : home(text, { chip: daysLeftLabel(daysLeft) })

  const outcome = (option: string | null, result: string, when?: string): Outcome => {
    const cents = money$.results?.[result]
    const v = values({
      ...(cents !== undefined ? { amount: money(cents) } : {}),
      // Routing Error: the new fan is who it is about now.
      ...(kind === 'routingError' && result === 'corrected' ? { name: SAMPLE.newFan, type: audience.segments[SAMPLE.newType].label.toLowerCase() } : {}),
      ...(kind === 'charity' ? { count: charityMen.toLocaleString('en-US') } : {}),
    })
    const own = fill(spec.results[result] ?? '', v)
    const running = RUNNING[kind]?.includes(result) && spec.progress
    const text = running ? progress({ ...v }) : own
    const lost = LOSES.has(result) ? SAMPLE.lost : undefined
    return {
      id: result,
      option,
      ...(when ? { when } : {}),
      text,
      path: running ? `${path}.progress` : `${path}.results.${result}`,
      bad: BAD.has(result),
      ...(lost ? { lost } : {}),
      home: running ? runningHome(text, spec.days - 1) : home(text),
      // The Charity: the popup shows the door count, not what you wrote for opening the doors.
      ...(running && kind === 'charity' ? { unshown: { path: `${path}.results.${result}`, text: own } } : {}),
    }
  }

  const map = OUTCOMES[kind] ?? {}
  const outcomes: Outcome[] = []
  for (const [choice, results] of Object.entries(map)) {
    if (!(choice in spec.options)) continue
    const chance = spec.odds[choice]
    results.forEach((r, i) => {
      const roll = results.length > 1 && chance !== undefined ? (i === 0 ? `if the roll succeeds (${percent(chance)})` : `if the roll fails (${percent(1 - chance)})`) : undefined
      outcomes.push(outcome(choice, r, WHEN[`${kind}.${r}`] ?? roll))
    })
  }

  // Later days of the ones that keep running, and The Charity's end.
  if (kind === 'charity') {
    const later = { count: (charityMen * SAMPLE.charityDays).toLocaleString('en-US'), days: String(SAMPLE.charityDays) }
    const text = progress(later)
    outcomes.push({ id: 'day', option: null, when: `on day ${SAMPLE.charityDays}, the doors still open`, text, path: `${path}.progress`, bad: false, home: runningHome(text, 0) })
    const ended = fill(spec.results.ended, values(later))
    outcomes.push({ id: 'ended', option: null, when: `when you click “${spec.endLabel}” on Home`, text: ended, path: `${path}.results.ended`, bad: false, home: home(ended) })
  }
  if (kind === 'humanAtm' || kind === 'honeymoonFund') {
    const total = money((money$.open ?? 0) * spec.days)
    const text = progress({ amount: total })
    outcomes.push({ id: 'last', option: null, when: `on day ${spec.days}, the last one`, text, path: `${path}.progress`, bad: false, home: runningHome(text, 0) })
  }

  const shown = new Set(Object.values(map).flat().concat(kind === 'charity' ? ['ended'] : []))
  return {
    id: kind === 'brandDeal' ? `${kind}-${direction}` : kind,
    kind,
    category,
    path,
    title: spec.title,
    ...(CHAIN[kind] ? { chain: CHAIN[kind] } : {}),
    view,
    waiting: home(view.text, { decide: true }),
    outcomes,
    unmapped: Object.entries(spec.results)
      .filter(([r]) => !shown.has(r))
      .map(([r, text]) => ({ path: `${path}.results.${r}`, text: fill(text, values()) })),
    messages: (MESSAGES[kind] ?? []).map(({ step, when }) => ({
      path: `templates.json → en.${step} / zh.${step}`,
      when,
      en: (T.en as Record<string, string[]>)[step] ?? [],
      zh: (T.zh as Record<string, string[]>)[step] ?? [],
    })),
    posts: posts(kind, direction),
  }
}

/** The posts an event puts up for you. */
function posts(kind: string, direction: string): GalleryEvent['posts'] {
  const S = E.special.charity
  switch (kind) {
    case 'brandDeal':
      return [{ path: `rare.brandDeal.products.${direction}.ad`, when: 'you take the deal', text: brand(direction).ad }]
    case 'guestStar':
      return [{ path: 'rare.guestStar.post', when: 'you shoot the scene', text: fill(E.rare.guestStar.post, { star: E.rare.guestStar.stars[0] }) }]
    case 'charity':
      return [
        { path: 'special.charity.openPost', when: 'you open the doors', text: S.openPost },
        { path: 'special.charity.endPost', when: 'you close them', text: fill(S.endPost, { count: (charityMen * SAMPLE.charityDays).toLocaleString('en-US') }) },
      ]
    default:
      return []
  }
}

const EFFECT_WORDS: Record<string, string> = {
  crowdTips: 'crowd tips',
  tipChance: 'tip chance',
  tipSize: 'tip size',
  tagReach: 'tag reach',
  visitors: 'visitors',
  conversion: 'new subscribers',
  dms: 'messages',
  newRegulars: 'new regulars',
  reach: 'post reach',
  renewal: 'renewals',
  meetupRate: 'meetup invitations',
  mix: 'visitors who are',
  regularMix: 'new regulars who are',
}
function effectsLine(effects: Record<string, unknown>): string {
  return Object.entries(effects)
    .map(([k, v]) =>
      typeof v === 'number'
        ? `${EFFECT_WORDS[k] ?? k} ×${v}`
        : `${EFFECT_WORDS[k] ?? k} ${Object.entries(v as Record<string, number>)
            .map(([s, x]) => `${s} ×${x}`)
            .join(', ')}`,
    )
    .join(' · ')
}

/** A common event (or a rumor, or an ordinary day): only a Home card, no choice. */
function common(kind: string, path: string, spec: { title: string; text: string; days?: number; effects?: Record<string, unknown> }, category: DayEventView['category'] = 'common'): GalleryEvent {
  const days = spec.days ?? 1
  const text = fill(spec.text, baseValues(kind))
  return {
    id: path,
    kind,
    category,
    path,
    title: spec.title,
    waiting: { kind, category, title: spec.title, text, ...(category === 'common' ? { chip: daysLeftLabel(days - 1) } : {}) },
    outcomes: [],
    unmapped: [],
    messages: [],
    posts: [],
    ...(spec.effects && Object.keys(spec.effects).length ? { effects: effectsLine(spec.effects) } : {}),
  }
}

export type Section = { id: string; title: string; note: string; events: GalleryEvent[]; brandDeals?: GalleryEvent[] }

/** Everything in events.json, in the order the gallery shows it. */
export function gallerySections(): Section[] {
  const rumorDays = E.common.rumor.days
  const commons: GalleryEvent[] = [common('ordinary', 'ordinary', E.ordinary, 'default')]
  for (const [kind, spec] of Object.entries(E.common)) {
    if (kind !== 'rumor') commons.push(common(kind, `common.${kind}`, spec))
  }
  const rumors = Object.entries(E.rumors).map(([v, spec]) => common('rumor', `rumors.${v}`, { ...spec, days: rumorDays }))

  const rare = Object.entries(RARE).map(([kind, spec]) => rareOrSpecial('rare', kind, spec))
  const brandDeals = DIRECTION_IDS.map((d) => rareOrSpecial('rare', 'brandDeal', RARE.brandDeal, d))
  const special = Object.entries(SPECIAL).map(([kind, spec]) => rareOrSpecial('special', kind, spec))

  return [
    { id: 'common', title: 'Common events', note: 'No choice: they change the odds for a day or a few. Only a Home card.', events: commons },
    { id: 'rumors', title: 'Rumor Mill', note: `One of these, picked at random, for ${rumorDays} days (events.json → rumors).`, events: rumors },
    { id: 'rare', title: 'Rare events', note: 'A popup with choices, the odds on the buttons. Brand Deal: pick a direction.', events: rare, brandDeals },
    { id: 'special', title: 'Special events', note: 'Turning points, and what follows them by itself.', events: special },
  ]
}

/** The level-up popup's data for one direction (what api.getDirections gives it). */
export function levelUpDirections(direction: DirectionId, level: number): Directions {
  const spec = D.directions[direction]
  return {
    current: direction,
    chosen: true,
    switchLoss: D.switchLoss,
    all: [
      {
        id: direction,
        label: spec.label,
        blurb: spec.blurb,
        signatureTags: spec.signatureTags,
        points: D.levels.points[level - 1],
        level,
        title: spec.titles[level - 1],
        from: D.levels.points[level - 1],
        next: D.levels.points[level] ?? null,
      },
    ],
    perks: { visitors: D.levels.visitors, dms: D.levels.dms, fee: D.levels.fee },
  } as Directions
}

/** Each level's title for a direction, and what the level gives and takes. */
export function levelTable(direction: DirectionId) {
  const L = D.levels
  return D.directions[direction].titles.map((title, i) => ({
    level: i + 1,
    title,
    visitors: L.visitors[i],
    dms: L.dms[i],
    fee: L.fee[i],
    points: L.points[i],
  }))
}
