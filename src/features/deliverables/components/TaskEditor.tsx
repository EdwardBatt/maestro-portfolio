import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../../app/auth-context'
import { usePermissions } from '../../../app/permissions'
import { Button, IconButton } from '../../../components/Button'
import { Modal } from '../../../components/Modal'
import { ReviewerPicker } from '../../../components/ReviewerPicker'
import { SegmentedControl } from '../../../components/SegmentedControl'
import { namedRefusal, refusalSentence } from '../../../lib/errors/classify'
import { translateScheduleWarning } from '../../../lib/bookings/schedule-outcome'
import { REVIEW_MODES, reviewModeLabelKey, type ReviewMode } from '../../../lib/review/review-mode'
import { iraqDay } from '../../../lib/time/iraq'
import { usePendingAssignmentRequestsForTasks } from '../../../lib/assignment-requests/api'
// The Schedule's own pickers (ADR-0140 d.4: "the same pickers as the Schedule"), used as they are.
import { Avatar } from '../../schedule/components/Avatar'
import { DatesPicker } from '../../schedule/components/DatesPicker'
import { PeoplePicker } from '../../schedule/components/PeoplePicker'
import { Popover } from '../../schedule/components/Popover'
import { dayLong, dayRange } from '../../schedule/lib/day-words.ts'
import { sundayOfIso, usePeopleWeek } from '../../schedule/hooks/use-people-week'
import { useReviewers } from '../api/deliverables-api'
import { useTaskDependencies, type TaskDependency } from '../api/requirements-api'
import { saveTask, useAskAnotherTeam, usePieceTaskList, type EditablePiece, type EditableTask } from '../api/task-editor-api'
import { changesOf, draftOf, draftProblem, rebaseDraft, stepHours, taskRefusal, type TaskDraft } from '../lib/task-edit'
import { useQueryClient } from '@tanstack/react-query'
import { invalidateTaskViews } from '../../../lib/query/task-views'

/** "Waits for" (SC-13): the piece's other tasks, several allowed, or nothing — it starts any time. */
export function WaitsForPicker({
  title,
  options,
  value,
  onChange,
  testId,
}: {
  title: string
  options: { id: string; title: string; sub: string | null }[]
  value: readonly string[]
  onChange: (next: string[]) => void
  testId: string
}) {
  const { t } = useTranslation()
  return (
    <div className="te-waits" data-testid={testId}>
      <p className="sc-pop-title">{t('schedule.sc.waits.title', { task: title })}</p>
      <label className="te-waits-row">
        <input type="radio" checked={value.length === 0} onChange={() => onChange([])} data-testid={`${testId}-none`} />
        <span>
          <span className="te-waits-name">{t('schedule.sc.waits.nothing')}</span>
          <span className="te-waits-sub">{t('schedule.sc.waits.nothingSub')}</span>
        </span>
      </label>
      {options.map((o, i) => (
        <label key={o.id} className={`te-waits-row${value.includes(o.id) ? ' is-on' : ''}`}>
          <input
            type="checkbox"
            checked={value.includes(o.id)}
            onChange={() => onChange(value.includes(o.id) ? value.filter((x) => x !== o.id) : [...value, o.id])}
            data-testid={`${testId}-${o.id}`}
          />
          <span>
            <span className="te-waits-name">{i + 1} · {o.title}</span>
            {o.sub && <span className="te-waits-sub">{o.sub}</span>}
          </span>
        </label>
      ))}
      <p className="te-waits-foot">{t('schedule.sc.waits.foot')}</p>
    </div>
  )
}

export interface TaskEditorFormProps {
  task: EditableTask
  piece: EditablePiece
  siblings: readonly EditableTask[]
  edges: readonly TaskDependency[]
  /** Who and Dates are offered to those who book (`bookings:create`) — ADR-0140 d.4. */
  mayBook: boolean
  onSaved?: (r: { outcome: 'saved' | 'requested'; movedTo: string | null }) => void
  onCancel?: () => void
  /** ADR-0141 d.2: a move past the piece's due date opens the one change form, filled in with that day. */
  onPastDue?: (dueDay: string) => void
  /** extra actions after Save (the Schedule pop-up's Open the piece / Edit all tasks) */
  actions?: ReactNode
  /** the quiet end of the foot (the Schedule pop-up's Cancel this booking / Remove this task) */
  actionsEnd?: ReactNode
  saveLabel?: string
  testId?: string
}

/**
 * **The one task editor** (ADR-0140 d.1, I74.7–I74.9; mock-up 3). Every detail of a task: name, notes, hours,
 * person, days, what it waits for, reviewers and how it is reviewed. The writes are the server's
 * (`saveTask`), and so are the answers it gives in place:
 *
 *  - a STARTED task's person or days move only when asked — "Zubaida has started this — move it anyway?" (d.3);
 *  - another team's person or days become a request to that team's lead, shown ⏳ (d.2, ADR-0139);
 *  - before the task list is approved nobody is given the work (d.4) — Who and Dates wait for the approval.
 */
export function TaskEditorForm(p: TaskEditorFormProps) {
  const { task, piece, testId = 'task-editor' } = p
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const qc = useQueryClient()
  const { claims } = useAuth()
  const reviewerOptions = useReviewers()
  const today = iraqDay(Date.now())
  const fresh = useMemo(() => draftOf(task, p.edges), [task, p.edges])
  // What the form LOADED is what a save is measured against — never the latest read. When the task is read again
  // while the form is open, the form moves to the fresh task and keeps only the user's own edits (`rebaseDraft`),
  // so a save can never send a person, days or hours the user did not touch (test script step 14).
  const freshKey = JSON.stringify(fresh)
  const [seen, setSeen] = useState(freshKey)
  const [before, setBefore] = useState<TaskDraft>(fresh)
  const [draft, setDraft] = useState<TaskDraft>(fresh)
  if (seen !== freshKey) {
    setSeen(freshKey)
    setBefore(fresh)
    setDraft(rebaseDraft(before, draft, fresh))
  }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [startedAsk, setStartedAsk] = useState<string | null>(null)
  const [open, setOpen] = useState<{ kind: 'who' | 'dates'; anchor: HTMLElement } | null>(null)
  const listApproved = piece.tasksApprovedAt != null
  const people = usePeopleWeek(sundayOfIso(draft.from ?? today))
  const ask = useAskAnotherTeam()
  const pending = usePendingAssignmentRequestsForTasks([task.id])
  const pendingAsk = pending.data?.get(task.id) ?? null

  const set = (patch: Partial<TaskDraft>) => { setDraft((d) => ({ ...d, ...patch })); setError(null); setNote(null) }
  const c = changesOf(before, draft)
  const dirty = Object.values(c).some(Boolean)
  const problem = dirty ? draftProblem(before, draft, listApproved) : null
  const resource = draft.assigneeId ? (people.resByUser.get(draft.assigneeId) ?? null) : null
  const personName = resource?.name ?? (draft.assigneeId === task.assigneeId ? task.assigneeName : null)
  const firstName = personName ?? ''
  const free = resource ? people.people.find((x) => x.resource.id === resource.id)?.freeHours ?? null : null
  const dueIso = piece.dueAt ? iraqDay(piece.dueAt) : null
  // ADR-0140 d.3: asked before Save when we already know it has started; the server's hint asks too.
  const movesStarted = task.started && task.assigneeId != null && (c.person || c.days)
  const askStarted = startedAsk ?? (movesStarted ? (task.assigneeName ?? '') : null)

  const say = (e: unknown) => {
    const x = e as { code?: string; message?: string }
    return namedRefusal(e, t) ?? refusalSentence(x) ?? (x.code === '22023' ? x.message : null) ?? t('tasks.editor.saveFailed')
  }

  async function save(confirmStarted: boolean, d: TaskDraft = draft) {
    if (problem && d === draft) return
    setBusy(true)
    setError(null)
    try {
      const span = d.assigneeId && d.from && d.to && resource
        ? people.spanFor(resource.id, d.from, d.to, d.hours ?? 0)
        : null
      const r = await saveTask({
        subTaskId: task.id,
        deliverableId: task.deliverableId,
        before,
        draft: d,
        span,
        confirmStarted,
        edges: p.edges,
        tenantId: claims.tenantId ?? null,
      })
      setStartedAsk(null)
      const movedTo = (d.from !== before.from || d.to !== before.to) ? d.to : null
      if (r.scheduleWarning) setNote(translateScheduleWarning(t, r.scheduleWarning))
      else if (r.outcome === 'requested') setNote(t('tasks.editor.requested'))
      else setNote(t('tasks.editor.saved'))
      p.onSaved?.({ outcome: r.outcome, movedTo })
      if (movedTo && dueIso && movedTo > dueIso) p.onPastDue?.(movedTo)
    } catch (e) {
      const refusal = taskRefusal(e)
      if (refusal?.kind === 'started') setStartedAsk(refusal.name || (task.assigneeName ?? ''))
      else setError(say(e))
    } finally {
      invalidateTaskViews(qc)
      setBusy(false)
    }
  }

  /** "Keep": the person and the days stay as they were; whatever else changed still saves. */
  function keep() {
    const back = { ...draft, assigneeId: before.assigneeId, from: before.from, to: before.to }
    setDraft(back)
    setStartedAsk(null)
    const still = changesOf(before, back)
    if (Object.values(still).some(Boolean)) void save(false, back)
  }

  const siblingOptions = p.siblings
    .filter((x) => x.id !== task.id)
    .map((x) => ({ id: x.id, title: x.title }))
  const mayBook = p.mayBook && listApproved

  return (
    <div className="te-form" data-testid={testId}>
      <div className="te-grid">
        <label className="te-label" htmlFor={`${testId}-title`}>{t('tasks.editor.task')}</label>
        <input id={`${testId}-title`} className="te-input" value={draft.title} maxLength={200}
          onChange={(e) => set({ title: e.target.value })} data-testid={`${testId}-title`} />

        <label className="te-label" htmlFor={`${testId}-notes`}>{t('tasks.editor.notes')}</label>
        <textarea id={`${testId}-notes`} className="te-input te-notes" rows={2} dir="auto" value={draft.notes}
          placeholder={t('tasks.editor.notesHint')} onChange={(e) => set({ notes: e.target.value })} data-testid={`${testId}-notes`} />

        <span className="te-label">{t('tasks.editor.hours')}</span>
        <span className="te-hours">
          <span className="sc-stepper" role="group" aria-label={t('tasks.editor.hours')}>
            <button type="button" aria-label={t('schedule.sc.less')} onClick={() => set({ hours: stepHours(draft.hours, -1) })} data-testid={`${testId}-less`}>−</button>
            <span data-testid={`${testId}-hours`}>{draft.hours == null ? '—' : t('schedule.sc.hours', { n: draft.hours })}</span>
            <button type="button" aria-label={t('schedule.sc.more')} onClick={() => set({ hours: stepHours(draft.hours, 1) })} data-testid={`${testId}-more`}>+</button>
          </span>
        </span>

        <span className="te-label">{t('tasks.editor.who')}</span>
        <span className="te-cell">
          {mayBook ? (
            <>
              <button type="button" className={`sc-field te-who${draft.assigneeId ? ' is-set' : ''}${open?.kind === 'who' ? ' is-open' : ''}`}
                onClick={(e) => setOpen({ kind: 'who', anchor: e.currentTarget })} data-testid={`${testId}-who`}>
                {draft.assigneeId ? (
                  <>
                    <Avatar id={resource?.id ?? draft.assigneeId} name={personName ?? ''} size={20} />
                    <span className="sc-field-text">
                      <span className="sc-field-main">{personName}</span>
                      <span className="sc-field-sub">
                        {[resource?.jobTitle, free != null ? t('schedule.sc.freeThisWeek', { n: free }) : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </>
                ) : <span className="sc-field-ph">{t('schedule.sc.pickPerson')}</span>}
                <span className="sc-caret" aria-hidden="true">▾</span>
              </button>
              {draft.assigneeId && (
                <Button variant="link" size="sm" onClick={() => set({ assigneeId: null })} data-testid={`${testId}-take-off`}>
                  {t('tasks.editor.takeOff')}
                </Button>
              )}
            </>
          ) : (
            <span className="te-fixed" data-testid={`${testId}-who-fixed`}>
              {task.assigneeName ?? (listApproved ? t('tasks.editor.nobody') : t('tasks.editor.afterApproval'))}
            </span>
          )}
          {pendingAsk && (
            <span className="te-asked" data-testid={`${testId}-asked`}>
              ⏳ {t('tasks.editor.askedOf', { name: pendingAsk.resourceName ?? pendingAsk.departmentName ?? '' })}
            </span>
          )}
        </span>

        <span className="te-label">{t('tasks.editor.dates')}</span>
        <span className="te-cell">
          {mayBook || !task.assigneeId ? (
            <button type="button" className={`sc-field sc-field-dates te-dates${draft.from ? ' is-set' : ''}${draft.to && dueIso && draft.to > dueIso ? ' is-bad' : ''}${open?.kind === 'dates' ? ' is-open' : ''}`}
              onClick={(e) => setOpen({ kind: 'dates', anchor: e.currentTarget })} data-testid={`${testId}-dates`}>
              {draft.from && draft.to
                ? <span className="sc-field-main">{dayRange(draft.from, draft.to, lang)}</span>
                : <span className="sc-field-ph">{t('schedule.sc.pickDates')}</span>}
              <span className="sc-caret" aria-hidden="true">▾</span>
            </button>
          ) : (
            <span className="te-fixed">{draft.from && draft.to ? dayRange(draft.from, draft.to, lang) : '—'}</span>
          )}
          {dueIso && <span className="te-hint">{t('tasks.editor.pieceDue', { day: dayLong(dueIso, lang) })}</span>}
        </span>

        <span className="te-label">{t('tasks.editor.waitsFor')}</span>
        <span className="te-chips" role="group" aria-label={t('tasks.editor.waitsFor')} data-testid={`${testId}-waits`}>
          {siblingOptions.map((o) => {
            const on = draft.waitsFor.includes(o.id)
            return (
              <button key={o.id} type="button" className={`te-chip${on ? ' is-on' : ''}`} aria-pressed={on}
                onClick={() => set({ waitsFor: on ? draft.waitsFor.filter((x) => x !== o.id) : [...draft.waitsFor, o.id] })}
                data-testid={`${testId}-waits-${o.id}`}>
                {on && <span aria-hidden="true">✓ </span>}{o.title}
              </button>
            )
          })}
          <button type="button" className={`te-chip${draft.waitsFor.length === 0 ? ' is-on' : ''}`} aria-pressed={draft.waitsFor.length === 0}
            onClick={() => set({ waitsFor: [] })} data-testid={`${testId}-waits-none`}>
            {t('schedule.sc.waits.any')}
          </button>
        </span>

        <span className="te-label">{t('tasks.editor.reviewers')}</span>
        <span className="te-cell te-reviewers">
          <ReviewerPicker
            options={reviewerOptions.data ?? []}
            value={draft.reviewers}
            onChange={(next) => set({ reviewers: next })}
            excludeUserId={draft.assigneeId}
            testId={`${testId}-reviewer`}
            selectClassName="sc-select"
          />
          <span className="te-hint">{t('tasks.editor.reviewersHint')}</span>
        </span>

        <span className="te-label">{t('tasks.editor.review')}</span>
        <span className="te-cell">
          <SegmentedControl<ReviewMode>
            size="sm"
            label={t('tasks.editor.review')}
            value={draft.reviewMode}
            onChange={(v) => set({ reviewMode: v })}
            options={REVIEW_MODES.map((m) => ({ value: m, label: t(reviewModeLabelKey(m)), testId: `${testId}-review-${m}` }))}
          />
          <span className="te-hint">{t(`reviewMode.hint.${draft.reviewMode}`)}</span>
        </span>
      </div>

      {askStarted != null && (
        <div className="te-started" role="alert" data-testid={`${testId}-started`}>
          <p>
            <strong>{t('tasks.editor.startedTitle', { name: askStarted || t('tasks.editor.someone') })}</strong>{' '}
            {draft.to && c.days
              ? t('tasks.editor.startedMoveTo', { day: dayLong(draft.to, lang) })
              : c.person ? t('tasks.editor.startedGive', { name: firstName }) : t('tasks.editor.startedMove')}
          </p>
          <div className="te-started-actions">
            <Button variant="primary" size="sm" busy={busy} onClick={() => void save(true)} data-testid={`${testId}-move-anyway`}>
              {t('tasks.editor.moveIt')}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={keep} data-testid={`${testId}-keep`}>
              {before.from && c.days ? t('tasks.editor.keepDay', { day: dayLong(before.from, lang) }) : t('tasks.editor.keep')}
            </Button>
          </div>
        </div>
      )}

      {problem && <p className="te-problem" role="status" data-testid={`${testId}-problem`}>{t(`tasks.editor.problem.${problem}`)}</p>}
      {error && <p className="form-error" role="alert" data-testid={`${testId}-error`}>{error}</p>}
      {note && <p className="te-note" role="status" data-testid={`${testId}-note`}>{note}</p>}

      <div className="te-foot">
        {askStarted == null && (
          <Button variant="primary" busy={busy} disabled={!dirty || problem != null} onClick={() => void save(false)} data-testid={`${testId}-save`}>
            {p.saveLabel ?? t('tasks.editor.save')}
          </Button>
        )}
        {p.actions}
        {p.onCancel && <Button variant="link" onClick={p.onCancel} data-testid={`${testId}-cancel`}>{t('tasks.editor.cancel')}</Button>}
        <span className="sc-grow" />
        {p.actionsEnd}
      </div>
      {task.started && <p className="te-foot-note" data-testid={`${testId}-no-remove`}>{t('tasks.editor.noRemove')}</p>}

      {open?.kind === 'who' && (
        <Popover anchor={open.anchor} onClose={() => setOpen(null)} width={320} testId={`${testId}-who-pop`}>
          <PeoplePicker
            people={people.people}
            selectedId={resource?.id ?? null}
            onPick={(rid) => { set({ assigneeId: people.resById.get(rid)?.userId ?? null }); setOpen(null) }}
            askDay={draft.to}
            askOnly={people.asksOnly}
            onAsk={(choice) => {
              setOpen(null)
              // An ask names who checks the task (20261003180000): the lead who answers books it, and a task is never
              // booked without a reviewer. Reviewers chosen here travel with the ask and the booking writes them onto
              // the task (I74.53) — asking is not an edit of the task.
              if (draft.reviewers.length === 0) { setError(t('campaigns.assign.pickReviewer')); return }
              void (async () => {
                try {
                  await ask.mutateAsync({ subTaskId: task.id, teamId: choice.teamId, assigneeId: choice.assigneeId, hours: draft.hours, neededBy: choice.neededBy ?? (draft.to ?? null), note: choice.note,
                    reviewers: JSON.stringify(draft.reviewers) !== JSON.stringify(before.reviewers) ? draft.reviewers : null })
                  setNote(t('tasks.editor.asked'))
                } catch (e) { setError(say(e)) }
              })()
            }}
            testId={`${testId}-people`}
          />
        </Popover>
      )}
      {open?.kind === 'dates' && (
        <Popover anchor={open.anchor} onClose={() => setOpen(null)} width={360} testId={`${testId}-dates-pop`}>
          <DatesPicker
            personName={firstName || null}
            startSunday={sundayOfIso(draft.from ?? today)}
            from={draft.from}
            to={draft.to}
            hours={draft.hours ?? 0}
            dueIso={dueIso}
            todayIso={today}
            workingWeekdays={people.workingCols(resource?.id ?? null)}
            isWorking={(iso) => (resource ? people.isWorking(resource.id, iso) : true)}
            loadOn={(iso) => (resource ? people.loadOn(resource.id, iso) : null)}
            onChange={(from, to) => set({ from, to })}
            onDone={() => setOpen(null)}
            testId={`${testId}-dates-picker`}
          />
        </Popover>
      )}
    </div>
  )
}

/**
 * The editor in its own window (mock-up 3): from the pencil on a task row, and — with `all` — "Edit all tasks"
 * (ADR-0140 d.1, SC-21): the same form, with the piece's tasks listed beside it to move between.
 */
export function TaskEditorDialog({
  deliverableId,
  taskId,
  all = false,
  onClose,
  onPastDue,
  testId = 'task-editor-dialog',
}: {
  deliverableId: string
  taskId: string | null
  all?: boolean
  onClose: () => void
  onPastDue?: (taskId: string, dueDay: string) => void
  testId?: string
}) {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const list = usePieceTaskList(deliverableId)
  const deps = useTaskDependencies(deliverableId)
  const [current, setCurrent] = useState<string | null>(taskId)
  const tasks = list.data?.tasks ?? []
  const task = tasks.find((x) => x.id === current) ?? tasks[0] ?? null
  const piece = list.data?.piece ?? null
  const index = task ? tasks.findIndex((x) => x.id === task.id) : -1

  return (
    <Modal onClose={onClose} labelledById={`${testId}-title`} testId={testId} size="wide">
      <div className={`te-dialog${all ? ' is-all' : ''}`}>
        <header className="te-head">
          {piece && (
            <p className="sc-book-eyebrow">
              <span className="sc-dot" aria-hidden="true" />
              {[piece.campaignName, piece.name, index >= 0 ? t('tasks.editor.taskOf', { n: index + 1, count: tasks.length }) : null].filter(Boolean).join(' · ')}
            </p>
          )}
          <h2 id={`${testId}-title`} className="sc-book-title">
            {all ? t('tasks.editor.allTitle', { piece: piece?.name ?? '' }) : t('tasks.editor.title', { task: task?.title ?? '' })}
          </h2>
          <IconButton icon="close" label={t('tasks.editor.close')} className="sc-book-x" onClick={onClose} data-testid={`${testId}-close`} />
        </header>
        {list.isLoading || deps.isLoading ? (
          <p className="muted" data-testid={`${testId}-loading`}>{t('tasks.editor.loading')}</p>
        ) : !task || !piece ? (
          <p className="muted" data-testid={`${testId}-gone`}>{t('tasks.editor.gone')}</p>
        ) : (
          <div className="te-body">
            {all && (
              <ol className="te-list" aria-label={t('tasks.editor.allList')} data-testid={`${testId}-list`}>
                {tasks.map((x, i) => (
                  <li key={x.id}>
                    <button type="button" className={`te-list-item${x.id === task.id ? ' is-on' : ''}`} aria-current={x.id === task.id || undefined}
                      onClick={() => setCurrent(x.id)} data-testid={`${testId}-pick-${x.id}`}>
                      <span className="sc-num">{i + 1}</span>
                      <span className="te-list-text">
                        <span className="te-list-name">{x.title}</span>
                        <span className="te-list-sub">{x.assigneeName ?? t('tasks.editor.nobody')}{x.started ? ` · ${t('tasks.editor.startedShort')}` : ''}</span>
                      </span>
                      {x.started && <span className="te-lock" aria-label={t('tasks.editor.startedShort')}>🔒</span>}
                    </button>
                  </li>
                ))}
              </ol>
            )}
            <TaskEditorForm
              key={task.id}
              task={task}
              piece={piece}
              siblings={tasks}
              edges={deps.data ?? []}
              mayBook={can('bookings:create')}
              onCancel={onClose}
              onPastDue={onPastDue ? (day) => onPastDue(task.id, day) : undefined}
              // Edward, 4 Oct: Save closes the window. "Edit all tasks" stays open to edit the next task.
              onSaved={() => { if (!all) onClose() }}
              testId={`${testId}-form`}
            />
          </div>
        )}
      </div>
    </Modal>
  )
}

/**
 * The editor on the task page (ADR-0140 d.1): for the piece's owner and the leads who run its work, in place of the
 * task-list table row the page used to embed. The maker's own controls on the page are untouched.
 */
export function TaskEditorInline({ deliverableId, taskId, testId = 'task-editor-inline' }: { deliverableId: string; taskId: string; testId?: string }) {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const list = usePieceTaskList(deliverableId)
  const deps = useTaskDependencies(deliverableId)
  const task = list.data?.tasks.find((x) => x.id === taskId) ?? null
  if (list.isLoading || deps.isLoading) return <p className="muted" data-testid={`${testId}-loading`}>{t('tasks.editor.loading')}</p>
  if (!task || !list.data) return <p className="muted" data-testid={`${testId}-gone`}>{t('tasks.editor.gone')}</p>
  // The task page's controls beside the editor (status changes, re-open, cancel) change the task under it: the form
  // starts again from the saved task when the task itself changes, so it never shows the state before (I74 fix-up).
  const version = [task.id, task.status, task.assigneeId, task.startsAt, task.dueAt, task.reviewers.map((r) => `${r.userId}:${r.isMandatory}`).join(',')].join('|')
  return (
    <TaskEditorForm
      key={version}
      task={task}
      piece={list.data.piece}
      siblings={list.data.tasks}
      edges={deps.data ?? []}
      mayBook={can('bookings:create')}
      testId={testId}
    />
  )
}
