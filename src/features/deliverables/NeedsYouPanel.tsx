import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { formatIraqDate, formatIraqDateTime } from '../../lib/time/iraq'
import { Button, type ButtonTone } from '../../components/Button'
import { WaitingOn } from '../../components/WaitingOn'
import { useAuth } from '../../app/auth-context'
import { AssignmentRequestActions } from '../notifications/AssignmentRequestActions'
import { type AssignedWorkItem, type AwaitingReviewItem } from './api/deliverables-api'
import { useNeedsYouItems } from './api/use-needs-you-items'
import { useAnswerTooMuch, useCloseChangeRequest } from './api/requests-api'
import {
  clockOf,
  groupNeedsYou,
  type NeedsYouAction,
  type NeedsYouDialog,
  type NeedsYouItem,
  type PendingApprovalRow,
  type Span,
  type UnassignedPiece,
} from './lib/needs-you'
import {
  type ChangeRequestRow,
  type MessageRow,
} from './lib/needs-you-requests'
import { errorText } from './lib/requests-text'
import { ReviewerModal } from './components/ReviewerModal'
import { NeedsYouDialogHost } from './components/requests/NeedsYouDialogHost'

/**
 * "Needs you" (ADR-0105 d.2, I59.10) — one list of everything asking the signed-in person to act,
 * grouped by the clock: today or it slips · this week · quietly, most urgent first.
 *
 * It replaces "Waiting for you" (I53.16) and "Awaiting my review" (ADR-0035) on My Work, and every
 * row either had keeps what it showed and did, with the same test ids: an approval names its kind
 * and opens where it is answered, a booking request is answered in place, a review card names the
 * maker, who is still owed, whether mine is required, manual or digital, the piece's state and due
 * date, and Review opens the same modal. Its own sources: Assign (the owner's unassigned tasks),
 * Changes came back and New on you (the maker's) — and, from the database tracks of 25 Sep (I59
 * Track 6, plan View 3): Someone is blocked, the extension's two steps, a change request and its
 * push-back / decline, Too much, Over capacity, Escalated to you, Waiting on the client, Reduced
 * scope not acknowledged, A question for you.
 *
 * Every card with a clock says it in real time — "waiting 26 hours · escalates in 4 hours" — from
 * the tenant's escalation rules (ADR-0108), which is what the groups sort on (D1). A button opens
 * its dialog here (View 6) or acts in place; nothing is decided on the client.
 *
 * The sources and the one item shape are in `lib/needs-you.ts` and `lib/needs-you-requests.ts`.
 * Shown when there is at least one item; a source that fails to load says so rather than leaving a
 * blank that reads as "nothing is waiting".
 */

export function NeedsYouPanel() {
  const { t, i18n } = useTranslation()
  const { session } = useAuth()
  const myId = session?.user.id ?? null
  const loc = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const navigate = useNavigate()

  const { items: allItems, pending, awaiting, unassigned, src } = useNeedsYouItems(myId)
  // I74.26: an ask from another team has its own card on top of My work (AsksFromOtherTeams), with its clock.
  const items = allItems.filter((i) => i.kind !== 'booking_request')

  const [openReviewId, setOpenReviewId] = useState<string | null>(null)
  const [open, setOpen] = useState<{ item: NeedsYouItem; dialog: NeedsYouDialog; mode?: string } | null>(null)
  const [actError, setActError] = useState<{ id: string; text: string } | null>(null)
  const closeChange = useCloseChangeRequest()
  const answerTooMuch = useAnswerTooMuch()

  const sections = groupNeedsYou(items)
  const failed = (q: { isError: boolean; error: unknown }, id: string) =>
    q.isError ? { id, text: errorText(q.error, t('needsYou.loadFailed')) } : null
  const errors = [
    pending.isError && { id: 'waiting-for-you-load-error', text: (pending.error as Error)?.message || t('waitingForYou.loadFailed') },
    awaiting.isError && { id: 'awaiting-review-load-error', text: (awaiting.error as Error)?.message || t('awaitingReview.actionFailed') },
    unassigned.isError && { id: 'needs-you-assign-load-error', text: (unassigned.error as Error)?.message || t('needsYou.loadFailed') },
    failed(src.blocks, 'needs-you-blocks-load-error'),
    failed(src.extensions, 'needs-you-extensions-load-error'),
    failed(src.changes, 'needs-you-changes-load-error'),
    failed(src.messages, 'needs-you-messages-load-error'),
    failed(src.overload, 'needs-you-overload-load-error'),
    failed(src.escalations, 'needs-you-escalations-load-error'),
    failed(src.client, 'needs-you-client-load-error'),
    failed(src.scope, 'needs-you-scope-load-error'),
    failed(src.changeAsks, 'needs-you-change-asks-load-error'),
  ].filter((e): e is { id: string; text: string } => !!e)

  if (items.length === 0 && errors.length === 0) return null

  const openReview = (awaiting.data ?? []).find((r) => r.subTaskId === openReviewId) ?? null

  function onAct(item: NeedsYouItem, action: Extract<NeedsYouAction, { type: 'act' }>) {
    setActError(null)
    const fail = (e: unknown) => setActError({ id: item.id, text: errorText(e, t('requests.failed')) })
    if (action.act === 'change_close') {
      closeChange.mutate((item.ref as ChangeRequestRow).id, { onError: fail })
      return
    }
    answerTooMuch.mutate(
      { messageId: (item.ref as MessageRow).id, answer: action.act === 'too_much_rebalance' ? 'rebalance' : 'keep' },
      { onSuccess: () => { if (action.to) void navigate(action.to) }, onError: fail },
    )
  }

  const handlers = {
    onReview: (it: NeedsYouItem) => setOpenReviewId(it.id),
    onDialog: (it: NeedsYouItem, a: Extract<NeedsYouAction, { type: 'dialog' }>) => setOpen({ item: it, dialog: a.dialog, mode: a.mode }),
    onAct,
    busy: closeChange.isPending || answerTooMuch.isPending,
  }

  return (
    <section className="my-work-panel needs-you" data-testid="needs-you-panel">
      <header className="schedule-bar">
        <h2>{t('needsYou.heading')} <span className="muted">({items.length})</span></h2>
      </header>

      {errors.map((e) => (
        <p key={e.id} className="form-error" data-testid={e.id}>{e.text}</p>
      ))}

      {sections.map((s) => (
        <div key={s.group} className={`ny-group ny-group-${s.group}`} data-testid={`needs-you-group-${s.group}`}>
          <div className="ny-group-head">
            <h3 className="ny-group-label">{t(`needsYou.group.${s.group}`)}</h3>
            <span className="ny-group-count" data-testid={`needs-you-count-${s.group}`}>{t('needsYou.groupCount', { count: s.items.length })}</span>
          </div>
          <ul className="my-work-list ny-list">
            {s.items.map((it) => (
              <NeedsYouCard
                key={`${it.kind}-${it.id}`}
                item={it}
                group={s.group}
                loc={loc}
                handlers={handlers}
                error={actError?.id === it.id ? actError.text : null}
              />
            ))}
          </ul>
        </div>
      ))}

      {openReview && <ReviewerModal item={openReview} onClose={() => setOpenReviewId(null)} />}
      {open && (
        <NeedsYouDialogHost item={open.item} dialog={open.dialog} mode={open.mode} meId={myId} onClose={() => setOpen(null)} />
      )}
    </section>
  )
}

const APPROVAL_KINDS = new Set(['department_brief', 'department_brief_unwritten', 'task_list', 'task_list_undefined', 'tasks_all_cancelled', 'booking_request', 'extension_request', 'campaign', 'handover'])

/**
 * What a card is ABOUT, read off its source row (I59.45): the task, the deliverable, the person. An
 * email or the bell opens `/my-work?task=<id>&kind=<kind>` and My Work finds the card by these —
 * a card's own id is a question's, an input's or a request's, which a notification never names.
 */
function aboutOf(it: NeedsYouItem): { task?: string; deliverable?: string; resource?: string } {
  const r = (it.ref ?? {}) as Record<string, unknown>
  const s = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
  return { task: s(r.subTaskId), deliverable: s(r.deliverableId), resource: s(r.resourceId) }
}

/** The row's own test id — the old panels' ids where the row came from one of them. */
function rowTestId(it: NeedsYouItem): string {
  if (APPROVAL_KINDS.has(it.kind)) return `waiting-for-you-${it.kind}-${it.id}`
  if (it.kind === 'review') return `awaiting-review-item-${it.id}`
  return `needs-you-${it.kind}-${it.id}`
}

interface Handlers {
  onReview: (it: NeedsYouItem) => void
  onDialog: (it: NeedsYouItem, a: Extract<NeedsYouAction, { type: 'dialog' }>) => void
  onAct: (it: NeedsYouItem, a: Extract<NeedsYouAction, { type: 'act' }>) => void
  busy: boolean
}

/** "26 hours" / "3 days" / "45 minutes" (Settled, 25 Sep). */
function useSpanText() {
  const { t } = useTranslation()
  return (s: Span) => t(`requests.span.${s.unit}`, { count: s.n })
}

/** The clock line: "waiting 26 hours · escalates in 4 hours", or "came back 2 hours ago". */
function ClockLine({ item }: { item: NeedsYouItem }) {
  const { t } = useTranslation()
  const span = useSpanText()
  const c = clockOf(item)
  const parts: string[] = []
  if (c.waited) parts.push(item.kind === 'changes_back' ? t('requests.clock.cameBack', { span: span(c.waited) }) : t('requests.clock.waiting', { span: span(c.waited) }))
  if (c.escalatesIn) parts.push(t('requests.clock.escalatesIn', { span: span(c.escalatesIn) }))
  if (c.escalatedAgo) parts.push(t('requests.clock.escalatedAgo', { span: span(c.escalatedAgo) }))
  if (parts.length === 0) return null
  return (
    <span className={`ny-clock${c.escalatedAgo ? ' is-late' : ''}`} data-testid={`needs-you-clock-${item.id}`}>
      {parts.join(' · ')}
    </span>
  )
}

function NeedsYouCard({
  item,
  group,
  loc,
  handlers,
  error,
}: {
  item: NeedsYouItem
  group: string
  loc: 'en' | 'ar'
  handlers: Handlers
  error: string | null
}) {
  const { t } = useTranslation()
  const approval = APPROVAL_KINDS.has(item.kind)
  const review = item.kind === 'review' ? (item.ref as AwaitingReviewItem) : null
  const task = item.kind === 'changes_back' || item.kind === 'new_on_you' ? (item.ref as AssignedWorkItem) : null
  const piece = item.kind === 'assign' ? (item.ref as UnassignedPiece) : null

  const kindLabel = approval ? t(`waitingForYou.kind.${item.kind}`) : t(`needsYou.kind.${item.kind}`)
  const kindTestId = approval ? `waiting-for-you-kind-${item.id}` : `needs-you-kind-${item.id}`

  const about = aboutOf(item)
  return (
    <li
      data-testid={rowTestId(item)} data-kind={item.kind} data-group={group} className={`ny-card ny-card-${group}`}
      data-id={item.id} data-task={about.task} data-deliverable={about.deliverable} data-resource={about.resource}
    >
      {/* Figma NY-*: the kind as a shaded pill, the title in bold on its line (with the review's
          badges and the due date at the end), then one line of context under it. */}
      <div className="ny-card-head">
        <span className={`ny-kind ny-kind-${group}`} data-testid={kindTestId}>{kindLabel}</span>
        <span className="my-work-title" dir="auto">{item.title}</span>
        <span className="my-work-tail">
          {review?.reviewMode === 'manual' && (
            <span className="state-badge" data-testid={`awaiting-review-mode-${item.id}`}>{t('reviewMode.manual')}</span>
          )}
          {review?.mineIsMandatory && (
            <span className="reviewer-required-badge" data-testid={`awaiting-review-mine-mandatory-${item.id}`}>
              {t('reviewers.yoursIsRequired')}
            </span>
          )}
          {review?.deliverableState && (
            <span className={`state-badge state-${review.deliverableState}`}>{t(`deliverables.state.${review.deliverableState}`)}</span>
          )}
          {(review || task || piece) && (
            <span className="my-work-due muted" data-testid={`needs-you-due-${item.id}`}>
              {item.clock.dueAt ? t('myWork.due', { date: formatIraqDateTime(item.clock.dueAt) }) : t('myWork.noDue')}
            </span>
          )}
        </span>
      </div>

      <div className="ny-card-body">
        {review ? (
          <span className="my-work-meta muted">
            <span data-testid={`awaiting-review-context-${item.id}`}>
              {item.context}{item.context ? ' · ' : ''}
            </span>
            {t('awaitingReview.by', { name: review.assigneeName ?? '—' })}
            {' · '}
            <WaitingOn reviewers={review.reviewers} testId={`awaiting-review-waiting-on-${item.id}`} />
          </span>
        ) : approval ? (
          <span className="my-work-meta muted">
            {item.context}
            {item.since ? `${item.context ? ' · ' : ''}${t('waitingForYou.since', { date: formatIraqDate(item.since, loc) })}` : ''}
          </span>
        ) : item.context ? (
          <span className="my-work-meta muted" dir="auto" data-testid={`needs-you-context-${item.id}`}>{item.context}</span>
        ) : null}

        <ClockLine item={item} />

        {piece && (
          <span className="muted" data-testid={`needs-you-assign-count-${item.id}`}>
            {t('needsYou.assignCount', { count: piece.unassignedCount })}
          </span>
        )}
        {item.kind === 'changes_back' && task && (
          <span className="muted" data-testid={`needs-you-changes-round-${item.id}`}>
            {task.revisionLimit
              ? t('needsYou.roundOf', { n: task.revisionRound, limit: task.revisionLimit })
              : t('needsYou.round', { n: task.revisionRound })}
          </span>
        )}
      </div>

      <div className="my-work-actions">
        <Action action={item.primary} item={item} primary handlers={handlers} />
        {item.secondary && <Action action={item.secondary} item={item} handlers={handlers} />}
      </div>
      {error && <p className="form-error" role="alert" data-testid={`needs-you-error-${item.id}`}>{error}</p>}
    </li>
  )
}

/**
 * E17 (I59): a card's button takes the colour of what it DOES — accepting a counter is a change
 * request (brown), declining is the rust outline. Opening, reviewing, deciding stay violet; a
 * booking request's Approve / Refuse carry their own (AssignmentRequestActions).
 */
const ACTION_TONE: Record<string, ButtonTone> = {
  'accept-counter': 'change',
  decline: 'caution',
}

/** One button. Its test id keeps the old panels' where the row came from one. */
function Action({
  action,
  item,
  primary = false,
  handlers,
}: {
  action: NeedsYouAction | null
  item: NeedsYouItem
  primary?: boolean
  handlers: Handlers
}) {
  const { t } = useTranslation()
  if (!action) return null
  switch (action.type) {
    case 'booking':
      return <AssignmentRequestActions subTaskId={(item.ref as PendingApprovalRow).targetId} />
    case 'review':
      return (
        <Button variant="arrow" data-testid={`awaiting-review-open-${item.id}`} onClick={() => handlers.onReview(item)}>
          {t('awaitingReview.review')}
        </Button>
      )
    case 'dialog':
      return (
        <Button
          variant={primary ? 'arrow' : 'secondary'}
          tone={ACTION_TONE[action.name]}
          size={primary ? 'md' : 'sm'}
          data-testid={`needs-you-${action.name}-${item.id}`}
          onClick={() => handlers.onDialog(item, action)}
        >
          {t(action.labelKey)}
        </Button>
      )
    case 'act':
      return (
        <Button
          variant={primary ? 'arrow' : 'secondary'}
          size={primary ? 'md' : 'sm'}
          busy={handlers.busy}
          disabled={handlers.busy}
          data-testid={`needs-you-${action.name}-${item.id}`}
          onClick={() => handlers.onAct(item, action)}
        >
          {t(action.labelKey)}
        </Button>
      )
    case 'link':
      return (
        <Button
          to={action.to}
          variant={primary ? 'arrow' : 'secondary'}
          size={primary ? 'md' : 'sm'}
          data-testid={
            APPROVAL_KINDS.has(item.kind)
              ? `waiting-for-you-open-${item.id}`
              : action.name
                ? `needs-you-${action.name}-${item.id}`
                : `needs-you-open-${item.kind}-${item.id}`
          }
        >
          {t(action.labelKey)}
        </Button>
      )
  }
}
