import { useEffect, useRef, useState } from 'react'
import { BackButton } from '../../components/BackButton'
import { pieceHref } from '../../lib/navigation/piece-link'
import type { Origin } from '../../lib/navigation/origin'
import { useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { WaitingOn } from '../../components/WaitingOn'
import { PriorityMark } from '../../components/PriorityMark'
import { useAuth } from '../../app/auth-context'
import { usePermissions } from '../../app/permissions'
import { TaskEditorInline } from './components/TaskEditor'
import { TaskRowControls } from './components/TaskRowControls'
import { formatIraqDate, formatIraqDateTime, iraqDay } from '../../lib/time/iraq'
import { hasOwnNoteThisRound } from '../../lib/review/review-mode'
import { sortReviewers } from '../../lib/reviewers/task-reviewers'
import {
  useAssignedTask,
  useMarkTaskSeen,
  useStartSubTask,
  useSubmitSubTask,
  useTaskListRules,
  useTransitionDeliverable,
  type AssignedWorkItem,
} from './api/deliverables-api'
import { useDeliverableVersions, useTaskComments } from './api/review-api'
import { useLatestExtensionByTask } from './api/extensions-api'
import { useTaskDependencies } from './api/requirements-api'
import {
  fetchReferenceDownloadUrl,
  useAssetUrl,
  useCampaignReferencesFolderId,
  useReferenceFiles,
  useTaskBrief,
  useTaskReceipt,
  useTaskTimer,
} from './api/task-page-api'
import {
  useClearInput,
  usePieceQuestions,
  usePiecePeople,
  useRoundTiming,
  useTaskInputs,
  type TaskInput,
} from './api/requests-api'
import { ReviewPanel } from './ReviewPanel'
import { TaskReviewThread } from './TaskReviewThread'
import { TaskResources } from './TaskResources'
import { ChangesCameBack } from './components/ChangesCameBack'
import { useChangesCameBack } from './hooks/use-changes-came-back'
import { ExtensionControl } from './components/ExtensionControl'
import { AskMoreTime } from './components/AskMoreTime'
import { RequiredInput } from './components/RequiredInput'
import { WorkingFiles } from './components/WorkingFiles'
import { AskDialog } from './components/requests/AskDialog'
import { BlockDialog } from './components/requests/BlockDialog'
import { ReplyDialog } from './components/requests/ReplyDialog'
import { UntimedDialog } from './components/requests/SmallDialogs'
import { isChangesRequested } from './lib/needs-you'
import { errorText, joinNames, untimedRefusal } from './lib/requests-text'
import { canSend, formatMinutes, stepOf, TASK_STEPS, timerFigures, wouldBeUntimed } from './lib/task-page'
import { RISK_KEY } from '../../lib/brief/single-execution'

/** Back from the task page when there is no page before it: My Work, where tasks live (ADR-0132 d.7). */
const MY_WORK: Origin = { path: '/my-work', labelKey: 'back.myWork' }

/**
 * The task page (ADR-0105 d.3, I59.11, Figma M2 / M4) — `/my-work/task/:taskId`.
 *
 * Every function of the four pop-ups My Work's rows used to open lives here:
 * - **Deliverable** / **Review feedback** — the ReviewPanel (versions, pins, comments) under Your
 *   file, and the M4 arrangement when the latest round came back with changes;
 * - **Submit** — Your file (digital: this round's upload into the ReviewPanel; manual: the maker's
 *   note with an optional link) and Send for review, enabled by the same rules (`canSend`);
 * - **Ask for more time** — the ExtensionControl at the foot: ask, withdraw, the pending /
 *   answered line.
 * Plus what the plan adds from data that already exists: the brief, how the request came in, where
 * the task is, what it waits on, the rules, what is attached, the earlier rounds.
 *
 * The assignee works on it; anybody else who opens the link reads it (no Start, no Send, no upload).
 *
 * I59 Track 6 filled the slots the database tracks of 25 Sep opened: **Ask someone** (ADR-0113 d.2)
 * and **I'm blocked** (ADR-0107) at the foot; the **Questions** on the piece, with Reply; **Waiting
 * on** live — the task's own blocks and its deliverable's inputs, each clearable by whoever may; the
 * timer's **blocked** time, not counted (ADR-0107 d.3); the **untimed-round warning** before Send
 * and Send V2 (ADR-0106 d.2); the receipt's **screenshot**. I59 Track 11 placed Track 7's pin
 * controls (I59.29): Mark done / Undo / Reply on each pin of the previous round — the ReviewPanel
 * for a digital task, the manual thread for a manual one — and the To-fix list shows which are done.
 * Opening the page marks the task seen on the server (`mark_task_seen`), which is what takes it off
 * "New on you".
 */
export function TaskPage() {
  const { taskId } = useParams()
  const { t } = useTranslation()
  const task = useAssignedTask(taskId ?? null)

  if (task.isLoading) return <p className="muted" data-testid="task-page-loading">…</p>
  if (task.isError) return <p className="form-error" data-testid="task-page-error">{t('taskPage.loadFailed')}</p>
  if (!task.data) {
    return (
      <section className="task-page" data-testid="task-page-missing">
        <p className="muted">{t('taskPage.missing')}</p>
        <BackButton fallback={MY_WORK} testId="task-page-back" />
      </section>
    )
  }
  return <TaskPageBody item={task.data} />
}

function TaskPageBody({ item }: { item: AssignedWorkItem }) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const { session } = useAuth()
  const { can } = usePermissions()
  const myId = session?.user.id ?? null
  const mine = item.assigneeId != null && item.assigneeId === myId
  const id = item.subTaskId
  const thisRound = item.revisionRound + 1
  const isManual = item.reviewMode === 'manual'
  const changes = isChangesRequested(item)
  const step = stepOf(item)
  const digitalFile = !!item.deliverableId && !isManual

  // The same reads the retired Submit dialog made to decide whether Send is open.
  const versions = useDeliverableVersions(digitalFile ? item.deliverableId : null, id)
  const notes = useTaskComments(isManual ? id : null)
  const hasVersion = (versions.data ?? []).some((v) => v.round === thisRound)
  const hasNote = hasOwnNoteThisRound(notes.data ?? [], thisRound, myId)
  const sendable = canSend({
    status: item.status,
    hasDeliverable: !!item.deliverableId,
    isManual,
    hasVersionThisRound: hasVersion,
    hasOwnNoteThisRound: hasNote,
  })
  const gateLoading = digitalFile ? versions.isLoading : isManual ? notes.isLoading : false

  const start = useStartSubTask()
  const submit = useSubmitSubTask()
  const transition = useTransitionDeliverable()
  const extensions = useLatestExtensionByTask([id])
  const timing = useRoundTiming(id, mine && item.status === 'in_progress')
  const piecePeople = usePiecePeople(item.deliverableId, id)
  // Who edits the task here: the deliverable's owner, and whoever may manage task lists (the leads).
  const manages = (!!myId && piecePeople.data?.ownerId === myId) || can('project_tasks:manage')
  const [manageNote, setManageNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  // The untimed-round warning (ADR-0106 d.2): open with the allocation it names, or closed.
  const [untimed, setUntimed] = useState<{ hours: number | null } | null>(null)
  const [untimedError, setUntimedError] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [blocking, setBlocking] = useState(false)

  // A chip on My Work opens a part of this page (#task-brief, #task-rules, #task-attached).
  useScrollToHash()

  // Q38: the maker opening their task counts as seen — it leaves "New on you" on every device (I59:
  // `sub_tasks.assignee_seen_at`, stamped once by the server; only the assignee can).
  const markSeen = useMarkTaskSeen()
  const seenAsked = useRef<string | null>(null)
  const unseen = mine && !item.seenAt
  useEffect(() => {
    if (!unseen || seenAsked.current === id) return
    seenAsked.current = id
    markSeen.mutate(id)
  }, [unseen, id, markSeen])

  function send(acceptUntimed: boolean) {
    const done = () => {
      setUntimed(null)
      setUntimedError(null)
    }
    const refused = (err: unknown) => {
      // The server's own refusal of an untimed round is the warning's cue too (a race with the clock).
      const hours = untimedRefusal(err)
      if (hours !== undefined) {
        submit.reset()
        setUntimed({ hours: hours ?? timing.data?.allocatedHours ?? item.allocatedHours ?? null })
      } else if (acceptUntimed) {
        setUntimedError(errorText(err, t('myWork.actionFailed')))
      }
    }
    // A pure standalone task has nothing to attach and sends at once (ADR-0034/0035).
    if (!item.deliverableId) return submit.mutate({ subTaskId: id, acceptUntimed }, { onSuccess: done, onError: refused })
    submit.mutate(
      { subTaskId: id, acceptUntimed },
      {
        onSuccess: () => {
          done()
          // An ad-hoc deliverable IS this one task: sending readies it for its reviewer. A campaign
          // deliverable holds several tasks and stays with its owner. Best-effort.
          if (!item.campaignId && item.deliverableState === 'in_progress') {
            transition.mutate({ deliverableId: item.deliverableId!, to: 'in_review', expectedState: 'in_progress' })
          }
        },
        onError: refused,
      },
    )
  }

  /**
   * Send / Send V2: an untimed round is warned about first (plan View 6) — from the server's
   * round timing, read against the clock now. Unread, or read as timed, it is sent, and the
   * server's own refusal of an untimed round opens the same warning (`refused` above).
   */
  function onSend() {
    const r = timing.data
    if (r && wouldBeUntimed(r)) {
      setUntimedError(null)
      setUntimed({ hours: r.allocatedHours ?? item.allocatedHours ?? null })
      return
    }
    send(false)
  }

  // M4's foot: "Reply to a pin" opens the reply on the first pin still open (the To-fix list's own Reply).
  const m4 = useChangesCameBack(item, thisRound)
  function replyToFirstPin() {
    const list = document.querySelector('[data-testid="task-page-to-fix"]')
    const open = list?.querySelector<HTMLElement>('.task-fix-row:not(.is-done) [data-testid^="pin-reply-open-"]')
      ?? list?.querySelector<HTMLElement>('[data-testid^="pin-reply-open-"]')
    open?.scrollIntoView?.({ block: 'center' })
    open?.click()
  }

  const sendLabel = changes ? t('taskPage.sendAgain', { n: thisRound }) : t('myWork.action.submit')
  const reviewerNames = joinNames(item.reviewers.map((r) => r.name), t('requests.listAnd'), t('requests.listSep'))

  return (
    <section className="task-page" data-testid="task-page" data-task={id}>
      <BackButton fallback={MY_WORK} testId="task-page-back" />

      <TaskHeader item={item} changes={changes} loc={loc} />

      {!mine && !manages && <p className="muted" data-testid="task-page-not-yours">{t('taskPage.notYours')}</p>}

      {/* Edward, 27 Sep: the deliverable's owner and the leads who run its work edit the task HERE —
          its row from the task-list table, every control it has there (assignee, SLA, due, status,
          review, required input, resources, cancel, delete, notes). The database still decides reach
          and names who can when it refuses. */}
      {manages && item.deliverableId && (
        <section className="task-page-card task-page-manage" data-testid="task-page-manage">
          <h2 className="task-page-card-title">{t('taskPage.manage')}</h2>
          {manageNote && <p className={manageNote.kind === 'error' ? 'form-error' : 'notice notice-ok'} role="status" data-testid="task-page-manage-note">{manageNote.text}</p>}
          {/* The row's status changes, cancel/reinstate and Required input, beside the one editor (I74 fix-up). */}
          <TaskRowControls
            deliverableId={item.deliverableId}
            taskId={id}
            canReview={can('reviews:moderate')}
            onBanner={(b) => setManageNote({ kind: b.kind === 'error' ? 'error' : 'ok', text: b.text })}
          />
          {/* ADR-0140 d.1 (I74.7): the one task editor — every detail of this task — in place of the task-list row,
              with the task's resources as the row carried them. */}
          <TaskEditorInline deliverableId={item.deliverableId} taskId={id} testId="task-page-editor" />
          <TaskResources subTaskId={id} canManage compact />
        </section>
      )}

      {/* Figma M4: when the round came back with changes, the previous file and what to fix lead. */}
      {changes && digitalFile && <ChangesCameBack item={item} mine={mine} thisRound={thisRound} myId={myId} />}

      <div className="task-page-grid">
        <div className="task-page-main">
          <TaskBrief item={item} />
          {/* I57.45: the owner's notes for this task, written on the task list (Edward, 26 Sep). */}
          {item.notes && (
            <section className="task-page-card" data-testid="task-page-notes">
              <h2 className="task-page-card-title">{t('taskPage.notes')}</h2>
              <p className="task-page-notes" dir="auto">{item.notes}</p>
            </section>
          )}
          <TaskReceiptLine campaignId={item.campaignId} />
          <TaskQuestions item={item} myId={myId} />
          <PreviousRounds item={item} thisRound={thisRound} />
        </div>

        <aside className="task-page-side">
          <section className="task-page-card" data-testid="task-page-steps">
            <h2 className="task-page-card-title">{t('taskPage.whereItIs')}</h2>
            <ol className="task-steps">
              {TASK_STEPS.map((s) => (
                <li
                  key={s}
                  className={`task-step${s === step ? ' is-current' : ''}${TASK_STEPS.indexOf(s) < TASK_STEPS.indexOf(step) ? ' is-past' : ''}`}
                  data-testid={`task-page-step-${s}`}
                  data-current={s === step ? 'true' : undefined}
                  aria-current={s === step ? 'step' : undefined}
                >
                  {t(`taskPage.step.${s}`)}
                </li>
              ))}
            </ol>
          </section>

          {!(changes && digitalFile) && (
            <section className="task-page-card" data-testid="task-page-file">
              <h2 className="task-page-card-title">{t('taskPage.yourFile')}</h2>
              {/* ADR-0059 d.9: a manual task has a note, never an empty version rail. */}
              {isManual ? (
                mine ? (
                  // I59.29: the maker answers each note — Mark done · Undo · Reply.
                  <TaskReviewThread subTaskId={id} round={thisRound} role="maker" pinActions />
                ) : (
                  <p className="muted" data-testid="task-page-manual-readonly">{t('reviewMode.manualExplainer')}</p>
                )
              ) : item.deliverableId ? (
                <ReviewPanel deliverableId={item.deliverableId} subTaskId={id} isReadOnly={!mine} allowUpload={mine} />
              ) : (
                <p className="muted" data-testid="task-page-no-file">{t('taskPage.noFileNeeded')}</p>
              )}
            </section>
          )}

          {/* Figma M2: Your file follows Where it is; what the task waits on comes after it. */}
          <WaitingOnInputs item={item} mine={mine} ownerId={piecePeople.data?.ownerId ?? null} myId={myId} />
          <TaskRules item={item} />
          <AlreadyAttached item={item} />
        </aside>
      </div>

      {/* The foot: the maker's acts on their own task. */}
      <footer className="task-page-foot" data-testid="task-page-foot">
        {mine && item.status === 'todo' && step !== 'done' && (
          <Button
            // Before Start, Start IS the page's main action — filled, as M2 fills Send for review once it has begun.
            variant="primary"
            busy={start.isPending}
            data-testid={`my-work-start-${id}`}
            onClick={() => start.mutate(id)}
          >
            {start.isPending ? t('myWork.action.starting') : t('myWork.action.start')}
          </Button>
        )}
        {mine && item.status === 'in_progress' && (
          <Button
            variant="primary"
            busy={submit.isPending}
            disabled={!sendable}
            data-testid={`my-work-submit-${id}`}
            onClick={onSend}
          >
            {submit.isPending ? t('myWork.action.submitting') : sendLabel}
          </Button>
        )}
        {mine && item.status === 'in_progress' && !sendable && !gateLoading && digitalFile && (
          <span className="muted" data-testid={`my-work-submit-needs-file-${id}`}>
            {item.revisionRound > 0 ? t('myWork.submit.noneThisRound') : t('myWork.submit.noneAttached')}
          </span>
        )}
        {/* ADR-0134 d.24: optional working files beside Send — into the piece's Library folder, marked SOURCE. */}
        {mine && item.status === 'in_progress' && item.deliverableId && (
          <WorkingFiles deliverableId={item.deliverableId} subTaskId={id} />
        )}
        {mine && changes && digitalFile && step !== 'done' && m4.pins.some((c) => c.authorId !== myId) && (
          <Button variant="secondary" data-testid="task-page-reply-to-pin" onClick={replyToFirstPin}>
            {t('taskPage.replyToPin')}
          </Button>
        )}
        {mine && step !== 'done' && (
          <Button variant="secondary" data-testid="task-page-ask" onClick={() => setAsking(true)}>
            {t('requests.ask.button')}
          </Button>
        )}
        {mine && step !== 'done' && item.deliverableId && (
          <Button variant="secondary" tone="caution" className="task-page-blocked" data-testid="task-page-blocked-open" onClick={() => setBlocking(true)}>
            {t('requests.block.button')}
          </Button>
        )}
        {mine && step !== 'done' && <AskMoreTime subTaskId={id} dueAt={item.dueAt} />}
        {step !== 'done' && (
          <ExtensionControl
            subTaskId={id}
            taskTitle={item.title}
            latest={extensions.data?.get(id)}
            canRequest={mine}
            viewerId={myId}
            committedDueAt={item.committedDueAt}
            deliverableDueAt={item.deliverableDueAt}
            goLiveAt={item.goLiveAt}
            testId={`my-work-extension-${id}`}
          />
        )}
        {can('project_tasks:manage') && item.deliverableId && item.campaignId && (
          <Button
            to={pieceHref(item.campaignId, item.deliverableId, id)}
            variant="link"
            data-testid="task-page-deliverable-link"
          >
            {t('taskPage.inDeliverables')}
          </Button>
        )}
      </footer>

      {(start.error || (submit.error && !untimed)) && (
        <p className="form-error" data-testid={submit.error ? `my-work-submit-error-${id}` : `my-work-error-${id}`}>
          {((submit.error ?? start.error) as Error).message || t('myWork.actionFailed')}
        </p>
      )}

      {untimed && (
        <UntimedDialog
          allocatedHours={untimed.hours}
          reviewerNames={reviewerNames}
          busy={submit.isPending}
          error={untimedError}
          onSend={() => send(true)}
          onCancel={() => {
            setUntimed(null)
            setUntimedError(null)
            submit.reset()
          }}
        />
      )}
      {asking && (
        <AskDialog
          deliverableId={item.deliverableId}
          subTaskId={id}
          pieceLabel={[item.title, item.deliverableName].filter(Boolean).join(' · ')}
          meId={myId}
          onClose={() => setAsking(false)}
        />
      )}
      {blocking && item.deliverableId && (
        <BlockDialog
          deliverableId={item.deliverableId}
          subTaskId={id}
          taskTitle={item.title}
          ownerName={piecePeople.data?.ownerName ?? null}
          accountManagerName={piecePeople.data?.accountManagerName ?? null}
          onClose={() => setBlocking(false)}
        />
      )}
    </section>
  )
}

/** A chip's `#part` is scrolled to once the part has rendered. */
function useScrollToHash() {
  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : ''
    if (!hash) return
    let tries = 0
    const timer = window.setInterval(() => {
      const el = document.getElementById(hash)
      tries += 1
      if (el) {
        el.scrollIntoView?.({ block: 'start' })
        window.clearInterval(timer)
      } else if (tries > 20) window.clearInterval(timer)
    }, 150)
    return () => window.clearInterval(timer)
  }, [])
}

// ------------------------------------------------------------------------- header ----

function TaskHeader({ item, changes, loc }: { item: AssignedWorkItem; changes: boolean; loc: 'en' | 'ar' }) {
  const { t } = useTranslation()
  // The time entry's round IS the task's `revision_number` (0 for the first round) — what
  // `sub_task_start` / `sub_task_submit` write (ADR-0030). "v1" is only how the header SAYS it.
  const timer = useTaskTimer(item.subTaskId, item.revisionRound)
  const running = useRoundTiming(item.subTaskId, item.status === 'in_progress' && !timer.data?.submittedAt)
  const now = useMinuteClock()
  const figures = timerFigures(timer.data, running.data, now)
  const minutes = figures.timed
  const reviewers = sortReviewers(item.reviewers).map((r) => r.name ?? '—').join(', ') || '—'

  return (
    <header className="task-page-head">
      <div className="task-page-title-row">
        <h1 data-testid="task-page-title">
          {item.title}
          {item.priority && <PriorityMark priority={item.priority} testId={`my-work-priority-${item.subTaskId}`} />}
        </h1>
        <span
          className={`state-badge ${changes ? 'state-changes' : ''}`}
          data-testid="task-page-status"
          data-status={changes ? 'changes' : item.status}
        >
          {changes ? t('myWork.changesRequested') : t(`deliverables.subStatus.${item.status}`)}
        </span>
        {item.reviewMode === 'manual' && (
          <span className="state-badge" data-testid={`my-work-review-mode-${item.subTaskId}`}>{t('reviewMode.manual')}</span>
        )}
        <span className="my-work-due muted" data-testid="task-page-due">
          {item.dueAt ? t('myWork.due', { date: formatIraqDateTime(item.dueAt, loc) }) : t('myWork.noDue')}
        </span>
        {item.committedDueAt && item.dueAt && iraqDay(item.committedDueAt) !== iraqDay(item.dueAt) && (
          <span className="my-work-due cell-warn" data-testid={`my-work-committed-${item.subTaskId}`}>
            {t('deadlineExtension.committed', { date: formatIraqDate(item.committedDueAt, loc) })}
          </span>
        )}
      </div>

      <p className="muted task-page-context" data-testid="task-page-context">
        {[item.isAdhoc || !item.campaignId ? t('myWork.adhoc') : item.deliverableName, item.campaignName, item.discipline]
          .filter(Boolean)
          .join(' · ')}
        {item.deliverableId ? ` · v${item.revisionRound + 1}` : ''}
      </p>

      <p className="muted task-page-people" data-testid="task-page-people">
        {item.assignedAt
          ? t('taskPage.gaveIt', { name: item.assignerName ?? '—', date: formatIraqDate(item.assignedAt, loc) })
          : t('myWork.assignedBy', { name: item.assignerName ?? '—' })}
        {' · '}
        {item.status === 'review' && item.reviewers.some((r) => r.approvedAt == null) ? (
          <WaitingOn reviewers={item.reviewers} testId={`my-work-waiting-on-${item.subTaskId}`} />
        ) : (
          t('myWork.reviewedBy', { name: reviewers })
        )}
        {item.allocatedHours != null && (
          <span data-testid="task-page-hours">{' · '}{t('taskPage.allocated', { hours: item.allocatedHours })}</span>
        )}
        {timer.data?.startedAt && (
          <span data-testid="task-page-timer">
            {' · '}
            {t('taskPage.startedAt', { time: formatIraqDateTime(timer.data.startedAt, loc) })}
            {minutes != null
              ? ` · ${figures.untimed ? t('requests.timer.untimed', { time: formatMinutes(minutes) }) : t('taskPage.timed', { time: formatMinutes(minutes) })}`
              : ''}
            {figures.blocked > 0 && (
              <span data-testid="task-page-blocked-time">
                {' · '}
                {t('requests.timer.blocked', { time: formatMinutes(figures.blocked) })}
              </span>
            )}
          </span>
        )}
      </p>
    </header>
  )
}

/** Re-renders once a minute, so a running timer's "time so far" moves. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

// ------------------------------------------------------------ left: brief and history ----

function TaskBrief({ item }: { item: AssignedWorkItem }) {
  const { t, i18n } = useTranslation()
  const brief = useTaskBrief(item.campaignId, item.deliverableId ?? null)
  const ar = i18n.language.startsWith('ar')
  return (
    <section className="task-page-card" id="task-brief" data-testid="task-page-brief">
      <h2 className="task-page-card-title">{t('taskPage.brief')}</h2>
      {brief.isLoading ? (
        <p className="muted">…</p>
      ) : !brief.data || brief.data.length === 0 ? (
        <p className="muted" data-testid="task-page-brief-none">{t('taskPage.briefNone')}</p>
      ) : (
        <dl className="task-brief-fields">
          {brief.data.map((f) => (
            <div key={f.key} className={`task-brief-field${f.value.trim() ? '' : ' is-empty'}`}>
              {/* A single job's "what could stop this" is not a template field, so the read hands it back
                  under its key; it is named as the request step names it, never as `whatCouldStopThis`. */}
              <dt>{f.labelKey ? t(f.labelKey) : f.key === RISK_KEY ? t('intake.brief.risk') : ar && f.ar ? f.ar : f.en}</dt>
              <dd dir="auto" data-testid={`task-page-brief-${f.key}`}>
                {f.value.trim() ? f.value : t('campaigns.briefView.notWritten')}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

/** How the request came in (ADR-0066): the recorded receipt and its screenshot. Hidden when none was recorded. */
function TaskReceiptLine({ campaignId }: { campaignId: string | null }) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const receipt = useTaskReceipt(campaignId)
  const shot = useAssetUrl(receipt.data?.assetId ?? null)
  if (!receipt.data) return null
  const r = receipt.data
  return (
    <section className="task-page-card task-page-receipt" data-testid="task-page-receipt">
      <h2 className="task-page-card-title">{t('taskPage.cameIn')}</h2>
      <p>
        {r.subject ? <span dir="auto">{r.subject}</span> : null}
        {r.receivedAt ? `${r.subject ? ' · ' : ''}${formatIraqDateTime(r.receivedAt, loc)}` : ''}
        {r.recordedBy ? ` · ${t('taskPage.recordedBy', { name: r.recordedBy })}` : ''}
      </p>
      {r.assetId && shot.data && (
        <img className="task-receipt-shot" src={shot.data} alt={t('requests.receiptShot')} data-testid="task-page-receipt-shot" />
      )}
      {r.assetId && shot.isError && (
        <p className="muted" data-testid="task-page-receipt-shot-error">{t('requests.receiptShotFailed')}</p>
      )}
    </section>
  )
}

/**
 * Questions (plan View 4, ADR-0113 d.2): every question asked about this piece and its replies,
 * newest first. A question sent to me that I have not answered has Reply. Hidden when there are none.
 */
function TaskQuestions({ item, myId }: { item: AssignedWorkItem; myId: string | null }) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const questions = usePieceQuestions(item.deliverableId, item.subTaskId)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const list = questions.data ?? []
  if (list.length === 0) return null
  const open = list.find((q) => q.id === replyTo) ?? null
  const names = (ns: { name: string | null }[]) => joinNames(ns.map((n) => n.name), t('requests.listAnd'), t('requests.listSep')) ?? '—'

  return (
    <section className="task-page-card task-questions" data-testid="task-page-questions">
      <h2 className="task-page-card-title">{t('requests.questions.title')}</h2>
      <ul className="task-page-lines">
        {list.map((q) => {
          const mayReply = !!myId && q.recipients.some((r) => r.id === myId) && !q.replies.some((r) => r.authorId === myId)
          return (
            <li key={q.id} className="task-question" data-testid={`task-page-question-${q.id}`}>
              <p>
                <b>{q.authorName ?? '—'}</b> → {names(q.recipients)}: <span dir="auto">“{q.body}”</span>
                <span className="muted"> · {formatIraqDateTime(q.createdAt, loc)}</span>
              </p>
              {q.replies.map((r) => (
                <p key={r.id} className="task-question-reply" data-testid={`task-page-reply-${r.id}`}>
                  <b>{r.authorName ?? '—'}</b>: <span dir="auto">“{r.body}”</span>
                </p>
              ))}
              {mayReply && (
                <Button variant="secondary" size="sm" data-testid={`task-page-question-reply-${q.id}`} onClick={() => setReplyTo(q.id)}>
                  {t('requests.reply.button')}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {open && (
        <ReplyDialog
          questionId={open.id}
          askerName={open.authorName}
          question={open.body}
          pieceLabel={item.deliverableName ?? item.title}
          onClose={() => setReplyTo(null)}
        />
      )}
    </section>
  )
}

/** Earlier rounds, folded — what the Review feedback pop-up was read for. */
function PreviousRounds({ item, thisRound }: { item: AssignedWorkItem; thisRound: number }) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const isManual = item.reviewMode === 'manual'
  const versions = useDeliverableVersions(!isManual && item.revisionRound > 0 ? item.deliverableId : null, item.subTaskId)
  const notes = useTaskComments(isManual && item.revisionRound > 0 ? item.subTaskId : null)
  if (item.revisionRound === 0) return null

  const earlier = isManual
    ? [...new Set((notes.data ?? []).filter((c) => c.round < thisRound).map((c) => c.round))].sort((a, b) => a - b).map((round) => ({
        round,
        line: t('taskPage.roundNotes', { count: (notes.data ?? []).filter((c) => c.round === round).length }),
      }))
    : (versions.data ?? [])
        .filter((v) => v.round < thisRound)
        .sort((a, b) => a.version - b.version)
        .map((v) => ({
          round: v.round,
          line: [t('review.version', { n: v.version }), v.uploadedByName, formatIraqDate(v.createdAt, loc)].filter(Boolean).join(' · '),
        }))

  return (
    <details className="task-page-card task-page-rounds" data-testid="task-page-rounds">
      <summary data-testid="task-page-rounds-toggle">{t('taskPage.previousRounds', { count: item.revisionRound })}</summary>
      {earlier.length === 0 ? (
        <p className="muted">{t('taskPage.noEarlier')}</p>
      ) : (
        <ul className="task-page-lines">
          {earlier.map((e, i) => (
            <li key={`${e.round}-${i}`} data-testid={`task-page-round-${e.round}`}>
              <b>{t('review.roundLabel', { n: e.round })}</b> · {e.line}
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}

// ------------------------------------------------------------- right: the side cards ----

/**
 * What the task waits on (ADR-0069, ADR-0107) — live: the tasks it depends on (the Deliverables
 * page's Required input, read only), then each outstanding input with who has it and since when —
 * the task's own blocks ("I'm blocked") and its deliverable's. The maker or the deliverable's owner
 * clears a block on the task (ADR-0107 d.2); an input on the whole deliverable is cleared by
 * whoever manages the piece's tasks (its RLS). A cleared block is not re-opened — raise a new one.
 */
function WaitingOnInputs({ item, mine, ownerId, myId }: { item: AssignedWorkItem; mine: boolean; ownerId: string | null; myId: string | null }) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const { can } = usePermissions()
  const deps = useTaskDependencies(item.deliverableId)
  const inputs = useTaskInputs(item.deliverableId, item.subTaskId)
  const clear = useClearInput()
  const [error, setError] = useState<string | null>(null)
  if (!item.deliverableId) return null
  const outstanding = (inputs.data ?? []).filter((i) => i.satisfiedAt === null)
  const mayClear = (i: TaskInput) =>
    i.subTaskId ? mine || (!!myId && ownerId === myId) || can('project_tasks:manage') : can('project_tasks:manage')

  return (
    <section className="task-page-card" data-testid="task-page-waiting">
      <h2 className="task-page-card-title">{t('taskPage.waitingOn')}</h2>
      <RequiredInput
        subTaskId={item.subTaskId}
        deliverableId={item.deliverableId}
        dependencies={deps.data ?? []}
        candidates={[]}
        externalInputs={[]}
        canManage={false}
      />
      {outstanding.length > 0 && (
        <ul className="task-page-lines task-inputs" data-testid="task-page-inputs">
          {outstanding.map((i) => (
            <li key={i.id} className="task-input" data-testid={`task-page-input-${i.id}`} data-own={i.subTaskId ? 'task' : 'deliverable'}>
              <span>
                {i.kind && <span className="task-rule-kind">{t(`requests.blockKind.${i.kind}`)}</span>}{' '}
                {i.awaitedFrom ? t('requests.waitingOnWho', { who: i.awaitedFrom }) : null}
                {i.awaitedFrom ? ' · ' : ''}
                <span dir="auto">{i.description}</span>
                <span className="muted"> · {t('requests.sinceDate', { date: formatIraqDateTime(i.requestedAt, loc) })}</span>
              </span>
              {mayClear(i) && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon="check"
                  busy={clear.isPending && clear.variables === i.id}
                  disabled={clear.isPending}
                  data-testid={`task-page-input-clear-${i.id}`}
                  onClick={() => {
                    setError(null)
                    clear.mutate(i.id, { onError: (e) => setError(errorText(e, t('requests.failed'))) })
                  }}
                >
                  {i.subTaskId ? t('requests.block.clear') : t('requests.received.button')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="form-error" data-testid="task-page-input-error">{error}</p>}
    </section>
  )
}

/** The rules this piece follows (Q26): plain lines, never ticks. Hidden when there are none. */
function TaskRules({ item }: { item: AssignedWorkItem }) {
  const { t } = useTranslation()
  const rules = useTaskListRules(item.campaignId, item.deliverableId ?? null)
  const list = rules.data ?? []
  if (list.length === 0) return null
  return (
    <section className="task-page-card" id="task-rules" data-testid="task-page-rules">
      <h2 className="task-page-card-title">{t('taskPage.rules')}</h2>
      <ul className="task-page-lines task-rules">
        {list.map((r, i) => (
          <li key={i} className={`task-rule task-rule-${r.kind}`} data-testid={`task-page-rule-${i}`}>
            <span className="task-rule-kind">{t(`taskPage.ruleKind.${r.kind}`)}</span> <span dir="auto">{r.text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Already attached: what the task needs (TaskResources, read only) and the campaign's reference files. */
function AlreadyAttached({ item }: { item: AssignedWorkItem }) {
  const { t } = useTranslation()
  const folder = useCampaignReferencesFolderId(item.campaignId)
  const files = useReferenceFiles(folder.data ?? null)
  const [error, setError] = useState<string | null>(null)
  const list = files.data ?? []

  async function download(ids: string[]) {
    setError(null)
    try {
      for (const assetId of ids) {
        const url = await fetchReferenceDownloadUrl(assetId)
        // An anchor per file rather than window.open, so "Download all" is not stopped as pop-ups.
        const a = document.createElement('a')
        a.href = url
        a.download = ''
        a.rel = 'noopener'
        document.body.appendChild(a)
        a.click()
        a.remove()
      }
    } catch {
      setError(t('library.downloadFailed'))
    }
  }

  return (
    <section className="task-page-card" id="task-attached" data-testid="task-page-attached">
      <h2 className="task-page-card-title">{t('taskPage.attached')}</h2>
      <TaskResources subTaskId={item.subTaskId} canManage={false} compact />
      {list.length > 0 && (
        <>
          <h3 className="task-page-sub">{t('taskPage.references')}</h3>
          <ul className="task-page-lines">
            {list.map((f) => (
              <li key={f.id} className="task-ref" data-testid={`task-page-ref-${f.id}`}>
                <span dir="auto">{f.name}</span>
                <Button
                  variant="secondary" size="sm" icon="download"
                  data-testid={`task-page-ref-download-${f.id}`}
                  onClick={() => void download([f.id])}
                >
                  {t('library.download')}
                </Button>
              </li>
            ))}
          </ul>
          {list.length > 1 && (
            <Button variant="secondary" size="sm" icon="download" data-testid="task-page-ref-download-all" onClick={() => void download(list.map((f) => f.id))}>
              {t('taskPage.downloadAll')}
            </Button>
          )}
        </>
      )}
      {error && <p className="form-error" data-testid="task-page-ref-error">{error}</p>}
    </section>
  )
}
