import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { arcs, pct } from '../lib/figures'
import { ProgressBar, ProgressTip } from '../../../components/DeliverableProgress'
import type { WorkProgress } from '../../../lib/deliverables/work-phase'
import clockIcon from '../assets/ontime.svg'
import warnIcon from '../assets/atrisk.svg'
import doneIcon from '../assets/delivered.svg'
import personIcon from '../assets/person.svg'
import ringIcon from '../assets/status-ring.svg'
import dotAmber from '../assets/dot-amber.svg'
import dotRed from '../assets/dot-red.svg'
import rowCheck from '../assets/row-check.svg'

/**
 * The Dashboard's building blocks — Figma section H (`1592:2`: DB-AM `1592:5`, DB-L `1592:118`, DB-M `1592:245`),
 * one shape for every view (ADR-0122 d.1). Each block is the frame's: its sizes, spacing and colours (tokens in
 * `index.css`, "Dashboard", taken from the frames' own values), the Figma's icon assets where it has them, and the
 * three icons it draws from plain rectangles (lines, bars, pause) drawn the same way here. Every chip in the frames
 * is a working control.
 */

export type IconKind = 'clock' | 'warn' | 'done' | 'person' | 'lines' | 'bars' | 'pause'

export function DashIcon({ kind }: { kind: IconKind }) {
  const src = { clock: clockIcon, warn: warnIcon, done: doneIcon, person: personIcon }[kind as 'clock']
  if (src) return <img className="db-icon" src={src} width={28} height={28} alt="" />
  return (
    <span className={`db-icon db-icon-drawn db-icon-${kind}`} aria-hidden="true">
      {kind === 'lines' && <><i /><i /><i /></>}
      {kind === 'bars' && <><i /><i /><i /></>}
      {kind === 'pause' && <><i /><i /></>}
    </span>
  )
}

export interface TrendProps { value: number | null; upIsGood: boolean; unit?: '%' | '' }

/**
 * "8% ↗" (Figma H trend chip) — red when the move is bad news, green when it is good. `upIsGood` says which way
 * is good for this figure: more work finished is good, more hours booked or more waiting is not. `unit` '%' shows
 * the change as a percentage; '' as a count ("2 ↗").
 */
export function Trend({ value, upIsGood, unit = '%' }: TrendProps) {
  if (value == null || value === 0) return null
  const arrow = value > 0 ? '↗' : '↘'
  const good = value > 0 === upIsGood
  return (
    <span className={`db-trend ${good ? 'db-trend-good' : 'db-trend-bad'}`}>
      {Math.abs(value)}{unit} {arrow}
    </span>
  )
}

export interface StatProps {
  id: string
  icon: IconKind
  label: string
  value: string
  caption: string
  /** The whole caption on hover, where the line shortens it (I66.5). */
  captionTitle?: string
  /** A caption of full names wraps to a second line rather than cutting a name off (I66.1, I66.5). */
  captionWraps?: boolean
  trend?: TrendProps
  /** Where the problem is acted on (ADR-0122 d.4) — the whole card opens it. */
  to?: string
}

/** A top-bar card (Figma H 1707:520): icon, label, the ring; the figure and its trend; one line of verdict. */
export function StatCard({ id, icon, label, value, caption, captionTitle, captionWraps, trend, to }: StatProps) {
  const body = (
    <>
      <span className="db-stat-head">
        <DashIcon kind={icon} />
        <span className="db-stat-label">{label}</span>
        <img className="db-stat-ring" src={ringIcon} width={14} height={14} alt="" />
      </span>
      <span className="db-stat-value-row">
        <span className="db-stat-value" data-testid={`db-stat-${id}-value`}>{value}</span>
        {trend && <Trend {...trend} />}
      </span>
      <span className={`db-stat-caption${captionWraps ? ' db-stat-caption-wraps' : ''}`} title={captionTitle}>{caption}</span>
    </>
  )
  return to ? (
    <Link to={to} className="db-card db-stat" data-testid={`db-stat-${id}`}>{body}</Link>
  ) : (
    <div className="db-card db-stat" data-testid={`db-stat-${id}`}>{body}</div>
  )
}

export function StatRow({ stats }: { stats: StatProps[] }) {
  return <div className="db-stats">{stats.map((s) => <StatCard key={s.id} {...s} />)}</div>
}

/** A panel (Figma H 1707:572): icon, title, its chips on the right, then its body. */
export function Panel({ id, icon, title, action, children, wide, full }: {
  id: string
  icon: IconKind
  title: string
  action?: ReactNode
  children: ReactNode
  /** Takes the rest of its row (the frames' wide panel); otherwise the 420px narrow one. */
  wide?: boolean
  /** A row of its own, edge to edge ("What to touch today"). */
  full?: boolean
}) {
  return (
    <section className={`db-card db-panel${wide ? ' db-panel-wide' : ''}${full ? ' db-panel-full' : ''}`} data-testid={`db-panel-${id}`}>
      <header className="db-panel-head">
        <DashIcon kind={icon} />
        <h2 className="db-panel-title">{title}</h2>
        <span className="db-spacer" />
        {action}
      </header>
      {children}
    </section>
  )
}

export function PanelLink({ to, children, id }: { to: string; children: ReactNode; id: string }) {
  return <Link to={to} className="db-chip" data-testid={id}>{children}</Link>
}

/** A Figma chip that chooses ("This week ⌄", "All clients ⌄", "Filter"): a real select, drawn as the chip. */
export function ChipSelect<V extends string>({ id, label, value, options, onChange }: {
  id: string
  label: string
  value: V
  options: { value: V; label: string }[]
  onChange: (v: V) => void
}) {
  return (
    <label className="db-chip db-chip-select">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as V)} data-testid={id}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span className="db-chip-caret" aria-hidden="true">⌄</span>
    </label>
  )
}

/** A Figma chip that toggles ("Sort"). */
export function ChipButton({ id, children, pressed, onClick }: { id: string; children: ReactNode; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`db-chip${pressed ? ' is-on' : ''}`} aria-pressed={pressed} onClick={onClick} data-testid={id}>
      {children}
    </button>
  )
}

/** The big figure under a panel's title: "32  18% ↗  +5 on the last four weeks". */
export function Headline({ value, trend, note }: { value: string; trend?: TrendProps; note?: string }) {
  return (
    <div className="db-headline">
      <span className="db-headline-value">{value}</span>
      {trend && <Trend {...trend} />}
      {note && <span className="db-headline-note">{note}</span>}
    </div>
  )
}

// ------------------------------------------------------------------ charts

export interface Series { key: string; label: string; tone: string }

/**
 * Stacked bars, one per week, the total over each, and the shaded bands that join each series from one week to the
 * next (Figma H "Deliveries, last four weeks" / "Hours booked, last four weeks"). Series stack bottom up in order.
 * Drawn in one SVG so bars and bands share one scale.
 */
export function WeekBars({ weeks, series, format = (n) => String(n) }: {
  weeks: { key: string; label: string; values: Record<string, number>; now?: boolean }[]
  series: Series[]
  format?: (n: number) => string
}) {
  const totals = weeks.map((w) => series.reduce((n, s) => n + (w.values[s.key] ?? 0), 0))
  const max = Math.max(1, ...totals)
  const W = 600
  const H = 250
  const BASE = 210 // bars stand on this line; labels sit under it (Figma: labels at 220)
  const TOP = 30 // room for the total over the tallest bar
  const n = weeks.length
  const barW = W / (n + (n - 1) * 0.95)
  const step = barW * 1.95
  const GAP = 4
  const segs = weeks.map((w) => {
    let y = BASE
    return series.map((s) => {
      const v = w.values[s.key] ?? 0
      const h = v > 0 ? Math.max(8, (v / max) * (BASE - TOP) - GAP) : 0
      const seg = { key: s.key, tone: s.tone, bottom: y, top: y - h }
      if (h > 0) y = y - h - GAP
      return seg
    })
  })
  const topOf = (i: number) => Math.min(BASE, ...segs[i]!.map((s) => s.top))
  return (
    <div className="db-weekbars">
      <svg className="db-weekbars-svg" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={weeks.map((w, i) => `${w.label} ${format(totals[i]!)}`).join(', ')}>
        {segs.slice(0, -1).map((col, i) =>
          col.map((s, k) => {
            const next = segs[i + 1]![k]!
            if (s.top === s.bottom || next.top === next.bottom) return null
            const x1 = i * step + barW
            const x2 = (i + 1) * step
            return <polygon key={`b${i}-${s.key}`} className={`db-band db-fill-${s.tone}`} points={`${x1},${s.top} ${x2},${next.top} ${x2},${next.bottom} ${x1},${s.bottom}`} />
          }))}
        {segs.map((col, i) =>
          col.map((s) => (s.top === s.bottom ? null : (
            <rect key={`r${i}-${s.key}`} className={`db-fill-${s.tone}`} x={i * step} y={s.top} width={barW} height={s.bottom - s.top} rx={7} />
          ))))}
        {weeks.map((w, i) => (
          <g key={w.key}>
            <text className="db-weekbar-total" x={i * step + barW / 2} y={topOf(i) - 12} textAnchor="middle">{format(totals[i]!)}</text>
            <text className={`db-weekbar-label${w.now ? ' is-now' : ''}`} x={i * step + barW / 2} y={H - 14} textAnchor="middle">{w.label}</text>
          </g>
        ))}
      </svg>
      <Legend series={series} />
    </div>
  )
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="db-legend">
      {series.map((s) => (
        <li key={s.key}><span className={`db-swatch db-tone-${s.tone}`} />{s.label}</li>
      ))}
    </ul>
  )
}

/** Seven day bars, the heaviest marked, days off drawn empty (Figma H "Due this week" / "Busiest day" / "Your week, by day"). */
export function DayBars({ values, labels, off, peakLabel, tall }: {
  values: number[]
  labels: string[]
  off: boolean[]
  peakLabel?: (value: number) => string
  /** The maker's wider chart (DB-M: 280 high, 46-wide bars). */
  tall?: boolean
}) {
  const max = Math.max(1, ...values)
  const peak = values.indexOf(Math.max(...values))
  const hasPeak = values[peak]! > 0
  return (
    <div className={`db-daybars${tall ? ' is-tall' : ''}`} role="img" aria-label={labels.map((l, i) => `${l} ${values[i]}`).join(', ')}>
      {values.map((v, i) => {
        const isPeak = hasPeak && i === peak
        const empty = off[i] && v === 0
        return (
          <div className="db-day" key={labels[i]}>
            <span className="db-day-peak">{isPeak && peakLabel ? peakLabel(v) : ''}</span>
            <div className="db-day-track">
              <span
                className={`db-day-bar${isPeak ? ' is-peak' : ''}${empty ? ' is-off' : ''}`}
                style={{ height: empty ? undefined : `${Math.max(v > 0 ? 8 : 7, (v / max) * 100)}%` }}
              />
            </div>
            <span className={`db-day-label${isPeak ? ' is-peak' : ''}${off[i] ? ' is-off' : ''}`}>{labels[i]}</span>
          </div>
        )
      })}
    </div>
  )
}

/** A ring and its legend (Figma H "Where the work is"): the total in the middle, each part's share. */
export function Ring({ parts, unit }: { parts: { key: string; label: string; value: number; tone: string }[]; unit: string }) {
  const total = parts.reduce((n, p) => n + p.value, 0)
  const R = 69
  const C = 2 * Math.PI * R
  const drawn = arcs(parts.map((p) => ({ key: p.key, value: p.value })))
  const toneOf = new Map(parts.map((p) => [p.key, p.tone]))
  const gap = drawn.length > 1 ? 2.5 : 0
  return (
    <div className="db-ring">
      <div className="db-ring-chart">
        <svg width="168" height="168" viewBox="0 0 168 168" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
          {drawn.length === 0 && <circle cx="84" cy="84" r={R} className="db-ring-empty" />}
          {drawn.map((a) => (
            <circle
              key={a.key}
              cx="84"
              cy="84"
              r={R}
              className={`db-ring-arc db-stroke-${toneOf.get(a.key)}`}
              strokeDasharray={`${Math.max(0.1, (a.to - a.from) * C - gap)} ${C}`}
              strokeDashoffset={-a.from * C}
              transform="rotate(-90 84 84)"
            />
          ))}
        </svg>
        <span className="db-ring-total">{total}</span>
        <span className="db-ring-unit">{unit}</span>
      </div>
      <ul className="db-ring-legend">
        {parts.map((p) => (
          <li key={p.key} data-testid={`db-ring-${p.key}`}>
            <span className={`db-ring-mark db-tone-${p.tone}`} />
            <span className="db-ring-text"><span>{p.label}</span><strong>{p.value}</strong></span>
            <span className="db-ring-pct">{pct(p.value, total)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface BarRow {
  id: string
  name: string
  note: string
  /** 0–100 */
  fill: number
  tone: string
  noteTone?: 'bad'
  to?: string
}

/** Rows of a name, a note and a bar (Figma H "Campaigns" / "Load by person" / "Rounds used"). */
export function BarList({ rows, empty }: { rows: BarRow[]; empty: string }) {
  if (rows.length === 0) return <p className="db-empty">{empty}</p>
  return (
    <ul className="db-barlist">
      {rows.map((r) => {
        const inner = (
          <>
            <span className="db-bar-head">
              <span className="db-bar-name">{r.name}</span>
              <span className="db-spacer" />
              <span className={`db-bar-note${r.noteTone === 'bad' ? ' is-bad' : ''}`}>{r.note}</span>
            </span>
            <span className="db-bar-track">
              <span className={`db-bar-fill db-tone-${r.tone}`} style={{ width: `${Math.min(100, Math.max(0.9, r.fill))}%` }} />
            </span>
          </>
        )
        return (
          <li key={r.id} data-testid={`db-bar-${r.id}`}>
            {r.to ? <Link to={r.to} className="db-bar-link">{inner}</Link> : <div>{inner}</div>}
          </li>
        )
      })}
    </ul>
  )
}

// ------------------------------------------------------------------ what to touch today

export interface TouchRow {
  id: string
  title: string
  context: string
  /** The second column — the client (account manager) or who it is for (a lead). */
  second: string
  waiting: string
  waitingBad: boolean
  /** The piece's tasks done, 0–100; null when the item is not about a piece. */
  progress: number | null
  /** I67.4: the piece's tasks by where they are, and its status word — the segmented bar and its hover card. */
  work?: { progress: WorkProgress; status: string } | null
  urgent: boolean
  action: string
  primary: boolean
  to: string
}

/** The table of what needs this person, one action a row (Figma H "What to touch today", 1707:1095). */
export function TouchToday({ rows, seeAll, empty, secondLabel }: { rows: TouchRow[]; seeAll: string; empty: string; secondLabel: string }) {
  const { t } = useTranslation()
  return (
    <Panel id="touch" icon="warn" title={t('roleDashboard.touch.title')} full action={<PanelLink to={seeAll} id="db-touch-all">{t('roleDashboard.touch.seeAll')}</PanelLink>}>
      {rows.length === 0 ? (
        <p className="db-empty">{empty}</p>
      ) : (
        <div className="db-table" role="table">
          <div className="db-table-head" role="row">
            <span role="columnheader">{t('roleDashboard.touch.col.item')}</span>
            <span role="columnheader">{secondLabel}</span>
            <span role="columnheader">{t('roleDashboard.touch.col.waiting')}</span>
            <span role="columnheader">{t('roleDashboard.touch.col.progress')}</span>
            <span role="columnheader"><span className="sr-only">{t('roleDashboard.touch.col.action')}</span></span>
          </div>
          {rows.map((r) => (
            <div className="db-table-row" role="row" key={r.id} data-testid={`db-touch-${r.id}`}>
              <span className="db-touch-item" role="cell">
                <img src={r.urgent ? dotRed : dotAmber} width={28} height={28} alt="" />
                <span className="db-touch-text">
                  <strong>{r.title}</strong>
                  {r.context && <span>{r.context}</span>}
                </span>
              </span>
              <span className="db-touch-second" role="cell">{r.second}</span>
              <span className={`db-touch-waiting${r.waitingBad ? ' is-bad' : ''}`} role="cell">{r.waiting}</span>
              <span className="db-touch-progress" role="cell">
                {r.work ? (
                  <ProgressTip progress={r.work.progress} status={r.work.status} testId={`progress-tip-${r.id}`}>
                    <ProgressBar progress={r.work.progress} testId={`progress-bar-${r.id}`} />
                  </ProgressTip>
                ) : r.progress != null && (
                  <>
                    <span className="db-progress-track">
                      <span className={`db-progress-fill db-tone-${r.urgent ? 'risk' : 'warn'}`} style={{ width: `${Math.max(2, r.progress)}%` }} />
                    </span>
                    <span className="db-progress-pct">{r.progress}%</span>
                  </>
                )}
              </span>
              <span className="db-touch-action" role="cell">
                <Link to={r.to} className={`db-action${r.primary ? ' is-primary' : ''}`}>{r.action}</Link>
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

// ------------------------------------------------------------------ my deliverables

export interface MyPiece { id: string; title: string; context: string; tint: 'risk' | 'warn' | 'new' | 'quiet'; to: string }

/** The maker's list with Today / Tomorrow / This week (Figma H DB-M 1707:1236). */
export function MyDeliverables({ lists, action }: { lists: Record<'today' | 'tomorrow' | 'week', MyPiece[]>; action?: ReactNode }) {
  const { t } = useTranslation()
  const first = (['today', 'tomorrow', 'week'] as const).find((k) => lists[k].length > 0) ?? 'today'
  const [tab, setTab] = useState<'today' | 'tomorrow' | 'week'>(first)
  const rows = lists[tab]
  return (
    <Panel id="my-deliverables" icon="lines" title={t('roleDashboard.member.myDeliverables')} action={action}>
      <div className="db-tabs" role="tablist">
        {(['today', 'tomorrow', 'week'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={`db-tab${tab === k ? ' is-on' : ''}`}
            onClick={() => setTab(k)}
            data-testid={`db-tab-${k}`}
          >
            {t(`roleDashboard.member.tab.${k}`)}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="db-empty">{t('roleDashboard.member.nothingDue')}</p>
      ) : (
        <ul className="db-mine">
          {rows.map((r) => (
            <li key={r.id}>
              <Link to={r.to} className={`db-mine-row db-tint-${r.tint}`} data-testid={`db-mine-${r.id}`}>
                <span className="db-mine-head">
                  <strong>{r.title}</strong>
                  <span className="db-spacer" />
                  <img src={rowCheck} width={16} height={16} alt="" />
                </span>
                <span className="db-mine-context">{r.context}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
