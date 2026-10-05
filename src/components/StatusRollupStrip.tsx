import { useTranslation } from 'react-i18next'
import type { DeliverableProgress, StatusRollup, TaskCoverage } from '../lib/campaigns/status'

/**
 * Campaign delivery status: **two gauges, one label each.**
 *
 * Shared (`src/components/`) rather than owned by the campaigns feature, because the campaign page
 * and the campaign CHAT ROOM both head themselves with it — a feature importing another feature's
 * component is the edge STATE.md counts twenty-one of.
 *
 * **I52.10 (Edward, 17 Sep): one ring PER DELIVERABLE, its tasks done of its tasks** — "Deliverable A,
 * 0 of 5 complete" — filling as tasks are approved; then the tasks ring, assigned of ALL tasks (a
 * done task is still assigned; only a cancelled one leaves the total). Before this the first ring
 * counted closed containers (all-or-nothing per deliverable) and the second excluded finished work,
 * so neither ever read as progress.
 *
 * Deliverables first, because that is the campaign's own progress; tasks second, because that is
 * whether anybody is actually on it. Edward, 31 Aug, on the version before this one: *"it shows a
 * fuel gauge, 3 different labels… 0 of 4 done refers to the progress on deliverables, which is a
 * separate gauge, and should be the first gauge."* It was saying the same fact twice — "0 of 26
 * tasks assigned" and "26 tasks have nobody on them" are one number — and mixing a deliverable
 * figure into a task gauge's caption.
 *
 * **Severity is a function of the campaign's status, not of the number.** ADR-0052 lays tasks down
 * unassigned on purpose and ADR-0048 d.8 gates only *assignment* on approval, so unassigned work
 * before approval is the system working and after approval is work that should have started. Same
 * figure, two meanings. Colouring both would make the amber meaningless (design language: status
 * colour is data, never decoration — if everything glows, nothing warns).
 */

const RADIUS = 26
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

type Tone = 'neutral' | 'ok' | 'warn' | 'breach'

export function Gauge({
  done,
  total,
  label,
  tone,
  testId,
}: {
  done: number
  total: number
  label: string
  tone: Tone
  testId: string
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className={`task-gauge tone-${tone}`} data-testid={testId}>
      <div className="gauge-ring">
        <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
          <circle className="gauge-track" cx="32" cy="32" r={RADIUS} />
          <circle
            className="gauge-fill"
            cx="32"
            cy="32"
            r={RADIUS}
            strokeDasharray={CIRCUMFERENCE}
            // Drawn from the top, clockwise. An empty ring reads as "none of this has started".
            strokeDashoffset={CIRCUMFERENCE * (1 - pct / 100)}
          />
        </svg>
        <span className="gauge-value" data-testid={`${testId}-value`}>
          {done}/{total}
        </span>
      </div>
      <span className="gauge-label">{label}</span>
    </div>
  )
}

export function StatusRollupStrip({
  rollup,
  coverage,
  /** True once the campaign is approved — the difference between "not started yet" and "late". */
  approved,
  testId,
  /** Compact form for a section heading: the two figures as text, no rings. */
  compact = false,
  deliverables,
}: {
  rollup: StatusRollup
  coverage: TaskCoverage
  approved: boolean
  testId: string
  compact?: boolean
  /** I52.10: one ring per deliverable. Without it the strip shows the tasks ring alone. */
  deliverables?: DeliverableProgress[]
}) {
  const { t } = useTranslation()
  if (rollup.total === 0 && coverage.total === 0) return null

  const taskTone: Tone =
    coverage.total === 0 || !approved || coverage.unassigned === 0
      ? 'ok'
      : coverage.assigned === 0
        ? 'breach'
        : 'warn'

  if (compact) {
    return (
      <div className="status-rollup status-rollup-compact" data-testid={testId}>
        {coverage.total > 0 && (
          <span className="status-done" data-testid={`${testId}-done`}>
            {t('campaignStatus.ofTotalComplete', { done: coverage.done, total: coverage.total })}
          </span>
        )}
        {coverage.total > 0 && (
          <span className={`status-done tone-${taskTone}`} data-testid={`${testId}-assigned`}>
            {t('campaignStatus.ofTotalAssigned', {
              assigned: coverage.assigned,
              total: coverage.total,
            })}
          </span>
        )}
        <HeldLine coverage={coverage} testId={testId} />
        <Chips rollup={rollup} testId={testId} />
      </div>
    )
  }

  return (
    <div className="status-rollup" data-testid={testId}>
      {(deliverables ?? []).map((d) => (
        <Gauge
          key={d.id}
          done={d.done}
          total={d.total}
          label={t('campaignStatus.deliverableComplete', { name: d.name, done: d.done, total: d.total })}
          tone={d.total > 0 && d.done === d.total ? 'ok' : 'neutral'}
          testId={`${testId}-deliverable-${d.id}`}
        />
      ))}
      {coverage.total > 0 && (
        <Gauge
          done={coverage.assigned}
          total={coverage.total}
          label={t('campaignStatus.tasksLabel')}
          tone={taskTone}
          testId={`${testId}-tasks`}
        />
      )}
      <HeldLine coverage={coverage} testId={testId} />
      <Chips rollup={rollup} testId={testId} />
    </div>
  )
}

/** ADR-0090 d.3b: of the unassigned, the part nobody should assign yet — named for its owner. */
function HeldLine({ coverage, testId }: { coverage: TaskCoverage; testId: string }) {
  const { t } = useTranslation()
  if (!coverage.held || coverage.held === 0) return null
  return (
    <span className="held-label" data-testid={`${testId}-held`}>
      {t('intake.held.dashboardLine', {
        count: coverage.held,
        owners: coverage.heldOwners.length > 0 ? coverage.heldOwners.join(', ') : t('intake.held.dashboardNone'),
      })}
    </span>
  )
}

/** Blocked and overdue, shown only when non-zero — a lead should not read a row of zeros to learn
 *  that nothing needs them (ADR-0018 §6.3, exception-first). */
function Chips({ rollup, testId }: { rollup: StatusRollup; testId: string }) {
  const { t } = useTranslation()
  if (rollup.blocked === 0 && rollup.overdue === 0) return null
  return (
    <div className="status-chips">
      {rollup.blocked > 0 && (
        <span className="status-chip chip-blocked" data-testid={`${testId}-blocked`}>
          {t('campaignStatus.blocked')}: {rollup.blocked}
        </span>
      )}
      {rollup.overdue > 0 && (
        <span className="status-chip chip-overdue" data-testid={`${testId}-overdue`}>
          {t('campaignStatus.overdue')}: {rollup.overdue}
        </span>
      )}
    </div>
  )
}
