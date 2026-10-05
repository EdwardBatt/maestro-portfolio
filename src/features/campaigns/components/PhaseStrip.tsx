import { useTranslation } from 'react-i18next'
import { Gauge } from '../../../components/StatusRollupStrip'
import { IconButton } from '../../../components/Button'
import { formatCalendarDay, iraqDay } from '../../../lib/time/iraq'
import type { CampaignPhase } from '../api/campaign-detail-api'

/** `Mon, 21 Sep` — a phase's day, as every date reads; the year only when it is not this year (I66.8). */
function shortDay(isoDay: string, locale: string, _withYear?: boolean): string {
  return formatCalendarDay(isoDay, locale === 'ar' ? 'ar' : 'en')
}

/** What the strip needs of a deliverable: which phase, and its tasks done of its tasks. */
export interface PhaseStripRow {
  id: string
  state: string
  phaseId?: string | null
  doneCount?: number
  taskTotal?: number
  taskCount: number
}

/** One phase's figures over its deliverables — the same arithmetic as the deliverable rings (I52.10). */
export function phaseProgress(phase: CampaignPhase, rows: readonly PhaseStripRow[], today: string) {
  const mine = rows.filter((d) => d.phaseId === phase.id && d.state !== 'archived')
  const done = mine.reduce((n, d) => n + (d.doneCount ?? 0), 0)
  const total = mine.reduce((n, d) => n + (d.taskTotal ?? d.taskCount), 0)
  const complete = total > 0 && done === total
  // Past its end with work still open: the phase is late. Empty phases are never late.
  const overdue = !complete && mine.length > 0 && today > phase.endsOn
  return { count: mine.length, done, total, complete, overdue }
}

/**
 * ADR-0096 d.9: the phase strip — one ring per phase, in number order, "Week 2 · 26 Sep – 2 Oct ·
 * 4 of 9 complete", overdue in the warn colour. The LUMA sheet's *by week* grid, as rings. The
 * *Phases* button (the campaign's approval authority only) opens the dialog that manages them.
 * Edward will inspect this on the local stack and change it; the data and the rules are the ADR's,
 * the pixels are not.
 */
export function PhaseStrip({
  phases,
  rows,
  onManage,
  testId,
}: {
  phases: readonly CampaignPhase[]
  rows: readonly PhaseStripRow[]
  /** Null where the caller may not manage phases. */
  onManage: (() => void) | null
  testId: string
}) {
  const { t, i18n } = useTranslation()
  const today = iraqDay(new Date())
  return (
    <div className="phase-strip" data-testid={testId}>
      <div className="phase-strip-head">
        <span className="campaign-people-label">{t('campaigns.phases.heading')}</span>
        {onManage && (
          <IconButton icon="edit" size="sm" label={t('campaigns.phases.manage')} onClick={onManage} data-testid={`${testId}-manage`} />
        )}
      </div>
      <div className="status-rollup">
        {phases.map((p) => {
          const x = phaseProgress(p, rows, today)
          return (
            <div key={p.id} className="phase-gauge" data-testid={`${testId}-phase-${p.id}`} data-overdue={x.overdue ? 'true' : undefined}>
              <Gauge
                done={x.done}
                total={x.total}
                label={`${p.number}. ${p.name}`}
                tone={x.complete ? 'ok' : x.overdue ? 'warn' : 'neutral'}
                testId={`${testId}-gauge-${p.id}`}
              />
              <span className="muted phase-gauge-dates" data-testid={`${testId}-dates-${p.id}`}>
                {shortDay(p.startsOn, i18n.language, false)} – {shortDay(p.endsOn, i18n.language, true)}
              </span>
              <span className={x.overdue ? 'cell-warn' : 'muted'} data-testid={`${testId}-line-${p.id}`}>
                {t('campaigns.phases.line', { count: x.count, done: x.done, total: x.total })}
                {x.overdue ? ` · ${t('campaigns.phases.overdue')}` : ''}
              </span>
            </div>
          )
        })}
        {phases.length === 0 && (
          <span className="muted" data-testid={`${testId}-empty`}>{t('campaigns.phases.none')}</span>
        )}
      </div>
    </div>
  )
}
