import { Button, Card, CardContent, Chip } from '@fanvue/ui'
import { type ReactNode, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ProductCard } from '../ProductCard'
import { PageTitle } from '../shell/PageTitle'
import { DayEventDialog } from '../time/DayEventDialog'
import {
  DIRECTION_IDS,
  type DirectionId,
  directionLabel,
  GALLERY_ID,
  type GalleryEvent,
  gallerySections,
  levelSeenKey,
  levelTable,
  money,
  SAMPLE,
} from './galleryData'
import { HomeCardPreview, PopupPreview, type PopupStage, RealLevelUp, Txt } from './previews'

// Event gallery (Settings → Developer, 2026-10-17): every daily event, every step of the
// special ones, each direction's Brand Deal and the level-up popup, with sample values and
// without playing to them. The words come straight from presets/events.json (galleryData.ts),
// so with `npm run dev` running an edit to the JSON shows here at once. Nothing is saved:
// the popups and cards here are drawings, and the "Real popup" buttons open the real ones
// with made-up data. Goes with the rest of ui/dev/ (see DevConsole.tsx).

export function EventGallery() {
  const navigate = useNavigate()
  const sections = gallerySections()
  // The level-up preview's made-up record goes when you leave.
  useEffect(
    () => () => {
      try {
        localStorage.removeItem(levelSeenKey)
      } catch {
        // Nothing to clean up.
      }
    },
    [],
  )
  const jump = (id: string) => document.getElementById(`gallery-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4">
      <PageTitle
        title="Event gallery"
        subtitle="Every event with sample values, straight from presets/events.json. With npm run dev running, edit the JSON and this page updates."
        actions={
          <Button variant="secondary" size="32" onClick={() => navigate('/settings')}>
            Back to Settings
          </Button>
        }
      />
      <SampleCard />
      <div className="flex flex-wrap gap-2">
        {sections.map((s) => (
          <Chip key={s.id} size="32" onClick={() => jump(s.id)}>
            {s.title}
          </Chip>
        ))}
        <Chip size="32" onClick={() => jump('levelUp')}>
          Level up
        </Chip>
      </div>

      {sections.map((s) => (
        <section key={s.id} id={`gallery-${s.id}`} className="flex scroll-mt-4 flex-col gap-4">
          <SectionTitle title={s.title} note={s.note} />
          {s.id === 'common' || s.id === 'rumors' ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {s.events.map((e) => (
                <CommonCard key={e.id} event={e} />
              ))}
            </div>
          ) : (
            s.events.map((e) =>
              s.byDirection?.[e.kind] ? <ByDirectionCard key={e.kind} kind={e.kind} deals={s.byDirection[e.kind]} /> : <EventCard key={e.id} event={e} />,
            )
          )}
        </section>
      ))}

      <section id="gallery-levelUp" className="flex scroll-mt-4 flex-col gap-4">
        <SectionTitle title="Level up" note="The popup when your direction goes up a level (ui/time/LevelUp.tsx). Titles and numbers: presets/directions.json." />
        <LevelUpCard />
      </section>
    </div>
  )
}

function SectionTitle({ title, note }: { title: string; note: string }) {
  return (
    <div className="border-b border-border-primary pb-2">
      <h2 className="font-display text-3xl">{title}</h2>
      <p className="text-sm text-content-secondary">{note}</p>
    </div>
  )
}

/** The values the {placeholders} are filled with. */
function SampleCard() {
  const rows: [string, string][] = [
    ['{name}', `${SAMPLE.name} (the fan it is about)`],
    ['{gone}', `${SAMPLE.gone} (who leaves)`],
    ['{you}', SAMPLE.you],
    ['{amount} {fee}', `worked out per event, e.g. one of his tips is ${money(SAMPLE.tipCents)}`],
    ['{chance}', 'from the event’s odds'],
    ['{freebies}', String(SAMPLE.freebies)],
    ['day', String(SAMPLE.day)],
    ['subscribers', `${SAMPLE.subscribers.toLocaleString('en-US')} (${SAMPLE.lost} leave in a scandal)`],
  ]
  return (
    <Card className="p-5">
      <CardContent className="flex flex-col gap-2 px-0 py-0 text-sm">
        <span className="typography-body-small-14px-semibold">Sample values</span>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt>
                <code className="text-xs">{k}</code>
              </dt>
              <dd className="text-content-secondary">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-content-tertiary">
          A placeholder still in braces, <Txt>{'like {this}'}</Txt>, was not filled: a typo in the JSON, or a new one the gallery does not know yet. Sample values live
          in app/src/ui/dev/galleryData.ts (SAMPLE).
        </p>
      </CardContent>
    </Card>
  )
}

/** Where a piece of text lives. */
function Path({ children }: { children: string }) {
  return <code className="break-all text-[11px] text-content-tertiary">{children}</code>
}

function Column({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-xs font-semibold tracking-widest text-content-tertiary uppercase">{label}</span>
      {children}
    </div>
  )
}

/** A common event, a rumor or an ordinary day: just the Home card. */
function CommonCard({ event }: { event: GalleryEvent }) {
  return (
    <div className="flex flex-col gap-2">
      <HomeCardPreview home={event.waiting} />
      <Path>{`events.json → ${event.path}`}</Path>
      {event.effects && <p className="text-xs text-content-tertiary">{event.effects}</p>}
    </div>
  )
}

/** A rare or special event: the popup, the Home card, and every way it can turn out. */
function EventCard({ event, header }: { event: GalleryEvent; header?: ReactNode }) {
  const [stage, setStage] = useState<PopupStage>({ at: 'open' })
  const [real, setReal] = useState(false)
  const view = event.view!
  const label = (choice: string | null) => (choice ? view.options.find((o) => o.choice === choice)?.label : undefined)
  const choose = (choice: string) => {
    if (stage.at === 'open' && view.options.find((o) => o.choice === choice)?.pick) return setStage({ at: 'picking' })
    const outcome = event.outcomes.find((o) => o.option === choice)
    if (outcome) setStage({ at: 'done', outcome })
  }
  const selected = stage.at === 'done' ? stage.outcome.id : null
  const home = stage.at === 'done' ? stage.outcome.home : event.waiting

  return (
    <Card className="p-5" id={`gallery-${event.id}`}>
      <CardContent className="flex flex-col gap-4 px-0 py-0">
        <div className="flex flex-wrap items-start gap-3">
          <div className="mr-auto min-w-0">
            <h3 className="font-display text-2xl">{event.title}</h3>
            <Path>{`events.json → ${event.path}`}</Path>
            {event.chain && <p className="text-xs text-content-secondary">Comes by itself: {event.chain}.</p>}
          </div>
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <Button variant="secondary" size="32" onClick={() => setReal(true)}>
              Real popup
            </Button>
            <span className="text-[11px] text-content-tertiary">The choices do nothing there.</span>
          </div>
        </div>
        {header}
        <div className="grid gap-6 lg:grid-cols-[400px_minmax(0,1fr)]">
          <Column label="Popup">
            <PopupPreview view={view} stage={stage} onChoose={choose} onBack={() => setStage({ at: 'open' })} />
            <p className="text-xs text-content-tertiary">Click a choice to see how it turns out; the list on the right has every result.</p>
          </Column>
          <div className="flex min-w-0 flex-col gap-6">
            <Column label="Home card">
              <HomeCardPreview home={home} />
            </Column>
            <Column label="How it turns out">
              <ResultRow
                selected={stage.at !== 'done'}
                title="Waiting for you"
                text={event.waiting.text}
                path={`events.json → ${event.path}.text`}
                onClick={() => setStage({ at: 'open' })}
              />
              {event.outcomes.map((o) => {
                const option = label(o.option)
                return (
                  <ResultRow
                    key={o.id}
                    selected={selected === o.id}
                    tone={o.bad || o.lost ? 'bad' : 'good'}
                    title={[option && `“${option}”`, o.when].filter(Boolean).join(' · ') || o.id}
                    path={`events.json → ${o.path}`}
                    text={o.text + (o.lost ? ` ${o.lost} subscribers left.` : '')}
                    onClick={() => setStage({ at: 'done', outcome: o })}
                  >
                    {o.unshown && (
                      <span className="block rounded-lg bg-warning-surface p-2 text-xs text-warning-content">
                        Never shown right now: the game shows the line above instead. events.json → {o.unshown.path}: “<Txt>{o.unshown.text}</Txt>”
                      </span>
                    )}
                  </ResultRow>
                )
              })}
              {event.unmapped.map((u) => (
                <div key={u.path} className="rounded-xl border border-dashed border-border-primary p-3 text-sm">
                  <span className="text-xs text-content-tertiary">No choice leads here (add it to OUTCOMES in ui/dev/galleryData.ts)</span>
                  <p>
                    <Txt>{u.text}</Txt>
                  </p>
                  <Path>{`events.json → ${u.path}`}</Path>
                </div>
              ))}
            </Column>
            {event.posts.length > 0 && (
              <Column label="Posts it puts up for you">
                {event.posts.map((p) => (
                  <div key={p.path} className="rounded-xl border border-border-primary bg-surface-primary p-3 text-sm">
                    <span className="text-xs text-content-tertiary">When {p.when}</span>
                    <p>
                      <Txt>{p.text}</Txt>
                    </p>
                    {p.product && <ProductCard product={p.product} />}
                    <Path>{`events.json → ${p.path}`}</Path>
                  </div>
                ))}
              </Column>
            )}
            {event.messages.length > 0 && (
              <Column label="His messages (template lines)">
                <p className="text-xs text-content-tertiary">
                  The model writes these. When it cannot, one of these lines is used (picked at random, in his language). What the model is told: llm/fanMessage.ts (eventLine).
                </p>
                {event.messages.map((m) => (
                  <div key={m.path} className="flex flex-col gap-1 rounded-xl border border-border-primary p-3 text-sm">
                    <span className="text-xs text-content-tertiary">{m.when}</span>
                    {m.en.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                    {m.zh.map((line) => (
                      <p key={line} className="text-content-secondary">
                        {line}
                      </p>
                    ))}
                    <Path>{m.path}</Path>
                  </div>
                ))}
              </Column>
            )}
          </div>
        </div>
      </CardContent>
      {real && <DayEventDialog accountId={GALLERY_ID} view={view} onDone={() => setReal(false)} onLater={() => setReal(false)} />}
    </Card>
  )
}

/** One way it can go: what leads there, the words, where they live; `children`: a note under it. */
function ResultRow({
  title,
  text,
  path,
  selected,
  tone,
  onClick,
  children,
}: {
  title: string
  text: string
  path: string
  selected: boolean
  tone?: 'good' | 'bad'
  onClick: () => void
  children?: ReactNode
}) {
  const dot = tone === 'bad' ? 'bg-warning-content' : tone === 'good' ? 'bg-success-content' : 'bg-content-tertiary'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col gap-1 rounded-xl border p-3 text-left text-sm ${selected ? 'border-brand-primary-default bg-surface-primary' : 'border-border-primary hover:border-brand-primary-default'}`}
    >
      <span className="flex items-center gap-2 text-xs text-content-tertiary">
        <span className={`size-2 shrink-0 rounded-full ${dot}`} />
        {title}
      </span>
      <span>
        <Txt>{text}</Txt>
      </span>
      {children}
      <Path>{path}</Path>
    </button>
  )
}

/** The Brand Deal (or its follow-up), for whichever direction you pick: each has its own product. */
function ByDirectionCard({ kind, deals }: { kind: string; deals: GalleryEvent[] }) {
  const [direction, setDirection] = useState<DirectionId>('girl_next_door')
  const deal = deals.find((d) => d.id === `${kind}-${direction}`) ?? deals[0]
  return (
    <EventCard
      key={deal.id}
      event={deal}
      header={
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {DIRECTION_IDS.map((d) => (
              <Chip key={d} size="32" selected={d === direction} onClick={() => setDirection(d)}>
                {directionLabel(d)}
              </Chip>
            ))}
          </div>
          <p className="text-xs text-content-tertiary">
            {kind === 'brandFollowUp'
              ? 'How each direction’s product sells, and the odds: events.json → rare.brandDeal.products.<direction>.followUp.'
              : 'Each direction’s product, picture and fixed fee: events.json → rare.brandDeal.products (pictures in assets/products).'}
          </p>
        </div>
      }
    />
  )
}

const pct = (x: number) => `${Math.round(x * 100)}%`

/** Each direction's level titles and what each level gives, and the real popup for any step up. */
function LevelUpCard() {
  const [direction, setDirection] = useState<DirectionId>('girl_next_door')
  const [showing, setShowing] = useState<{ direction: DirectionId; level: number; n: number } | null>(null)
  const rows = levelTable(direction)
  return (
    <Card className="p-5">
      <CardContent className="flex flex-col gap-4 px-0 py-0">
        <div className="flex flex-wrap gap-2">
          {DIRECTION_IDS.map((d) => (
            <Chip key={d} size="32" selected={d === direction} onClick={() => setDirection(d)}>
              {directionLabel(d)}
            </Chip>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-content-tertiary">
              <tr>
                <th className="py-1 pr-3 font-normal">Level</th>
                <th className="py-1 pr-3 font-normal">Title</th>
                <th className="py-1 pr-3 font-normal">Points</th>
                <th className="py-1 pr-3 font-normal">Visitors</th>
                <th className="py-1 pr-3 font-normal">Fans writing</th>
                <th className="py-1 pr-3 font-normal">Platform fee</th>
                <th className="py-1 font-normal" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-primary">
              {rows.map((r) => (
                <tr key={r.level}>
                  <td className="py-2 pr-3">{r.level}</td>
                  <td className="py-2 pr-3">“{r.title}”</td>
                  <td className="py-2 pr-3">{r.points}</td>
                  <td className="py-2 pr-3">×{r.visitors}</td>
                  <td className="py-2 pr-3">×{r.dms}</td>
                  <td className="py-2 pr-3">{pct(r.fee)}</td>
                  <td className="py-2 text-right">
                    {r.level > 1 && (
                      <Button variant="secondary" size="32" onClick={() => setShowing({ direction, level: r.level, n: (showing?.n ?? 0) + 1 })}>
                        Popup {r.level - 1} → {r.level}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Path>{`directions.json → directions.${direction}.titles · levels.points / visitors / dms / fee`}</Path>
        <p className="text-xs text-content-tertiary">The popup’s other words (Congratulations!, the benefit names) are written in ui/time/LevelUp.tsx.</p>
      </CardContent>
      {showing && <RealLevelUp key={showing.n} direction={showing.direction} level={showing.level} />}
    </Card>
  )
}
