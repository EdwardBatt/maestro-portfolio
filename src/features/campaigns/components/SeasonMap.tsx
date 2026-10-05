import { useTranslation } from 'react-i18next'
import { iraqDay } from '../../../lib/time/iraq'
import { formatPlanRange } from '../../../lib/timing/plan-back'
import type { DeliverableRow } from '../../deliverables/api/deliverables-api'
import type { CampaignPhase } from '../api/campaign-detail-api'
import type { GridWorkstream } from '../lib/campaign-grid'
import { mapColumns, mapRows, NO_DATE, NO_PHASE, weekColumns, weekStartDay } from '../lib/season-map'
import { IRAQ_WORKING_CALENDAR, type WorkingCalendar } from '../../../lib/campaigns/go-live-dates'
import { PieceSquare, SquareLegend } from './PieceSquare'

/**
 * The season map (Figma CG-02, I57.6) — workstream × phase, one square per piece.
 *
 * The sheet's workstream × week dashboard, drawn instead of counted: a row that goes grey to the
 * right is work not yet started, a row with a red square is the one to talk about. Every square is
 * a PIECE, never a task, and pressing it opens the piece drawer (CG-04) where the tasks are.
 *
 * Phases keep their NAMES and dates; the frame's event line ("▲ Draw Night 1 · Fri 25") is left out
 * (Edward, 24 Sep). The phase today falls in is highlighted. A campaign without phases is mapped BY
 * WEEK, as CG-02 is drawn (Edward, 28 Sep, I63.5): the week starts on the client's first working day.
 */
export function SeasonMap({
  pieces,
  phases,
  workstreams,
  outstandingInputs,
  onOpenPiece,
  calendar = IRAQ_WORKING_CALENDAR,
  today,
}: {
  pieces: readonly DeliverableRow[]
  /** The campaign's phases (any order — they are sorted by number). */
  phases: readonly CampaignPhase[]
  workstreams: readonly GridWorkstream[]
  /** Outstanding inputs per piece — a piece waiting on one is WAITING, as on the Board. */
  outstandingInputs?: ReadonlyMap<string, number>
  /** Opens the CG-04 drawer. */
  onOpenPiece: (id: string) => void
  /** CG-E1's edit — not offered from a square; the drawer carries it. Accepted for the shared shape. */
  onEditPiece?: ((id: string) => void) | null
  /** The client's working week (ADR-0123 d.3) — where a week starts when the map is by week. */
  calendar?: WorkingCalendar
  /** Epoch ms standing in for now — tests only. */
  today?: number
}) {
  const { t, i18n } = useTranslation()
  const now = today ?? Date.now()

  const columns = phases.length > 0
    ? mapColumns(phases, pieces, iraqDay(now))
    : weekColumns(pieces, iraqDay(now), weekStartDay(calendar.workingDays))
  const rows = mapRows(pieces, workstreams, columns, now, outstandingInputs)
  const hasWorkstreams = workstreams.length > 0

  return (
    <div role="tabpanel" className="season-map" data-testid="campaign-panel-season-map">
      <SquareLegend testId="season-map-legend" />
      <div className="season-map-scroll">
        <div
          className="season-map-grid"
          style={{ gridTemplateColumns: `minmax(160px, 200px) repeat(${columns.length}, minmax(128px, 1fr))` }}
          data-testid="season-map-grid"
        >
          <span aria-hidden="true" />
          {columns.map((col) => (
            <div
              key={col.key}
              className={`season-map-head${col.current ? ' is-current' : ''}`}
              data-testid={`season-map-phase-${col.key}`}
              aria-current={col.current ? 'date' : undefined}
            >
              <span className="season-map-phase-name">
                {col.phase ? col.phase.name : col.week ? t('campaigns.seasonMap.week', { number: col.week.number }) : col.key === NO_DATE ? t('campaigns.seasonMap.noDate') : t('campaigns.seasonMap.noPhase')}
              </span>
              <span className="season-map-phase-dates">
                {col.phase ? formatPlanRange(col.phase.startsOn, col.phase.endsOn, i18n.language)
                  : col.week ? formatPlanRange(col.week.startsOn, col.week.endsOn, i18n.language) : '—'}
              </span>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="muted season-map-empty" data-testid="season-map-empty">{t('campaigns.seasonMap.empty')}</p>
          )}
          {rows.map(({ group, cells }) => (
            <div key={group.key} className="season-map-row" data-testid={`season-map-row-${group.key}`}>
              <div className="season-map-label" style={{ ['--group-hue' as string]: `var(--hue-${(group.index % 12) + 1})` }}>
                <span className="season-map-label-name">
                  {group.name ?? t(group.kind === 'none' && hasWorkstreams ? 'campaigns.grid.noWorkstream' : 'campaigns.page.unassignedDepartment')}
                </span>
                <span className="season-map-label-line" data-testid={`season-map-row-line-${group.key}`}>
                  {t('campaigns.seasonMap.delivered', { delivered: group.delivered, count: group.total })}
                </span>
              </div>
              {columns.map((col) => {
                const squares = cells.get(col.key) ?? []
                return (
                  <div
                    key={col.key}
                    className={`season-map-cell${col.current ? ' is-current' : ''}${squares.length === 0 ? ' is-empty' : ''}`}
                    data-testid={`season-map-cell-${group.key}-${col.key === NO_PHASE ? 'none' : col.key}`}
                  >
                    {squares.length === 0 && <span className="season-map-bar" aria-hidden="true" />}
                    {squares.map((s) => (
                      <PieceSquare key={s.piece.id} piece={s.piece} status={s.status} onOpen={onOpenPiece} />
                    ))}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="muted season-map-foot">{t('campaigns.seasonMap.foot')}</p>
    </div>
  )
}
