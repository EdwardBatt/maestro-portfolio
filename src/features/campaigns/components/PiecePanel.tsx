import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePermissions } from '../../../app/permissions'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { DateField } from '../../../components/DateField'
import { DeliverablePicker } from '../../../components/DeliverablePicker'
import { LanguagePicker } from '../../../components/LanguagePicker'
import { PersonPicker } from '../../../components/PersonPicker'
import { allowedTransitions } from '../../../lib/deliverables/state-machine'
import { leadsOfDepartment } from '../../../lib/people/leads-of-department'
import { formatIraqShortDate, iraqDay } from '../../../lib/time/iraq'
import { formatPlanDay } from '../../../lib/timing/plan-back'
import { useDueDateChecks } from '../hooks/use-due-date-checks'
import { DueDateWarning } from './DueDateWarning'
import { ExternalInputs } from '../../deliverables/components/ExternalInputs'
import { TaskListRiskReminder } from '../../deliverables/components/TaskListApproval'
import { PieceTasks } from './PieceTasks'
import { usePendingInputs, type PendingInput } from '../../deliverables/api/requirements-api'
import { ChatPanel } from '../../chat/ChatPanel'
import { useAddLanguage, useDeliverableCatalogue, useLanguageWords } from '../../admin/api/deliverable-types-api'
import { failed, type Banner } from '../../deliverables/DeliverablesPage'
import {
  useDeliverableOwnerCandidates,
  useReassignDeliverable,
  useTransitionDeliverable,
  type DeliverableRow,
} from '../../deliverables/api/deliverables-api'
import { useMoveDeliverableToPhase, useUpdateCampaignDeliverable, useUpdatePieceDetails, type CampaignPhase } from '../api/campaign-detail-api'
import { useMoveDeliverableToWorkstream } from '../api/workstreams-api'
import {
  useChangeDeliverableType,
  useEditPieceDirect,
  usePreviewQuantityChange,
  usePreviewTypeChange,
} from '../api/piece-edit-api'
import { askAccountManagerOf } from '../lib/change-ask'
import { ChangeAskDialog } from './ChangeAskDialog'
import { PieceChangeAsk } from './PieceChangeAsk'
import { followSaved, sameSaved } from '../lib/follow-saved'

/**
 * **The piece, edited in its panel** — ADR-0132 d.2–d.4 (I68.2, I68.3). The campaign page is the one page: every
 * view opens this panel, and for those who may edit a piece (`project_tasks:manage`, the grid's Edit) it is the
 * editor. Each field goes through the write that already exists, gated as that write gates it:
 *
 *  - name (and the type on a piece with no live work) — `update_campaign_deliverable`;
 *  - the TYPE on a piece with live tasks — direct, asked first (d.3, amending ADR-0110): the preview says which open
 *    tasks are cancelled and who is told, what is kept, what is added; then `change_deliverable_type`;
 *  - QUANTITY — direct, asked first the same way (the units cancelled above a lower count, the units a higher one
 *    adds); then `edit_piece_directly`;
 *  - due date — direct, a day due at 18:00 Iraq (`edit_piece_directly`). The evidenced route stays for the CLIENT
 *    asking for something different ("The client asked for a change", the Edit dialog's change request);
 *  - owner — `reassign_deliverable`, the piece's own department's leads (ADR-0128);
 *  - workstream and phase — the campaign's moves (a single job has neither);
 *  - channel, languages and brief lines — `update_piece_details`. ADR-0117 addendum (Q18, 4 Oct): the deliverable starts
 *    with its campaign's languages and the account manager may add one to it alone (the existing LanguagePicker, any of
 *    the tenant's, Add language for a new one); at least one stays. Its translation task follows (Q20, in the database).
 *
 * The task list is `PieceTasks` (ADR-0140, superseding d.2's read-only assignee): the suggested list and its approval,
 * then Who and Dates on every row once approved, each row's pencil opening the one task editor. A task the owner adds
 * counts as approved; anyone else's waits for the owner (d.4, the server decides).
 */
export interface PiecePanelProps {
  piece: DeliverableRow
  campaignId: string
  clientId: string
  goLiveAt: string | null
  isSingleJob: boolean
  phases: readonly CampaignPhase[]
  workstreams: readonly { id: string; name: string }[]
  campaignApproved: boolean
  canMovePhase: boolean
  /** The task the person came from (`?task=`), marked in the list. */
  markTaskId: string | null
  onBanner: (b: Banner) => void
  onClosed: () => void
  /** ADR-0132 d.3: the change request stays for the CLIENT asking for something different — the Edit dialog's route. */
  onClientChange?: (() => void) | null
  /**
   * ADR-0141 d.1 (I74.13): whether the viewer changes the deliverable itself — the account manager, the account
   * director, Traffic, the Power Admin (approve_campaign's gate, mirrored by the page). False on a live campaign for
   * the owner and the department's leads: its fields read in the header and they ask (`PieceChangeAsk`). Default true.
   */
  mayChangeFields?: boolean
  /** The signed-in person (the asker reads her own ask's state). */
  viewerId?: string | null
  testId?: string
}

const NO_INPUTS: PendingInput[] = []

type Ask =
  | { kind: 'type'; typeId: string }
  | { kind: 'quantity'; quantity: number }
  | { kind: 'close' }
  | null

export function PiecePanel(props: PiecePanelProps) {
  const { piece, testId = 'piece-panel' } = props
  const { t, i18n } = useTranslation()
  const loc = i18n.language === 'ar' ? 'ar' : 'en'
  const { can } = usePermissions()
  // I68.11 / I68.12: the phase's delivery day and the ADR-0093 arithmetic, the same code Edit piece and the
  // evidenced date dialog use.
  const checks = useDueDateChecks({ deliverableId: piece.id, clientId: props.clientId, goLiveAt: props.goLiveAt })
  const catalogue = useDeliverableCatalogue()
  const leads = useDeliverableOwnerCandidates()
  const update = useUpdateCampaignDeliverable()
  const reassign = useReassignDeliverable()
  const movePhase = useMoveDeliverableToPhase()
  const moveWorkstream = useMoveDeliverableToWorkstream()
  const transition = useTransitionDeliverable()
  const changeType = useChangeDeliverableType()
  const editDirect = useEditPieceDirect()
  const updateDetails = useUpdatePieceDetails()
  // I68.14: what the piece waits for from outside (ADR-0069) — raised and cleared here now the window is retired.
  const pendingInputs = usePendingInputs(piece.id)

  const [name, setName] = useState(piece.name)
  const [typeId, setTypeId] = useState(piece.deliverableTypeId ?? '')
  const [quantity, setQuantity] = useState(String(piece.quantity ?? 1))
  const [ownerId, setOwnerId] = useState(piece.ownerUserId ?? '')
  const [phaseId, setPhaseId] = useState(piece.phaseId ?? '')
  const [workstreamId, setWorkstreamId] = useState(piece.workstreamId ?? '')
  const [dueDay, setDueDay] = useState(piece.dueAt ? iraqDay(piece.dueAt) : '')
  // I68.11: the answer to "the phase moves the date — move it?", for the phase picked now; null = not yet asked.
  const [phaseDateAnswer, setPhaseDateAnswer] = useState<'move' | 'keep' | null>(null)
  const [channel, setChannel] = useState(piece.channel ?? '')
  // ADR-0117 addendum (Q18): the deliverable's own list, in the order chosen.
  const [languages, setLanguages] = useState<string[]>(piece.languages ?? [])
  const languageList = useLanguageWords()
  const addLanguage = useAddLanguage()
  const [notes, setNotes] = useState(piece.notes ?? '')
  // The deliverable changed under the panel (an answered ask moved its due date; a save came back): every field the
  // person has not touched follows the saved deliverable, so nothing stale is offered to Save (test script, 4 Oct).
  const saved = {
    name: piece.name, typeId: piece.deliverableTypeId ?? '', quantity: String(piece.quantity ?? 1),
    ownerId: piece.ownerUserId ?? '', phaseId: piece.phaseId ?? '', workstreamId: piece.workstreamId ?? '',
    dueDay: piece.dueAt ? iraqDay(piece.dueAt) : '', channel: piece.channel ?? '', languages: piece.languages ?? [],
    notes: piece.notes ?? '',
  }
  const [seenSaved, setSeenSaved] = useState(saved)
  if (!sameSaved(seenSaved, saved)) {
    const f = followSaved(seenSaved, saved, { name, typeId, quantity, ownerId, phaseId, workstreamId, dueDay, channel, languages, notes })
    setSeenSaved(saved)
    setName(f.name); setTypeId(f.typeId); setQuantity(f.quantity); setOwnerId(f.ownerId); setPhaseId(f.phaseId)
    setWorkstreamId(f.workstreamId); setDueDay(f.dueDay); setChannel(f.channel); setLanguages([...f.languages]); setNotes(f.notes)
  }
  // The type went through `change_deliverable_type` in this save — the name write must not send it again.
  const typeApplied = useRef(false)
  const [saving, setSaving] = useState(false)
  const [ask, setAsk] = useState<Ask>(null)

  const tasks = (piece.taskList ?? []).filter((x) => x.status !== 'cancelled')
  const liveTasks = tasks.filter((x) => x.status !== 'done')
  const mayChangeOwner = can('deliverable_owner:manage')
  const mayMovePhase = props.canMovePhase && props.phases.length > 0
  const mayClose = allowedTransitions(piece.state, { manage: can('project_tasks:manage'), review: can('reviews:moderate') })
    .some((tr) => tr.to === 'archived')

  const ownerOptions = useMemo(() => {
    const people = leadsOfDepartment(leads.data ?? [], piece.departmentId).map((u) => ({ id: u.id, name: u.name, hint: null }))
    if (piece.ownerUserId && !people.some((p) => p.id === piece.ownerUserId)) {
      people.unshift({ id: piece.ownerUserId, name: piece.ownerName ?? '—', hint: null })
    }
    return people
  }, [leads.data, piece.departmentId, piece.ownerUserId, piece.ownerName])

  const typeChanged = (typeId || null) !== (piece.deliverableTypeId ?? null)
  const qty = Math.max(1, Number(quantity) || 1)
  const qtyChanged = qty !== (piece.quantity ?? 1)
  const currentDay = piece.dueAt ? iraqDay(piece.dueAt) : ''
  const dueChanged = dueDay !== '' && dueDay !== currentDay
  // ADR-0093: what the new date leaves before go-live — warned before Save, recorded when proceeded past.
  const dueArithmetic = dueChanged ? checks.arithmetic(dueDay) : null
  // I68.11 (I57.36): a new phase moves the date to its delivery day — asked the moment the phase is picked.
  const targetPhase = mayMovePhase && phaseId !== '' && phaseId !== (piece.phaseId ?? '')
    ? props.phases.find((p) => p.id === phaseId) ?? null
    : null
  const plannedDue = targetPhase ? checks.phaseDue(targetPhase.endsOn) : null
  const phaseDateAsk = plannedDue != null && plannedDue !== currentDay && phaseDateAnswer == null ? plannedDue : null
  const languagesChanged = languages.join(',') !== (piece.languages ?? []).join(',')
  const detailsChanged =
    channel.trim() !== (piece.channel ?? '') || languagesChanged || notes.trim() !== (piece.notes ?? '')
  // Q18: a deliverable is made in at least one language — said under the picker, and Save waits for one.
  const noLanguage = languages.length === 0 && detailsChanged
  const dirty =
    name.trim() !== piece.name || typeChanged || qtyChanged || dueChanged || detailsChanged ||
    (mayChangeOwner && ownerId !== '' && ownerId !== (piece.ownerUserId ?? '')) ||
    (mayMovePhase && phaseId !== '' && phaseId !== (piece.phaseId ?? '')) ||
    (!props.isSingleJob && props.workstreams.length > 0 && workstreamId !== (piece.workstreamId ?? ''))

  // ADR-0141: the server is authoritative — a direct edit it refuses in the account manager's name opens the form.
  const locked = props.mayChangeFields === false
  const [askOpen, setAskOpen] = useState(false)
  const fail = (err: unknown) => {
    const am = askAccountManagerOf(err)
    if (am) {
      props.onBanner({ kind: 'error', text: t('changeAsk.error.ask_account_manager', { name: am.name ?? t('changeAsk.theAm') }) })
      setAskOpen(true)
      return
    }
    props.onBanner(failed(err, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t))
  }

  /** What is left once the type and the quantity are settled (each asked first, d.3). */
  async function saveRest() {
    if (!name.trim()) return props.onBanner({ kind: 'error', text: t('campaigns.deliverableDialog.nameRequired') })
    setSaving(true)
    try {
      const typeHere = typeChanged && !typeApplied.current
      if (name.trim() !== piece.name || typeHere) {
        await update.mutateAsync({
          campaignId: props.campaignId,
          deliverableId: piece.id,
          name: name.trim(),
          deliverableTypeId: typeId || null,
          quantity: qty,
        })
      }
      if (dueChanged) {
        await editDirect.mutateAsync({ deliverableId: piece.id, dueDay })
        // ADR-0093 / ADR-0075 d.9: a warning proceeded past is recorded (due_date_override), as the evidenced route does.
        await checks.recordIfWarned(dueDay, dueArithmetic)
      }
      if (detailsChanged) {
        await updateDetails.mutateAsync({
          campaignId: props.campaignId, deliverableId: piece.id, channel: channel.trim(), languages, notes: notes.trim(),
        })
      }
      if (mayChangeOwner && ownerId !== '' && ownerId !== (piece.ownerUserId ?? '')) {
        await reassign.mutateAsync({ deliverableId: piece.id, ownerUserId: ownerId })
      }
      if (mayMovePhase && phaseId !== '' && phaseId !== (piece.phaseId ?? '')) {
        await movePhase.mutateAsync({ campaignId: props.campaignId, deliverableId: piece.id, phaseId })
      }
      if (!props.isSingleJob && props.workstreams.length > 0 && workstreamId !== (piece.workstreamId ?? '')) {
        await moveWorkstream.mutateAsync({ deliverableId: piece.id, workstreamId: workstreamId || null })
      }
      // I59.47, as Edit piece says it: a phase move names the phase and whether the promised date moved with it.
      props.onBanner({
        kind: 'ok',
        text: targetPhase
          ? dueChanged
            ? t('campaigns.editPiece.movedDateChanged', { phase: targetPhase.name })
            : t('campaigns.editPiece.movedDateKept', {
                phase: targetPhase.name,
                date: piece.dueAt ? formatIraqShortDate(piece.dueAt) : t('campaigns.editPiece.noDue'),
              })
          : t('campaigns.deliverableDialog.editedOk'),
      })
    } catch (err) {
      fail(err)
    } finally {
      typeApplied.current = false
      setSaving(false)
    }
  }

  /** After the type: a new quantity is asked first too, then the rest. */
  function afterType() {
    if (qtyChanged) return setAsk({ kind: 'quantity', quantity: qty })
    void saveRest()
  }

  function save() {
    typeApplied.current = false
    // d.3: a new type over live tasks replaces the list — asked first, with what it does.
    if (typeChanged && typeId && liveTasks.length > 0) return setAsk({ kind: 'type', typeId })
    afterType()
  }

  async function confirmType(nextType: string) {
    setSaving(true)
    try {
      await changeType.mutateAsync({ deliverableId: piece.id, typeId: nextType })
      typeApplied.current = true
      setAsk(null)
      setSaving(false)
      afterType()
    } catch (err) {
      setAsk(null)
      setSaving(false)
      fail(err)
    }
  }

  async function confirmQuantity(next: number) {
    setSaving(true)
    try {
      await editDirect.mutateAsync({ deliverableId: piece.id, quantity: next })
      setAsk(null)
      setSaving(false)
      await saveRest()
    } catch (err) {
      setAsk(null)
      setSaving(false)
      fail(err)
    }
  }

  const typeName = (id: string | null) => (id ? catalogue.items.find((x) => x.id === id)?.name ?? piece.typeName ?? '' : '')

  return (
    <section className="piece-panel" data-testid={testId}>
      <h3 className="piece-section-title">{t('campaigns.panel.deliverable')}</h3>
      {/* I74.13 / I74.15 (mock-up 6, CP-07–CP-09): the header strip and the ask's state. */}
      <PieceChangeAsk deliverableId={piece.id} locked={locked} viewerId={props.viewerId ?? null} testId={`${testId}-ask`} />
      {askOpen && <ChangeAskDialog deliverableId={piece.id} onClose={() => setAskOpen(false)} testId={`${testId}-ask-form`} />}
      <div className="piece-panel-fields">
        {!locked && (<>
        <label className="piece-panel-field">
          <span>{t('campaigns.editPiece.name')}</span>
          <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid={`${testId}-name`} />
        </label>
        <div className="piece-panel-field">
          <span>{t('campaigns.editPiece.type')}</span>
          <DeliverablePicker items={catalogue.items} value={typeId} onChange={setTypeId} testId={`${testId}-type`} />
          {typeChanged && liveTasks.length > 0 && (
            <small className="piece-panel-note" data-testid={`${testId}-type-note`}>{t('campaigns.panel.typeReplaces')}</small>
          )}
        </div>
        <label className="piece-panel-field">
          <span>{t('campaigns.editPiece.quantity')}</span>
          <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid={`${testId}-quantity`} />
        </label>
        </>)}
        <div className="piece-panel-field">
          <span>{t('campaigns.editPiece.owner')}</span>
          {mayChangeOwner ? (
            <PersonPicker people={ownerOptions} value={ownerId} onChange={setOwnerId} placeholder={t('campaigns.deliverableDialog.ownerHint')} testId={`${testId}-owner`} />
          ) : (
            <span className="piece-panel-fixed">{piece.ownerName ?? t('campaigns.page.noOwner')}</span>
          )}
        </div>
        {!locked && (<>
        <div className="piece-panel-field">
          <span>{t('campaigns.panel.dueToClient')}</span>
          <DateField value={dueDay} onChange={setDueDay} aria-label={t('campaigns.panel.dueToClient')} data-testid={`${testId}-due`} />
          <DueDateWarning arithmetic={dueArithmetic} testId={`${testId}-due-warning`} />
        </div>
        <label className="piece-panel-field">
          <span>{t('campaigns.panel.channel')}</span>
          <input value={channel} maxLength={80} onChange={(e) => setChannel(e.target.value)} data-testid={`${testId}-channel`} />
        </label>
        <div className="piece-panel-field piece-panel-wide">
          <span>{t('campaigns.panel.languages')}</span>
          <LanguagePicker
            options={languageList.options}
            value={languages}
            onChange={setLanguages}
            onAdd={(label) => addLanguage.mutateAsync(label)}
            adding={addLanguage.isPending}
            testId={`${testId}-languages`}
          />
          {noLanguage && (
            <small className="piece-panel-note" role="status" data-testid={`${testId}-languages-missing`}>
              {t('campaigns.panel.languagesRequired')}
            </small>
          )}
        </div>
        </>)}
        {!props.isSingleJob && props.workstreams.length > 0 && (
          <label className="piece-panel-field">
            <span>{t('campaigns.panel.workstream')}</span>
            <select value={workstreamId} onChange={(e) => setWorkstreamId(e.target.value)} data-testid={`${testId}-workstream`}>
              {!piece.workstreamId && <option value="">{t('campaigns.panel.noWorkstream')}</option>}
              {props.workstreams.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        )}
        {!props.isSingleJob && mayMovePhase && (
          <label className="piece-panel-field">
            <span>{t('campaigns.editPiece.phase')}</span>
            <select value={phaseId} onChange={(e) => { setPhaseId(e.target.value); setPhaseDateAnswer(null) }} data-testid={`${testId}-phase`}>
              {!piece.phaseId && <option value="">{t('campaigns.editPiece.noPhase')}</option>}
              {props.phases.map((p) => <option key={p.id} value={p.id}>{p.number}. {p.name}</option>)}
            </select>
          </label>
        )}
        {phaseDateAsk && targetPhase && (
          <div className="piece-panel-phase-date piece-panel-wide" role="status" data-testid={`${testId}-phase-date`}>
            <span>{t('campaigns.panel.phaseMovesDate', { phase: targetPhase.name, date: formatPlanDay(phaseDateAsk, loc) })}</span>
            <Button variant="secondary" size="sm" onClick={() => { setDueDay(phaseDateAsk); setPhaseDateAnswer('move') }} data-testid={`${testId}-phase-date-move`}>
              {t('campaigns.panel.phaseDateMove', { date: formatPlanDay(phaseDateAsk, loc) })}
            </Button>
            <Button variant="link" size="sm" onClick={() => setPhaseDateAnswer('keep')} data-testid={`${testId}-phase-date-keep`}>
              {currentDay ? t('campaigns.panel.phaseDateKeep', { date: formatPlanDay(currentDay, loc) }) : t('campaigns.panel.phaseDateKeepNone')}
            </Button>
          </div>
        )}
        {locked ? (
          piece.notes ? (
            <div className="piece-panel-field piece-panel-wide">
              <span>{t('campaigns.panel.briefLines')}</span>
              <p className="piece-panel-fixed" dir="auto" data-testid={`${testId}-brief-lines-ro`}>{piece.notes}</p>
            </div>
          ) : null
        ) : (
          <label className="piece-panel-field piece-panel-wide">
            <span>{t('campaigns.panel.briefLines')}</span>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} dir="auto" data-testid={`${testId}-brief-lines`} />
          </label>
        )}
      </div>
      <div className="piece-panel-save">
        <Button variant="primary" size="sm" busy={saving} disabled={!dirty || saving || noLanguage} onClick={save} data-testid={`${testId}-save`}>
          {t('campaigns.panel.save')}
        </Button>
        {props.onClientChange && !locked && (
          <Button variant="link" size="sm" onClick={props.onClientChange} data-testid={`${testId}-client-change`}>
            {t('campaigns.panel.clientChange')}
          </Button>
        )}
      </div>

      {/* I71.7 (Edward, 1 Oct, A): the brief's "what could stop this", above the list and its Approve — while the list
          is unapproved, also before its first task exists (the owner is defining them). */}
      {piece.tasksApprovedAt == null && (
        <TaskListRiskReminder campaignId={props.campaignId} departmentId={piece.departmentId} canDismiss testId={`${testId}-risk`} />
      )}
      {/* ADR-0140 (I74.7–I74.12): the piece's tasks — the suggested list and its approval, then Who and Dates on every
          row; each row's pencil opens the one task editor. */}
      <PieceTasks deliverableId={piece.id} markTaskId={props.markTaskId} onBanner={props.onBanner} testId={`${testId}-tasks`} />

      {/* I68.14 (ADR-0132 d.8): the window's "Waiting on someone outside" and the deliverable's chat, after the task list. */}
      <ExternalInputs deliverableId={piece.id} inputs={pendingInputs.data ?? NO_INPUTS} canManage={can('project_tasks:manage')} />

      {mayClose && (
        <div className="piece-panel-close">
          <Button variant="danger" size="sm" onClick={() => setAsk({ kind: 'close' })} data-testid={`${testId}-close-piece`}>
            {t(props.isSingleJob ? 'campaigns.panel.closeJob' : 'campaigns.panel.closePiece')}
          </Button>
        </div>
      )}

      <ChatPanel contextType="deliverable" contextId={piece.id} readOnly={piece.state === 'archived'} />

      {ask?.kind === 'type' && (
        <TypeChangeConfirm
          deliverableId={piece.id}
          fromName={typeName(piece.deliverableTypeId ?? null)}
          toTypeId={ask.typeId}
          toName={typeName(ask.typeId)}
          busy={saving}
          onConfirm={() => void confirmType(ask.typeId)}
          onCancel={() => { setTypeId(piece.deliverableTypeId ?? ''); setAsk(null) }}
          testId={`${testId}-type-confirm`}
        />
      )}
      {ask?.kind === 'quantity' && (
        <QuantityChangeConfirm
          deliverableId={piece.id}
          from={piece.quantity ?? 1}
          to={ask.quantity}
          busy={saving}
          onConfirm={() => void confirmQuantity(ask.quantity)}
          onCancel={() => { setQuantity(String(piece.quantity ?? 1)); setAsk(null) }}
          testId={`${testId}-quantity-confirm`}
        />
      )}
      {ask?.kind === 'close' && (
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
          onConfirm={() =>
            transition.mutate(
              { deliverableId: piece.id, to: 'archived', expectedState: piece.state },
              {
                onSuccess: () => { setAsk(null); props.onBanner({ kind: 'ok', text: t('campaigns.editPiece.closedOk') }); props.onClosed() },
                onError: (e) => { setAsk(null); fail(e) },
              },
            )
          }
          onCancel={() => setAsk(null)}
          testId={`${testId}-close-confirm`}
        />
      )}
    </section>
  )
}

/** ADR-0132 d.3: what a new type does to the list, said before it happens (the server's preview). */
function TypeChangeConfirm(p: {
  deliverableId: string
  fromName: string
  toTypeId: string
  toName: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
  testId: string
}) {
  const { t } = useTranslation()
  const preview = usePreviewTypeChange(p.deliverableId, p.toTypeId)
  const d = preview.data
  const told = d ? [...new Set(d.cancelled.map((x) => x.assigneeName).filter((x): x is string => !!x))] : []
  const detail = d
    ? [
        d.cancelled.length > 0
          ? t('campaigns.panel.typeCancels', { count: d.cancelled.length, names: d.cancelled.map((x) => x.title).join(', ') })
          : t('campaigns.panel.typeCancelsNone'),
        ...(told.length > 0 ? [t('campaigns.panel.typeTold', { names: told.join(', ') })] : []),
        ...(d.kept.length > 0 ? [t('campaigns.panel.typeKeeps', { names: d.kept.map((x) => x.title).join(', ') })] : []),
        t('campaigns.panel.typeAdds', { count: d.added.length, names: d.added.join(', ') }),
      ]
    : [preview.isError ? t('campaigns.panel.typePreviewFailed') : t('campaigns.panel.typePreviewLoading')]
  return (
    <ConfirmDialog
      title={t('campaigns.panel.typeTitle', { from: p.fromName, to: p.toName })}
      message={t('campaigns.panel.typeMessage')}
      detail={detail}
      confirmLabel={t('campaigns.panel.typeConfirm')}
      busy={p.busy || preview.isLoading}
      onConfirm={p.onConfirm}
      onCancel={p.onCancel}
      testId={p.testId}
    />
  )
}

/** ADR-0132 d.3: what a new quantity does to the units, said before it happens (the server's preview). */
function QuantityChangeConfirm(p: {
  deliverableId: string
  from: number
  to: number
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
  testId: string
}) {
  const { t } = useTranslation()
  const preview = usePreviewQuantityChange(p.deliverableId, p.to)
  const d = preview.data
  const told = d ? [...new Set(d.cancelled.map((x) => x.assigneeName).filter((x): x is string => !!x))] : []
  const detail = d
    ? [
        d.cancelled.length > 0
          ? t('campaigns.panel.typeCancels', { count: d.cancelled.length, names: d.cancelled.map((x) => x.title).join(', ') })
          : t('campaigns.panel.typeCancelsNone'),
        ...(told.length > 0 ? [t('campaigns.panel.typeTold', { names: told.join(', ') })] : []),
        ...(d.added.length > 0 ? [t('campaigns.panel.typeAdds', { count: d.added.length, names: d.added.join(', ') })] : []),
      ]
    : [preview.isError ? t('campaigns.panel.typePreviewFailed') : t('campaigns.panel.typePreviewLoading')]
  return (
    <ConfirmDialog
      title={t('campaigns.panel.quantityTitle', { from: p.from, to: p.to })}
      message={t('campaigns.panel.quantityMessage')}
      detail={detail}
      confirmLabel={t('campaigns.panel.quantityConfirm')}
      busy={p.busy || preview.isLoading}
      onConfirm={p.onConfirm}
      onCancel={p.onCancel}
      testId={p.testId}
    />
  )
}
