import { useEffect, useMemo, useRef, useState } from 'react'
import { pieceHref } from '../../lib/navigation/piece-link'
import { openLinkTarget, usePieceCampaign, useTaskPiece } from '../../lib/navigation/piece-campaign'
import { useAuth } from '../../app/auth-context'
import { endOfWorkingDay, formatIraqDate, formatIraqDateTime, iraqDay } from '../../lib/time/iraq'
import { useTranslation } from 'react-i18next'
import { Button, IconButton, type ButtonVariant } from '../../components/Button'
import type { IconName } from '../../components/Icon'
import { useNavigate, useSearchParams } from 'react-router'
import { usePermissions } from '../../app/permissions'
import {
  useCampaignOptions,
  useCampaignDeliverables,
  useAdhocDeliverables,
  useDeliverable,
  useAssignableUsers,
  useDeliverableOwnerCandidates,
  useReassignDeliverable,
  useTransitionDeliverable,
  useUpsertSubTask,
  useDeliverableOfTask,
  useReviewers,
  useCancelSubTask,
  useRemoveSubTask,
  fetchCancelImpact,
  type SubTaskRow,
  useResequenceDeliverableTasks,
  useRequestChangesSubTask,
  isHeldForOwnerReview,
  type DeliverableRow,
} from './api/deliverables-api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ProgressBar, ProgressTip } from '../../components/DeliverableProgress'
import { RequiredInput } from './components/RequiredInput'
import { TaskListApproval } from './components/TaskListApproval'
import { PriorityMark } from '../../components/PriorityMark'
import { ExternalInputs } from './components/ExternalInputs'
import {
  usePendingInputs,
  useRequirementCandidates,
  useTaskDependencies,
  type PendingInput,
  type RequirementCandidate,
  type TaskDependency,
} from './api/requirements-api'
import { allowedTransitions, type DeliverableState } from '../../lib/deliverables/state-machine'
import { useSlaProfiles } from '../sla/api/sla-api'
import { isDeliverableComplete } from '../../lib/deliverables/completeness'
import { moveTask } from './lib/task-order'
import { rankByFields } from '../../lib/search/rank-by-name'
import { translateScheduleWarning } from '../../lib/bookings/schedule-outcome'
import { ReviewPanel } from './ReviewPanel'
import { TaskReviewThread } from './TaskReviewThread'
import { TaskResources } from './TaskResources'
import { ReviewerPicker } from '../../components/ReviewerPicker'
import { WaitingOn } from '../../components/WaitingOn'
import { appointmentsOf, isReviewerOutstanding } from '../../lib/reviewers/task-reviewers'
import { ReviewActions } from './components/ReviewActions'
import { REVIEW_MODES, reviewModeLabelKey, type ReviewMode } from '../../lib/review/review-mode'
import { classifyWriteFailure } from '../../lib/errors/classify'
import { ChatPanel } from '../chat/ChatPanel'
import { NoticeDialog } from '../../components/Notice'
import { usePendingAssignmentRequestsForTasks } from '../../lib/assignment-requests/api'
import { useLatestExtensionByTask } from './api/extensions-api'
import { ExtensionControl } from './components/ExtensionControl'
import { ChangeAskDialog } from '../campaigns/components/ChangeAskDialog'
import { AddSubTaskDialog } from './components/AddSubTaskDialog'
import { ReinstateDialog } from './components/ReinstateDialog'
import { ReopenDialog } from './components/ReopenDialog'
import { reopenDoneText } from './lib/reopen-text'
import { Modal } from '../../components/Modal'
import { Provenance } from '../../components/Provenance'
import { DateField } from '../../components/DateField'
import { leadsOfDepartment } from '../../lib/people/leads-of-department'

/**
 * Deliverables work surface (ADR-0024, I2.3 — unblocks L1.16). Pick a campaign → its
 * deliverables, each with its lifecycle state, revision round and the transitions the caller
 * is allowed to make (deliverable-transition; the DB guard is authoritative). Open one to break
 * it into sub-tasks and assign owners with hours/dates — assigning materialises bookings on the
 * assignee's schedule (subtask-schedule). Gated `project_tasks:manage`; RLS scopes every write.
 *
 * Deep-linkable: `?campaign=<id>&open=<deliverableId>` pre-selects the campaign and opens a
 * deliverable's breakdown directly (Creative My Work, I2.2, links here).
 */

export type Banner = { kind: 'ok' | 'error'; text: string; reportable?: boolean; cause?: unknown }

/**
 * ADR-0080 d.10/d.11. The archive action is labelled by what it will DO, not by the state it writes.
 *
 * Since d.1 it cancels every live task under the container, releases their bookings and tells their
 * assignees — so on work that still has live tasks the honest word is *Cancel*. "Archive" promises
 * something filed away quietly, which is the opposite, and it was the only button on an Ad-hoc Live
 * row: somebody wanting rid of a row pressed it, and it archived the container and left the work.
 * With nothing live underneath, archiving really is only tidying a finished item away, and the word
 * stays. Edward, 9 Sep: *"on adhoc it should say cancel and warn"*.
 */
function actionKey(from: DeliverableState, to: DeliverableState, liveTasks = 0): string {
  if (to === 'blocked') return 'block'
  if (to === 'archived') return liveTasks > 0 ? 'cancelJob' : 'archive'
  if (to === 'delivered') return 'markDelivered'
  if (to === 'in_progress') {
    if (from === 'blocked') return 'unblock'
    return 'reopen'
  }
  return to
}

/**
 * How a transition button looks, from what it does: the forward move is the primary of its row,
 * a sideways move (block) is secondary, and taking work away is red. An icon
 * beside the word where one reads at a glance.
 */
function transitionLook(key: string): { variant: ButtonVariant; icon?: IconName } {
  switch (key) {
    case 'markDelivered':
      return { variant: 'primary' }
    case 'reopen':
    case 'unblock':
      return { variant: 'secondary', icon: 'undo' }
    case 'archive':
      return { variant: 'secondary', icon: 'archive' }
    case 'cancelJob':
      return { variant: 'danger' }
    default:
      return { variant: 'secondary' }
  }
}

/**
 * The banner for a failed write — worded by code, never the raw database sentence (I48.42).
 *
 * `t` is optional only so a caller that has no translator in hand still compiles; pass it wherever
 * there is one. Without it a refusal that NAMES who can (I54.20) falls back to the database's
 * English sentence, which is right for a log and wrong for an Arabic reader.
 */
export const failed = (
  err: unknown,
  fallback: string,
  outsideReach: string,
  t?: (key: string, opts?: Record<string, unknown>) => string,
): Banner => ({ kind: 'error', ...classifyWriteFailure(err, fallback, outsideReach, t) })

export function DeliverablesPage() {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const grants = { manage: can('project_tasks:manage'), review: can('reviews:moderate') }

  const [params] = useSearchParams()
  const campaigns = useCampaignOptions()
  const [campaignId, setCampaignId] = useState(() => params.get('campaign') ?? '')
  const [openId, setOpenId] = useState<string | null>(() => params.get('open'))
  // I51.7: `?task=<id>` — a notification's door. The task's deliverable is looked up and opened, and
  // the task row is marked, so the person lands on the thing itself rather than on a list.
  const focusTaskId = params.get('task')
  const deliverableOfTask = useDeliverableOfTask(focusTaskId)
  useEffect(() => {
    if (focusTaskId && deliverableOfTask.data && !openId) setOpenId(deliverableOfTask.data)
    // Only the arrival matters: closing the dialog afterwards must not reopen it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTaskId, deliverableOfTask.data])
  /** ADR-0080 d.7 — the container whose archive is waiting to be confirmed, with the live work it
   *  will call off. Held as the row itself: the warning names the people, and the row already
   *  carries them (`assigneeNames` is computed over LIVE tasks only). */
  const [pendingArchive, setPendingArchive] = useState<DeliverableRow | null>(null)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [reopenRow, setReopenRow] = useState<DeliverableRow | null>(null)

  const [tab, setTab] = useState<'campaign' | 'adhoc'>('campaign')

  const campaignDeliverables = useCampaignDeliverables(campaignId || null)
  const adhocDeliverables = useAdhocDeliverables()
  
  const deliverables = tab === 'adhoc' ? adhocDeliverables : campaignDeliverables
  const transition = useTransitionDeliverable()
  // Memoised because `groups` derives from it: `data ?? []` is a fresh array every render, so
  // an unmemoised `rows` would make the split recompute on every keystroke elsewhere.
  const rows = useMemo(() => deliverables.data ?? [], [deliverables.data])

  /**
   * Narrowing a list by typing — **one search per group, not one shared between them**.
   *
   * Live work and finished work are two different lists that happen to sit on one page (Edward,
   * 26 Aug), so they get a box each: you look for a job in progress, or you look through the
   * archive, and a single box would narrow the one you are not reading.
   *
   * Matches the NAME, the TYPE and the DEPARTMENT, because "print" should reach a Print
   * Advertisement whatever somebody called it, and "production" should reach everything that
   * department owns. Prefix before substring, the rule the owner picker already uses.
   */
  const [search, setSearch] = useState<Record<string, string>>({})
  /**
   * I40.22 — narrowing by column, on top of the free-text search. Edward, 8 Sep: "allow me to
   * filter based on columns."
   *
   * Options come from the ROWS, not from a hand-written list: a filter offering a status nothing is
   * in, or missing a person who is on the work, is worse than no filter — and a hand-written list
   * is the drift this project has paid for three times (traps.md). One filter set for the page,
   * not per group: "show me everything Sara is on" is a question about the work, not about a
   * heading it happens to sit under.
   */
  const [filters, setFilters] = useState({ phase: '', assigner: '', assignee: '', reviewer: '' })
  const filtersOn = Object.values(filters).some(Boolean)

  const options = useMemo(() => {
    const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort()
    return {
      phase: uniq(rows.map((d) => d.progress.phase)),
      assigner: uniq(rows.flatMap((d) => d.assignerNames)),
      assignee: uniq(rows.flatMap((d) => d.assigneeNames)),
      reviewer: uniq(rows.flatMap((d) => d.blockingReviewers.names)),
    }
  }, [rows])

  const matchesFilters = (d: DeliverableRow) =>
    (!filters.phase || d.progress.phase === filters.phase) &&
    (!filters.assigner || d.assignerNames.includes(filters.assigner)) &&
    (!filters.assignee || d.assigneeNames.includes(filters.assignee)) &&
    (!filters.reviewer || d.blockingReviewers.names.includes(filters.reviewer))

  const searchIn = (key: string, list: DeliverableRow[]) =>
    rankByFields(list.filter(matchesFilters), search[key] ?? '', (d) => [d.name, d.typeName, d.discipline])
  const openRow = rows.find((d) => d.id === openId) ?? null
  // ADR-0132 d.8 (I68.10): a campaign's deliverable is edited on its campaign page, in the piece's panel. A link
  // that still opens it here (`?open=`, `?task=`) forwards there; ad-hoc work, which has no campaign, keeps this window.
  const navigate = useNavigate()
  // I68.13: a bare `?open=<id>` (no `&campaign=`) loads no rows, so the row cannot say its campaign — look it up.
  // Ad-hoc work (no campaign) opens here, on the Ad-hoc tab. Only the arrival is forwarded, never a later click.
  const arrivedOpen = useRef(params.get('open') ?? null)
  // `?task=` alone (no `?open=`) named no deliverable, so it never forwarded and opened the retired campaign
  // table by hand (I74 browser tests). Look up the task's piece and treat it as the arrival.
  const taskPiece = useTaskPiece(!arrivedOpen.current && focusTaskId ? focusTaskId : null)
  useEffect(() => {
    if (arrivedOpen.current || !taskPiece.data) return
    arrivedOpen.current = taskPiece.data
    setOpenId(taskPiece.data)
  }, [taskPiece.data])
  const lookedUp = usePieceCampaign(arrivedOpen.current && !openRow ? arrivedOpen.current : null)
  useEffect(() => {
    if (openRow) {
      if (openRow.campaignId) navigate(pieceHref(openRow.campaignId, openRow.id, focusTaskId), { replace: true })
      return
    }
    if (!arrivedOpen.current || openId !== arrivedOpen.current || !lookedUp.isSuccess) return
    const target = openLinkTarget(openId, focusTaskId, lookedUp.data)
    if (target.kind === 'forward') navigate(target.href, { replace: true })
    else if (target.kind === 'adhoc') setTab('adhoc')
  }, [openRow, openId, focusTaskId, lookedUp.isSuccess, lookedUp.data, navigate])

  // Live work and finished work answer different questions, so they are shown APART rather than
  // mixed and sorted by date (Edward, 26 Aug).
  //
  // BOTH tabs split (Edward, 8 Sep: "both ad-hoc and campaign should be the same"). The campaign
  // tab did not, on the reasoning that it is already narrowed to one campaign — true when a
  // campaign held a handful of deliverables, and no longer true in the pilot. One rule, one
  // `isDeliverableComplete`, so the two tabs cannot answer "is this finished" differently.
  const groups = useMemo(() => {
    // `total` is what the group holds; `rows` is what the search left. Both are needed: a heading
    // that counted only the visible rows would silently redefine "12 complete" as "12 matching".
    const live = rows.filter((d) => !isDeliverableComplete(d.state))
    const done = rows.filter((d) => isDeliverableComplete(d.state))
    return [
      { key: 'live', label: t('deliverables.groupLive'), rows: live, total: live.length },
      { key: 'complete', label: t('deliverables.groupComplete'), rows: done, total: done.length },
    ]
  }, [rows, t])

  /**
   * I19.7 (ADR-0052 d.10 part 2). Sign-off with tasks nobody was ever given is ALLOWED — the guard
   * stopped blocking it, deliberately, so a planned list does not deadlock the deliverable. But it
   * is worth being sure about, and this is the only place a person can be asked: a `before update`
   * trigger has no channel for "are you sure", because PostgREST returns a row or an error and
   * `raise notice` reaches nobody.
   *
   * Warn-and-allow, the `I17.2` pattern. The database records the count either way
   * (`deliverables.unassigned_at_signoff`), so a client that skips this dialog still leaves the
   * fact on the row — the warning is a courtesy, not the control.
   */
  function runTransition(d: DeliverableRow, to: DeliverableState) {
    transition.mutate(
      { deliverableId: d.id, to, expectedState: d.state },
      { onError: (err) => setBanner(failed(err, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t)) },
    )
  }

  function onTransition(d: DeliverableRow, to: DeliverableState) {
    setBanner(null)
    // ADR-0080 d.7: it always warns, and the warning scales to the cost. `archived` is terminal
    // (ADR-0024) and ad-hoc work cannot be reinstated once its container is archived
    // (20260903120000), so this is genuinely the last moment anybody can be told. Nothing live
    // underneath means nothing is lost, and a dialog there would be the ceremony that teaches
    // people to dismiss dialogs.
    if (to === 'archived' && d.taskCount > 0) return setPendingArchive(d)
    // ADR-0103 d.3: a finished deliverable re-opens by the tasks that need doing again — the bare
    // move back to in progress is refused by the database.
    if (to === 'in_progress' && (d.state === 'approved' || d.state === 'delivered')) return setReopenRow(d)
    runTransition(d, to)
  }

  return (
    <section data-testid="surface-deliverables">
      <header className="schedule-bar">
        <h1>{t('deliverables.title')}</h1>
        <div className="deliverables-tabs">
          <Button 
            variant="secondary" className={tab === 'campaign' ? 'is-active' : ''}
            aria-pressed={tab === 'campaign'}
            data-testid="deliverables-tab-campaign"
            onClick={() => { setTab('campaign'); setOpenId(null); setBanner(null) }}
          >
            {t('deliverables.tabCampaign')}
          </Button>
          <Button 
            variant="secondary" className={tab === 'adhoc' ? 'is-active' : ''}
            aria-pressed={tab === 'adhoc'}
            data-testid="deliverables-tab-adhoc"
            onClick={() => { setTab('adhoc'); setOpenId(null); setBanner(null) }}
          >
            {t('deliverables.tabAdhoc')}
          </Button>
          
          {tab === 'campaign' && (
            <select
              value={campaignId}
              onChange={(e) => { setCampaignId(e.target.value); setOpenId(null); setBanner(null) }}
              data-testid="deliverables-campaign"
            >
              <option value="" disabled>{t('deliverables.pickCampaign')}</option>
              {(campaigns.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>
      </header>
      <p className="muted">{t('deliverables.intro')}</p>

      {/* Edward, 29 Aug: an outcome is reported in front of the person, not as a strip above
          the table they were already reading. `I12.9` established this for the schedule refusal;
          it is the same rule for every result now. The testid rides along with the message, so the
          suites keep asserting the words rather than the placement. */}
      {banner && (
        <NoticeDialog
          kind={banner.kind === 'error' ? 'error' : 'success'}
          message={banner.text}
          testId="deliverables-banner"
          reportable={banner.reportable}
          reportWhere="Deliverables"
          reportCause={banner.cause}
          onClose={() => setBanner(null)}
        />
      )}

      {/* I40.22 — narrowing by column. Above the groups rather than inside them: "everything Sara
          is on" is a question about the work, not about which heading it sits under. Every option
          is derived from the rows, so a filter can never offer a status nothing is in, nor miss a
          person who is on the work. Nothing is ever hidden without a way back — the clear button
          only appears once something is narrowed. */}
      {rows.length > 0 && (
        <div className="deliverable-filters" data-testid="deliverable-filters">
          {([
            ['phase', 'filterPhase'],
            ['assigner', 'filterAssigner'],
            ['assignee', 'filterAssignee'],
            ['reviewer', 'filterReviewer'],
          ] as const).map(([key, label]) => (
            options[key].length > 0 && (
              <select
                key={key}
                value={filters[key]}
                aria-label={t(`deliverables.${label}`)}
                data-testid={`deliverable-filter-${key}`}
                onChange={(e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }))}
              >
                <option value="">{t(`deliverables.${label}`)}</option>
                {options[key].map((v) => (
                  <option key={v} value={v}>
                    {key === 'phase' ? t(`deliverables.phase.${v}`) : v}
                  </option>
                ))}
              </select>
            )
          ))}
          {filtersOn && (
            <Button
              variant="link"
              data-testid="deliverable-filters-clear"
              onClick={() => setFilters({ phase: '', assigner: '', assignee: '', reviewer: '' })}
            >
              {t('deliverables.filterClear')}
            </Button>
          )}
        </div>
      )}

      {tab === 'campaign' && !campaignId ? (
        <div className="empty-state" data-testid="deliverables-pick"><p>{t('deliverables.pickPrompt')}</p></div>
      ) : deliverables.isError ? (
        <p className="form-error">{t('deliverables.loadFailed')}</p>
      ) : deliverables.isLoading ? (
        <p className="muted" data-testid="deliverables-loading">…</p>
      ) : rows.length === 0 ? (
        <div className="empty-state" data-testid="deliverables-empty"><p>{t('deliverables.emptyTitle')}</p></div>
      ) : (
        groups.map((g) => (
        <section key={g.key} className="deliverable-group" data-testid={`deliverable-group-${g.key}`}>
        {g.label && <h3 className="group-heading">{g.label} <span className="muted">({g.total})</span></h3>}
        {/* This group's own box. Live and Complete are two lists, and one shared search would
            narrow the one you are not looking at. */}
        {g.total > 0 && (
          <div className="group-search">
            <input
              type="search"
              value={search[g.key] ?? ''}
              onChange={(e) => setSearch((prev) => ({ ...prev, [g.key]: e.target.value }))}
              placeholder={t('deliverables.searchPlaceholder')}
              aria-label={t('deliverables.searchLabel')}
              data-testid={`deliverables-search-${g.key}`}
            />
            {/* I40.22 — the count appears whenever ANYTHING has narrowed the list, not only when
                the search box has text. A filtered list with no count is a list you cannot trust:
                you cannot tell "three deliverables" from "three of forty". */}
            {((search[g.key] ?? '').trim() !== '' || filtersOn) && (
              <span className="muted" data-testid={`deliverables-search-count-${g.key}`}>
                {t('deliverables.searchCount', {
                  shown: searchIn(g.key, g.rows).length,
                  total: g.total,
                })}
              </span>
            )}
          </div>
        )}
        {searchIn(g.key, g.rows).length === 0 ? (
          <p className="muted" data-testid={`deliverable-group-empty-${g.key}`}>
            {(search[g.key] ?? '').trim() !== '' || filtersOn
              ? t('deliverables.searchEmpty')
              : t('deliverables.groupEmpty')}
          </p>
        ) : (
        <table className="data-table" data-testid={g.key === 'all' ? 'deliverables-table' : `deliverables-table-${g.key}`}>
          <thead>
            {/* The two tabs answer different questions, so they carry different columns. Ad-hoc is
                an approved-only archive: Discipline comes from the stream and is structurally NULL
                here (it rendered as a column of dashes), and the revision round matters far less
                than WHICH version was signed off. */}
            <tr>
              <th>{t('deliverables.colName')}</th>
              {tab === 'campaign' && <th>{t('deliverables.type')}</th>}
              {tab === 'campaign' && <th>{t('deliverables.colDiscipline')}</th>}
              {/* I40.22 — WHO HANDED IT OUT, not who owns the container. On ad-hoc those are the
                  same person (the schedule creates both from one action), so an Owner column
                  repeated the next column and said nothing (Edward, 8 Sep). */}
              <th>{t('deliverables.colAssignedBy')}</th>
              {/* I40.22 — the owner is accountable for the deliverable; the ASSIGNEES are the
                  people on its live tasks, which is the unit that gets booked. Different question,
                  different column. */}
              <th>{t('deliverables.colAssignedTo')}</th>
              <th>{t('deliverables.colBlockedBy')}</th>
              <th>{t('deliverables.colState')}</th>
              <th>{tab === 'adhoc' ? t('deliverables.colApprovedVersion') : t('deliverables.colRevision')}</th>
              <th>{t('deliverables.colDue')}</th>
              <th>{t('deliverables.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {searchIn(g.key, g.rows).map((d) => (
              <tr key={d.id} data-testid={`deliverable-row-${d.id}`}>
                <td>
                  <Button
                    variant="link"
                    onClick={() => (d.campaignId ? navigate(pieceHref(d.campaignId, d.id)) : setOpenId(openId === d.id ? null : d.id))}
                    aria-expanded={openId === d.id}
                    data-testid={`deliverable-open-${d.id}`}
                  >
                    {d.name}
                  </Button>
                  {/* I53.14: "× n" beside the name when the deliverable is several — the quantity
                      that multiplied its creation step (ADR-0071). */}
                  {(d.quantity ?? 1) > 1 && <span className="muted" data-testid={`deliverable-qty-${d.id}`}> × {d.quantity}</span>}
                </td>
                {/* ADR-0051 d.8: an untyped deliverable says so and STAYS IN THE LIST. Hiding it
                    would hide real work — untyped is a legal permanent state, not a defect. */}
                {tab === 'campaign' && (
                  <td data-testid={`deliverable-type-${d.id}`}>
                    {d.typeName ?? <span className="muted">{t('deliverables.noTypeSet')}</span>}
                  </td>
                )}
                {tab === 'campaign' && <td>{d.discipline ?? '—'}</td>}
                <td data-testid={`deliverable-assigners-${d.id}`}>
                  {d.assignerNames.length > 0
                    ? d.assignerNames.join(', ')
                    : <span className="muted">—</span>}
                </td>
                <td data-testid={`deliverable-assignees-${d.id}`}>
                  {d.assigneeNames.length > 0
                    ? d.assigneeNames.join(', ')
                    : isHeldForOwnerReview(d) && d.unassignedCount > 0
                      // ADR-0090 d.3b: not "nobody yet" — nobody SHOULD be yet. Named for the owner.
                      ? <span className="held-label" data-testid={`deliverable-held-${d.id}`}>
                          {d.ownerName
                            ? t('intake.held.awaitingReview', { owner: d.ownerName })
                            : t('intake.held.awaitingReviewNoOwner')}
                        </span>
                      : <span className="muted">—</span>}
                </td>
                {/* Mandatory reviewers only, and only on a task actually in review: an optional
                    reviewer cannot hold the work up, and a reviewer on an unsubmitted task is not
                    waiting for anything. */}
                <td data-testid={`deliverable-blocked-by-${d.id}`}>
                  {d.blockingReviewers.names.length > 0
                    ? (
                      <span className={d.blockingReviewers.allRequired ? 'warning-text' : undefined}>
                        {d.blockingReviewers.names.join(', ')}
                        {/* `is_mandatory` defaults to false (ADR-0043 d.5), so most appointments
                            are optional. Naming them is still the right answer — somebody IS being
                            waited on — but it is not a hard block, and the row says which. */}
                        {!d.blockingReviewers.allRequired && (
                          <span className="muted"> {t('deliverables.reviewerNotRequired')}</span>
                        )}
                      </span>
                    )
                    : <span className="muted">—</span>}
                </td>
                {/* I40.22 — where the work IS, from the tasks, not what the container is called.
                    A deliverable reads `in_progress` from the moment it exists, so the stored state
                    could not tell work nobody had begun from work under way. The counts beneath say
                    how much is left and whether anybody is missing from it. */}
                <td data-testid={`deliverable-phase-${d.id}`}>
                  <ProgressTip progress={d.progress} status={t(`deliverables.phase.${d.progress.phase}`)} testId={`progress-tip-${d.id}`}>
                    <span className={`state-badge state-${d.progress.phase}`}>
                      {t(`deliverables.phase.${d.progress.phase}`)}
                    </span>
                  </ProgressTip>
                  {d.progress.everTotal > 0 && (
                    <div className="muted deliverable-phase-detail">
                      <ProgressBar progress={d.progress} testId={`progress-bar-${d.id}`} />
                      {d.progress.unassigned > 0 && (
                        <> · <span className="warning-text">
                          {t('deliverables.phaseUnassigned', { count: d.progress.unassigned })}
                        </span></>
                      )}
                    </div>
                  )}
                </td>
                <td data-testid={`deliverable-version-${d.id}`}>
                  {tab === 'adhoc'
                    ? (d.approvedVersion != null ? `v${d.approvedVersion}` : '—')
                    : `${d.revisionRound}${d.revisionLimit != null ? ` / ${d.revisionLimit}` : ''}`}
                </td>
                {/* ADR-0076 d.6: the IRAQ day, not the UTC one. The column head names the clock. */}
                <td>{d.dueAt ? formatIraqDateTime(d.dueAt) : '—'}{d.priority && <PriorityMark priority={d.priority} testId={`deliverable-priority-${d.id}`} />}</td>
                <td className="row-actions">
                  {allowedTransitions(d.state, grants)
                    // Ad-hoc is an approved-only archive, so the only thing to do here is tidy a
                    // finished item away. "Mark delivered" and "Reopen" are campaign-lifecycle
                    // moves and would be noise (delivery files into a campaign Library folder that
                    // ad-hoc work does not have — see I11.4).
                    .filter((tr) => tab === 'campaign' || tr.to === 'archived')
                    // ADR-0118 d.5: nobody sends a deliverable to review by hand — its tasks do.
                    .filter((tr) => tr.to !== 'in_review')
                    .map((tr) => (
                    <Button
                      key={tr.to}
                      type="button"
                      {...transitionLook(actionKey(d.state, tr.to, d.taskCount))}
                      size="sm"
                      busy={transition.isPending}
                      onClick={() => onTransition(d, tr.to)}
                      data-testid={`deliverable-${actionKey(d.state, tr.to, d.taskCount)}-${d.id}`}
                    >
                      {t(`deliverables.action.${actionKey(d.state, tr.to, d.taskCount)}`)}
                    </Button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
        </section>
        ))
      )}

      {/* ADR-0080 d.7. The warning is itemised rather than "are you sure?": a dialog everybody
          dismisses without reading is worse than no dialog, because it buys the illusion of a
          safeguard (ConfirmDialog's own header). It names how many tasks go, who is holding them,
          and that they will be told — the last being what makes d.6's widened authority tolerable,
          since the archiver may be calling off work in a department they could not otherwise touch. */}
      {reopenRow && (
        <ReopenDialog
          deliverableId={reopenRow.id}
          deliverableName={reopenRow.name}
          onDone={(r) => setBanner({ kind: 'ok', text: reopenDoneText(t, r) })}
          onFailed={(err) => setBanner(failed(err, t('reopen.failed'), t('reopen.outsideReach'), t))}
          onClose={() => setReopenRow(null)}
        />
      )}
      {pendingArchive && (
        <ConfirmDialog
          title={t('deliverables.confirmArchiveTitle')}
          message={t('deliverables.confirmArchiveMessage', { name: pendingArchive.name })}
          detail={[
            t('deliverables.confirmArchiveTasks', { count: pendingArchive.taskCount }),
            pendingArchive.assigneeNames.length > 0
              ? t('deliverables.confirmArchiveAssignees', {
                  names: pendingArchive.assigneeNames.join(', '),
                })
              : t('deliverables.confirmArchiveUnassigned'),
            t('deliverables.confirmArchiveFinal'),
          ]}
          confirmLabel={t('deliverables.action.cancelJob')}
          busy={transition.isPending}
          onConfirm={() => {
            const d = pendingArchive
            setPendingArchive(null)
            runTransition(d, 'archived')
          }}
          onCancel={() => setPendingArchive(null)}
          testId="deliverable-archive-confirm"
        />
      )}

      {/* The detail opens as a MODAL, not inline under the table (Edward, 26 Aug). Below the list it
          was easy to miss entirely — on a tab with 51 live items you select something near the top
          and the panel appears past the fold. `dialog-wide` is the size the review panel already
          expects (92vh), so downloads and the requirements editor both have room. */}
      {openId && (
        <Modal onClose={() => setOpenId(null)} card={false}>
          <div
            className="dialog dialog-wide"
            role="dialog"
            aria-modal="true"
            aria-label={openRow?.name ?? t('deliverables.detailTitle')}
            data-testid="deliverable-detail-dialog"
           
            onKeyDown={(e) => { if (e.key === 'Escape') setOpenId(null) }}
          >
            <div className="dialog-title-row">
              <h2>{openRow?.name ?? t('deliverables.detailTitle')}</h2>
              <IconButton
                icon="close"
                label={t('schedule.cancel')}
                onClick={() => setOpenId(null)}
                data-testid="deliverable-detail-close"
              />
            </div>
            <DeliverableDetail deliverableId={openId} canManage={grants.manage} canReview={grants.review} onBanner={setBanner} focusTaskId={focusTaskId} />
          </div>
        </Modal>
      )}
    </section>
  )
}

/**
 * One deliverable, opened: its sub-tasks, who they are assigned to, what they require, and the
 * review stack. **Exported so the campaign page reuses it rather than growing a second copy**
 * (ADR-0048 / I16.6) — this is where a sub-task is defined and assigned, and there should be
 * exactly one place that does it.
 */
/**
 * Who is accountable for this deliverable, and the one control that changes it (ADR-0055, I22.4).
 *
 * It sits ABOVE the task table on purpose: the owner is who answers for the whole thing, and the
 * tasks beneath are how they choose to get it done. Reading order is who, then what.
 *
 * Shown only to holders of `deliverable_owner:manage`. That is not the whole rule — the account
 * manager of the campaign may also reassign, regardless of scope (ADR-0055 d.3b) — but in practice
 * the `account_manager` role is seeded with the permission, so gating the control on it shows the
 * button to everyone the server will accept. `app.tg_deliverable_owner_guard` is what actually
 * decides; this only decides whether to offer the attempt.
 */
function OwnerControl({
  deliverableId,
  ownerUserId,
  departmentId,
  campaignWork,
  onBanner,
}: {
  deliverableId: string
  ownerUserId: string | null
  departmentId: string | null
  /** Under a campaign (stream) — where ADR-0083 d.9 applies. Ad-hoc and internal work is not. */
  campaignWork: boolean
  onBanner: (b: Banner) => void
}) {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const users = useAssignableUsers()
  const leads = useDeliverableOwnerCandidates()
  const reassign = useReassignDeliverable()
  const [pick, setPick] = useState<string | null>(null)

  // The current owner may predate the rule (a team member on a pilot campaign), so their name is
  // looked up in both lists.
  const ownerName =
    (users.data ?? []).find((u) => u.id === ownerUserId)?.name ??
    (leads.data ?? []).find((u) => u.id === ownerUserId)?.name ??
    null
  const editing = pick !== null

  // ADR-0083 d.9, offered as the trigger will decide it: on campaign work only leads are offered, and
  // (I66.9, Edward 29 Sep) only the deliverable's own department's, whoever is looking. Narrowed-to-nothing
  // falls back to every lead rather than an empty select (the UI never blocks; the server decides).
  const options = useMemo(() => {
    if (!campaignWork) return users.data ?? []
    return leadsOfDepartment(leads.data ?? [], departmentId)
  }, [campaignWork, users.data, leads.data, departmentId])

  // ADR-0083 d.12: on campaign work where the department has no lead among the candidates, the
  // picker names the department's team leads and says why. "Nobody" is never offered on campaign
  // work (d.11) — ownership cannot be cleared.
  const noDeptLead = campaignWork && options.length > 0 && !options.some((u) => u.scope === 'department')

  function save() {
    reassign.mutate(
      { deliverableId, ownerUserId: pick || null },
      {
        onSuccess: () => {
          setPick(null)
          onBanner({ kind: 'ok', text: t('deliverables.ownerChanged') })
        },
        // Never a silent failure: the server's own reason is shown, because "outside your scope"
        // and "not in your organization" are different problems with different fixes.
        onError: (err) => onBanner(failed(err, t('deliverables.ownerFailed'), t('deliverables.outsideReach'), t)),
      },
    )
  }

  return (
    <p className="deliverable-owner" data-testid="deliverable-owner">
      <span className="muted">{t('deliverables.owner')}: </span>
      {editing ? (
        <>
          <select value={pick ?? ''} onChange={(e) => setPick(e.target.value)} data-testid="deliverable-owner-select">
            {/* d.11: campaign work never offers "Nobody" — an owner cannot be cleared. A placeholder
                prompts a choice; non-campaign work keeps the unset option. */}
            {campaignWork
              ? <option value="" disabled>{t('deliverables.ownerChoose')}</option>
              : <option value="">{t('deliverables.ownerNobody')}</option>}
            {options.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          {campaignWork && (
            <span className="muted" data-testid="deliverable-owner-note">
              {' '}{noDeptLead ? t('deliverables.ownerNoLead') : t('deliverables.ownerLeadsOnly')}
            </span>
          )}
          <Button variant="primary" busy={reassign.isPending} disabled={campaignWork && !pick} onClick={save} data-testid="deliverable-owner-save">
            {t('common.save')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setPick(null)} data-testid="deliverable-owner-cancel">
            {t('common.cancel')}
          </Button>
        </>
      ) : (
        <>
          <strong data-testid="deliverable-owner-name">{ownerName ?? t('deliverables.ownerNobody')}</strong>
          {can('deliverable_owner:manage') && (
            <Button
              variant="secondary" size="sm" icon="edit"
              onClick={() => setPick(ownerUserId ?? '')}
              data-testid="deliverable-owner-change"
            >
              {t('deliverables.ownerChange')}
            </Button>
          )}
        </>
      )}
    </p>
  )
}

/** Stable empty fallbacks, so a query that has not resolved does not invalidate every memo. */
const NO_DEPENDENCIES: TaskDependency[] = []
const NO_CANDIDATES: RequirementCandidate[] = []
const NO_INPUTS: PendingInput[] = []

export function DeliverableDetail({
  deliverableId,
  canManage,
  canReview,
  onBanner,
  focusTaskId = null,
  tasksOnly = false,
  onlyTaskId = null,
}: {
  deliverableId: string
  canManage: boolean
  canReview: boolean
  onBanner: (b: Banner) => void
  /** I51.7: the task a notification pointed at — its row is marked and scrolled to. */
  focusTaskId?: string | null
  /** The task table and what hangs off it, without the heading, owner control, approval or chat —
   *  for the campaign page's "Task lists to approve", where those are the panel's own (Edward, 27 Sep:
   *  the owner reviews, edits and approves with every column the task table has). */
  tasksOnly?: boolean
  /** The task page (Edward, 27 Sep): that ONE task's row, with every control the table has — for the
   *  deliverable's owner and the leads who manage its work. Implies `tasksOnly`. */
  onlyTaskId?: string | null
}) {
  const { t } = useTranslation()
  const detail = useDeliverable(deliverableId)
  useEffect(() => {
    if (!focusTaskId || !detail.data) return
    document.querySelector(`[data-testid="subtask-row-${focusTaskId}"]`)?.scrollIntoView({ block: 'center' })
  }, [focusTaskId, detail.data])
  const users = useAssignableUsers()
  const slaProfiles = useSlaProfiles()
  const reviewerOptions = useReviewers()
  const upsert = useUpsertSubTask()
  // I40.27: the reviewer's own actions, for the ad-hoc panel — `ReviewActions`, the same component
  // the reviewer inbox renders. One implementation, two doors.
  const { session } = useAuth()
  const myUserId = session?.user.id ?? null
  const cancelTask = useCancelSubTask()
  const removeTask = useRemoveSubTask()
  // ADR-0069: what every task under this deliverable is waiting for. Read once here and handed
  // down, rather than a query per row.
  const dependencies = useTaskDependencies(deliverableId)
  const candidates = useRequirementCandidates(deliverableId)
  const pendingInputs = usePendingInputs(deliverableId)
  /**
   * ADR-0068 d.1–d.3: the pending destructive action, and what it will cost.
   *
   * `impact` is fetched BEFORE the dialog opens, because the wording depends on it — a PLAN is
   * deleted outright and nothing is lost, anything else is cancelled and its bookings go. A
   * dialog that guessed would promise one outcome and the function would deliver the other.
   */
  // Outstanding external inputs cascade to every task under the deliverable (ADR-0069 d.7), so
  // they are computed once here rather than per row.
  const outstandingInputs = useMemo(
    () => (pendingInputs.data ?? []).filter((i) => i.satisfiedAt === null).map((i) => i.description),
    [pendingInputs.data],
  )

  const [pendingCancel, setPendingCancel] = useState<
    | {
        id: string
        title: string
        assigneeName: string | null
        dueAt: string | null
        bookings: number
        isPlan: boolean
        isAdhoc: boolean
      }
    | null
  >(null)
  const resequence = useResequenceDeliverableTasks()
  const requestChanges = useRequestChangesSubTask()

  /**
   * ADR-0068 d.2/d.3. Fetch what it costs, THEN ask — the dialog says whether this is a plan being
   * deleted (nothing lost) or work being cancelled (assignee, dates and bookings lost), and it
   * cannot know which without asking.
   */
  async function armCancel(task: SubTaskRow) {
    try {
      const impact = await fetchCancelImpact(task.id)
      setPendingCancel({
        id: task.id,
        title: task.title,
        assigneeName: task.assigneeName,
        dueAt: task.dueAt,
        bookings: impact.bookings,
        isPlan: impact.isPlan,
        isAdhoc: impact.isAdhoc,
      })
    } catch (err) {
      onBanner(failed(err, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t))
    }
  }

  function onConfirmCancel() {
    const pending = pendingCancel
    if (!pending) return
    setPendingCancel(null)
    // A PLAN is deleted by `remove_sub_task`; anything else is cancelled by it. One call, and the
    // dialog has already said which it will be.
    if (pending.isPlan) {
      removeTask.mutate(pending.id, {
        onSuccess: () => onBanner({ kind: 'ok', text: t('deliverables.removedDeleted') }),
        onError: (err) => onBanner(failed(err, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t)),
      })
      return
    }
    cancelTask.mutate(pending.id, {
      onSuccess: () => onBanner({ kind: 'ok', text: t('deliverables.cancelledOk') }),
      onError: (err) => onBanner(failed(err, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t)),
    })
  }

  /**
   * I52.7: Reinstate asks "assign to whom?" in the same step. It used to come back unassigned
   * with a mail to the person who had lost it — who could not assign it (Edward, 17 Sep). The
   * dialog assigns through the ordinary path, or reinstates unassigned and tells the leads.
   */
  const [pendingReinstate, setPendingReinstate] = useState<SubTaskRow | null>(null)
  // ADR-0103 d.2: an approved task re-opened from its own row.
  const [reopening, setReopening] = useState<SubTaskRow | null>(null)
  /** I52.12 (Edward, 17 Sep): the task whose review is open. A deliverable is never submitted for
   *  review — its tasks are — so the review belongs on the task's row, and the deliverable-level
   *  panel that listed every task's versions unlabelled is gone. */
  const [reviewing, setReviewing] = useState<SubTaskRow | null>(null)
  function onReinstated(r: { assigned: boolean; scheduleWarning?: string }) {
    if (r.scheduleWarning) return onBanner({ kind: 'error', text: translateScheduleWarning(t, r.scheduleWarning)! })
    // ADR-0068 d.5: unassigned means off the calendar too, and saying so is half the point.
    onBanner({ kind: 'ok', text: t(r.assigned ? 'deliverables.reinstate.assignedOk' : 'deliverables.reinstatedOk') })
  }

  function onRequestChanges(subTaskId: string) {
    requestChanges.mutate(subTaskId, {
      onSuccess: () => onBanner({ kind: 'ok', text: t('deliverables.changesRequested') }),
      onError: (err) => onBanner(failed(err, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t)),
    })
  }

  // I51.5: the add-task dialog is open.
  const [adding, setAdding] = useState(false)

  // Which task's resource requirements are open. One at a time: the table is the thing being
  // scanned, and an inline editor under every row would bury it.
  // I19.8: narrow the table to the work nobody is on. Off by default — the list is the thing being
  // scanned, and a filter that hides most of it by default hides the shape of the job.
  const [unassignedOnly, setUnassignedOnly] = useState(false)
  // I19.9 (ADR-0052 d.12): retitle and re-date, in place. One row at a time — the table is what is
  // being read, and every row carrying two live inputs is a form, not a list.
  const [editing, setEditing] = useState<string | null>(null)
  // ADR-0059 d.4: the mode is a person's decision, changeable at any time. Discovering at the shoot
  // that there is nothing to upload is normal, and a mode that could only be set once would be a
  // second dead end.
  const [editReviewMode, setEditReviewMode] = useState<ReviewMode>('digital')
  const [editTitle, setEditTitle] = useState('')
  const [editDue, setEditDue] = useState('')
  // I57.45: the hours and the notes for whoever does it, edited in the same row.
  const [editHours, setEditHours] = useState('')
  const [editNotes, setEditNotes] = useState('')
  // ADR-0087 d.11: a task with a booking request out says so wherever its status is shown.
  const taskIds = useMemo(() => (detail.data?.subTasks ?? []).map((x) => x.id), [detail.data])
  const pendingRequests = usePendingAssignmentRequestsForTasks(taskIds)
  // ADR-0088 d.10: the state of the ask on every task, one read; and the offer a save makes when
  // the plan it wrote ends after the commitment.
  const extensions = useLatestExtensionByTask((detail.data?.subTasks ?? []).map((s) => s.id))
  const [offer, setOffer] = useState<{ subTaskId: string; title: string; day: string; committedDueAt: string } | null>(null)
  // I66.13: close the deliverable from here — the Needs-you cards open this window ("add a task, or close it").
  const closeDeliverable = useTransitionDeliverable()
  const [confirmClose, setConfirmClose] = useState(false)

  const d = detail.data
  if (detail.isLoading || !d) return <p className="muted" data-testid="deliverable-detail-loading">…</p>

  // Live work only: a cancelled task is settled and a done one was done by somebody, so neither is
  // work nobody has picked up.
  const liveTasks = d.subTasks.filter((x) => x.status !== 'done' && x.status !== 'cancelled')
  const unassignedTasks = liveTasks.filter((x) => !x.assigneeId)
  const shownTasks = onlyTaskId ? d.subTasks.filter((x) => x.id === onlyTaskId) : unassignedOnly ? unassignedTasks : d.subTasks
  // Bound outside the handlers below: TypeScript drops the `d` narrowing inside a closure.
  const allTasks = d.subTasks

  // The reorder control needs the WHOLE list: `resequence_deliverable_tasks` assigns each task's
  // position from the array it is handed, so reordering a filtered subset would renumber the rows
  // on screen and silently interleave the hidden ones. Filtered, the control is withdrawn rather
  // than made to guess. (ADR-0052 d.14 — order is presentation, but it is still somebody's plan.)
  const canReorder = canManage && !unassignedOnly && d.subTasks.length > 1
  // Title, assignee, SLA, due, status, review mode, resources — plus the two conditional ones.
  // ADR-0059 added the sixth fixed column; a colSpan that lags the header leaves the resources
  // panel short of the table it sits under.

  function onMove(subTaskId: string, direction: 'up' | 'down') {
    const orderedIds = moveTask(allTasks, subTaskId, direction)
    if (!orderedIds) return // already at that end — no round trip to write the order we have.
    resequence.mutate(
      { deliverableId, orderedIds },
      { onError: (err) => onBanner(failed(err, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t)) },
    )
  }

  function onSaveEdit(subTaskId: string) {
    if (!editTitle.trim()) return
    const current = detail.data?.subTasks.find((s) => s.id === subTaskId)
    const hours = editHours.trim() === '' ? null : Number(editHours)
    if (hours != null && (!Number.isFinite(hours) || hours < 0)) return
    // Only the two fields being edited. `save_sub_task` coalesces every parameter, so a null here
    // means "leave it alone" — which is what keeps a retitle from wiping the assignee, the hours or
    // the reviewers (20260827100000:1033). Clearing a date is deliberately not possible from here.
    upsert.mutate(
      {
        id: subTaskId,
        deliverableId,
        title: editTitle,
        // ADR-0076 d.3 — a deadline is 18:00 Iraq, the close of the working day.
        dueAt: editDue ? endOfWorkingDay(editDue).toISOString() : null,
        // Sent only when it actually moved. `save_sub_task` coalesces, so an unchanged value would
        // be harmless — but "send only what you edited" is the property that keeps a retitle from
        // touching anything else, and it is worth keeping literally true rather than nearly so.
        ...(editReviewMode !== current?.reviewMode ? { reviewMode: editReviewMode } : {}),
        // An emptied hours box leaves the hours alone (`save_sub_task` coalesces); notes clear on ''.
        ...(hours != null && hours !== current?.slaHours ? { slaHours: hours } : {}),
        ...(editNotes.trim() !== (current?.description ?? '').trim() ? { description: editNotes.trim() } : {}),
      },
      {
        onSuccess: (r) => {
          setEditing(null)
          onBanner(r.scheduleWarning ? { kind: 'error', text: translateScheduleWarning(t, r.scheduleWarning)! } : { kind: 'ok', text: t('deliverables.subSaved') })
          // ADR-0141 d.2 (replaces ADR-0088 d.10): a reschedule past the PIECE's due date opens the one change
          // form, filled in with the day just saved. Offers, never forces — ADR-0075 d.8 keeps the move free.
          if (current?.committedDueAt && editDue && d?.dueAt && editDue > iraqDay(d.dueAt)) {
            setOffer({ subTaskId, title: current.title, day: editDue, committedDueAt: current.committedDueAt })
          }
        },
        onError: (err) => {
          // I49.66: an edit outside reach names who can — the deliverable's owner rides in the
          // refusal's DETAIL, the hint says whether there is one. Not reportable: it is an answer.
          const e = err as { code?: string; details?: string; hint?: string }
          if (e?.code === '42501' && (e.hint === 'deliverable_owner' || e.hint === 'no_owner')) {
            const name = (e.details ?? '').trim()
            onBanner({
              kind: 'error',
              reportable: false,
              text: name ? t('deliverables.editOutsideReachNamed', { name }) : t('deliverables.editOutsideReachNoOwner'),
            })
            return
          }
          onBanner(failed(err, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t))
        },
      },
    )
  }

  // I31.5 (ADR-0062 d.7). This was `isAdhoc={tab === 'adhoc'}` — a property of WHICH TAB WAS
  // CLICKED, passed in by the caller, with the campaign page hardcoding `false`. Reach an ad-hoc
  // deliverable any other way (a deep link `?open=`, a notification, the wrong tab) and this branch
  // was skipped, the campaign layout rendered, and a chat panel mounted on work whose job carries
  // no campaign — which the Edge Function then answered with a 404. The deliverable already knows
  // what it is: ad-hoc work hangs off the Ad-hoc job, so it has neither a stream nor a campaign.
  const isAdhoc = d.streamId == null && d.campaignId == null

  if (isAdhoc) {
    // FINISHED ad-hoc work is a record: the review chain, read-only, and nothing to edit.
    // LIVE ad-hoc work is a job in flight, so it also shows what its task NEEDS (ADR-0042) — this
    // page had no way to reach that at all, since ad-hoc work is created on the schedule and the
    // tab used to list approved items only.
    const done = d.state === 'approved' || d.state === 'archived'

    return (
      <section className="deliverable-detail" data-testid="deliverable-detail">
        {/* ADR-0058 d.8: ad-hoc is the reference implementation of the container model and always
            has exactly one task, so its artefact belongs to that task like any other. */}
        <ReviewPanel deliverableId={deliverableId} subTaskId={d.subTasks[0]?.id ?? null} isReadOnly={done} />

        {/* I36.1 (Edward, 3 Sep): this branch renders no task table, so ad-hoc work had NO cancel,
            no reinstate and no way to say what it was waiting for — on a tab that holds most of
            this tenant's deliverables. Ad-hoc is exactly one task by design (ADR-0058 d.8), so it
            gets those controls directly rather than a one-row table. */}
        {!done &&
          d.subTasks.map((s) => (
            <section key={s.id} className="adhoc-task-controls" data-testid={`adhoc-task-${s.id}`}>
              <div className="required-input-block">
                <h3 className="org-section-heading">{t('requirements.column')}</h3>
                <RequiredInput
                  subTaskId={s.id}
                  deliverableId={deliverableId}
                  dependencies={dependencies.data ?? NO_DEPENDENCIES}
                  candidates={candidates.data ?? NO_CANDIDATES}
                  externalInputs={outstandingInputs}
                  canManage={canManage}
                />
              </div>

              {/* I40.27 — the reviewer's two actions, where the work is (Edward, 8 Sep).
                  Shown ONLY when the signed-in person is an appointed reviewer on this task who has
                  not yet acted. That is not a display choice: `public.sub_task_approve` refuses
                  anybody else — "only an appointed reviewer may approve this task", ADR-0043,
                  deliberately not "any moderator at large" — so a permission-based button would
                  always error. A Power Admin who needs to act appoints themselves above first,
                  which leaves a record that they did.

                  The reviewer inbox on My Work is unchanged and remains the queue. This is a second
                  door into the same action, not a second implementation of it. */}
              {s.status === 'review' &&
                (s.reviewers ?? []).some((r) => r.userId === myUserId && isReviewerOutstanding(r, s.reviewers ?? [])) && (
                <div className="row-actions" data-testid={`adhoc-review-actions-${s.id}`}>
                  <ReviewActions subTaskId={s.id} reviewers={s.reviewers ?? []} testIdPrefix="adhoc" />
                </div>
              )}

              {/* I40.26 — ad-hoc work had no way to change WHO REVIEWS IT (Edward, 8 Sep). The
                  campaign branch appoints reviewers when a task is created, and the schedule's edit
                  modal can change them afterwards; ad-hoc — most of this tenant's work — had
                  neither. A task cannot complete without its mandatory reviewers agreeing, so being
                  unable to correct one (somebody left, somebody was named in error) is a dead end. */}
              {canManage && (
                <div className="adhoc-reviewers" data-testid={`adhoc-reviewers-${s.id}`}>
                  <h3 className="org-section-heading">{t('reviewers.heading')}</h3>
                  <ReviewerPicker
                    options={reviewerOptions.data ?? []}
                    value={appointmentsOf(s.reviewers)}
                    onChange={(next) =>
                      upsert.mutate({
                        id: s.id,
                        deliverableId,
                        // `save_sub_task` requires a non-empty title and coalesces everything else,
                        // so sending the title it already has is how "change only the reviewers"
                        // is expressed.
                        title: s.title,
                        reviewers: next,
                      })
                    }
                    excludeUserId={s.assigneeId}
                    testId={`adhoc-reviewer-${s.id}`}
                  />
                </div>
              )}
              <TaskResources subTaskId={s.id} canManage={canManage} />

              {canManage && (
                <div className="row-actions">
                  {s.status !== 'cancelled' ? (
                    <Button
                      variant="link" className="danger"
                      disabled={cancelTask.isPending}
                      onClick={() => void armCancel(s)}
                      data-testid={`subtask-cancel-${s.id}`}
                    >
                      {t('deliverables.cancelTask')}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary" size="sm" icon="undo"
                      onClick={() => setPendingReinstate(s)}
                      data-testid={`subtask-reinstate-${s.id}`}
                    >
                      {t('deliverables.reinstateTask')}
                    </Button>
                  )}
                </div>
              )}
            </section>
          ))}

        <ExternalInputs
          deliverableId={deliverableId}
          inputs={pendingInputs.data ?? NO_INPUTS}
          canManage={canManage}
        />

        {/* The same confirmation the campaign branch uses — one action, one behaviour, whichever
            surface it is reached from (ADR-0068 d.1). */}
        {pendingReinstate && (
          <ReinstateDialog
            task={pendingReinstate}
            users={users.data ?? []}
            reviewerOptions={reviewerOptions.data ?? []}
            onDone={onReinstated}
            onFailed={(err) => onBanner(failed(err, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t))}
            onClose={() => setPendingReinstate(null)}
          />
        )}
        {pendingCancel && (
          <ConfirmDialog
            title={t(pendingCancel.isPlan ? 'deliverables.confirmRemoveTitle' : 'deliverables.confirmCancelTitle')}
            message={t(
              pendingCancel.isPlan ? 'deliverables.confirmRemoveBody' : 'deliverables.confirmCancelBody',
              { title: pendingCancel.title },
            )}
            detail={
              pendingCancel.isPlan
                ? [t('deliverables.confirmRemoveNothingLost')]
                : [
                    pendingCancel.assigneeName
                      ? t('deliverables.confirmCancelAssignee', { name: pendingCancel.assigneeName })
                      : t('deliverables.confirmCancelUnassigned'),
                    pendingCancel.dueAt
                      ? t('deliverables.confirmCancelDue', { date: formatIraqDateTime(pendingCancel.dueAt) })
                      : t('deliverables.confirmCancelNoDue'),
                    t('deliverables.confirmCancelBookings', { n: pendingCancel.bookings }),
                    // The promise has to match what the system can actually do: ad-hoc work is archived
                    // by its own cancellation (ADR-0061 d.6) and `archived` is terminal (ADR-0024), so it
                    // must not be offered an undo that does not exist.
                    t(
                      pendingCancel.isAdhoc
                        ? 'deliverables.confirmCancelAdhocFinal'
                        : 'deliverables.confirmCancelUndo',
                    ),
                  ]
            }
            confirmLabel={t(pendingCancel.isPlan ? 'deliverables.remove' : 'deliverables.cancelTask')}
            busy={cancelTask.isPending || removeTask.isPending}
            onConfirm={onConfirmCancel}
            onCancel={() => setPendingCancel(null)}
            testId="subtask-cancel-confirm"
          />
        )}
        {/* ADR-0062 d.7. Ad-hoc work had no thread ANYWHERE: the panel was omitted here on purpose,
            because the old gate 404d anything without a campaign — and 131 of this tenant's
            deliverables are ad-hoc, so in practice chat surfaced on almost nothing. The gate now
            authorizes on the PEOPLE, so the omission is the only thing left in the way. */}
        <ChatPanel contextType="deliverable" contextId={deliverableId} />
      </section>
    )
  }

  return (
    <section className="deliverable-detail" data-testid={tasksOnly ? 'deliverable-tasks' : 'deliverable-detail'}>
      {!tasksOnly && (<>
      <h2>
        {t('deliverables.subTasksFor', { name: d.name })}
        {d.priority && <PriorityMark priority={d.priority} testId="deliverable-detail-priority" />}
      </h2>
      <Provenance
        createdByName={d.createdByName ?? null} createdAt={d.createdAt ?? null}
        updatedByName={d.updatedByName ?? null} updatedAt={d.updatedAt ?? null}
        testId="deliverable-provenance"
      />
      <OwnerControl
        deliverableId={deliverableId}
        ownerUserId={d.ownerUserId}
        departmentId={d.departmentId}
        campaignWork={d.streamId !== null}
        onBanner={onBanner}
      />
      {/* ADR-0090 d.7: a single job's list is a proposal until its owner — the Department Manager —
          approves it, and this is where the list lives. Campaign deliverables keep the gate they
          have (d.6), so nothing appears on them. Whether to OFFER the button is the server's own
          answer (`can_approve_tasks`, amended 12 Sep), the same predicate the RPC raises on — so it
          shows for the owner / in-scope lead and never the account manager. The RPC still decides. */}
      {/* I66.13 (Edward, 29 Sep): the Needs-you cards open this window for campaign pieces too, so the list is
          approved here as well — wherever there is a list to approve (a task that is not cancelled), or to say
          who approved it. A piece with nothing on it has nothing to approve. */}
      {d.streamId !== null && (d.tasksApprovedAt != null || liveTasks.length > 0) && (
        <TaskListApproval
          deliverableId={deliverableId}
          campaignId={d.campaignId}
          departmentId={d.departmentId}
          ownerName={(users.data ?? []).find((u) => u.id === d.ownerUserId)?.name ?? null}
          tasksApprovedAt={d.tasksApprovedAt}
          approverName={(users.data ?? []).find((u) => u.id === d.tasksApprovedBy)?.name ?? null}
          canApprove={d.canApproveTasks}
          onError={(text) => onBanner({ kind: 'error', text })}
        />
      )}
      {/* I66.13: "Close this deliverable" — the archive move (ADR-0080), asked first, for whoever may make it. */}
      {d.streamId !== null && allowedTransitions(d.state, { manage: canManage, review: canReview }).some((tr) => tr.to === 'archived') && (
        <div className="deliverable-close">
          <Button variant="danger" onClick={() => setConfirmClose(true)} data-testid="deliverable-close">
            {t('campaigns.editPiece.close')}
          </Button>
          <span className="field-hint">{t('campaigns.editPiece.closeNote')}</span>
        </div>
      )}
      {confirmClose && (
        <ConfirmDialog
          title={t('campaigns.editPiece.closeTitle')}
          message={t('campaigns.editPiece.closeMessage', { name: d.name })}
          detail={[
            ...(liveTasks.length > 0
              ? [
                  t('deliverables.confirmArchiveTasks', { count: liveTasks.length }),
                  liveTasks.some((x) => x.assigneeName)
                    ? t('deliverables.confirmArchiveAssignees', { names: [...new Set(liveTasks.map((x) => x.assigneeName).filter(Boolean))].join(', ') })
                    : t('deliverables.confirmArchiveUnassigned'),
                ]
              : [t('campaigns.editPiece.closeNothingLive')]),
            t('deliverables.confirmArchiveFinal'),
          ]}
          confirmLabel={t('campaigns.editPiece.closeConfirm')}
          busy={closeDeliverable.isPending}
          onConfirm={() =>
            closeDeliverable.mutate(
              { deliverableId: d.id, to: 'archived', expectedState: d.state },
              {
                onSuccess: () => { setConfirmClose(false); onBanner({ kind: 'ok', text: t('deliverables.closed') }) },
                onError: (err) => { setConfirmClose(false); onBanner(failed(err, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t)) },
              },
            )}
          onCancel={() => setConfirmClose(false)}
          testId="deliverable-close-confirm"
        />
      )}
      </>)}
      {/* I19.8 (ADR-0052 d.11), the first of three levels. Laying a whole task list down at once is
          only safe if the tasks nobody picked up are VISIBLE — otherwise "planned" and "forgotten"
          look identical, which is the failure mode d.5 would otherwise introduce. */}
      {!onlyTaskId && <p className="deliverable-task-count" data-testid="deliverable-unassigned-count">
        {liveTasks.length === 0
          ? null
          : unassignedTasks.length === 0
            ? <span className="muted">{t('deliverables.allAssigned')}</span>
            : (
              <>
                <strong>{t('deliverables.unassignedOf', { unassigned: unassignedTasks.length, total: liveTasks.length })}</strong>
                <Button
                  variant="link"
                  onClick={() => setUnassignedOnly((v) => !v)}
                  data-testid="deliverable-unassigned-filter"
                >
                  {unassignedOnly ? t('deliverables.showAllTasks') : t('deliverables.showUnassignedOnly')}
                </Button>
              </>
            )}
      </p>}
      {shownTasks.length === 0 ? (
        <p className="muted" data-testid="subtasks-empty">{t('deliverables.noSubTasks')}</p>
      ) : (
        <table className="data-table" data-testid="subtasks-table">
          <thead>
            <tr>
              {canReorder && <th aria-label={t('deliverables.colOrder')} />}
              <th>{t('deliverables.subTitle')}</th>
              <th>{t('deliverables.subAssignee')}</th>
              <th>{t('deliverables.subSla')}</th>
              <th>{t('deliverables.subDue')}</th>
              <th>{t('deliverables.subStatusCol')}</th>
              {/* ADR-0059 d.9: on the table, because "why can I not upload here?" must have an
                  answer on screen. */}
              <th>{t('reviewMode.column')}</th>
              {/* ADR-0069 d.6: ONE column for what this task is waiting for — the tasks it depends
                  on AND the deliverable's outstanding external inputs. They are one question. */}
              <th>{t('requirements.column')}</th>
              {(canManage || canReview) && <th aria-label={t('deliverables.colActions')} />}
            </tr>
          </thead>
          <tbody>
            {shownTasks.map((s, i) => (
              <tr key={s.id} data-testid={`subtask-row-${s.id}`} className={s.id === focusTaskId ? 'is-focused' : undefined}>
                {/* ADR-0052 d.14: this moves a number. It does NOT reschedule — no date on this row
                    changes, and the person assigned to it keeps the week they were given. */}
                {canReorder && (
                  <td className="row-reorder">
                    <IconButton icon="arrow-up" label={t('deliverables.moveUp')}
                      disabled={resequence.isPending || i === 0}
                      title={t('deliverables.reorderHint')}
                      onClick={() => onMove(s.id, 'up')}
                      data-testid={`subtask-move-up-${s.id}`}
                     />
                    <IconButton icon="arrow-down" label={t('deliverables.moveDown')}
                      disabled={resequence.isPending || i === shownTasks.length - 1}
                      title={t('deliverables.reorderHint')}
                      onClick={() => onMove(s.id, 'down')}
                      data-testid={`subtask-move-down-${s.id}`}
                     />
                  </td>
                )}
                <td>
                  {editing === s.id ? (
                    <>
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        aria-label={t('deliverables.subTitle')}
                        data-testid={`subtask-edit-title-${s.id}`}
                      />
                      <textarea
                        className="subtask-edit-notes"
                        rows={2}
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        placeholder={t('taskLists.edit.notesHint')}
                        aria-label={t('taskLists.edit.notes')}
                        data-testid={`subtask-edit-notes-${s.id}`}
                      />
                    </>
                  ) : (
                    <>
                      {s.title}
                      {/* I53.15: the project and department on every row (Edward, 20 Sep: "imagine
                          12 projects all with Static Posts"). The title stays "step — deliverable n";
                          the project is context beside it, as My Work and the schedule print it, so
                          a renamed campaign is right everywhere at once. */}
                      {!tasksOnly && (d.campaignName || d.discipline) && (
                        <span className="muted subtask-context" data-testid={`subtask-context-${s.id}`}>
                          {[d.campaignName, d.discipline].filter(Boolean).map((x) => ` · ${x}`).join('')}
                        </span>
                      )}
                      {/* I57.45: the owner's notes for whoever does it. */}
                      {s.description?.trim() && (
                        <div className="muted subtask-notes" data-testid={`subtask-notes-${s.id}`}>{s.description}</div>
                      )}
                    </>
                  )}
                </td>
                <td>{s.assigneeName ?? t('deliverables.unassigned')}</td>
                <td data-testid={`subtask-sla-${s.id}`}>
                  {editing === s.id ? (
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      className="subtask-edit-hours"
                      value={editHours}
                      onChange={(e) => setEditHours(e.target.value)}
                      aria-label={t('deliverables.subSla')}
                      data-testid={`subtask-edit-hours-${s.id}`}
                    />
                  ) : s.slaHours != null
                    ? <span title={t('deliverables.slaManualHint')}>{t('deliverables.slaHoursValue', { hours: s.slaHours })} <span className="muted">· {t('deliverables.slaOverride')}</span></span>
                    : s.slaProfileName != null
                      ? <span>{s.slaProfileName}{s.slaProfileHours != null ? ` · ${t('deliverables.slaHoursValue', { hours: s.slaProfileHours })}` : ''}</span>
                      : <span className="muted" title={t('deliverables.slaFallbackHint')}>{t('deliverables.slaInherited')}</span>}
                </td>
                <td>
                  {editing === s.id ? (
                    <DateField
                     
                      value={editDue}
                      onChange={(v) => setEditDue(v)}
                      aria-label={t('deliverables.subDue')}
                      data-testid={`subtask-edit-due-${s.id}`}
                    />
                  ) : (
                    <>
                      {s.dueAt ? formatIraqDateTime(s.dueAt) : '—'}
                      {/* ADR-0088 d.1: the plan and the commitment, both, when they disagree. */}
                      {s.committedDueAt && s.dueAt && iraqDay(s.committedDueAt) !== iraqDay(s.dueAt) && (
                        <div className="cell-warn" data-testid={`subtask-committed-${s.id}`}>
                          {t('deadlineExtension.committed', { date: formatIraqDate(s.committedDueAt) })}
                        </div>
                      )}
                      {/* ADR-0088 d.10: the ask sits beside the date; the answer lands here too. */}
                      {s.status !== 'done' && s.status !== 'cancelled' && s.assigneeId && (
                        <ExtensionControl
                          subTaskId={s.id}
                          taskTitle={s.title}
                          latest={extensions.data?.get(s.id)}
                          canRequest={canManage || s.assigneeId === myUserId}
                          viewerId={myUserId}
                          committedDueAt={s.committedDueAt}
                          deliverableDueAt={d.dueAt}
                          goLiveAt={d.goLiveAt}
                          showDecision
                          testId={`subtask-extension-${s.id}`}
                        />
                      )}
                    </>
                  )}
                </td>
                <td>
                  {/* I52.11 (Edward, 17 Sep): the task's status, coloured like every other badge —
                      "Not started" orange so an unstarted task is visible, not neutral. */}
                  <span className={`state-badge state-${s.status}`} data-testid={`subtask-status-${s.id}`}>
                    {t(`deliverables.subStatus.${s.status}`)}
                  </span>
                  {s.scheduleOverridden && <span className="muted" title={t('deliverables.overriddenHint')}> · {t('deliverables.overridden')}</span>}
                  {pendingRequests.data?.get(s.id) && (
                    <span className="muted" data-testid={`subtask-awaiting-approval-${s.id}`}>
                      {' · '}
                      {t('deliverables.awaitingApproval', { department: pendingRequests.data.get(s.id)?.departmentName ?? '' })}
                    </span>
                  )}
                  {/* ADR-0043 d.8: a task in review says WHO it is waiting for, mandatory ones
                      marked. With one reviewer that name was obvious; with three, "who is holding
                      this up?" had no answer on screen and a task could sit for a week. */}
                  {/* Mandatory only (I40.22): this is a tracking surface, and an optional reviewer
                      does not block the work. */}
                  {s.status === 'review' && (
                    <div><WaitingOn reviewers={s.reviewers} blockingOnly testId={`subtask-waiting-on-${s.id}`} /></div>
                  )}
                </td>
                <td data-testid={`subtask-review-mode-${s.id}`}>
                  {editing === s.id ? (
                    <select
                      value={editReviewMode}
                      onChange={(e) => setEditReviewMode(e.target.value as ReviewMode)}
                      aria-label={t('reviewMode.column')}
                      data-testid={`subtask-edit-review-mode-${s.id}`}
                    >
                      {REVIEW_MODES.map((m) => (
                        <option key={m} value={m}>{t(reviewModeLabelKey(m))}</option>
                      ))}
                    </select>
                  ) : (
                    t(reviewModeLabelKey(s.reviewMode))
                  )}
                </td>
                <td>
                  <RequiredInput
                    subTaskId={s.id}
                    deliverableId={deliverableId}
                    dependencies={dependencies.data ?? NO_DEPENDENCIES}
                    candidates={candidates.data ?? NO_CANDIDATES}
                    externalInputs={outstandingInputs}
                    canManage={canManage}
                  />
                </td>
                {(canManage || canReview) && (
                  <td className="row-actions">
                    {/* I19.9 (ADR-0052 d.12): retitle and re-date, before AND after approval —
                        before approval this is what the Account Manager is reviewing; after it,
                        this is how a job changes, which jobs do. Re-dating DOES reschedule: a date
                        is the commitment, and moving it is the point. Reordering does not. */}
                    {canManage && editing === s.id && (
                      <>
                        <Button
                          variant="primary" size="sm"
                          disabled={upsert.isPending || !editTitle.trim()}
                          onClick={() => onSaveEdit(s.id)}
                          data-testid={`subtask-edit-save-${s.id}`}
                        >
                          {t('common.save')}
                        </Button>
                        <Button
                          variant="secondary" size="sm"
                          onClick={() => setEditing(null)}
                          data-testid={`subtask-edit-cancel-${s.id}`}
                        >
                          {t('common.cancel')}
                        </Button>
                      </>
                    )}
                    {/* I52.12: the task's own review — its versions (digital) or the maker's account
                        (manual), and the reviewer's actions when it is their turn. */}
                    {/* Edward, 27 Sep: always shown, but greyed out until there is something to look at
                        — a version handed in (in review, or sent back at least once) or a finished
                        task, which can be re-opened (ADR-0103). A not-started task opened onto "No
                        versions yet", a dead end. */}
                    {s.status !== 'cancelled' && (() => {
                      const reviewable = s.status === 'review' || s.status === 'done' || (s.revisionRound ?? 0) > 0
                      return (
                        <Button
                          variant="link" size="sm"
                          disabled={!reviewable}
                          title={reviewable ? undefined : t('deliverables.openReviewNothingYet')}
                          onClick={() => setReviewing(s)}
                          data-testid={`subtask-review-open-${s.id}`}
                        >
                          {t('deliverables.openReview')}
                        </Button>
                      )
                    })()}
                    {/* ADR-0103 d.2: an approved task goes back to its maker and reviewers. */}
                    {canManage && s.status === 'done' && (
                      <Button
                        variant="secondary" size="sm" icon="undo"
                        onClick={() => setReopening(s)}
                        data-testid={`subtask-reopen-${s.id}`}
                      >
                        {t('reopen.action')}
                      </Button>
                    )}
                    {canManage && editing !== s.id && (
                      <IconButton
                        icon="edit"
                        size="sm"
                        label={t('deliverables.editTask')}
                        onClick={() => {
                          setEditing(s.id)
                          setEditTitle(s.title)
                          // A <input type="date"> wants a plain day, and it must be the day the
                          // reader sees — the Iraq one (ADR-0076 d.6).
                          setEditDue(s.dueAt ? iraqDay(s.dueAt) : '')
                          setEditReviewMode(s.reviewMode)
                          setEditHours(s.slaHours != null ? String(s.slaHours) : '')
                          setEditNotes(s.description ?? '')
                        }}
                        data-testid={`subtask-edit-${s.id}`}
                      />
                    )}
                    {canReview && s.status === 'review' && (
                      <Button variant="secondary" tone="caution" size="sm" icon="undo" disabled={requestChanges.isPending} onClick={() => onRequestChanges(s.id)} data-testid={`subtask-request-changes-${s.id}`}>
                        {t('deliverables.action.requestChanges')}
                      </Button>
                    )}
                    {/* ADR-0068 d.1: never straight from the click. What it costs is fetched
                        first, because the wording depends on it (d.2/d.3). */}
                    {canManage && s.status !== 'cancelled' && (
                      <Button
                        variant="link" className="danger"
                        disabled={cancelTask.isPending}
                        onClick={() => void armCancel(s)}
                        data-testid={`subtask-cancel-${s.id}`}
                      >
                        {t('deliverables.cancelTask')}
                      </Button>
                    )}
                    {/* ADR-0068 d.4. Only where there is something to undo. */}
                    {canManage && s.status === 'cancelled' && (
                      <Button
                        variant="secondary" size="sm" icon="undo"
                        onClick={() => setPendingReinstate(s)}
                        data-testid={`subtask-reinstate-${s.id}`}
                      >
                        {t('deliverables.reinstateTask')}
                      </Button>
                    )}
                    {/* ADR-0052 d.13. Removing a task somebody is ON also destroys their booking —
                        `bookings.sub_task_id` is `on delete cascade` — so it asks first, by name.
                        A task nobody was ever given goes without a dialog: there is nothing to
                        interrupt and nobody to surprise. */}
                    {canManage && (
                      <IconButton
                        icon="trash"
                        danger
                        size="sm"
                        label={t('deliverables.remove')}
                        disabled={removeTask.isPending}
                        onClick={() => {
                          if (s.assigneeId) {
                            const ok = window.confirm(
                              t('deliverables.removeAssignedWarn', { name: s.assigneeName ?? '' }),
                            )
                            if (!ok) return
                          }
                          removeTask.mutate(s.id, {
                            onSuccess: (how) =>
                              onBanner({
                                kind: 'ok',
                                text: how === 'deleted'
                                  ? t('deliverables.removedDeleted')
                                  : t('deliverables.removedCancelled'),
                              }),
                            onError: (err) =>
                              onBanner(failed(err, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t)),
                          })
                        }}
                        data-testid={`subtask-remove-${s.id}`}
                      />
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ADR-0069 d.7: registered on the DELIVERABLE and cascading to its tasks, so it sits under
          the table rather than inside it. Every task's Required input cell shows these; this is
          where one is raised and cleared. */}
      {!onlyTaskId && (
      <ExternalInputs
        deliverableId={deliverableId}
        inputs={pendingInputs.data ?? NO_INPUTS}
        canManage={canManage}
      />
      )}

      {/* ADR-0068 d.2/d.3: what is lost, in numbers, before anything happens. */}
      {pendingReinstate && (
          <ReinstateDialog
            task={pendingReinstate}
            users={users.data ?? []}
            reviewerOptions={reviewerOptions.data ?? []}
            onDone={onReinstated}
            onFailed={(err) => onBanner(failed(err, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t))}
            onClose={() => setPendingReinstate(null)}
          />
        )}
        {reopening && (
          <ReopenDialog
            deliverableId={deliverableId}
            deliverableName={d.name}
            taskId={reopening.id}
            onDone={(r) => onBanner({ kind: 'ok', text: reopenDoneText(t, r) })}
            onFailed={(err) => onBanner(failed(err, t('reopen.failed'), t('reopen.outsideReach'), t))}
            onClose={() => setReopening(null)}
          />
        )}
        {pendingCancel && (
        <ConfirmDialog
          title={t(pendingCancel.isPlan ? 'deliverables.confirmRemoveTitle' : 'deliverables.confirmCancelTitle')}
          message={t(
            pendingCancel.isPlan ? 'deliverables.confirmRemoveBody' : 'deliverables.confirmCancelBody',
            { title: pendingCancel.title },
          )}
          detail={
            pendingCancel.isPlan
              ? // Nothing is lost: unassigned, never started, never worked on. Saying so is what
                // stops this dialog becoming one people click through everywhere.
                [t('deliverables.confirmRemoveNothingLost')]
              : [
                  pendingCancel.assigneeName
                    ? t('deliverables.confirmCancelAssignee', { name: pendingCancel.assigneeName })
                    : t('deliverables.confirmCancelUnassigned'),
                  pendingCancel.dueAt
                    ? t('deliverables.confirmCancelDue', { date: formatIraqDateTime(pendingCancel.dueAt) })
                    : t('deliverables.confirmCancelNoDue'),
                  t('deliverables.confirmCancelBookings', { n: pendingCancel.bookings }),
                  // The promise has to match what the system can actually do: ad-hoc work is archived
                  // by its own cancellation (ADR-0061 d.6) and `archived` is terminal (ADR-0024), so it
                  // must not be offered an undo that does not exist.
                  t(
                    pendingCancel.isAdhoc
                      ? 'deliverables.confirmCancelAdhocFinal'
                      : 'deliverables.confirmCancelUndo',
                  ),
                ]
          }
          confirmLabel={t(pendingCancel.isPlan ? 'deliverables.remove' : 'deliverables.cancelTask')}
          busy={cancelTask.isPending || removeTask.isPending}
          onConfirm={onConfirmCancel}
          onCancel={() => setPendingCancel(null)}
          testId="subtask-cancel-confirm"
        />
      )}

      {/* ADR-0141 d.2: the save moved the task past the piece's due date — the one form to the account manager,
          filled in with the day just saved. Closing it is the ordinary answer; the move already stands. */}
      {offer && (
        <ChangeAskDialog
          deliverableId={d.id}
          fromSubTaskId={offer.subTaskId}
          initialDueDay={offer.day}
          onClose={() => setOffer(null)}
          testId={`subtask-change-ask-${offer.subTaskId}`}
        />
      )}

      {/* I51.5: a button and a dialog, not an eight-field row. The task name is the only required
          field; the dialog says which of the rest are optional. */}
      {canManage && !onlyTaskId && (
        <div className="org-add-form">
          <Button variant="primary" icon="plus" onClick={() => setAdding(true)} data-testid="subtask-add-open">
            {t('deliverables.addSubTask')}
          </Button>
        </div>
      )}
      {adding && (
        <AddSubTaskDialog
          deliverableId={deliverableId}
          users={users.data ?? []}
          reviewerOptions={reviewerOptions.data ?? []}
          slaProfiles={slaProfiles.data ?? []}
          onSaved={(r) => onBanner(r.scheduleWarning ? { kind: 'error', text: translateScheduleWarning(t, r.scheduleWarning)! } : { kind: 'ok', text: t('deliverables.subSaved') })}
          onFailed={(err) => onBanner(failed(err, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t))}
          onClose={() => setAdding(false)}
        />
      )}

      {/* ADR-0058 d.1: nothing is uploaded to a deliverable, and — I52.12 (Edward, 17 Sep) — nothing
          is REVIEWED at deliverable level either: the panel that used to sit here listed every
          task's versions with no task named, so nobody could tell whose v1 they were looking at. The
          review is opened from the task's row. */}
      {reviewing && (
        <Modal onClose={() => setReviewing(null)} card={false} testId={`subtask-review-modal-${reviewing.id}`}>
          <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-label={reviewing.title}>
            <h2>{reviewing.title}</h2>
            <p className="muted">
              {t('awaitingReview.by', { name: reviewing.assigneeName ?? '—' })}
              {' · '}
              <span className={`state-badge state-${reviewing.status}`}>{t(`deliverables.subStatus.${reviewing.status}`)}</span>
            </p>
            {reviewing.reviewMode === 'manual' ? (
              <TaskReviewThread subTaskId={reviewing.id} role={canReview ? 'reviewer' : 'maker'} />
            ) : (
              // ADR-0112 d.1 (I59.29): the rules the piece follows, beside the file it is judged on.
              <ReviewPanel deliverableId={deliverableId} subTaskId={reviewing.id} isReadOnly={!canReview || reviewing.status !== 'review'} allowUpload={false} showRules />
            )}
            <div className="dialog-actions">
              <Button variant="secondary" onClick={() => setReviewing(null)} data-testid={`subtask-review-close-${reviewing.id}`}>
                {t('awaitingReview.close')}
              </Button>
            </div>
            {canReview && reviewing.status === 'review' && (
              <ReviewActions
                subTaskId={reviewing.id}
                reviewers={reviewing.reviewers ?? []}
                onSettled={() => setReviewing(null)}
                testIdPrefix="subtask-review"
              />
            )}
          </div>
        </Modal>
      )}
      {!tasksOnly && <ChatPanel contextType="deliverable" contextId={deliverableId} />}
    </section>
  )
}
