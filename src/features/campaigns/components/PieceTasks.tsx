import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../../app/auth-context'
import { usePermissions } from '../../../app/permissions'
import { Button, IconButton } from '../../../components/Button'
import { namedRefusal, refusalSentence } from '../../../lib/errors/classify'
import { usePendingAssignmentRequestsForTasks } from '../../../lib/assignment-requests/api'
import { endOfWorkingDay, formatIraqShortDate, iraqDay } from '../../../lib/time/iraq'
import { useApproveDeliverableTasks, useRemoveSubTask, useReviewers, useUpsertSubTask } from '../../deliverables/api/deliverables-api'
import { useTaskDependencies } from '../../deliverables/api/requirements-api'
import { saveTask, useAskAnotherTeam, usePieceTaskList, type EditableTask } from '../../deliverables/api/task-editor-api'
import { TaskEditorDialog, WaitsForPicker } from '../../deliverables/components/TaskEditor'
import { useWaitsWords } from '../../deliverables/hooks/use-waits-words'
import { DEFAULT_TASK_HOURS, changesOf, draftOf, mayEditTasks, stepHours, taskRefusal, type TaskDraft } from '../../deliverables/lib/task-edit'
import { failed, type Banner } from '../../deliverables/DeliverablesPage'
// The Schedule's own pickers and day words (ADR-0140 d.4), used as they are.
import { Avatar } from '../../schedule/components/Avatar'
import { DatesPicker } from '../../schedule/components/DatesPicker'
import { PeoplePicker } from '../../schedule/components/PeoplePicker'
import { Popover } from '../../schedule/components/Popover'
import { sundayOfIso, usePeopleWeek, type PlannedHours } from '../../schedule/hooks/use-people-week'
import { usePieceWorkflow } from '../../schedule/api/book-api'
import { isAcceptableTaskName } from '../../schedule/lib/book-plan.ts'
import { dayLong, dayRange } from '../../schedule/lib/day-words.ts'
import { ChangeAskDialog } from './ChangeAskDialog'

/** What a row would book, before Save (CP-04, CP-12). */
interface Staged { hours?: number; assigneeId?: string | null; from?: string | null; to?: string | null }

type Open =
  | { kind: 'who' | 'dates' | 'waits'; id: string; anchor: HTMLElement }
  | { kind: 'bulkWho' | 'bulkDay'; anchor: HTMLElement }

const UNDO_MS = 8000

/**
 * **The piece's tasks, on the campaign page** (ADR-0140 d.1, d.4, d.5; I74.7, I74.10–I74.12; Figma N CP-01…CP-05,
 * CP-10…CP-12; mock-up 4). One list, two moments:
 *
 *  - **before approval** (CP-01…CP-03) it is the suggested list: rename, hours, what each waits for, remove with
 *    undo, add your own (≥3 letters), then "Approve N tasks" — the existing approval. Nobody is given the work yet.
 *  - **once approved** (CP-04, CP-05) each row has Who and Dates, the Schedule's own pickers with free hours and
 *    "Ask another team…"; ticking rows gives them to one person on one day with the hours checked (CP-10…CP-12).
 *    The same booking rules hold (ADR-0139): within your reach it books, outside it it asks — the server decides.
 *
 * Every row carries a pencil (Edit — the one task editor) beside the ✕ (delete); a started task shows 🔒 instead of
 * ✕ (ADR-0140 d.3). Who and Dates are offered to those who book (`bookings:create`) — not on `project_tasks:manage`,
 * which team members hold: they see the rows read-only.
 */
export function PieceTasks({
  deliverableId,
  markTaskId,
  onBanner,
  embedded = false,
  testId = 'piece-tasks',
}: {
  deliverableId: string
  markTaskId: string | null
  onBanner: (b: Banner) => void
  /** inside "Task lists to approve" (the Grid tab), whose row carries the banner's words and its own Approve */
  embedded?: boolean
  testId?: string
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const { can, scope } = usePermissions()
  const { session, claims } = useAuth()
  const myId = session?.user.id ?? null
  const list = usePieceTaskList(deliverableId)
  const deps = useTaskDependencies(deliverableId)
  const workflow = usePieceWorkflow(deliverableId)
  const reviewerOptions = useReviewers()
  const approve = useApproveDeliverableTasks()
  const remove = useRemoveSubTask()
  const upsert = useUpsertSubTask()
  const ask = useAskAnotherTeam()
  const today = iraqDay(Date.now())

  const piece = list.data?.piece ?? null
  const allTasks = useMemo(() => list.data?.tasks ?? [], [list.data])
  const edges = useMemo(() => deps.data ?? [], [deps.data])
  const approved = piece?.tasksApprovedAt != null
  const isOwner = !!myId && piece?.ownerUserId === myId
  // ADR-0140 d.2: the owner edits every task on the piece; Traffic and the Power Admin every task; a lead who books
  // edits within reach (the server decides). A team member holds project_tasks:manage but books nobody: read-only.
  const mayEdit = mayEditTasks({ isOwner, scope, can })
  const mayBook = approved && can('bookings:create')
  // I74.51: Approve is offered to exactly whom the server admits — the owner, the department's leads and deputy
  // leads, Traffic and the Power Admin — never the account manager. The server's own answer, not a guess from grants.
  const mayApprove = piece?.canApproveTasks === true

  const [staged, setStaged] = useState<Map<string, Staged>>(new Map())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkPerson, setBulkPerson] = useState<string | null>(null)
  const [bulkDay, setBulkDay] = useState<string | null>(null)
  const [open, setOpen] = useState<Open | null>(null)
  const [editing, setEditing] = useState<{ taskId: string | null; all: boolean } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ task: EditableTask; waiting: number } | null>(null)
  const [askRemove, setAskRemove] = useState<EditableTask | null>(null)
  const [startedAsk, setStartedAsk] = useState<Map<string, string>>(new Map())
  const [rowErrors, setRowErrors] = useState<Map<string, string>>(new Map())
  const [reviewerId, setReviewerId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [changeAsk, setChangeAsk] = useState<{ taskId: string; day: string } | null>(null)
  const pendingRemove = useRef<{ id: string; timer: number } | null>(null)

  const tasks = useMemo(() => allTasks.filter((x) => x.id !== removing?.task.id), [allTasks, removing])
  const pending = usePendingAssignmentRequestsForTasks(allTasks.map((x) => x.id))
  const sunday = sundayOfIso(today)
  const planned: PlannedHours[] = useMemo(() => [...staged.entries()].flatMap(([id, s]) => {
    const task = allTasks.find((x) => x.id === id)
    const hours = s.hours ?? task?.hours ?? 0
    const from = s.from ?? null
    const to = s.to ?? null
    return s.assigneeId && from && to ? [{ key: id, resourceId: s.assigneeId, from, to, hours }] : []
  }), [staged, allTasks])
  const people = usePeopleWeek(sunday)
  // `planned` carries user ids; the loads are per calendar — translated here.
  const plannedByRes: PlannedHours[] = useMemo(
    () => planned.flatMap((p) => { const r = people.resByUser.get(p.resourceId); return r ? [{ ...p, resourceId: r.id }] : [] }),
    [planned, people.resByUser],
  )
  const withPlan = usePeopleWeek(sunday, plannedByRes)

  const say = useCallback((e: unknown) => {
    const x = e as { code?: string; message?: string }
    return namedRefusal(e, t) ?? refusalSentence(x) ?? (x.code === '22023' ? x.message : null) ?? t('campaigns.assign.failed')
  }, [t])
  // A failure in the banner (I74.55, Edward 5 Oct, A): a refusal says why in the reader's words — never "Try again" —
  // and anything unexpected offers Report with its cause (ADR-0092 d.3), as the rest of the campaign page does.
  const fail = useCallback((e: unknown): Banner => {
    const named = namedRefusal(e, t)
    return named ? { kind: 'error', text: named, reportable: false } : failed(e, t('campaigns.assign.failed'), t('deliverables.outsideReach'), t)
  }, [t])

  // ---- removal with undo (SC-16 / CP-02): the row goes at once; the remove is sent when the undo has passed --------
  const commitRemove = useCallback(() => {
    const p = pendingRemove.current
    if (!p) return
    window.clearTimeout(p.timer)
    pendingRemove.current = null
    remove.mutate(p.id, { onError: (e) => onBanner(fail(e)), onSettled: () => setRemoving(null) })
  }, [remove, onBanner, fail])
  // On leaving the panel, a removal still in its undo is sent — once, on unmount (the mutation object changes every
  // render, so a cleanup keyed on it would send at once).
  const commitRef = useRef(commitRemove)
  useEffect(() => { commitRef.current = commitRemove }, [commitRemove])
  useEffect(() => () => commitRef.current(), [])

  function removeUnbooked(task: EditableTask) {
    commitRemove()
    const waiting = edges.filter((e) => e.prerequisiteId === task.id).length
    setRemoving({ task, waiting })
    pendingRemove.current = { id: task.id, timer: window.setTimeout(commitRemove, UNDO_MS) }
  }
  function undoRemove() {
    const p = pendingRemove.current
    if (p) window.clearTimeout(p.timer)
    pendingRemove.current = null
    setRemoving(null)
  }

  // ---- edits saved as you go on the suggested list (CP-02) ----------------------------------------------------------
  async function saveNow(task: EditableTask, patch: Partial<TaskDraft>) {
    const before = draftOf(task, edges)
    try {
      await saveTask({ subTaskId: task.id, deliverableId, before, draft: { ...before, ...patch }, span: null, confirmStarted: false, edges, tenantId: claims.tenantId ?? null })
      setRowErrors((m) => { const n = new Map(m); n.delete(task.id); return n })
    } catch (e) {
      setRowErrors((m) => new Map(m).set(task.id, say(e)))
    } finally {
      void list.refetch()
      void deps.refetch()
    }
  }

  function addTask() {
    const title = (adding ?? '').trim()
    if (!isAcceptableTaskName(title)) return
    upsert.mutate(
      {
        deliverableId,
        title,
        slaHours: DEFAULT_TASK_HOURS,
        // The piece's own due day, at close of business (ADR-0076 d.3) — a task added here is due with its piece.
        dueAt: piece?.dueAt ? endOfWorkingDay(iraqDay(piece.dueAt)).toISOString() : null,
        materialise: false,
      },
      { onSuccess: () => setAdding(null), onError: (e) => onBanner(fail(e)) },
    )
  }

  // ---- the booking half (CP-04, CP-10…CP-12) -------------------------------------------------------------------------
  const stage = (id: string, s: Staged) => setStaged((m) => new Map(m).set(id, { ...m.get(id), ...s }))
  const view = (task: EditableTask) => {
    const s = staged.get(task.id)
    return {
      hours: s?.hours ?? task.hours,
      assigneeId: s && 'assigneeId' in s ? (s.assigneeId ?? null) : task.assigneeId,
      from: s && 'from' in s ? (s.from ?? null) : (task.startsAt ? iraqDay(task.startsAt) : null),
      to: s && 'to' in s ? (s.to ?? null) : (task.dueAt ? iraqDay(task.dueAt) : null),
    }
  }
  const changedRows = tasks.filter((x) => {
    const before = draftOf(x, edges)
    const v = view(x)
    const c = changesOf(before, { ...before, ...v })
    return c.hours || c.person || c.days
  })
  const needsReviewer = changedRows.some((x) => view(x).assigneeId && x.reviewers.length === 0)
  // The "Checked by" pick shows for any task nobody is named to check, not only a staged booking — an ask to
  // another team needs it too (20261003180000), and the ask is sent from the Who picker with nothing staged.
  const someWithoutReviewer = tasks.some((x) => x.reviewers.length === 0 && x.status !== 'done' && x.status !== 'cancelled')
  const booking = changedRows.filter((x) => view(x).assigneeId && (!x.assigneeId || view(x).assigneeId !== x.assigneeId)).length

  async function saveRows(confirm: ReadonlySet<string> = new Set()) {
    if (needsReviewer && !reviewerId) { onBanner({ kind: 'error', text: t('campaigns.assign.pickReviewer') }); return }
    setBusy(true)
    const errors = new Map<string, string>()
    const asks = new Map<string, string>()
    let booked = 0
    let requested = 0
    let pastDue: { taskId: string; day: string } | null = null
    const dueIso = piece?.dueAt ? iraqDay(piece.dueAt) : null
    for (const task of changedRows) {
      const before = draftOf(task, edges)
      const v = view(task)
      const draft: TaskDraft = {
        ...before,
        ...v,
        reviewers: before.reviewers.length > 0 || !v.assigneeId ? before.reviewers : [{ userId: reviewerId, isMandatory: true }],
      }
      const moved = v.assigneeId !== before.assigneeId || v.from !== before.from || v.to !== before.to
      if (moved && v.assigneeId && (!v.from || !v.to)) { errors.set(task.id, t('campaigns.assign.needsDates')); continue }
      const res = v.assigneeId ? people.resByUser.get(v.assigneeId) : undefined
      const span = res && v.from && v.to ? people.spanFor(res.id, v.from, v.to, v.hours ?? 0) : null
      try {
        const r = await saveTask({ subTaskId: task.id, deliverableId, before, draft, span, confirmStarted: confirm.has(task.id), edges, tenantId: claims.tenantId ?? null })
        if (r.outcome === 'requested') requested += 1
        else if (v.assigneeId) booked += 1
        if (r.scheduleWarning) errors.set(task.id, t('schedule.sc.book.unscheduled', { task: task.title }))
        setStaged((m) => { const n = new Map(m); n.delete(task.id); return n })
        if (dueIso && v.to && v.to > dueIso && v.to !== before.to && !pastDue) pastDue = { taskId: task.id, day: v.to }
      } catch (e) {
        const refusal = taskRefusal(e)
        if (refusal?.kind === 'started') asks.set(task.id, refusal.name || (task.assigneeName ?? ''))
        else errors.set(task.id, say(e))
      }
    }
    setBusy(false)
    setRowErrors(errors)
    setStartedAsk(asks)
    void list.refetch()
    void pending.refetch()
    if (errors.size === 0 && asks.size === 0) {
      setSelected(new Set())
      setBulkPerson(null)
      setBulkDay(null)
      onBanner({ kind: 'ok', text: requested > 0 ? t('campaigns.assign.savedAsked', { count: booked, asked: requested }) : t('campaigns.assign.saved', { count: booked }) })
    }
    if (pastDue) setChangeAsk(pastDue)
  }

  function keepRow(task: EditableTask) {
    setStaged((m) => { const n = new Map(m); n.delete(task.id); return n })
    setStartedAsk((m) => { const n = new Map(m); n.delete(task.id); return n })
  }

  function applyBulk() {
    for (const id of selected) stage(id, { ...(bulkPerson ? { assigneeId: bulkPerson } : {}), ...(bulkDay ? { from: bulkDay, to: bulkDay } : {}) })
  }

  /** CP-12: what the ticked rows put on the person's day — "8h for Zubaida on Thu 1 Oct — exactly a full day." */
  const bulkLine = useMemo(() => {
    if (!bulkPerson || !bulkDay) return null
    const res = people.resByUser.get(bulkPerson)
    if (!res) return null
    const ticked = [...selected].filter((id) => { const s = staged.get(id); return s?.assigneeId === bulkPerson && s.from === bulkDay })
    if (ticked.length === 0) return null
    const hours = ticked.reduce((n, id) => n + (staged.get(id)?.hours ?? allTasks.find((x) => x.id === id)?.hours ?? 0), 0)
    const load = withPlan.loadOn(res.id, bulkDay)
    const first = res.name
    const day = dayLong(bulkDay, lang)
    if (!load) return null
    if (load.state === 'over') return { tone: 'bad', text: t('campaigns.assign.bulkOver', { hours, name: first, day, over: load.overHours }) }
    if (load.state === 'full') return { tone: 'ok', text: t('campaigns.assign.bulkFull', { hours, name: first, day }) }
    if (load.state === 'leave' || load.state === 'off') return { tone: 'bad', text: t('campaigns.assign.bulkOff', { name: first, day }) }
    return { tone: 'ok', text: t('campaigns.assign.bulkFree', { hours, name: first, day, free: load.freeHours }) }
  }, [bulkPerson, bulkDay, selected, staged, allTasks, people.resByUser, withPlan, lang, t])

  const waitsWords = useWaitsWords()
  if (list.isLoading || !piece) return <p className="muted" data-testid={`${testId}-loading`}>{t('campaigns.assign.loading')}</p>

  const nameOfUser = (uid: string | null, fallback: string | null) => (uid ? (people.resByUser.get(uid)?.name ?? fallback ?? '') : '')
  const hoursTotal = Math.round(tasks.reduce((n, x) => n + (x.hours ?? 0), 0) * 10) / 10
  const withPerson = tasks.filter((x) => x.assigneeId).length
  const workflowName = (lang === 'ar' ? workflow.data?.nameAr : null) ?? workflow.data?.name ?? null
  const allTicked = tasks.length > 0 && tasks.every((x) => selected.has(x.id))
  const status = (task: EditableTask): { key: string; tone: string; label: string } => {
    const asked = pending.data?.get(task.id)
    if (!approved) return task.fromWorkflow
      ? { key: 'suggested', tone: 'quiet', label: t('campaigns.assign.status.suggested') }
      : { key: 'notBooked', tone: 'bad', label: t('campaigns.assign.status.notBooked') }
    if (asked) {
      // An ask naming only a team says which team (ADR-0139): "Asked Copy".
      const name = asked.resourceName || asked.teamName || ''
      return { key: 'asked', tone: 'warn', label: name ? t('campaigns.assign.status.asked', { name }) : t('campaigns.assign.status.askedAny') }
    }
    switch (task.status) {
      case 'in_progress': return { key: 'inProgress', tone: 'ok', label: t('campaigns.assign.status.inProgress') }
      case 'review': return { key: 'review', tone: 'accent', label: t('campaigns.assign.status.review') }
      case 'done': return { key: 'done', tone: 'ok', label: t('campaigns.assign.status.done') }
      default: return task.assigneeId
        ? { key: 'booked', tone: 'accent', label: t('campaigns.assign.status.booked') }
        : { key: 'notBooked', tone: 'bad', label: t('campaigns.assign.status.notBooked') }
    }
  }

  const banner = !approved
    ? { tone: 'suggested', title: t('campaigns.assign.suggestedTitle'), text: tasks.some((x) => !x.fromWorkflow) && tasks.some((x) => x.fromWorkflow)
        ? t('campaigns.assign.suggestedMixed', { suggested: tasks.filter((x) => x.fromWorkflow).length, own: tasks.filter((x) => !x.fromWorkflow).length, hours: hoursTotal })
        : workflowName
        ? t('campaigns.assign.suggestedText', { count: tasks.length, workflow: workflowName, hours: hoursTotal })
        : t('campaigns.assign.suggestedTextNoWorkflow', { count: tasks.length, hours: hoursTotal }) }
    : withPerson === tasks.length && tasks.length > 0
      ? { tone: 'approved', title: t('campaigns.assign.allBookedTitle'), text: t('campaigns.assign.allBookedText', { count: tasks.length }) }
      : { tone: 'approved', title: t('campaigns.assign.approvedTitle', { date: formatIraqShortDate(piece.tasksApprovedAt!) }),
          text: mayBook ? t('campaigns.assign.approvedText', { n: withPerson, count: tasks.length }) : t('campaigns.assign.approvedReadOnly', { n: withPerson, count: tasks.length }) }

  return (
    <section className="pt" data-testid={testId}>
      {!embedded && (
        <div className={`pt-banner is-${banner.tone}`} data-testid={`${testId}-banner`}>
          <p className="pt-banner-title">{banner.title}</p>
          <p className="pt-banner-text">{banner.text}</p>
        </div>
      )}

      <div className="pt-head-line">
        <h3 className="piece-section-title">{t('campaigns.assign.tasks', { count: tasks.length })}</h3>
        {mayEdit && tasks.length > 1 && (
          <Button variant="link" size="sm" onClick={() => setEditing({ taskId: null, all: true })} data-testid={`${testId}-edit-all`}>
            {t('campaigns.assign.editAll')}
          </Button>
        )}
      </div>

      <div className={`pt-rows${approved ? ' is-approved' : ''}${mayBook ? ' can-book' : ''}`}>
        <div className="pt-row pt-thead" aria-hidden="true">
          {mayBook ? (
            <input type="checkbox" checked={allTicked} aria-label={t('campaigns.assign.selectAll')} tabIndex={-1}
              onChange={() => setSelected(allTicked ? new Set() : new Set(tasks.map((x) => x.id)))} data-testid={`${testId}-select-all`} />
          ) : <span />}
          <span>{t('campaigns.assign.col.task')}</span>
          <span>{t('campaigns.assign.col.hours')}</span>
          {approved && <span>{t('campaigns.assign.col.who')}</span>}
          {approved && <span>{t('campaigns.assign.col.dates')}</span>}
          <span>{t('campaigns.assign.col.status')}</span>
          <span />
        </div>

        {mayBook && selected.size > 0 && (
          <div className="sc-bulk" data-testid={`${testId}-bulk`}>
            <strong>{t('schedule.sc.bulk.selected', { count: selected.size })}</strong>
            <span className="sc-bulk-sep" />
            <span>{t('schedule.sc.bulk.giveTo')}</span>
            <button type="button" className="sc-bulk-pick" onClick={(e) => setOpen({ kind: 'bulkWho', anchor: e.currentTarget })} data-testid={`${testId}-bulk-who`}>
              {bulkPerson ? nameOfUser(bulkPerson, null) : t('schedule.sc.bulk.pickPerson')} ▾
            </button>
            <span>{t('schedule.sc.bulk.on')}</span>
            <button type="button" className="sc-bulk-pick" onClick={(e) => setOpen({ kind: 'bulkDay', anchor: e.currentTarget })} data-testid={`${testId}-bulk-day`}>
              {bulkDay ? dayLong(bulkDay, lang) : t('schedule.sc.bulk.pickDay')} ▾
            </button>
            <span className="sc-grow" />
            <Button variant="primary" size="sm" disabled={!bulkPerson && !bulkDay} onClick={applyBulk} data-testid={`${testId}-bulk-apply`}>
              {t('schedule.sc.bulk.apply', { count: selected.size })}
            </Button>
            <button type="button" className="sc-bulk-clear" onClick={() => { setSelected(new Set()); setBulkPerson(null); setBulkDay(null) }} data-testid={`${testId}-bulk-clear`}>
              {t('schedule.sc.bulk.clear')}
            </button>
          </div>
        )}

        {tasks.map((task, i) => {
          const v = view(task)
          const st = status(task)
          const marked = task.id === markTaskId
          const waitTitles = edges.filter((e) => e.subTaskId === task.id).map((e) => e.prerequisiteTitle)
          const asked = pending.data?.get(task.id) ?? null
          const res = v.assigneeId ? people.resByUser.get(v.assigneeId) : undefined
          const who = nameOfUser(v.assigneeId, v.assigneeId === task.assigneeId ? task.assigneeName : null)
          const free = res ? withPlan.people.find((p) => p.resource.id === res.id)?.freeHours ?? null : null
          const isStaged = staged.has(task.id)
          const dueIso = piece.dueAt ? iraqDay(piece.dueAt) : null
          const late = !!(v.to && dueIso && v.to > dueIso)
          const rowAsk = startedAsk.get(task.id)
          const rowError = rowErrors.get(task.id)
          const isRenaming = renaming?.id === task.id
          return (
            <div key={task.id}
              className={`sc-tblock pt-block${marked ? ' is-marked' : ''}${isStaged ? ' is-staged' : ''}${rowAsk || rowError ? ' is-bad' : ''}${isRenaming ? ' is-naming' : ''}`}
              data-testid={`${testId}-row-${task.id}`} data-marked={marked || undefined}>
              <div className="pt-row">
                {mayBook ? (
                  <input type="checkbox" checked={selected.has(task.id)} aria-label={t('schedule.sc.selectRow', { task: task.title })}
                    onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(task.id)) n.delete(task.id); else n.add(task.id); return n })}
                    data-testid={`${testId}-select-${task.id}`} />
                ) : <span />}
                <span className="sc-task">
                  <span className="sc-num">{i + 1}</span>
                  <span className="sc-task-text">
                    {isRenaming ? (
                      <input
                        autoFocus
                        className="sc-name-input"
                        value={renaming.title}
                        maxLength={200}
                        aria-label={t('campaigns.assign.rename', { task: task.title })}
                        onChange={(e) => setRenaming({ id: task.id, title: e.target.value })}
                        onBlur={() => { if (renaming.title.trim() && renaming.title.trim() !== task.title) void saveNow(task, { title: renaming.title }); setRenaming(null) }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
                          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRenaming(null) }
                        }}
                        data-testid={`${testId}-name-${task.id}`}
                      />
                    ) : mayEdit && !approved ? (
                      <button type="button" className="pt-name-btn sc-task-name" title={t('campaigns.assign.rename', { task: task.title })}
                        onClick={() => setRenaming({ id: task.id, title: task.title })} data-testid={`${testId}-rename-${task.id}`}>
                        {task.title}
                      </button>
                    ) : (
                      <span className="sc-task-name">{task.title}</span>
                    )}
                    {mayEdit ? (
                      <button type="button" className="sc-waits" onClick={(e) => setOpen({ kind: 'waits', id: task.id, anchor: e.currentTarget })} data-testid={`${testId}-waits-${task.id}`}>
                        {waitsWords(waitTitles)} ▾
                      </button>
                    ) : <span className="sc-waits pt-waits-ro">{waitsWords(waitTitles)}</span>}
                    {marked && <span className="piece-panel-came" data-testid={`${testId}-came-from`}>{t('campaigns.panel.cameFrom')}</span>}
                  </span>
                </span>
                {mayEdit && task.status !== 'done' ? (
                  <span className="sc-stepper" role="group" aria-label={t('campaigns.assign.col.hours')}>
                    <button type="button" aria-label={t('schedule.sc.less')} data-testid={`${testId}-less-${task.id}`}
                      onClick={() => (approved ? stage(task.id, { hours: stepHours(v.hours, -1) }) : void saveNow(task, { hours: stepHours(v.hours, -1) }))}>−</button>
                    <span data-testid={`${testId}-hours-${task.id}`}>{v.hours == null ? '—' : t('schedule.sc.hours', { n: v.hours })}</span>
                    <button type="button" aria-label={t('schedule.sc.more')} data-testid={`${testId}-more-${task.id}`}
                      onClick={() => (approved ? stage(task.id, { hours: stepHours(v.hours, 1) }) : void saveNow(task, { hours: stepHours(v.hours, 1) }))}>+</button>
                  </span>
                ) : <span className="pt-ro">{v.hours == null ? '—' : t('schedule.sc.hours', { n: v.hours })}</span>}
                {approved && (mayBook && task.status !== 'done' ? (
                  <button type="button" className={`sc-field${v.assigneeId ? ' is-set' : ''}${asked && !v.assigneeId ? ' is-warn' : ''}${open?.kind === 'who' && open.id === task.id ? ' is-open' : ''}`}
                    onClick={(e) => setOpen({ kind: 'who', id: task.id, anchor: e.currentTarget })} data-testid={`${testId}-who-${task.id}`}>
                    {v.assigneeId ? (
                      <>
                        <Avatar id={res?.id ?? v.assigneeId} name={who} size={18} />
                        <span className="sc-field-text">
                          <span className="sc-field-main">{v.assigneeId === myId ? t('campaigns.assign.you', { name: who }) : who}</span>
                          {isStaged && free != null && <span className="sc-field-sub">{t('schedule.sc.freeThisWeek', { n: free })}</span>}
                        </span>
                      </>
                    ) : asked ? (
                      <span className="sc-field-main pt-asked" data-testid={`${testId}-asked-${task.id}`}>⏳ {asked.resourceName
                        ? t('campaigns.assign.askedField', { name: asked.resourceName })
                        : asked.teamName
                          ? t('campaigns.assign.askedTeamNamed', { team: asked.teamName })
                          : asked.departmentName
                            ? t('campaigns.assign.askedField', { name: asked.departmentName })
                            : t('campaigns.assign.askedTeam')}</span>
                    ) : <span className="sc-field-ph">{t('schedule.sc.pickPerson')}</span>}
                    <span className="sc-caret" aria-hidden="true">▾</span>
                  </button>
                ) : (
                  <span className="pt-ro" data-testid={`${testId}-who-ro-${task.id}`}>
                    {v.assigneeId ? who : asked ? `⏳ ${asked.resourceName ?? (asked.teamName ? t('campaigns.assign.askedTeamNamed', { team: asked.teamName }) : null) ?? asked.departmentName ?? t('campaigns.assign.askedTeam')}` : t('campaigns.assign.nobody')}
                  </span>
                ))}
                {approved && (mayBook && task.status !== 'done' ? (
                  <button type="button" className={`sc-field sc-field-dates${v.from ? ' is-set' : ''}${late ? ' is-bad' : ''}${open?.kind === 'dates' && open.id === task.id ? ' is-open' : ''}`}
                    onClick={(e) => setOpen({ kind: 'dates', id: task.id, anchor: e.currentTarget })} data-testid={`${testId}-dates-${task.id}`}>
                    {v.from && v.to ? <span className="sc-field-main">{dayRange(v.from, v.to, lang)}</span> : <span className="sc-field-ph">{t('schedule.sc.pickDates')}</span>}
                    <span className="sc-caret" aria-hidden="true">▾</span>
                  </button>
                ) : (
                  <span className="pt-ro">{v.from && v.to ? dayRange(v.from, v.to, lang) : '—'}</span>
                ))}
                <span className={`pt-status is-${st.tone}`} data-testid={`${testId}-status-${task.id}`} data-status={st.key}>{st.label}</span>
                <span className="pt-actions">
                  {mayEdit && (
                    <IconButton icon="edit" size="sm" label={t('campaigns.assign.edit', { task: task.title })}
                      onClick={() => setEditing({ taskId: task.id, all: false })} data-testid={`${testId}-edit-${task.id}`} />
                  )}
                  {mayEdit && task.status !== 'done' && (task.started ? (
                    <span className="pt-lock" role="img" aria-label={t('campaigns.assign.locked')} title={t('campaigns.assign.locked')} data-testid={`${testId}-locked-${task.id}`}>🔒</span>
                  ) : (
                    <IconButton icon="close" size="sm" label={t('campaigns.assign.remove', { task: task.title })}
                      onClick={() => (task.assigneeId ? setAskRemove(task) : removeUnbooked(task))} data-testid={`${testId}-remove-${task.id}`} />
                  ))}
                </span>
              </div>
              {rowAsk != null && (
                <div className="te-started pt-row-ask" role="alert" data-testid={`${testId}-started-${task.id}`}>
                  <p><strong>{t('tasks.editor.startedTitle', { name: rowAsk || t('tasks.editor.someone') })}</strong> {t('tasks.editor.startedMove')}</p>
                  <div className="te-started-actions">
                    <Button variant="primary" size="sm" busy={busy} onClick={() => void saveRows(new Set([task.id]))} data-testid={`${testId}-move-anyway-${task.id}`}>{t('tasks.editor.moveIt')}</Button>
                    <Button variant="secondary" size="sm" onClick={() => keepRow(task)} data-testid={`${testId}-keep-${task.id}`}>{t('tasks.editor.keep')}</Button>
                  </div>
                </div>
              )}
              {askRemove?.id === task.id && (
                <div className="pt-remove-ask" role="alert" data-testid={`${testId}-remove-ask-${task.id}`}>
                  <p className="pt-remove-title">{t('campaigns.assign.removeTitle', { task: task.title })}</p>
                  <p>{t('campaigns.assign.removeText', { name: task.assigneeName ?? '', hours: task.hours ?? 0 })}</p>
                  <div className="te-started-actions">
                    <Button variant="danger" size="sm" busy={remove.isPending}
                      onClick={() => remove.mutate(task.id, { onSuccess: () => setAskRemove(null), onError: (e) => { setAskRemove(null); onBanner(fail(e)) } })}
                      data-testid={`${testId}-remove-yes-${task.id}`}>{t('campaigns.assign.removeYes')}</Button>
                    <Button variant="secondary" size="sm" onClick={() => setAskRemove(null)} data-testid={`${testId}-remove-keep-${task.id}`}>{t('campaigns.assign.removeKeep')}</Button>
                  </div>
                </div>
              )}
              {rowError && <p className="sc-row-warn is-bad" role="alert" data-testid={`${testId}-error-${task.id}`}>{rowError}</p>}
              {late && isStaged && <p className="sc-row-warn is-bad" data-testid={`${testId}-late-${task.id}`}>{t('schedule.sc.dates.late', { due: dayLong(dueIso!, lang) })}</p>}
            </div>
          )
        })}

        {removing && (
          <div className="sc-undo" data-testid={`${testId}-undo`}>
            <span>{removing.waiting === 0 ? t('schedule.sc.removed.none', { task: removing.task.title }) : t('schedule.sc.removed.waiting', { task: removing.task.title, count: removing.waiting })}</span>
            <Button variant="link" size="sm" onClick={undoRemove} data-testid={`${testId}-undo-button`}>{t('schedule.sc.removed.undo')}</Button>
          </div>
        )}
        {bulkLine && <p className={`pt-bulk-line is-${bulkLine.tone}`} data-testid={`${testId}-bulk-line`}>{bulkLine.text}</p>}

        {mayEdit && (
          <div className="sc-add-line">
            {adding == null ? (
              <button type="button" className="sc-add" onClick={() => setAdding('')} data-testid={`${testId}-add`}>+ {t('campaigns.assign.add')}</button>
            ) : (
              <span className="pt-add-row">
                <input
                  autoFocus
                  className="sc-name-input"
                  value={adding}
                  maxLength={200}
                  placeholder={t('campaigns.assign.addName')}
                  aria-label={t('campaigns.assign.addName')}
                  onChange={(e) => setAdding(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addTask() }
                    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAdding(null) }
                  }}
                  data-testid={`${testId}-add-name`}
                />
                <Button variant="primary" size="sm" busy={upsert.isPending} disabled={!isAcceptableTaskName(adding)} onClick={addTask} data-testid={`${testId}-add-save`}>{t('campaigns.assign.addSave')}</Button>
                <Button variant="link" size="sm" onClick={() => setAdding(null)}>{t('tasks.editor.cancel')}</Button>
              </span>
            )}
            <span className="sc-foot-note">
              {adding != null ? t('campaigns.assign.addHint')
                : approved ? t('campaigns.assign.addAnyTime')
                : workflowName ? t('schedule.sc.add.fromWorkflow', { workflow: workflowName }) : null}
            </span>
          </div>
        )}
      </div>

      {mayBook && (needsReviewer || someWithoutReviewer) && (
        <label className="sc-reviewer pt-reviewer" data-testid={`${testId}-reviewer-line`}>
          <span>{t('campaigns.assign.checkedBy')}</span>
          <select value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} data-testid={`${testId}-reviewer`}>
            <option value="">{t('schedule.sc.reviewer.pick')}</option>
            {(reviewerOptions.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <span className="sc-foot-note">{t('campaigns.assign.checkedByHint')}</span>
        </label>
      )}

      <div className={`pt-foot${embedded && !approved ? ' is-empty' : ''}`}>
        {!approved ? (
          !embedded &&
          mayApprove && tasks.length > 0 && (
            <>
              <Button variant="primary" busy={approve.isPending}
                onClick={() => {
                  commitRemove()
                  approve.mutate(deliverableId, {
                    onSuccess: () => onBanner({ kind: 'ok', text: t('campaigns.panel.approvedOk') }),
                    onError: (e) => onBanner(fail(e)),
                  })
                }}
                data-testid={`${testId}-approve`}>
                {t('campaigns.assign.approve', { count: tasks.length })}
              </Button>
              <span className="sc-foot-note pt-foot-note">{t('campaigns.assign.approveNote')}</span>
            </>
          )
        ) : (
          <>
            {mayBook && (
              <Button variant="primary" busy={busy} disabled={changedRows.length === 0 || (needsReviewer && !reviewerId)} onClick={() => void saveRows()} data-testid={`${testId}-save`}>
                {booking > 0 ? t('campaigns.assign.book', { count: booking }) : t('campaigns.assign.save')}
              </Button>
            )}
            <Button variant="secondary" to="/schedule" data-testid={`${testId}-open-schedule`}>{t('campaigns.assign.openSchedule')}</Button>
            <span className="sc-foot-note pt-foot-note">{mayBook ? t('campaigns.assign.bookNote') : t('campaigns.assign.readOnlyNote')}</span>
          </>
        )}
      </div>

      {open?.kind === 'waits' && (() => {
        const task = tasks.find((x) => x.id === open.id)
        if (!task) return null
        const current = edges.filter((e) => e.subTaskId === task.id).map((e) => e.prerequisiteId)
        return (
          <Popover anchor={open.anchor} onClose={() => setOpen(null)} width={300} testId={`${testId}-waits-pop`}>
            <OptimisticWaits
              title={task.title}
              options={tasks.filter((x) => x.id !== task.id).map((x) => ({
                id: x.id,
                title: x.title,
                sub: [x.assigneeName, x.startsAt ? dayLong(iraqDay(x.startsAt), lang) : null].filter(Boolean).join(' · ') || null,
              }))}
              value={current}
              onChange={(next) => void saveNow(task, { waitsFor: next })}
              testId={`${testId}-waits-picker`}
            />
          </Popover>
        )
      })()}
      {open?.kind === 'who' && (() => {
        const task = tasks.find((x) => x.id === open.id)
        if (!task) return null
        const v = view(task)
        return (
          <Popover anchor={open.anchor} onClose={() => setOpen(null)} width={320} testId={`${testId}-who-pop`}>
            <PeoplePicker
              people={withPlan.people}
              selectedId={v.assigneeId ? (people.resByUser.get(v.assigneeId)?.id ?? null) : null}
              onPick={(rid) => { stage(task.id, { assigneeId: people.resById.get(rid)?.userId ?? null }); setOpen(null) }}
              askDay={v.to}
              askOnly={people.asksOnly}
              onAsk={(choice) => {
                setOpen(null)
                // An ask names who checks the task (20261003180000): with no reviewer on the task, the "Checked by"
                // pick travels with the ask and the lead's booking writes it onto the task (I74.53) — the asker does
                // not edit the task, so an account manager can ask too. With neither, nothing is sent.
                if (task.reviewers.length === 0 && !reviewerId) { onBanner({ kind: 'error', text: t('campaigns.assign.pickReviewer') }); return }
                void (async () => {
                  try {
                    await ask.mutateAsync({ subTaskId: task.id, teamId: choice.teamId, assigneeId: choice.assigneeId, hours: v.hours, neededBy: choice.neededBy ?? v.to, note: choice.note,
                      reviewers: task.reviewers.length === 0 ? [{ userId: reviewerId, isMandatory: true }] : null })
                    void pending.refetch()
                    onBanner({ kind: 'ok', text: t('campaigns.assign.askSent', { task: task.title }) })
                  } catch (e) { onBanner(fail(e)) }
                })()
              }}
              testId={`${testId}-people`}
            />
          </Popover>
        )
      })()}
      {open?.kind === 'dates' && (() => {
        const task = tasks.find((x) => x.id === open.id)
        if (!task) return null
        const v = view(task)
        const rid = v.assigneeId ? (people.resByUser.get(v.assigneeId)?.id ?? null) : null
        return (
          <Popover anchor={open.anchor} onClose={() => setOpen(null)} width={360} testId={`${testId}-dates-pop`}>
            <DatesPicker
              personName={v.assigneeId ? nameOfUser(v.assigneeId, task.assigneeName) : null}
              startSunday={sundayOfIso(v.from ?? today)}
              from={v.from}
              to={v.to}
              hours={v.hours ?? 0}
              dueIso={piece.dueAt ? iraqDay(piece.dueAt) : null}
              todayIso={today}
              workingWeekdays={people.workingCols(rid)}
              isWorking={(iso) => (rid ? people.isWorking(rid, iso) : true)}
              loadOn={(iso) => (rid ? withPlan.loadOn(rid, iso, task.id) : null)}
              onChange={(from, to) => stage(task.id, { from, to })}
              onDone={() => setOpen(null)}
              testId={`${testId}-dates-picker`}
            />
          </Popover>
        )
      })()}
      {open?.kind === 'bulkWho' && (
        <Popover anchor={open.anchor} onClose={() => setOpen(null)} width={320} testId={`${testId}-bulk-who-pop`}>
          <PeoplePicker people={withPlan.people} selectedId={bulkPerson ? (people.resByUser.get(bulkPerson)?.id ?? null) : null}
            onPick={(rid) => { setBulkPerson(people.resById.get(rid)?.userId ?? null); setOpen(null) }} testId={`${testId}-bulk-people`} />
        </Popover>
      )}
      {open?.kind === 'bulkDay' && (() => {
        const rid = bulkPerson ? (people.resByUser.get(bulkPerson)?.id ?? null) : null
        return (
          <Popover anchor={open.anchor} onClose={() => setOpen(null)} width={360} testId={`${testId}-bulk-day-pop`}>
            <DatesPicker
              single
              personName={bulkPerson ? nameOfUser(bulkPerson, null) : null}
              startSunday={sundayOfIso(bulkDay ?? today)}
              from={bulkDay}
              to={bulkDay}
              hours={0}
              dueIso={piece.dueAt ? iraqDay(piece.dueAt) : null}
              todayIso={today}
              workingWeekdays={people.workingCols(rid)}
              isWorking={(iso) => (rid ? people.isWorking(rid, iso) : true)}
              loadOn={(iso) => (rid ? withPlan.loadOn(rid, iso) : null)}
              onChange={(from) => { setBulkDay(from); setOpen(null) }}
              onDone={() => setOpen(null)}
              testId={`${testId}-bulk-day-picker`}
            />
          </Popover>
        )
      })()}

      {editing && (
        <TaskEditorDialog
          deliverableId={deliverableId}
          taskId={editing.taskId}
          all={editing.all}
          onClose={() => setEditing(null)}
          onPastDue={(taskId, day) => { setEditing(null); setChangeAsk({ taskId, day }) }}
        />
      )}
      {changeAsk && (
        <ChangeAskDialog deliverableId={deliverableId} fromSubTaskId={changeAsk.taskId} initialDueDay={changeAsk.day} onClose={() => setChangeAsk(null)} />
      )}
    </section>
  )
}

/** The waits-for picker holding its own ticks while the save goes out — the list's edges catch up on the refetch. */
function OptimisticWaits(p: Parameters<typeof WaitsForPicker>[0]) {
  const [value, setValue] = useState<string[]>([...p.value])
  return <WaitsForPicker {...p} value={value} onChange={(next) => { setValue(next); p.onChange(next) }} />
}
