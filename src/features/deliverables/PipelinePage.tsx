import { useMemo, useState } from 'react'
import { formatCalendarDay, formatIraqDate, iraqDay } from '../../lib/time/iraq'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { useCampaignOptions, useCampaignDeliverables, useCampaignPhaseOptions, type DeliverableRow } from './api/deliverables-api'
import { boardStages, buildBoard, buildPhaseGrid } from './lib/pipeline-board'
import { ProgressBar, ProgressTip } from '../../components/DeliverableProgress'

/**
 * Per-discipline pipeline board (ADR-0024, I2.4 — the swimlane surface). Pick a campaign → one
 * swimlane per stream (discipline: Production / Influencer / Creative / Performance), deliverables
 * laid out as cards in lifecycle-state columns. A read/oversight view; every card deep-links into
 * its breakdown on /deliverables (where the actual transitions + assignment live). Gated
 * `project_tasks:manage` — the grant team leads hold for their discipline.
 */

/** `Mon, 21 Sep` — a phase's day, as every date reads (I66.8). */
function shortDay(isoDay: string): string {
  return formatCalendarDay(isoDay)
}

function cardHref(d: DeliverableRow): string {
  const params = new URLSearchParams()
  if (d.campaignId) params.set('campaign', d.campaignId)
  params.set('open', d.id)
  return `/deliverables?${params.toString()}`
}

const NO_PHASES: { id: string; number: number; name: string; startsOn: string; endsOn: string }[] = []

export function PipelinePage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const campaigns = useCampaignOptions()
  const [campaignId, setCampaignId] = useState(() => params.get('campaign') ?? '')

  const deliverables = useCampaignDeliverables(campaignId || null)
  // ADR-0096 d.12: a phased campaign's board filters by phase; the filter is offered only then
  // and falls back to every phase if the one chosen disappears — never an empty board by accident.
  const phases = useCampaignPhaseOptions(campaignId || null)
  const [phaseId, setPhaseId] = useState(() => params.get('phase') ?? '')
  const phaseList = phases.data ?? NO_PHASES
  const openPhase = phaseId && phaseList.some((p) => p.id === phaseId) ? phaseId : ''
  const rows = useMemo(
    () => (deliverables.data ?? []).filter((d) => !openPhase || d.phaseId === openPhase),
    [deliverables.data, openPhase],
  )
  const board = useMemo(() => buildBoard(rows), [rows])
  const stages = useMemo(() => boardStages(rows), [rows])
  // A phased campaign is drawn as the team's sheet draws it: phases down, departments across
  // (ADR-0096 d.12). The filter narrows to one row.
  const grid = useMemo(
    () => (phaseList.length > 0 ? buildPhaseGrid(rows, phaseList.filter((p) => !openPhase || p.id === openPhase)) : null),
    [rows, phaseList, openPhase],
  )
  const today = iraqDay(new Date())

  return (
    <section data-testid="surface-pipeline">
      <header className="schedule-bar">
        <h1>{t('pipeline.title')}</h1>
        <select
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          data-testid="pipeline-campaign"
        >
          <option value="" disabled>{t('pipeline.pickCampaign')}</option>
          {(campaigns.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {phaseList.length > 0 && (
          <select value={openPhase} onChange={(e) => setPhaseId(e.target.value)} aria-label={t('campaigns.phases.filter')} data-testid="pipeline-phase">
            <option value="">{t('campaigns.phases.allPhases')}</option>
            {phaseList.map((p) => (
              <option key={p.id} value={p.id}>{p.number}. {p.name}</option>
            ))}
          </select>
        )}
      </header>
      <p className="muted">{t(grid ? 'pipeline.introPhases' : 'pipeline.intro')}</p>

      {!campaignId ? (
        <div className="empty-state" data-testid="pipeline-pick"><p>{t('pipeline.pickPrompt')}</p></div>
      ) : deliverables.isError ? (
        <p className="form-error">{t('pipeline.loadFailed')}</p>
      ) : deliverables.isLoading ? (
        <p className="muted" data-testid="pipeline-loading">…</p>
      ) : board.length === 0 ? (
        <div className="empty-state" data-testid="pipeline-empty"><p>{t('pipeline.emptyTitle')}</p></div>
      ) : grid ? (
        <div className="pipeline-grid-wrap" data-testid="pipeline-grid">
          <table className="pipeline-grid">
            <thead>
              <tr>
                <th className="pipeline-grid-corner">{t('campaigns.phases.phase')}</th>
                {grid.columns.map((c) => (
                  <th key={c.id} data-testid={`pipeline-grid-col-${c.id}`}>
                    {c.name ?? t('campaigns.page.unassignedDepartment')}
                    <span className="muted pipeline-grid-count"> {c.total}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => {
                const late = row.phase?.endsOn != null && today > row.phase.endsOn && row.done < row.total
                return (
                  <tr key={row.phase?.id ?? 'none'} data-testid={`pipeline-grid-row-${row.phase?.id ?? 'none'}`} data-late={late ? 'true' : undefined}>
                    <th scope="row" className={late ? 'pipeline-grid-phase is-late' : 'pipeline-grid-phase'}>
                      <span className="pipeline-grid-phase-name">{row.phase ? `${row.phase.number}. ${row.phase.name}` : t('campaigns.wizard.noPhase')}</span>
                      {row.phase?.startsOn && row.phase.endsOn && (
                        <span className="muted pipeline-grid-phase-dates">{shortDay(row.phase.startsOn)} – {shortDay(row.phase.endsOn)}</span>
                      )}
                      <span className={late ? 'cell-warn' : 'muted'}>
                        {t('pipeline.phaseTotal', { done: row.done, total: row.total })}
                        {late ? ` · ${t('campaigns.phases.overdue')}` : ''}
                      </span>
                    </th>
                    {grid.columns.map((c) => (
                      <td key={c.id} data-testid={`pipeline-grid-cell-${row.phase?.id ?? 'none'}-${c.id}`}>
                        {row.cells[c.id]!.map((d) => (
                          <Link key={d.id} to={cardHref(d)} className="pipeline-card" data-testid={`pipeline-card-${d.id}`}>
                            <span className="pipeline-card-name">
                              {d.name}
                              {(d.quantity ?? 1) > 1 && <span className="muted"> × {d.quantity}</span>}
                            </span>
                            <ProgressTip progress={d.progress} status={t(`deliverables.phase.${d.progress.phase}`)} testId={`progress-tip-${d.id}`}>
                              <span className={`state-badge state-${d.progress.phase}`}>{t(`deliverables.phase.${d.progress.phase}`)}</span>
                            </ProgressTip>
                            <ProgressBar progress={d.progress} testId={`progress-bar-${d.id}`} />
                            <span className="pipeline-card-meta muted">
                              {d.revisionRound > 0 ? t('pipeline.round', { n: d.revisionRound }) : ''}
                              {d.dueAt ? `${d.revisionRound > 0 ? ' · ' : ''}${formatIraqDate(d.dueAt)}` : ''}
                            </span>
                          </Link>
                        ))}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="pipeline-board" data-testid="pipeline-board">
          {board.map((lane) => (
            <div className="pipeline-lane" key={lane.laneId} data-testid={`pipeline-lane-${lane.laneId}`}>
              <div className="pipeline-lane-head">
                <span className="pipeline-lane-title">{lane.discipline ?? t('campaigns.page.unassignedDepartment')}</span>
                <span className="muted"> ({lane.count})</span>
              </div>
              <div className="pipeline-columns">
                {stages.map((stage) => (
                  <div className={`pipeline-col col-${stage}`} key={stage} data-testid={`pipeline-col-${lane.laneId}-${stage}`}>
                    <div className="pipeline-col-head">
                      <span className={`state-badge state-${stage}`}>{t(`deliverables.phase.${stage}`)}</span>
                      <span className="muted">{lane.columns[stage].length}</span>
                    </div>
                    {lane.columns[stage].map((d) => (
                      <Link
                        key={d.id}
                        to={cardHref(d)}
                        className="pipeline-card"
                        data-testid={`pipeline-card-${d.id}`}
                      >
                        <span className="pipeline-card-name">{d.name}</span>
                        <ProgressBar progress={d.progress} testId={`progress-bar-${d.id}`} />
                        <span className="pipeline-card-meta muted">
                          {d.revisionRound > 0 ? t('pipeline.round', { n: d.revisionRound }) : ''}
                          {d.dueAt ? `${d.revisionRound > 0 ? ' · ' : ''}${formatIraqDate(d.dueAt)}` : ''}
                        </span>
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
