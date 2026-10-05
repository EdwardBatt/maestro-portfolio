import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Field } from '../../../components/Field'
import { Modal, ModalFooter, ModalHeader } from '../../../components/Modal'
import { PersonPicker } from '../../../components/PersonPicker'
import { formatIraqShortDate, iraqDay } from '../../../lib/time/iraq'
import { useFinishedTasks, useReopenDeliverable, type ReopenKind, type ReopenResult } from '../api/reopen-api'
import { useAssignableUsers, useReviewers } from '../api/deliverables-api'
import { ReviewerPicker } from '../../../components/ReviewerPicker'
import type { ReviewerAppointment } from '../../../lib/reviewers/task-reviewers'
import { DateField } from '../../../components/DateField'

/**
 * Re-open finished work (ADR-0103 d.2, d.3, d.5; ADR-0142 — mock-up 7, I74.18, I74.19).
 *
 * One dialog for a deliverable and for one of its tasks. A deliverable re-opens by the approved tasks the person
 * ticks — at least one — because a client's change is usually to one step. From a task's own row the dialog opens with
 * that task ticked, and it is the same door.
 *
 * **Why** is asked first (ADR-0142 d.1): a **client amendment** (counted against the piece, the campaign and the
 * client for the month — "Amend 2") or **our own fix**. Then what the client asked / what needs fixing (on the record
 * and to everyone told), **the new date** (the round's new commitment, ADR-0075), and optionally **the round's hours**.
 *
 * **Who** (ADR-0142 d.2): every re-opened task goes back to the person who made it, with the same reviewers, and is
 * placed on her week by `subtask-schedule` (warnings, never a block). With one task ticked the maker is preselected and
 * the lead may give it to someone else in the same step — the ordinary assignment, so an out-of-reach person becomes a
 * request to their lead.
 *
 * **Reviewers** (I74 fix-up, Edward 3 Oct): a ticked task that nobody reviews is given reviewers here, with the
 * ReviewerPicker — several, the first required, the rest optional; no default — and the re-open saves them before the
 * task goes back to work. A task that has reviewers keeps them: re-opening does not change who reviews.
 */
export interface ReopenDialogProps {
  deliverableId: string
  deliverableName: string
  /** From a task's own row: that task, ticked. Omitted: nothing ticked yet. */
  taskId?: string
  onDone: (r: ReopenResult) => void
  onFailed: (err: unknown) => void
  onClose: () => void
  testId?: string
}

export function ReopenDialog({
  deliverableId,
  deliverableName,
  taskId,
  onDone,
  onFailed,
  onClose,
  testId = 'reopen-dialog',
}: ReopenDialogProps) {
  const { t } = useTranslation()
  const finished = useFinishedTasks(deliverableId)
  const people = useAssignableUsers()
  const reopen = useReopenDeliverable()
  const reviewerOptions = useReviewers()
  const [reviewers, setReviewers] = useState<Record<string, ReviewerAppointment[]>>({})
  const [picked, setPicked] = useState<string[]>(taskId ? [taskId] : [])
  const [kind, setKind] = useState<ReopenKind | null>(null)
  const [reason, setReason] = useState('')
  const [dueDay, setDueDay] = useState('')
  const [hours, setHours] = useState('')
  // '' = the maker (the default); another id = the lead gives the one task to someone else.
  const [who, setWho] = useState('')
  const today = iraqDay(Date.now())

  const tasks = finished.data ?? []
  const one = picked.length === 1 ? tasks.find((x) => x.id === picked[0]) ?? null : null
  const hoursNum = hours.trim() === '' ? null : Number(hours)
  const hoursOk = hoursNum == null || (Number.isFinite(hoursNum) && hoursNum > 0)
  // The ticked tasks nobody reviews — each needs its reviewers chosen before it can go back to work.
  const needReviewers = tasks.filter((x) => picked.includes(x.id) && !x.hasReviewer)
  const reviewersOk = needReviewers.every((x) => (reviewers[x.id] ?? []).length > 0)
  const ready = picked.length > 0 && kind != null && reason.trim() !== '' && dueDay !== '' && dueDay >= today && hoursOk && reviewersOk
  const toggle = (id: string) => {
    setWho('')
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }
  const whoOptions = useMemo(() => {
    const list = (people.data ?? []).map((u) => ({
      id: u.id,
      name: u.name,
      hint: one && u.id === one.assigneeId ? t('amendments.reopen.madeIt') : null,
    }))
    if (one?.assigneeId && !list.some((p) => p.id === one.assigneeId)) {
      list.unshift({ id: one.assigneeId, name: one.assigneeName ?? '—', hint: t('amendments.reopen.madeIt') })
    }
    return list
  }, [people.data, one, t])
  const chosen = who || one?.assigneeId || ''
  const reassign = one && who && who !== one.assigneeId ? { subTaskId: one.id, assigneeId: who } : null

  function submit() {
    if (!ready || kind == null) return
    reopen.mutate(
      {
        deliverableId,
        taskIds: picked,
        reason,
        dueDay,
        kind,
        ...(hoursNum != null ? { hours: hoursNum } : {}),
        ...(reassign ? { reassign } : {}),
        ...(needReviewers.length > 0 ? { reviewers: Object.fromEntries(needReviewers.map((x) => [x.id, reviewers[x.id] ?? []])) } : {}),
      },
      {
        onSuccess: (r) => { onDone(r); onClose() },
        // A refusal is worded on the page's banner (ADR-0092), so the dialog steps aside.
        onError: (err) => { onFailed(err); onClose() },
      },
    )
  }

  const amendment = kind === 'client_amendment'

  return (
    <Modal onClose={() => !reopen.isPending && onClose()} labelledById={`${testId}-title`} testId={testId}>
      <ModalHeader
        id={`${testId}-title`}
        eyebrow={t('reopen.eyebrow')}
        title={t('reopen.title', { name: deliverableName })}
        subtitle={t('amendments.reopen.intro')}
      />
      <form className="modal-body" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <Field as="div" label={t('amendments.reopen.why')} required>
          <div className="change-ask-kinds" role="radiogroup" aria-label={t('amendments.reopen.why')} data-testid={`${testId}-kind`}>
            {(['client_amendment', 'own_fix'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                className={`change-ask-kind${kind === k ? ' is-on' : ''}`}
                onClick={() => setKind(k)}
                data-testid={`${testId}-kind-${k}`}
              >
                {kind === k && <span aria-hidden="true" className="change-ask-tick">✓</span>}
                {t(`amendments.kind.${k}`)}
              </button>
            ))}
          </div>
        </Field>

        <Field as="div" label={t('reopen.tasks')} required hint={t('reopen.tasksHint')}>
          {finished.isLoading ? (
            <p className="muted" data-testid={`${testId}-loading`}>…</p>
          ) : tasks.length === 0 ? (
            <p className="muted" data-testid={`${testId}-none`}>{t('reopen.noneFinished')}</p>
          ) : (
            <ul className="reopen-tasks" data-testid={`${testId}-tasks`}>
              {tasks.map((task) => (
                <li key={task.id}>
                  <label className="reopen-task">
                    <input
                      type="checkbox"
                      checked={picked.includes(task.id)}
                      onChange={() => toggle(task.id)}
                      data-testid={`${testId}-task-${task.id}`}
                    />
                    <span className="reopen-task-title">{task.title}</span>
                    <span className="muted reopen-task-line">
                      {[task.assigneeName, task.approvedAt ? t('reopen.approvedOn', { date: formatIraqShortDate(task.approvedAt) }) : null]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Field>

        <Field label={amendment ? t('amendments.reopen.clientAsked') : t('reopen.reason')} required hint={t('reopen.reasonHint')}>
          <textarea
            rows={2}
            dir="auto"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            data-testid={`${testId}-reason`}
          />
        </Field>

        <div className="reopen-row">
          <Field label={t('reopen.due')} required hint={t('reopen.dueHint')}>
            <DateField
              min={today}
              value={dueDay}
              onChange={(v) => setDueDay(v)}
              data-testid={`${testId}-due`}
            />
          </Field>
          <Field label={t('amendments.reopen.hours')} hint={t('amendments.reopen.hoursHint')} error={hoursOk ? undefined : t('amendments.reopen.hoursWrong')}>
            <input
              type="number"
              min={0.5}
              step={0.5}
              inputMode="decimal"
              value={hours}
              placeholder={one?.hours != null ? String(one.hours) : ''}
              onChange={(e) => setHours(e.target.value)}
              data-testid={`${testId}-hours`}
            />
          </Field>
        </div>

        {one ? (
          <Field as="div" label={t('amendments.reopen.who')} hint={t('amendments.reopen.whoHint')}>
            <PersonPicker
              people={whoOptions}
              value={chosen}
              onChange={(id) => setWho(id)}
              placeholder={one.assigneeName ?? t('amendments.reopen.nobody')}
              testId={`${testId}-who`}
            />
          </Field>
        ) : picked.length > 1 ? (
          <p className="muted" data-testid={`${testId}-makers`}>{t('amendments.reopen.toMakers')}</p>
        ) : null}

        {needReviewers.map((x) => {
          // Nobody reviews their own work: the person it goes back to (or the one it is given to) is not offered.
          const doer = one && one.id === x.id ? chosen || null : x.assigneeId
          return (
            <Field as="div" key={x.id} label={t('amendments.reopen.reviewers', { task: x.title })} required hint={t('amendments.reopen.reviewersHint')}>
              <ReviewerPicker
                options={reviewerOptions.data ?? []}
                value={reviewers[x.id] ?? []}
                onChange={(next) => setReviewers((cur) => ({ ...cur, [x.id]: next }))}
                excludeUserId={doer}
                testId={`${testId}-reviewers-${x.id}`}
              />
            </Field>
          )
        })}

        <p className="muted" data-testid={`${testId}-consequence`}>
          {picked.length === 0 ? t('reopen.pickOne') : t('amendments.reopen.consequence', { count: picked.length })}
        </p>
      </form>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={reopen.isPending} data-testid={`${testId}-cancel`}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          icon="undo"
          busy={reopen.isPending}
          disabled={!ready || reopen.isPending}
          onClick={submit}
          data-testid={`${testId}-submit`}
        >
          {picked.length === 0
            ? t('reopen.action')
            : amendment
              ? t('amendments.reopen.submitAmend', { count: picked.length })
              : t('reopen.submit', { count: picked.length })}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
