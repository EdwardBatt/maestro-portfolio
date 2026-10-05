import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { ProgressBar, ProgressTip } from '../../../components/DeliverableProgress'
import { formatIraqShortDate } from '../../../lib/time/iraq'
import type { DeliverableRow } from '../../deliverables/api/deliverables-api'
import type { CampaignPhase } from '../api/campaign-detail-api'
import { ownersOf } from '../lib/campaign-grid'
import { columnKeyOf, periodColumns, weekStartDay } from '../lib/season-map'
import { periodLabel } from '../lib/period-label'
import { IRAQ_WORKING_CALENDAR, type WorkingCalendar } from '../../../lib/campaigns/go-live-dates'
import { iraqDay } from '../../../lib/time/iraq'
import {
  defaultPhase,
  durationSince,
  filterRows,
  whereRows,
  WHERE_STATUSES,
  type Duration,
  type Next,
  type PieceRisk,
  type WhereFilters,
  type WhereRow,
  type WhereStatus,
} from '../lib/where-is-everything'

/**
 * Where is everything (Figma CG-03, I57.10) — one row per live piece: where it is, with whom, for
 * how long, the one thing that moves it, its due date and the clock.
 *
 * "With whom" is the piece's OWNER and their department, never one task person (Edward, 24 Sep:
 * every view shows the piece and its owner; the drawer, CG-04, shows who holds each task). The clock
 * is the at-risk rule (I57 answer 11) — the risk map comes in as a prop from `useCampaignRisk`, so
 * this stays a layout the tests can drive. Rows are in order of urgency: late, at risk, then due.
 *
 * The phase filter opens on the phase today falls in, else on all.
 */
export function WhereIsEverything({
  pieces,
  phases,
  workstreams,
  risk,
  onOpenPiece,
  onEditPiece,
  calendar,
  today,
}: {
  pieces: readonly DeliverableRow[]
  phases: readonly CampaignPhase[]
  workstreams: readonly { id: string; name: string }[]
  risk: ReadonlyMap<string, PieceRisk>
  /** Opens the piece drawer (CG-04). */
  onOpenPiece: (id: string) => void
  /** Opens the Edit dialog (CG-E1); null when the viewer may not edit. */
  onEditPiece: ((id: string) => void) | null
  /** The client's working week (ADR-0123 d.3) — where a week starts when the campaign has no phases. */
  calendar?: WorkingCalendar
  today?: number
}) {
  const { t, i18n } = useTranslation()
  const now = today ?? Date.now()
  // Null until somebody picks a phase: the page opens on today's phase, and follows the data if the
  // phases arrive after the first render.
  const [phasePick, setPhasePick] = useState<string | null>(null)
  const [f, setF] = useState<Omit<WhereFilters, 'phase'>>({ workstream: '', owner: '', status: '' })

  // I63 (Edward, 28 Sep): phases, or weeks without them — the season map's periods. The page opens on
  // the one today falls in when it has live work (CG-03 opens on its current week), else on all.
  const periods = useMemo(
    () => periodColumns(phases, pieces, iraqDay(now), weekStartDay((calendar ?? IRAQ_WORKING_CALENDAR).workingDays)),
    [phases, pieces, now, calendar],
  )
  const periodOf = useMemo(() => columnKeyOf(periods), [periods])
  const opening = useMemo(() => {
    if (phases.length > 0) return defaultPhase(phases, pieces, now)
    const current = periods.find((p) => p.current)
    return current && pieces.some((d) => d.state !== 'archived' && periodOf(d) === current.key) ? current.key : ''
  }, [phases, pieces, now, periods, periodOf])
  const chosen = phasePick ?? opening
  // A filter naming a phase or workstream that no longer exists falls back to all.
  const filters: WhereFilters = {
    ...f,
    phase: chosen && periods.some((p) => p.key === chosen) ? chosen : '',
    workstream: f.workstream === 'none' || workstreams.some((w) => w.id === f.workstream) ? f.workstream : '',
  }
  const all = useMemo(() => whereRows(pieces, risk), [pieces, risk])
  const shown = filterRows(all, filters, periodOf)
  const owners = useMemo(() => ownersOf(pieces), [pieces])
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((prev) => ({ ...prev, [k]: v }))

  return (
    <div role="tabpanel" className="where-panel" data-testid="campaign-panel-where">
      <div className="grid-filters where-filters">
        {periods.length > 0 && (
          <select
            value={filters.phase}
            onChange={(e) => setPhasePick(e.target.value)}
            aria-label={t(phases.length > 0 ? 'campaigns.where.filterPhase' : 'campaigns.phases.filterWeek')}
            className={filters.phase ? 'is-set' : undefined}
            data-testid="where-filter-phase"
          >
            <option value="">{t(phases.length > 0 ? 'campaigns.where.allPhases' : 'campaigns.phases.allWeeks')}</option>
            {periods.map((p) => <option key={p.key} value={p.key}>{periodLabel(p, t, i18n.language)}</option>)}
          </select>
        )}
        {workstreams.length > 0 && (
          <select
            value={filters.workstream}
            onChange={(e) => set('workstream', e.target.value)}
            aria-label={t('campaigns.where.filterWorkstream')}
            className={filters.workstream ? 'is-set' : undefined}
            data-testid="where-filter-workstream"
          >
            <option value="">{t('campaigns.where.allWorkstreams')}</option>
            {workstreams.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            <option value="none">{t('campaigns.where.noWorkstream')}</option>
          </select>
        )}
        <select
          value={filters.owner}
          onChange={(e) => set('owner', e.target.value)}
          aria-label={t('campaigns.where.filterOwner')}
          className={filters.owner ? 'is-set' : undefined}
          data-testid="where-filter-owner"
        >
          <option value="">{t('campaigns.where.anyone')}</option>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select
          value={filters.status}
          onChange={(e) => set('status', e.target.value as WhereStatus | '')}
          aria-label={t('campaigns.where.filterStatus')}
          className={filters.status ? 'is-set' : undefined}
          data-testid="where-filter-status"
        >
          <option value="">{t('campaigns.where.anything')}</option>
          {WHERE_STATUSES.map((s) => <option key={s} value={s}>{t(`campaigns.where.status.${s}`)}</option>)}
        </select>
      </div>

      {shown.length === 0 ? (
        <p className="muted where-empty" data-testid="where-empty">
          {t(all.length === 0 ? 'campaigns.where.none' : 'campaigns.where.empty')}
        </p>
      ) : (
        <div className="grid-scroll">
          <table className="data-table where-table" data-testid="where-table">
            <thead>
              <tr>
                <th>{t('campaigns.where.colPiece')}</th>
                <th>{t('campaigns.where.colWhere')}</th>
                <th>{t('campaigns.where.colWithWhom')}</th>
                <th>{t('campaigns.where.colForHowLong')}</th>
                <th>{t('campaigns.where.colNext')}</th>
                <th>{t('campaigns.where.colDue')}</th>
                <th>{t('campaigns.where.colClock')}</th>
                <th><span className="sr-only">{t('campaigns.where.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <Row key={r.piece.id} r={r} now={now} onOpenPiece={onOpenPiece} onEditPiece={onEditPiece} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted where-note" data-testid="where-note">{t('campaigns.where.note')}</p>
    </div>
  )
}

function Row({
  r,
  now,
  onOpenPiece,
  onEditPiece,
}: {
  r: WhereRow
  now: number
  onOpenPiece: (id: string) => void
  onEditPiece: ((id: string) => void) | null
}) {
  const { t } = useTranslation()
  const d = r.piece
  const tone = r.clock?.tone
  const alarm = tone === 'late' || tone === 'at_risk'
  return (
    <tr
      className={`where-row${tone === 'late' ? ' is-late' : tone === 'at_risk' ? ' is-at-risk' : ''}`}
      onClick={() => onOpenPiece(d.id)}
      data-testid={`where-row-${d.id}`}
    >
      <td>
        <span className="where-code">{d.code ?? '—'}</span>
        <span className="where-name">{d.name}</span>
      </td>
      <td>
        <ProgressTip progress={d.progress} status={t(`campaigns.where.status.${r.status}`)} testId={`progress-tip-${d.id}`}>
          <span className={`state-badge where-status where-status-${r.status}`} data-testid={`where-status-${d.id}`}>
            {t(`campaigns.where.status.${r.status}`)}
          </span>
        </ProgressTip>
        <div><ProgressBar progress={d.progress} testId={`progress-bar-${d.id}`} /></div>
      </td>
      <td data-testid={`where-owner-${d.id}`}>
        {d.ownerName ? (
          <span className="where-owner">
            <span className="where-avatar" aria-hidden="true">{d.ownerName.trim().charAt(0).toUpperCase()}</span>
            {d.ownerName}
            {d.discipline && <span className="muted"> · {d.discipline}</span>}
          </span>
        ) : (
          <span className="cell-warn">{t('campaigns.where.noOwner')}</span>
        )}
      </td>
      <td className={alarm ? `where-since is-${tone}` : 'where-since muted'} data-testid={`where-since-${d.id}`}>
        {durationText(durationSince(r.since, now), t)}
      </td>
      <td className="where-next" data-testid={`where-next-${d.id}`}>{nextText(r.next, d.ownerName, t)}</td>
      <td className="where-due">{d.dueAt ? formatIraqShortDate(d.dueAt) : '—'}</td>
      <td data-testid={`where-clock-${d.id}`}>
        {r.clock && (
          <span className={`where-clock is-${r.clock.tone}`}>
            {r.clock.tone === 'late'
              ? r.clock.days === 1
                ? t('campaigns.where.clock.lateOne')
                : t('campaigns.where.clock.late', { n: r.clock.days })
              : t(`campaigns.where.clock.${r.clock.tone}`)}
          </span>
        )}
      </td>
      <td className="row-actions" onClick={(e) => e.stopPropagation()}>
        {onEditPiece && (
          <Button variant="secondary" size="sm" onClick={() => onEditPiece(d.id)} data-testid={`where-edit-${d.id}`}>
            {t('campaigns.where.edit')}
          </Button>
        )}
        <Button variant="link" size="sm" onClick={() => onOpenPiece(d.id)} data-testid={`where-open-${d.id}`}>
          {t('campaigns.where.open')}
        </Button>
      </td>
    </tr>
  )
}

type T = ReturnType<typeof useTranslation>['t']

function durationText(dur: Duration | null, t: T): string {
  if (!dur) return '—'
  if (dur.unit === 'under_hour') return t('campaigns.where.duration.underHour')
  if (dur.unit === 'hours') return t('campaigns.where.duration.hours', { n: dur.n })
  return dur.n === 1 ? t('campaigns.where.duration.oneDay') : t('campaigns.where.duration.days', { n: dur.n })
}

function nextText(next: Next, ownerName: string | null, t: T): string {
  const owner = ownerName ?? t('campaigns.where.theOwner')
  switch (next.kind) {
    case 'inputs':
      return t('campaigns.where.next.inputs', { count: next.count })
    case 'startsOn':
      return t('campaigns.where.next.startsOn', { date: formatIraqShortDate(next.at!) })
    case 'ownerApproves':
    case 'ownerApprovesList':
    case 'ownerGivesIt':
    case 'ownerPlans':
      return t(`campaigns.where.next.${next.kind}`, { owner })
    default:
      return t(`campaigns.where.next.${next.kind}`)
  }
}
