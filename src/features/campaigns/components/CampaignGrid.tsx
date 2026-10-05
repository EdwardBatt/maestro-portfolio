import { Fragment, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { statusBadgeOf } from '../lib/piece-status'
import { useAuth } from '../../../app/auth-context'
import { Button } from '../../../components/Button'
import { PriorityMark } from '../../../components/PriorityMark'
import { ProgressBar, ProgressTip } from '../../../components/DeliverableProgress'
import { formatIraqShortDate } from '../../../lib/time/iraq'
import { isOverdue } from '../../../lib/campaigns/status'
import { failed, type Banner } from '../../deliverables/DeliverablesPage'
import type { DeliverableRow } from '../../deliverables/api/deliverables-api'
import type { ExtensionEvent } from '../../deliverables/api/extensions-api'
import type { WorkPhase } from '../../../lib/deliverables/work-phase'
import type { CampaignPhase } from '../api/campaign-detail-api'
import { executedBy, gridGroups, needsApproval, NO_FILTERS, ownersOf, type GridFilters, type GridWorkstream } from '../lib/campaign-grid'
import { columnKeyOf, periodColumns, weekStartDay } from '../lib/season-map'
import { periodLabel } from '../lib/period-label'
import { IRAQ_WORKING_CALENDAR, type WorkingCalendar } from '../../../lib/campaigns/go-live-dates'
import { iraqDay } from '../../../lib/time/iraq'
import { DeliverableDialog } from './DeliverableDialog'
import { TaskListsApproval, type ApprovalGroup } from './TaskListsApproval'
import { useLanguageWords } from '../../admin/api/deliverable-types-api'

const STATUSES: readonly WorkPhase[] = ['not_started', 'in_progress', 'in_review', 'awaiting_signoff', 'delivered', 'complete', 'no_tasks']

/**
 * The campaign grid (Figma CG-01, I57.5) — the sheet the campaign is run from.
 *
 * Grouped by workstream (by department where a campaign has none), one row per piece:
 * ID · Piece · Format · Channel · Creative (the owner, the lead accountable) · Managed (the
 * workstream's owner) · Executed (EVERY person holding a task on it — Edward, 24 Sep) · Languages ·
 * Due · Status · Approved (its task list, ADR-0100 d.2).
 *
 * It took over the department tabs (retired 24 Sep, I57 answer 6), so what they did lives here:
 * the owners approve their task lists (the panel above the sheet, and "Needs approval" narrows the
 * sheet to those pieces); + Add a piece; Edit, which opens CG-E1 (`EditPieceDialog`, I57.11) — the
 * phase a piece sits in and its promised date moved there off the row; and Open, which opens the
 * piece drawer (CG-04) with its tasks one by one.
 */
export function CampaignGrid({
  campaignId,
  pieces,
  workstreams,
  isCampaign = false,
  approvalGroups,
  phases,
  goLiveAt,
  approved,
  failedRead,
  canManage,
  canAdd,
  pendingByDeliverable,
  onOpenPiece,
  onBanner,
  calendar,
}: {
  campaignId: string
  /** The campaign's client — the evidenced date change files its attachment there (ADR-0088 d.7a). */
  clientId: string
  pieces: readonly DeliverableRow[]
  workstreams: readonly GridWorkstream[]
  /** ADR-0116 d.3: a campaign's added piece names its workstream; a single job's does not. */
  isCampaign?: boolean
  approvalGroups: readonly ApprovalGroup[]
  phases: readonly CampaignPhase[]
  goLiveAt: string | null
  /** Approved campaigns: task lists are awaited; before approval there is nothing to accept yet. */
  approved: boolean
  /** The read failed: an empty sheet then means unknown, not none. */
  failedRead: boolean
  canManage: boolean
  canAdd: boolean
  pendingByDeliverable: ReadonlyMap<string, ExtensionEvent[]>
  /** ADR-0096 d.4: the approval authority on an open campaign moves pieces between phases (in Edit). */
  canMovePhase: boolean
  /** ADR-0088 d.7a: approved, and the account manager or projects:manage — the evidenced date change (in Edit). */
  canChangePromise: boolean
  /** Opens the piece drawer (CG-04) — the task-by-task breakdown every view shares. */
  onOpenPiece: (id: string) => void
  onBanner: (b: Banner) => void
  /** The client's working week (ADR-0123 d.3) — where a week starts when the campaign has no phases. */
  calendar?: WorkingCalendar
}) {
  const { t, i18n } = useTranslation()
  const { session } = useAuth()
  const myId = session?.user.id ?? null
  // ADR-0117 addendum (Q18): a deliverable's languages, in words.
  const languageList = useLanguageWords()
  const [f, setF] = useState<GridFilters>(NO_FILTERS)
  const [dialog, setDialog] = useState<null | { mode: 'add' }>(null)
  // I63 (Edward, 28 Sep): the phase filter is on every campaign — its phases, or its weeks without
  // phases, the same periods the season map draws.
  const periods = useMemo(
    () => periodColumns(phases, pieces, iraqDay(Date.now()), weekStartDay((calendar ?? IRAQ_WORKING_CALENDAR).workingDays)),
    [phases, pieces, calendar],
  )
  const periodOf = useMemo(() => columnKeyOf(periods), [periods])
  const hasPhases = phases.length > 0
  const hasWorkstreams = workstreams.length > 0
  // A filter naming a phase or workstream that no longer exists falls back to all — never an empty sheet.
  const filters: GridFilters = {
    ...f,
    phase: f.phase && periods.some((p) => p.key === f.phase) ? f.phase : '',
    workstream: f.workstream === 'none' || workstreams.some((w) => w.id === f.workstream) ? f.workstream : '',
  }
  const groups = useMemo(() => gridGroups(pieces, workstreams, filters, periodOf), [pieces, workstreams, periodOf, filters.workstream, filters.phase, filters.owner, filters.status, filters.needsApproval]) // eslint-disable-line react-hooks/exhaustive-deps
  const owners = useMemo(() => ownersOf(pieces), [pieces])
  const waiting = pieces.filter((d) => d.state !== 'archived' && needsApproval(d))
  // The lists waiting, and any that waited during this visit: the owner who approves one must see
  // it say so, not watch it vanish from under the press. Lists approved before the visit stay off
  // the panel — the grid's Approved column already says so, and the sheet is what the page is for.
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set(waiting.map((d) => d.id)))
  const waitingKey = waiting.map((d) => d.id).join(',')
  useEffect(() => {
    setSeen((prev) => (waiting.every((d) => prev.has(d.id)) ? prev : new Set([...prev, ...waiting.map((d) => d.id)])))
  }, [waitingKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const onPanel = pieces.filter((d) => d.state !== 'archived' && (needsApproval(d) || seen.has(d.id)))
  const shown = groups.reduce((n, g) => n + g.rows.length, 0)
  const cols = 12
  const set = <K extends keyof GridFilters>(k: K, v: GridFilters[K]) => setF((prev) => ({ ...prev, [k]: v }))

  return (
    <div role="tabpanel" className="campaign-grid" data-testid="campaign-grid">
      <div className="grid-bar">
        <div className="grid-filters" data-testid="campaign-grid-filters">
          {hasWorkstreams && (
            <select
              value={filters.workstream}
              onChange={(e) => set('workstream', e.target.value)}
              aria-label={t('campaigns.grid.filterWorkstream')}
              className={filters.workstream ? 'is-set' : undefined}
              data-testid="campaign-grid-filter-workstream"
            >
              <option value="">{t('campaigns.grid.allWorkstreams')}</option>
              {workstreams.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              <option value="none">{t('campaigns.grid.noWorkstream')}</option>
            </select>
          )}
          {periods.length > 0 && (
            <select
              value={filters.phase}
              onChange={(e) => set('phase', e.target.value)}
              aria-label={t(hasPhases ? 'campaigns.phases.filter' : 'campaigns.phases.filterWeek')}
              className={filters.phase ? 'is-set' : undefined}
              data-testid="campaign-phase-filter"
            >
              <option value="">{t(hasPhases ? 'campaigns.phases.allPhases' : 'campaigns.phases.allWeeks')}</option>
              {periods.map((p) => <option key={p.key} value={p.key}>{periodLabel(p, t, i18n.language)}</option>)}
            </select>
          )}
          <select
            value={filters.owner}
            onChange={(e) => set('owner', e.target.value)}
            aria-label={t('campaigns.grid.filterOwner')}
            className={filters.owner ? 'is-set' : undefined}
            data-testid="campaign-grid-filter-owner"
          >
            <option value="">{t('campaigns.grid.allOwners')}</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select
            value={filters.status}
            onChange={(e) => set('status', e.target.value as WorkPhase | '')}
            aria-label={t('campaigns.grid.filterStatus')}
            className={filters.status ? 'is-set' : undefined}
            data-testid="campaign-grid-filter-status"
          >
            <option value="">{t('campaigns.grid.anyStatus')}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`deliverables.phase.${s}`)}</option>)}
          </select>
          <button
            type="button"
            className={`filter-toggle${filters.needsApproval ? ' is-set' : ''}`}
            aria-pressed={filters.needsApproval}
            onClick={() => set('needsApproval', !filters.needsApproval)}
            data-testid="campaign-grid-filter-approval"
          >
            {t('campaigns.grid.needsApproval')}
            {waiting.length > 0 && <span className="filter-count">{waiting.length}</span>}
          </button>
        </div>
        {canAdd && (
          <Button variant="primary" icon="plus" onClick={() => setDialog({ mode: 'add' })} data-testid="campaign-add-deliverable">
            {t('campaigns.grid.addPiece')}
          </Button>
        )}
      </div>

      {/* ADR-0100 d.2/d.9: THE SECOND GATE. Each owner accepts their own pieces' task lists, all or
          selected — it moved here from the department tabs with them (24 Sep). Shown while lists
          wait, and first when "Needs approval" is on, because it decides whether the work can start. */}
      {approved && onPanel.length > 0 && (
        <TaskListsApproval
          deliverables={onPanel.map((d) => ({
            id: d.id,
            name: d.name,
            code: d.code ?? null,
            workstreamId: d.workstreamId,
            tasksApprovedAt: d.tasksApprovedAt,
            ownerName: d.ownerName,
            taskCount: d.taskCount,
            tasks: d.taskList ?? [],
            canApprove: d.canApproveTasks,
            isMine: myId != null && d.ownerUserId === myId,
          }))}
          groups={approvalGroups}
          testId="campaign-task-lists"
          canEdit={canManage}
          onError={(message) => onBanner({ kind: 'error', text: message })}
        />
      )}

      {dialog?.mode === 'add' && (
        <DeliverableDialog
          campaignId={campaignId}
          goLiveAt={goLiveAt}
          phases={phases}
          existing={null}
          workstreams={workstreams}
          requireWorkstream={isCampaign}
          onSaved={() => onBanner({ kind: 'ok', text: t('campaigns.deliverableDialog.addedOk') })}
          onFailed={(err) => onBanner(failed(err, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t))}
          onClose={() => setDialog(null)}
        />
      )}

      <div className="grid-scroll">
        <table className="data-table grid-table" data-testid="campaign-grid-table">
          <thead>
            <tr>
              <th>{t('campaigns.grid.colId')}</th>
              <th>{t('campaigns.grid.colPiece')}</th>
              <th>{t('campaigns.grid.colFormat')}</th>
              <th>{t('campaigns.grid.colChannel')}</th>
              <th>{t('campaigns.grid.colCreative')}</th>
              <th>{t('campaigns.grid.colManaged')}</th>
              <th>{t('campaigns.grid.colExecuted')}</th>
              <th>{t('campaigns.grid.colLanguages')}</th>
              <th>{t('campaigns.grid.colDue')}</th>
              <th>{t('campaigns.grid.colStatus')}</th>
              <th>{t('campaigns.grid.colApproved')}</th>
              <th><span className="sr-only">{t('admin.users.actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {/* A filter that empties a group hides its heading too (I57.24) — an empty heading is clutter. */}
            {groups.filter((g) => g.rows.length > 0).map((g) => (
              <Fragment key={g.key}>
                <tr className="grid-group-row" data-testid={`campaign-grid-group-${g.key}`}>
                  <td colSpan={cols}>
                    <span className="grid-group-name" style={{ ['--group-hue' as string]: `var(--hue-${(g.index % 12) + 1})` }}>
                      {g.name ?? t(g.kind === 'none' && hasWorkstreams ? 'campaigns.grid.noWorkstream' : 'campaigns.page.unassignedDepartment')}
                    </span>
                    <span className="grid-group-line" data-testid={`campaign-grid-group-line-${g.key}`}>
                      {t('campaigns.grid.groupLine', { count: g.total, delivered: g.delivered })}
                      {g.managerName && ` · ${t('campaigns.grid.manages', { name: g.managerName })}`}
                    </span>
                  </td>
                </tr>
                {g.rows.map((d) => {
                  const ex = executedBy(d)
                  const pending = pendingByDeliverable.get(d.id)?.length ?? 0
                  return (
                    <Fragment key={d.id}>
                      <tr data-testid={`campaign-deliverable-${d.id}`}>
                        <td className="grid-code" style={{ ['--group-hue' as string]: `var(--hue-${(g.index % 12) + 1})` }}>
                          {d.code ?? '—'}
                        </td>
                        <td>
                          <span className="grid-piece" data-testid={`campaign-deliverable-name-${d.id}`}>{d.name}</span>
                          {d.priority && <PriorityMark priority={d.priority} testId={`campaign-deliverable-priority-${d.id}`} />}
                          {(d.quantity ?? 1) > 1 && <span className="muted" data-testid={`campaign-deliverable-qty-${d.id}`}> × {d.quantity}</span>}
                        </td>
                        <td className="muted">
                          {d.typeName ?? <span className="cell-warn" data-testid={`campaign-deliverable-untyped-${d.id}`}>{t('campaigns.deliverableDialog.untyped')}</span>}
                        </td>
                        <td className="muted">{d.channel || '—'}</td>
                        <td data-testid={`campaign-deliverable-owner-${d.id}`}>
                          {d.ownerName ?? <span className="cell-warn">{t('campaigns.page.noOwner')}</span>}
                        </td>
                        <td>{(d.workstreamId && workstreams.find((w) => w.id === d.workstreamId)?.ownerName) || '—'}</td>
                        <td data-testid={`campaign-grid-executed-${d.id}`}>
                          {ex.names.length > 0 ? ex.names.join(', ') : ex.unassigned === 0 ? '—' : null}
                          {ex.unassigned > 0 && (
                            <span className="grid-unassigned">
                              {ex.names.length > 0 && ' · '}
                              {t('campaigns.grid.unassigned', { count: ex.unassigned })}
                            </span>
                          )}
                        </td>
                        <td className="muted" data-testid={`campaign-grid-languages-${d.id}`}>{languageList.words(d.languages) || '—'}</td>
                        <td className={isOverdue(d, Date.now()) ? 'error-text grid-due' : 'grid-due'} data-testid={`campaign-grid-due-${d.id}`}>
                          {d.dueAt ? formatIraqShortDate(d.dueAt) : '—'}
                          {/* ADR-0088 d.10: a pending extension request, against the piece. */}
                          {pending > 0 && (
                            <div className="cell-warn" data-testid={`campaign-deliverable-extensions-${d.id}`}>
                              {t('deadlineExtension.campaignPending', { count: pending })}
                            </div>
                          )}
                        </td>
                        <td>
                          {(() => {
                            const word = statusBadgeOf(d).approved ? t('campaigns.board.columns.approved') : t(`deliverables.phase.${d.progress.phase}`)
                            return (
                              <>
                                <ProgressTip progress={d.progress} status={word} testId={`progress-tip-${d.id}`}>
                                  <span className={`state-badge state-${statusBadgeOf(d).key}`} data-testid={`campaign-grid-status-${d.id}`}>
                                    {word}
                                  </span>
                                </ProgressTip>
                                <div><ProgressBar progress={d.progress} testId={`progress-bar-${d.id}`} /></div>
                              </>
                            )
                          })()}
                        </td>
                        <td data-testid={`campaign-grid-approved-${d.id}`}>
                          {(d.taskCount ?? 0) === 0 && !d.tasksApprovedAt ? (
                            <span className="muted">—</span>
                          ) : d.tasksApprovedAt ? (
                            <span className="state-badge state-approved">{t('campaigns.grid.approvedYes')}</span>
                          ) : (
                            <span className="state-badge state-todo">{t('campaigns.grid.approvedPending')}</span>
                          )}
                        </td>
                        <td className="row-actions">
                          {canManage && (
                            <Button
                              variant="secondary" size="sm"
                              // ADR-0132 d.2: Edit opens the piece's panel — the one editor on the page.
                              onClick={() => onOpenPiece(d.id)}
                              data-testid={`campaign-deliverable-edit-${d.id}`}
                            >
                              {t('campaigns.grid.edit')}
                            </Button>
                          )}
                          <Button
                            variant="link" size="sm"
                            onClick={() => onOpenPiece(d.id)}
                            data-testid={`campaign-deliverable-open-${d.id}`}
                          >
                            {t('campaigns.grid.open')}
                          </Button>
                        </td>
                      </tr>
                    </Fragment>
                  )
                })}
              </Fragment>
            ))}
            {shown === 0 && (
              <tr>
                <td
                  colSpan={cols}
                  className={failedRead ? 'form-error' : 'muted'}
                  data-testid={failedRead ? 'campaign-grid-failed' : pieces.length > 0 ? 'campaign-grid-no-matches' : 'campaign-grid-empty'}
                >
                  {t(failedRead ? 'campaigns.page.deliverablesFailedRow' : pieces.length > 0 ? 'campaigns.grid.noMatches' : 'campaigns.page.noWorkYet')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
