import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePermissions } from '../../../app/permissions'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { ProgressBar, ProgressTip } from '../../../components/DeliverableProgress'
import { DeliverablePicker } from '../../../components/DeliverablePicker'
import { Field } from '../../../components/Field'
import { Modal, ModalFooter, ModalHeader } from '../../../components/Modal'
import { PersonPicker } from '../../../components/PersonPicker'
import { PriorityMark } from '../../../components/PriorityMark'
import { Tag } from '../../../components/Tag'
import { allowedTransitions } from '../../../lib/deliverables/state-machine'
import { formatIraqShortDate, iraqDay } from '../../../lib/time/iraq'
import { formatPlanDay } from '../../../lib/timing/plan-back'
import { usePhaseDue } from '../hooks/use-due-date-checks'
import { useDeliverableCatalogue } from '../../admin/api/deliverable-types-api'
import { useDepartments } from '../../admin/api/admin-api'
import { failed, type Banner } from '../../deliverables/DeliverablesPage'
import {
  useDeliverableOwnerCandidates,
  useReassignDeliverable,
  useTransitionDeliverable,
  type DeliverableRow,
} from '../../deliverables/api/deliverables-api'
import { useMoveDeliverableToPhase, useUpdateCampaignDeliverable, type CampaignPhase } from '../api/campaign-detail-api'
import { pieceStatusStep, PIECE_STATUS_STEPS, type PieceStatusStep } from '../lib/piece-status'
import { DeliverableDueAtDialog } from './DeliverableDueAtDialog'
import { ChangeRequestDialog } from './ChangeRequestDialog'
import { useChangeRequestContext, type ChangeRequestContext } from '../api/change-requests-api'
import { hasChanges, requestedChanges, requestLine, startedFromTasks, type RequestedChanges } from '../lib/change-request'
import { DateField } from '../../../components/DateField'
import { leadsOfDepartment } from '../../../lib/people/leads-of-department'

/**
 * **Edit a deliverable** — Figma `CG-E1` (1710:604), `I57.11`.
 *
 * One dialog for the piece, opened from the grid's Edit and from the piece drawer. Every field is
 * wired to a write that ALREADY exists, and each is offered only as that write's own gate offers it:
 *
 *  - Name, Type, Quantity — `update_campaign_deliverable` (I52.21). Its trigger decides who may; a
 *    refusal comes back worded, never reportable (ADR-0092).
 *  - Phase — `move_deliverable_to_phase` (ADR-0096 d.4): the approval authority's (`canMovePhase`);
 *    everyone else reads the name.
 *  - Due — the promise to the client. After approval it moves ONLY through the evidenced dialog
 *    (ADR-0088 d.7a), so the field opens that dialog rather than taking a free date
 *    (`canChangePromise`). Before approval the dates are still being written in the wizard, so it
 *    reads here, as the old edit dialog left it.
 *  - Department — not a choice: the owner stamps it (ADR-0050). Shown, with why.
 *  - Owner — `reassign_deliverable` (ADR-0055), offered to holders of `deliverable_owner:manage`,
 *    campaign work offering leads only (ADR-0083 d.9) — the same reading as `OwnerControl`.
 *  - Priority — READ ONLY. Nothing writes a piece's priority after the brief (only the wizard's
 *    `write_campaign_content` does); a select here would promise a write that does not exist.
 *  - Status — SHOWN, never set (Edward, section D rule): the tasks move it.
 *  - Close this deliverable — the archive transition (ADR-0080), always asked first, the question
 *    itemising the live work it calls off (d.7). Offered where the lifecycle allows it.
 *
 * **Started work (ADR-0110 + addendum, I59.23, CG-E2).** On a deliverable whose work has started
 * (`deliverable_is_started`), a change to its TYPE, QUANTITY or DUE DATE is not saved: Save saves
 * the rest (name, phase, owner — E6: the owner saves straight away, the department follows) and
 * then opens `ChangeRequestDialog`, which sends those three to the owner as a change request. On
 * started work the due date is a plain day here (the evidenced dialog's direct write is refused by
 * the started-work guard); its evidence is asked for on the request instead (E5). A phase move whose
 * date would follow puts the new phase's day on the request. One request open per piece: the form
 * says so, and Save shows it rather than starting another.
 *
 * Props:
 *  - `piece`            the row as the campaign page read it (`useCampaignDeliverables`).
 *  - `campaignId`, `clientId`, `goLiveAt`  the campaign it sits on; the evidenced date dialog files
 *                       its attachment into the client's campaign References and reads go-live.
 *  - `phases`           the campaign's phases, empty when it runs without them.
 *  - `campaignApproved` whether the campaign is approved (the promise is then evidenced).
 *  - `canMovePhase`     the approval authority on an open campaign (ADR-0096 d.4).
 *  - `canChangePromise` approved, and the account manager or `projects:manage` (ADR-0088 d.7a).
 *  - `onClose`          closes the dialog (after a save, a close, or Cancel).
 *  - `onBanner`         the page banner: "saved", "closed", or the worded refusal / failure.
 */
export interface EditPieceDialogProps {
  piece: DeliverableRow
  campaignId: string
  clientId: string
  goLiveAt: string | null
  phases: readonly CampaignPhase[]
  campaignApproved: boolean
  canMovePhase: boolean
  canChangePromise: boolean
  onClose: () => void
  onBanner: (b: Banner) => void
}

type View = 'form' | 'due' | 'close' | 'request'

export function EditPieceDialog({
  piece,
  campaignId,
  clientId,
  goLiveAt,
  phases,
  campaignApproved,
  canMovePhase,
  canChangePromise,
  onClose,
  onBanner,
}: EditPieceDialogProps) {
  const { t, i18n } = useTranslation()
  const { can } = usePermissions()
  // ADR-0123 d.3: the client's working week.
  const { phaseDue } = usePhaseDue(clientId)
  const update = useUpdateCampaignDeliverable()
  const move = useMoveDeliverableToPhase()
  const reassign = useReassignDeliverable()
  const transition = useTransitionDeliverable()
  const catalogue = useDeliverableCatalogue()
  const leads = useDeliverableOwnerCandidates()
  const departments = useDepartments()
  const changeContext = useChangeRequestContext(piece.id)

  const [view, setView] = useState<View>('form')
  const [name, setName] = useState(piece.name)
  const [typeId, setTypeId] = useState(piece.deliverableTypeId ?? '')
  const [quantity, setQuantity] = useState(String(piece.quantity ?? 1))
  const [phaseId, setPhaseId] = useState(piece.phaseId ?? '')
  const [ownerId, setOwnerId] = useState(piece.ownerUserId ?? '')
  // ADR-0110: on started work the due date is a day typed here and goes on the change request.
  const [dueDay, setDueDay] = useState(piece.dueAt ? iraqDay(piece.dueAt) : '')
  // CG-E2: what goes to the owner, and who answers it — set by Save on started work.
  const [request, setRequest] = useState<{ changes: RequestedChanges; ownerName: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // I57.36: after a phase move the evidenced date dialog opens on the new phase's planned date.
  const [dueAfterMove, setDueAfterMove] = useState<{ day: string; phaseName: string } | null>(null)
  // I59.47 (Edward, 26 Sep, option A): while a question follows Save — the promised date after a phase
  // move, or the change request on started work — no "Deliverable saved" notice is shown over it. One
  // notice, after the answer, says what happened. These remember what the answer is added to.
  const dueChanged = useRef(false)
  const [savedBeforeRequest, setSavedBeforeRequest] = useState(false)

  const hasPhases = phases.length > 0
  const mayMovePhase = canMovePhase && hasPhases
  const mayChangeOwner = can('deliverable_owner:manage')
  // ADR-0080: close is the archive transition, offered where the lifecycle and the grants allow it.
  const mayClose = allowedTransitions(piece.state, { manage: can('project_tasks:manage'), review: can('reviews:moderate') })
    .some((tr) => tr.to === 'archived')
  const step = pieceStatusStep(piece)
  // ADR-0102 d.1/d.6: the department follows the owner. A newly picked owner in another department
  // is said BEFORE saving — the deliverable will move with them.
  const newOwnerDept = ownerId && ownerId !== (piece.ownerUserId ?? '')
    ? (leads.data ?? []).find((u) => u.id === ownerId)?.departmentId ?? null
    : null
  const movesTo = newOwnerDept && newOwnerDept !== piece.departmentId
    ? (departments.data ?? []).find((d) => d.id === newOwnerDept)?.name ?? null
    : null
  const phase = phases.find((p) => p.id === piece.phaseId) ?? null

  // I57.36 (Edward, 25 Sep): the date moves with the phase — to the new phase's delivery day,
  // planned back with the same rule and calendar the timing step uses (`phaseDueDate`).
  const targetPhase = phases.find((p) => p.id === phaseId) ?? null
  const phasePicked = mayMovePhase && phaseId !== '' && phaseId !== (piece.phaseId ?? '') && targetPhase != null
  const plannedDue = phasePicked
    ? phaseDue(targetPhase!.endsOn)
    : null
  const currentDay = piece.dueAt ? iraqDay(piece.dueAt) : null
  const shownPhase = phasePicked ? targetPhase : phase
  // "Inside the phase" is said only when it is true — of the phase the piece will be in.
  const dueInsidePhase = currentDay != null && shownPhase != null && currentDay >= shownPhase.startsOn && currentDay <= shownPhase.endsOn
  const dateWillMove = plannedDue != null && plannedDue !== currentDay
  const loc = i18n.language === 'ar' ? 'ar' : 'en'

  // ADR-0110 d.1: the database's "started" (`deliverable_is_started`). Were that read to fail, the
  // piece's own task statuses stand in (the time-entry half cannot be seen then) — and the
  // started-work guard refuses a direct write either way.
  const started = changeContext.data?.started ?? startedFromTasks(piece.taskList ?? [])
  const context: ChangeRequestContext = changeContext.data ?? {
    started,
    openRequest: null,
    escalationHours: null,
    tasks: (piece.taskList ?? []).map((x) => ({ id: x.id, title: x.title, status: x.status, bookedHours: 0, timedHours: 0 })),
  }
  const openRequest = context.openRequest
  // On started work the promise's day is asked of the owner by those who may move it (d.7a's gate).
  const askDue = started && campaignApproved && canChangePromise
  const typeNameOf = (id: string | null) =>
    id ? catalogue.items.find((x) => x.id === id)?.name ?? (id === piece.deliverableTypeId ? piece.typeName : null) ?? id : t('changeRequest.none')

  // ADR-0083 d.9, as `OwnerControl` offers it: leads only, and (I66.9, Edward 29 Sep) only the piece's own
  // department's, whoever is looking — a department with no lead falls back to every lead. The current owner is
  // always listed so the field can name them, even where they predate the rule.
  const ownerOptions = useMemo(() => {
    const offered = leadsOfDepartment(leads.data ?? [], piece.departmentId)
    const people = offered.map((u) => ({ id: u.id, name: u.name, hint: null }))
    if (piece.ownerUserId && !people.some((p) => p.id === piece.ownerUserId)) {
      people.unshift({ id: piece.ownerUserId, name: piece.ownerName ?? '—', hint: null })
    }
    return people
  }, [leads.data, piece.departmentId, piece.ownerUserId, piece.ownerName])

  const statusLabel = (s: PieceStatusStep) =>
    s === 'closed' ? t('campaigns.editPiece.statusClosed') : s === 'approved' ? t('campaigns.editPiece.statusApproved') : t(`deliverables.phase.${s}`)

  async function save() {
    setError(null)
    if (!name.trim()) return setError(t('campaigns.deliverableDialog.nameRequired'))
    const qty = Math.max(1, Number(quantity) || 1)
    const contentChanged =
      name.trim() !== piece.name || (typeId || null) !== (piece.deliverableTypeId ?? null) || qty !== (piece.quantity ?? 1)
    const phaseChanged = mayMovePhase && phaseId !== '' && phaseId !== (piece.phaseId ?? '')
    // Campaign work never clears an owner (ADR-0083 d.11): text that matches nobody changes nothing.
    const ownerChanged = mayChangeOwner && ownerId !== '' && ownerId !== (piece.ownerUserId ?? '')
    if (started) return saveStarted(qty, phaseChanged, ownerChanged)
    if (!contentChanged && !phaseChanged && !ownerChanged) return onClose()
    setSaving(true)
    try {
      if (contentChanged) {
        await update.mutateAsync({ campaignId, deliverableId: piece.id, name: name.trim(), deliverableTypeId: typeId || null, quantity: qty })
      }
      if (phaseChanged) await move.mutateAsync({ campaignId, deliverableId: piece.id, phaseId })
      if (ownerChanged) await reassign.mutateAsync({ deliverableId: piece.id, ownerUserId: ownerId })
      // The promise moves only on the client's agreement (ADR-0088 d.7a): the evidenced dialog opens
      // on the new phase's date, and Cancel there keeps the old date — which the form then calls
      // outside the phase, never inside it. Its notice waits for that answer (I59.47).
      if (phaseChanged && dateWillMove && campaignApproved && canChangePromise) {
        dueChanged.current = false
        setDueAfterMove({ day: plannedDue!, phaseName: targetPhase!.name })
        return
      }
      onBanner({ kind: 'ok', text: t('campaigns.deliverableDialog.editedOk') })
    } catch (err) {
      // ADR-0092: a refusal is worded and not reportable; anything else is worded and carries Report.
      onBanner(failed(err, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t))
    } finally {
      setSaving(false)
    }
    onClose()
  }

  /**
   * ADR-0110 d.1 on started work: name, phase and owner save now; type, quantity and due date go to
   * the owner as a change request (CG-E2) — the dialog opens on them, naming the owner as saved.
   */
  async function saveStarted(qty: number, phaseChanged: boolean, ownerChanged: boolean) {
    const changes = requestedChanges(
      { typeId: piece.deliverableTypeId ?? null, quantity: piece.quantity ?? 1, dueDay: currentDay },
      { typeId: typeId || null, quantity: qty, dueDay: askDue ? dueDay || null : null },
      true,
    )
    // I57.36 on started work: the date that follows the phase is asked for on the request.
    if (!changes.due && phaseChanged && dateWillMove && askDue) changes.due = { from: currentDay, to: plannedDue! }
    const nameChanged = name.trim() !== piece.name
    if (!nameChanged && !phaseChanged && !ownerChanged && !hasChanges(changes)) return onClose()
    setSaving(true)
    try {
      // The name alone: type and quantity are written back as they are, so the guard sees no change.
      if (nameChanged) {
        await update.mutateAsync({
          campaignId, deliverableId: piece.id, name: name.trim(), deliverableTypeId: piece.deliverableTypeId ?? null, quantity: piece.quantity ?? 1,
        })
      }
      if (phaseChanged) await move.mutateAsync({ campaignId, deliverableId: piece.id, phaseId })
      if (ownerChanged) await reassign.mutateAsync({ deliverableId: piece.id, ownerUserId: ownerId })
      if (hasChanges(changes)) {
        // I59.47: the request is asked next; its notice says the rest was saved too.
        setSavedBeforeRequest(nameChanged || phaseChanged || ownerChanged)
        const answerer = ownerChanged ? (leads.data ?? []).find((u) => u.id === ownerId)?.name ?? null : piece.ownerName
        setRequest({ changes, ownerName: answerer ?? t('changeRequest.theOwner') })
        setView('request')
        return
      }
      if (nameChanged || phaseChanged || ownerChanged) onBanner({ kind: 'ok', text: t('campaigns.deliverableDialog.editedOk') })
    } catch (err) {
      onBanner(failed(err, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t))
    } finally {
      setSaving(false)
    }
    onClose()
  }

  function closePiece() {
    transition.mutate(
      { deliverableId: piece.id, to: 'archived', expectedState: piece.state },
      {
        onSuccess: () => {
          onBanner({ kind: 'ok', text: t('campaigns.editPiece.closedOk') })
          onClose()
        },
        onError: (err) => {
          onBanner(failed(err, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t))
          onClose()
        },
      },
    )
  }

  // I57.36: the phase is moved; its date follows on the client's agreement. Closing this closes Edit.
  if (dueAfterMove) {
    return (
      <DeliverableDueAtDialog
        deliverableId={piece.id}
        deliverableName={piece.name}
        campaignId={campaignId}
        clientId={clientId}
        currentDueAt={piece.dueAt}
        goLiveAt={goLiveAt}
        initialDay={dueAfterMove.day}
        reason={t('campaigns.editPiece.dueMovesReason', { phase: dueAfterMove.phaseName, date: formatPlanDay(dueAfterMove.day, loc) })}
        onSaved={() => { dueChanged.current = true }}
        onClose={() => {
          // I59.47: the one notice, now that the question is answered — the move is saved either way.
          onBanner({
            kind: 'ok',
            text: dueChanged.current
              ? t('campaigns.editPiece.movedDateChanged', { phase: dueAfterMove.phaseName })
              : t('campaigns.editPiece.movedDateKept', {
                  phase: dueAfterMove.phaseName,
                  date: piece.dueAt ? formatIraqShortDate(piece.dueAt) : t('campaigns.editPiece.noDue'),
                }),
          })
          onClose()
        }}
        testId="campaign-deliverable-form-due-move"
      />
    )
  }

  // The evidenced date dialog REPLACES this one while it is open (two modals would both answer
  // Escape), and hands back to it — with whatever was typed here still there.
  if (view === 'due') {
    return (
      <DeliverableDueAtDialog
        deliverableId={piece.id}
        deliverableName={piece.name}
        campaignId={campaignId}
        clientId={clientId}
        currentDueAt={piece.dueAt}
        goLiveAt={goLiveAt}
        onClose={() => setView('form')}
      />
    )
  }

  // CG-E2: the rest is saved; these go to the owner, or stay as they were. Either way Edit is done.
  if (view === 'request' && request) {
    return (
      <ChangeRequestDialog
        deliverableId={piece.id}
        deliverableName={piece.name}
        campaignId={campaignId}
        clientId={clientId}
        currentDueAt={piece.dueAt}
        changes={request.changes}
        ownerName={request.ownerName}
        context={context}
        typeName={typeNameOf}
        onSent={() => {
          onBanner({
            kind: 'ok',
            text: savedBeforeRequest
              ? t('changeRequest.savedAndSentOk', { owner: request.ownerName })
              : t('changeRequest.sentOk', { owner: request.ownerName }),
          })
          onClose()
        }}
        onKeep={() => {
          // Kept as it was: only what was saved before the question is announced, if anything was.
          if (savedBeforeRequest) onBanner({ kind: 'ok', text: t('campaigns.deliverableDialog.editedOk') })
          onClose()
        }}
      />
    )
  }

  // ADR-0080 d.7: always asked, and the question says what is lost, in numbers.
  if (view === 'close') {
    return (
      <ConfirmDialog
        title={t('campaigns.editPiece.closeTitle')}
        message={t('campaigns.editPiece.closeMessage', { name: piece.name })}
        detail={[
          ...(piece.taskCount > 0
            ? [
                t('deliverables.confirmArchiveTasks', { count: piece.taskCount }),
                piece.assigneeNames.length > 0
                  ? t('deliverables.confirmArchiveAssignees', { names: piece.assigneeNames.join(', ') })
                  : t('deliverables.confirmArchiveUnassigned'),
              ]
            : [t('campaigns.editPiece.closeNothingLive')]),
          t('deliverables.confirmArchiveFinal'),
        ]}
        confirmLabel={t('campaigns.editPiece.closeConfirm')}
        busy={transition.isPending}
        onConfirm={closePiece}
        onCancel={() => setView('form')}
        testId="campaign-deliverable-form-close-confirm"
      />
    )
  }

  // Save waits for "started" — it decides where type, quantity and due go.
  const busy = saving || transition.isPending || changeContext.isLoading
  const openLine = openRequest ? requestLine(openRequest, piece.ownerName) : null
  return (
    <Modal onClose={onClose} labelledById="edit-piece-title" testId="edit-piece-dialog">
      <ModalHeader
        id="edit-piece-title"
        eyebrow={t('campaigns.editPiece.eyebrow')}
        title={t('campaigns.editPiece.title', { name: piece.name })}
        subtitle={t('campaigns.editPiece.intro')}
      />
      <form
        className="modal-body edit-piece"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        data-testid="campaign-deliverable-form"
      >
        <p className="edit-piece-where" data-testid="campaign-deliverable-form-where">
          <ProgressTip progress={piece.progress} status={t(`deliverables.phase.${piece.progress.phase}`)} testId={`progress-tip-${piece.id}`}>
            <Tag tone="accent">
              {t(`deliverables.phase.${piece.progress.phase}`)}
              {piece.ownerName ? ` · ${piece.ownerName}` : ''}
            </Tag>
          </ProgressTip>{' '}
          <ProgressBar progress={piece.progress} testId={`progress-bar-${piece.id}`} />
        </p>

        {/* ADR-0110: said before anything is typed — where these three go on started work. */}
        {started && (
          <p className="edit-piece-started" data-testid="campaign-deliverable-form-started">
            {t('changeRequest.startedNote', { owner: piece.ownerName ?? t('changeRequest.theOwner') })}
          </p>
        )}
        {openLine && (
          <p className="edit-piece-open-request" data-testid="campaign-deliverable-form-open-request">
            {t(openLine.key, openLine.values)} {t('changeRequest.alreadyOpenNote')}
          </p>
        )}

        <Field label={t('campaigns.editPiece.name')}>
          <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid="campaign-deliverable-form-name" />
        </Field>

        <div className="edit-piece-row">
          {/* ADR-0097 d.7: one of the catalogue, chosen by typing. */}
          <Field
            as="div"
            label={t('campaigns.editPiece.type')}
            hint={
              <span data-testid="campaign-deliverable-form-type-note">
                {started
                  ? t('changeRequest.typeStartedNote')
                  : t(piece.deliverableTypeId ? 'campaigns.deliverableDialog.typeLockedNote' : 'campaigns.deliverableDialog.typeNote')}
              </span>
            }
          >
            <DeliverablePicker items={catalogue.items} value={typeId} onChange={setTypeId} testId="campaign-deliverable-form-type" />
          </Field>

          <Field
            label={t('campaigns.editPiece.phase')}
            hint={hasPhases && !mayMovePhase ? t('campaigns.editPiece.phaseFixedHint') : undefined}
          >
            {mayMovePhase ? (
              <select value={phaseId} onChange={(e) => setPhaseId(e.target.value)} data-testid="campaign-deliverable-form-phase">
                {!piece.phaseId && <option value="">{t('campaigns.editPiece.noPhase')}</option>}
                {phases.map((p) => <option key={p.id} value={p.id}>{p.number}. {p.name}</option>)}
              </select>
            ) : (
              <span className="edit-piece-fixed" data-testid="campaign-deliverable-form-phase-fixed">
                {phase ? `${phase.number}. ${phase.name}` : t('campaigns.editPiece.noPhase')}
              </span>
            )}
          </Field>

          {/* ADR-0088 d.7a: after approval the promise moves only with the client's agreement. */}
          <Field
            as="div"
            label={t('campaigns.editPiece.due')}
            hint={
              askDue ? (
                <span data-testid="campaign-deliverable-form-due-request-hint">{t('changeRequest.dueStartedHint')}</span>
              ) : dateWillMove ? (
                <span data-testid="campaign-deliverable-form-due-moves">
                  {t(
                    campaignApproved && canChangePromise
                      ? 'campaigns.editPiece.dueMovesWithPhase'
                      : campaignApproved
                        ? 'campaigns.editPiece.dueStaysFixed'
                        : 'campaigns.editPiece.dueStaysBeforeApproval',
                    { phase: targetPhase!.name, date: formatPlanDay(plannedDue!, loc) },
                  )}
                </span>
              ) : (
                t(
                  campaignApproved
                    ? canChangePromise
                      ? dueInsidePhase || !shownPhase ? 'campaigns.editPiece.dueEvidencedHint' : 'campaigns.editPiece.dueOutsidePhaseHint'
                      : 'campaigns.editPiece.dueFixedHint'
                    : 'campaigns.editPiece.dueBeforeApprovalHint',
                  { phase: shownPhase?.name ?? '' },
                )
              )
            }
          >
            {askDue ? (
              <DateField
               
                value={dueDay}
                onChange={(v) => setDueDay(v)}
                aria-label={t('campaigns.editPiece.due')}
                data-testid="campaign-deliverable-form-due-day"
              />
            ) : campaignApproved && canChangePromise ? (
              <button
                type="button"
                className="edit-piece-due"
                onClick={() => setView('due')}
                data-testid="campaign-deliverable-form-due"
              >
                {piece.dueAt ? formatIraqShortDate(piece.dueAt) : t('campaigns.editPiece.noDue')}
              </button>
            ) : (
              <span className="edit-piece-fixed" data-testid="campaign-deliverable-form-due-fixed">
                {piece.dueAt ? formatIraqShortDate(piece.dueAt) : t('campaigns.editPiece.noDue')}
              </span>
            )}
          </Field>
        </div>

        <div className="edit-piece-row">
          {/* ADR-0102: the department is the owner's — read here, never chosen; a new owner moves it. */}
          <Field as="div" label={t('campaigns.editPiece.department')} hint={t('campaigns.editPiece.departmentHint')}>
            <span className="edit-piece-fixed" data-testid="campaign-deliverable-form-department">
              {piece.discipline ?? t('campaigns.page.unassignedDepartment')}
            </span>
            {movesTo && (
              <span className="edit-piece-moves" data-testid="campaign-deliverable-form-department-moves">
                {t('campaigns.editPiece.departmentMoves', { name: movesTo })}
              </span>
            )}
          </Field>

          <Field as="div" label={t('campaigns.editPiece.owner')} hint={mayChangeOwner ? t('campaigns.editPiece.ownerHint') : undefined}>
            {mayChangeOwner ? (
              <PersonPicker
                people={ownerOptions}
                value={ownerId}
                onChange={setOwnerId}
                placeholder={t('campaigns.deliverableDialog.ownerHint')}
                testId="campaign-deliverable-form-owner"
              />
            ) : (
              <span className="edit-piece-fixed" data-testid="campaign-deliverable-form-owner-fixed">
                {piece.ownerName ?? t('campaigns.page.noOwner')}
              </span>
            )}
          </Field>

          {/* Nothing writes a priority after the brief — shown, not offered. */}
          <Field as="div" label={t('campaigns.editPiece.priority')} hint={t('campaigns.editPiece.priorityHint')}>
            <span className="edit-piece-fixed" data-testid="campaign-deliverable-form-priority">
              {piece.priority ? (
                <>
                  <PriorityMark priority={piece.priority} />
                  {t(`intake.who.priorities.${piece.priority}`)}
                </>
              ) : (
                t('campaigns.editPiece.priorityNone')
              )}
            </span>
          </Field>
        </div>

        <div className="edit-piece-row">
          <Field label={t('campaigns.editPiece.quantity')}>
            <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="campaign-deliverable-form-quantity" />
          </Field>
        </div>

        {/* Shown, never set: the tasks move it (section D rule). */}
        <Field as="div" label={t('campaigns.editPiece.status')} hint={t('campaigns.editPiece.statusHint')}>
          <ol className="edit-piece-status" aria-label={t('campaigns.editPiece.status')} data-testid="campaign-deliverable-form-status">
            {[...PIECE_STATUS_STEPS, ...(step === 'closed' ? (['closed'] as const) : [])].map((s) => (
              <li
                key={s}
                className={s === step ? 'is-current' : undefined}
                aria-current={s === step ? 'step' : undefined}
                data-testid={`campaign-deliverable-form-status-${s}`}
              >
                {statusLabel(s)}
              </li>
            ))}
          </ol>
        </Field>

        {error && <p className="form-error" role="alert" data-testid="campaign-deliverable-form-error">{error}</p>}
      </form>
      <ModalFooter note={mayClose ? t('campaigns.editPiece.closeNote') : undefined}>
        <Button variant="primary" busy={busy} disabled={busy} onClick={() => void save()} data-testid="campaign-deliverable-form-submit">
          {t('campaigns.editPiece.save')}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onClose} data-testid="campaign-deliverable-form-cancel">
          {t('common.cancel')}
        </Button>
        {mayClose && (
          <Button variant="danger" disabled={busy} onClick={() => setView('close')} data-testid="campaign-deliverable-form-close">
            {t('campaigns.editPiece.close')}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  )
}
