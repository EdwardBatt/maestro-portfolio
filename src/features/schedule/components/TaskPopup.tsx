import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../../app/auth-context'
import { usePermissions } from '../../../app/permissions'
import { Button, IconButton } from '../../../components/Button'
import { Modal } from '../../../components/Modal'
import { ReviewerNames } from '../../../components/ReviewerNames'
import { loadPctToHours } from '../../../lib/capacity/day-hours.ts'
import { namedRefusal, refusalSentence } from '../../../lib/errors/classify'
import { pieceHref } from '../../../lib/navigation/piece-link'
import { iraqDay } from '../../../lib/time/iraq'
import { useRemoveSubTask } from '../../deliverables/api/deliverables-api'
import { useTaskDependencies } from '../../deliverables/api/requirements-api'
import { usePieceTaskList, useUnassignTask } from '../../deliverables/api/task-editor-api'
import { TaskEditorDialog, TaskEditorForm } from '../../deliverables/components/TaskEditor'
import { mayEditTasks, taskRefusal } from '../../deliverables/lib/task-edit'
import { ChangeAskDialog } from '../../campaigns/components/ChangeAskDialog'
import type { ScheduleBooking, ScheduleResource } from '../api/schedule-api'
import { dayLoad } from '../lib/day-load.ts'
import { dayLong, dayRange, dayTiny, weekdayName } from '../lib/day-words.ts'
import { stepOf, taskWithPiece } from '../lib/task-title.ts'
import { popupRead } from '../lib/popup-read.ts'
import { usePendingAssignmentRequestsForTasks } from '../../../lib/assignment-requests/api'

type Asking =
  | { kind: 'cancel'; started: string | null }
  | { kind: 'remove' }
  | null

/**
 * **A task, clicked on the Schedule** (Figma L SC-23, SC-24, SC-26, SC-27; ADR-0140 d.1, d.5). Its own pop-up is the
 * one task editor — every detail, the same form as the piece's pencil — with where the task stands, Open the piece,
 * Edit all tasks, and the two ways off the calendar:
 *
 *  - **Cancel this booking** (SC-24) takes the person off (`unassign_task`): the task goes back to To book with its
 *    days and hours, and the person and their lead are told — not the account manager (Edward, 3 Oct, correcting
 *    SC-24). A started task asks first ("Zubaida has started this — take her off anyway?").
 *  - **Remove this task** (SC-27), asked inline (`remove_sub_task`); not offered once the task has started (d.3).
 */
export function TaskPopup({
  booking,
  resources,
  bookings,
  onClose,
}: {
  booking: ScheduleBooking & { subTaskId: string; deliverableId: string }
  resources: ScheduleResource[]
  bookings?: ScheduleBooking[]
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const { can, scope } = usePermissions()
  const { session } = useAuth()
  // Read fresh on every opening (test script step 14): the booking window may have just booked this task.
  const list = usePieceTaskList(booking.deliverableId, { fresh: true })
  const [openedAt] = useState(() => Date.now())
  const [rereads, setRereads] = useState(0)
  const deps = useTaskDependencies(booking.deliverableId)
  const unassign = useUnassignTask()
  const remove = useRemoveSubTask()
  const [asking, setAsking] = useState<Asking>(null)
  const [error, setError] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const [changeAsk, setChangeAsk] = useState<string | null>(null)

  const tasks = list.data?.tasks ?? []
  // SC-26: the piece's tasks, each with who · day · hours and where it stands; an ask out says whom it asked.
  const asks = usePendingAssignmentRequestsForTasks(tasks.map((x) => x.id))
  const task = tasks.find((x) => x.id === booking.subTaskId) ?? null
  const piece = list.data?.piece ?? null
  const index = task ? tasks.indexOf(task) : -1
  // A held booking whose task reads as nobody's is a stale read: wait and read again, never an empty form to save.
  const read = popupRead({
    openedAt,
    readAt: Math.max(list.dataUpdatedAt, list.errorUpdatedAt),
    fetching: list.isFetching,
    bookingHeld: Boolean(booking.resourceId),
    taskAssigneeId: task ? task.assigneeId : undefined,
    rereads,
  })
  const { refetch } = list
  useEffect(() => {
    if (!read.refetch) return
    setRereads((n) => n + 1)
    void refetch()
  }, [read.refetch, refetch])
  const res = resources.find((r) => r.id === booking.resourceId) ?? null
  const first = res?.name ?? task?.assigneeName ?? ''
  const day = new Date(booking.start).toISOString().slice(0, 10)
  const spanFrom = task?.startsAt ? iraqDay(task.startsAt) : null
  const spanTo = task?.dueAt ? iraqDay(task.dueAt) : null

  const say = (e: unknown) => {
    const x = e as { code?: string; message?: string }
    return namedRefusal(e, t) ?? refusalSentence(x) ?? (x.code === '22023' ? x.message : null) ?? t('schedule.cancelFailed')
  }

  function cancelBooking(confirmStarted: boolean) {
    setError(null)
    unassign.mutate(
      { subTaskId: booking.subTaskId, confirmStarted },
      {
        onSuccess: () => onClose(),
        onError: (e) => {
          const r = taskRefusal(e)
          if (r?.kind === 'started') setAsking({ kind: 'cancel', started: r.name || first })
          else if (r?.kind === 'notAssigned') { setAsking(null); setError(t('tasks.popup.notAssigned')) }
          else if (r?.kind === 'notYours') { setAsking(null); setError(t('tasks.popup.notYours')) }
          else { setAsking(null); setError(say(e)) }
        },
      },
    )
  }

  function removeTask() {
    setError(null)
    remove.mutate(booking.subTaskId, {
      onSuccess: () => onClose(),
      onError: (e) => {
        setAsking(null)
        const r = taskRefusal(e)
        setError(r?.kind === 'started' ? t('tasks.popup.startedNoRemove', { name: r.name || first }) : say(e))
      },
    })
  }

  // The day this booking starts on, read as the grid reads it (`dayLoad`): over is said once, in hours.
  const overLine = (() => {
    if (!bookings || !res) return null
    const s = Date.UTC(new Date(booking.start).getUTCFullYear(), new Date(booking.start).getUTCMonth(), new Date(booking.start).getUTCDate())
    const load = dayLoad(res, bookings.filter((b) => b.resourceId === res.id && b.start < s + 86_400_000 && b.end > s))
    if (load.state !== 'over') return null
    return t('schedule.sc.edit.over', { name: res.name, over: load.overHours, day: weekdayName(new Date(s).toISOString().slice(0, 10), lang), hours: load.bookedHours })
  })()

  const steps = ['todo', 'in_progress', 'review', 'done'] as const
  const at = Math.max(0, steps.indexOf((task?.status ?? booking.taskStatus ?? 'todo') as (typeof steps)[number]))

  return (
    <>
      <Modal onClose={onClose} labelledById="task-popup-title" testId="edit-dialog" size="wide">
        <div className="te-dialog sc-task-pop" data-testid="task-popup">
          <header className="te-head">
            {booking.campaignName && <p className="sc-book-eyebrow"><span className="sc-dot" aria-hidden="true" />{booking.campaignName}</p>}
            <h2 id="task-popup-title" className="sc-book-title">{taskWithPiece(task?.title ?? booking.taskName ?? '', piece?.name)}</h2>
            <p className="sc-book-sub" data-testid="edit-booked-for">
              {[
                index >= 0 ? t('tasks.editor.taskOf', { n: index + 1, count: tasks.length }) : null,
                res ? t('schedule.sc.edit.bookedFor', { name: first }) : null,
                // I74.27 (SC-26): the task's whole span and total hours, as its fields say — not the clicked chip's
                // day and hours a day. The chip's own reading only until the task is read.
                spanFrom && spanTo ? (spanFrom === spanTo ? dayLong(spanFrom, lang) : dayRange(spanFrom, spanTo, lang)) : dayLong(day, lang),
                task?.hours != null ? t('schedule.sc.hours', { n: task.hours })
                  : booking.loadPct != null ? t('schedule.sc.hours', { n: loadPctToHours(booking.loadPct) }) : null,
              ].filter(Boolean).join(' · ')}
            </p>
            <IconButton icon="close" label={t('tasks.editor.close')} className="sc-book-x" onClick={onClose} data-testid="edit-close" />
          </header>
          <div className="te-body te-body-col">
            {overLine && <p className="sc-edit-alert" role="status" data-testid="edit-over">{overLine}</p>}
            {piece && tasks.length > 0 && (
              <section className="sc-pop-tasks" aria-labelledby="task-popup-tasks" data-testid="edit-piece-tasks">
                <h3 id="task-popup-tasks" className="sc-pop-tasks-title">{t('schedule.sc.edit.tasksOf')}</h3>
                <ol className="sc-pop-tasks-list">
                  {tasks.map((x, i) => {
                    const mine = x.id === booking.subTaskId
                    const ask = asks.data?.get(x.id) ?? null
                    const askedWho = ask ? (ask.resourceName || ask.teamName || ask.departmentName || '') : ''
                    const pill: { tone: string; label: string } = mine
                      ? { tone: 'mine', label: t('schedule.sc.edit.thisOne') }
                      : ask && !x.assigneeId
                        ? { tone: 'asked', label: askedWho ? t('schedule.sc.edit.asked', { name: askedWho }) : t('campaigns.assign.status.askedAny') }
                        : !x.assigneeId
                          ? { tone: 'none', label: t('schedule.sc.edit.notBooked') }
                          : { tone: x.status === 'done' ? 'done' : 'booked', label: t(`schedule.sc.edit.step.${(['todo', 'in_progress', 'review', 'done'] as const).includes(x.status as 'todo') ? x.status : 'todo'}`) }
                    const who = x.assigneeName ?? (ask && !x.assigneeId ? (ask.teamName ? t('schedule.sc.edit.teamOf', { team: ask.teamName }) : askedWho) : t('schedule.sc.edit.nobody'))
                    const when = x.startsAt ? dayTiny(iraqDay(x.startsAt), lang, day) : null
                    return (
                      <li key={x.id} className={`sc-pop-task is-${pill.tone}`} aria-current={mine || undefined} data-testid={`edit-piece-task-${x.id}`}>
                        <span className="sc-pop-task-n" aria-hidden="true">{i + 1}</span>
                        <span className="sc-pop-task-text">
                          <span className="sc-pop-task-name">{stepOf(x.title, piece.name)}</span>
                          <span className="sc-pop-task-sub">{[who, when, x.hours != null ? t('schedule.sc.hours', { n: x.hours }) : null].filter(Boolean).join(' · ')}</span>
                        </span>
                        <span className={`sc-pop-task-pill is-${pill.tone}`} data-testid={`edit-piece-task-pill-${x.id}`}>{pill.label}</span>
                      </li>
                    )
                  })}
                </ol>
                <p className="sc-pop-tasks-note">{t('schedule.sc.edit.waitsOnly')}</p>
              </section>
            )}
            <div className="sc-edit-where" data-testid="edit-where">
              <span className="sc-edit-where-label">{t('schedule.sc.edit.where')}</span>
              <ol className="sc-edit-steps">
                {steps.map((st, i) => <li key={st} className={i === at ? 'is-on' : i < at ? 'is-past' : ''}>{t(`schedule.sc.edit.step.${st}`)}</li>)}
              </ol>
            </div>
            {task && task.reviewers.length > 0 && (
              <p className="te-hint" data-testid="edit-reviewer-name">
                {t('tasks.popup.reviewedBy')} <ReviewerNames reviewers={task.reviewers} testId="edit-reviewer-name" />
              </p>
            )}
            {list.isLoading || deps.isLoading || read.state === 'wait' ? (
              <p className="muted" data-testid="task-popup-loading">{t('tasks.editor.loading')}</p>
            ) : !task || !piece ? (
              <p className="muted" data-testid="task-popup-gone">{t('tasks.editor.gone')}</p>
            ) : !mayEditTasks({ isOwner: !!session?.user.id && piece.ownerUserId === session.user.id, scope, can }) ? (
              // I74.53: the account manager (and anyone else who may not edit its tasks) reads the task, not a form.
              <div className="te-foot" data-testid="task-popup-read-only">
                <p className="te-hint">{t('tasks.popup.readOnly')}</p>
                <Button variant="secondary" to={pieceHref(booking.campaignId, booking.deliverableId, booking.subTaskId)} data-testid="edit-open-piece">
                  {t('schedule.sc.edit.openPiece')}
                </Button>
              </div>
            ) : (
              <TaskEditorForm
                key={task.id}
                task={task}
                piece={piece}
                siblings={tasks}
                edges={deps.data ?? []}
                mayBook={can('bookings:create')}
                saveLabel={t('schedule.sc.edit.save')}
                onPastDue={(d) => setChangeAsk(d)}
                // Edward, 4 Oct: Save closes the pop-up — unless the move went past the deliverable's due date,
                // when the change form opens here instead (it lives in this pop-up).
                onSaved={(r) => { const due = piece.dueAt ? iraqDay(piece.dueAt) : null; if (!(r.movedTo && due && r.movedTo > due)) onClose() }}
                testId="edit-task"
                actions={
                  <>
                    <Button variant="secondary" to={pieceHref(booking.campaignId, booking.deliverableId, booking.subTaskId)} data-testid="edit-open-piece">
                      {t('schedule.sc.edit.openPiece')}
                    </Button>
                    {tasks.length > 1 && (
                      <Button variant="secondary" onClick={() => setAll(true)} data-testid="edit-all-tasks">{t('tasks.popup.editAll')}</Button>
                    )}
                  </>
                }
                actionsEnd={
                  <>
                    {task.assigneeId && (
                      <Button variant="link" className="danger" onClick={() => setAsking({ kind: 'cancel', started: task.started ? (task.assigneeName ?? first) : null })} data-testid="edit-cancel-booking">
                        {t('tasks.popup.cancelBooking')}
                      </Button>
                    )}
                    {!task.started && (
                      <Button variant="link" className="danger" onClick={() => setAsking({ kind: 'remove' })} data-testid="edit-remove-task">
                        {t('tasks.popup.removeTask')}
                      </Button>
                    )}
                  </>
                }
              />
            )}
            {error && <p className="form-error" role="alert" data-testid="edit-error">{error}</p>}
          </div>
          {asking?.kind === 'cancel' && (
            <div className="sc-pop-ask" role="alert" data-testid="edit-cancel-ask">
              <p className="sc-pop-ask-title">
                {asking.started ? t('tasks.popup.startedTakeOff', { name: asking.started }) : t('tasks.popup.cancelTitle', { name: first })}
              </p>
              <p>{t('tasks.popup.cancelText', { name: first, day: weekdayName(day, lang) })}</p>
              <div className="te-started-actions">
                <Button variant="danger" size="sm" busy={unassign.isPending} onClick={() => cancelBooking(asking.started != null)} data-testid="edit-cancel-yes">
                  {asking.started ? t('tasks.popup.takeOffYes') : t('tasks.popup.cancelYes')}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setAsking(null)} data-testid="edit-cancel-keep">{t('tasks.popup.keepIt')}</Button>
              </div>
            </div>
          )}
          {asking?.kind === 'remove' && task && (
            <div className="sc-pop-ask" role="alert" data-testid="edit-remove-ask">
              <p className="sc-pop-ask-title">{t('tasks.popup.removeTitle', { task: task.title })}</p>
              <p>{task.assigneeId
                ? t('tasks.popup.removeText', { name: first, day: weekdayName(task.startsAt ? iraqDay(task.startsAt) : day, lang), hours: task.hours ?? 0 })
                : t('tasks.popup.removeTextNobody')}</p>
              <div className="te-started-actions">
                <Button variant="danger" size="sm" busy={remove.isPending} onClick={removeTask} data-testid="edit-remove-yes">{t('tasks.popup.removeYes')}</Button>
                <Button variant="secondary" size="sm" onClick={() => setAsking(null)} data-testid="edit-remove-keep">{t('tasks.popup.keepIt')}</Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
      {all && (
        <TaskEditorDialog deliverableId={booking.deliverableId} taskId={booking.subTaskId} all onClose={() => setAll(false)}
          onPastDue={(_, d) => { setAll(false); setChangeAsk(d) }} testId="edit-all" />
      )}
      {changeAsk && (
        <ChangeAskDialog deliverableId={booking.deliverableId} fromSubTaskId={booking.subTaskId} initialDueDay={changeAsk} onClose={() => setChangeAsk(null)} />
      )}
    </>
  )
}
