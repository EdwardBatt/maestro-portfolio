import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Modal } from '../../../components/Modal'
import { PersonPicker } from '../../../components/PersonPicker'
import { DeliverablePicker } from '../../../components/DeliverablePicker'
import { endOfWorkingDay, iraqDay } from '../../../lib/time/iraq'
import { classifyDueDate, isAfterPhaseEnd, type DueDateArithmetic } from '../../../lib/campaigns/go-live-dates'
import { useWorkCalendar } from '../../../lib/calendar/client-calendar'
import { useSchedulingSettings, DEFAULT_SCHEDULING_SETTINGS } from '../../../lib/settings/scheduling-settings-api'
import { useDeliverableCatalogue } from '../../admin/api/deliverable-types-api'
import { useDeliverableOwnerCandidates } from '../../deliverables/api/deliverables-api'
import { useAddCampaignDeliverable, useUpdateCampaignDeliverable, type CampaignPhase } from '../api/campaign-detail-api'
import { DueDateWarning, PhaseEndWarning } from './DueDateWarning'
import { DateField } from '../../../components/DateField'
import { leadsOfDepartment } from '../../../lib/people/leads-of-department'

/**
 * Add a deliverable to a campaign or job that already exists, or edit one (I52.20 / I52.21,
 * Edward 17 Sep). Until now a deliverable was born in the wizard and never touched again: on
 * production a campaign's deliverables had no type, so no task list ever materialised, and nothing
 * on any page could give them one.
 *
 * ADD (the account manager, or tenant-wide reach — the approval authority): the catalogue
 * deliverable (ADR-0097 d.7 — the field is "Deliverable", a searchable picker over the 260, never
 * "Type"), a label, owner, quantity, due date, and — when the campaign runs in phases — the phase
 * (ADR-0096 d.8). The owner stamps the department (ADR-0050); the catalogue entry materialises the
 * task list (ADR-0052); **a due date is required** (ADR-0093 addendum d.7); a date past go-live or
 * past the phase's end warns and is recorded (ADR-0093, ADR-0096 d.7).
 *
 * EDIT (also the owner and the leads in reach): label, catalogue entry, quantity. The due date is
 * not here — the deliverable's date is the promise to the client and moves only with evidence,
 * through *Change promise* (ADR-0088 d.7a). Setting a catalogue entry where there was none
 * materialises the tasks; changing one while its tasks are live is refused by the database, in
 * words. Moving between phases is on the row itself.
 */
export interface DeliverableDialogProps {
  campaignId: string
  goLiveAt: string | null
  /** ADR-0096: the campaign's phases, empty when phases are off. */
  phases?: readonly CampaignPhase[]
  /** Present for an edit; absent for an add. */
  existing?: { id: string; name: string; deliverableTypeId: string | null; quantity: number } | null
  onSaved: (mode: 'added' | 'edited') => void
  onFailed: (err: unknown) => void
  onClose: () => void
  /** ADR-0116 d.3: on a campaign, the piece goes into one of these — required. Absent on a single job. */
  workstreams?: readonly { id: string; name: string; departmentId?: string | null }[]
  requireWorkstream?: boolean
}

export function DeliverableDialog({ campaignId, goLiveAt, phases = [], existing, onSaved, onFailed, onClose, workstreams = [], requireWorkstream = false }: DeliverableDialogProps) {
  const { t } = useTranslation()
  const add = useAddCampaignDeliverable()
  const update = useUpdateCampaignDeliverable()
  const catalogue = useDeliverableCatalogue()
  const owners = useDeliverableOwnerCandidates()
  // ADR-0123 d.3: the client's working week.
  const { calendar } = useWorkCalendar({ campaignId })
  const settings = useSchedulingSettings()
  const rule = (settings.data ?? DEFAULT_SCHEDULING_SETTINGS).rule

  const [typeId, setTypeId] = useState(existing?.deliverableTypeId ?? '')
  const [name, setName] = useState(existing?.name ?? '')
  const [nameTouched, setNameTouched] = useState(Boolean(existing))
  const [quantity, setQuantity] = useState(String(existing?.quantity ?? 1))
  const [ownerId, setOwnerId] = useState('')
  const [workstreamId, setWorkstreamId] = useState(workstreams.length === 1 ? workstreams[0]!.id : '')
  const [due, setDue] = useState('')
  const [phaseId, setPhaseId] = useState(phases[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const busy = add.isPending || update.isPending
  const editing = Boolean(existing)
  const hasPhases = phases.length > 0

  // I66.9: the chosen workstream's department's leads — every lead only while no workstream is chosen.
  const department = workstreams.find((w) => w.id === workstreamId)?.departmentId ?? null
  const ownerOptions = useMemo(
    () => leadsOfDepartment(owners.data ?? [], department).map((u) => ({ id: u.id, name: u.name, hint: null })),
    [owners.data, department],
  )
  const chosenEntry = catalogue.items.find((x) => x.id === typeId) ?? null
  const chosenPhase = phases.find((p) => p.id === phaseId) ?? null
  const arithmetic: DueDateArithmetic | null =
    due && goLiveAt ? classifyDueDate({ dueDay: due, goLiveDay: iraqDay(goLiveAt), calendar, rule }) : null
  const afterPhaseEnd = isAfterPhaseEnd(due, chosenPhase)

  /** ADR-0097 d.2: the row is named by its catalogue entry until the person types their own label. */
  function chooseEntry(id: string) {
    setTypeId(id)
    if (!nameTouched) setName(catalogue.items.find((x) => x.id === id)?.name ?? '')
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError(t('campaigns.deliverableDialog.nameRequired'))
    const qty = Math.max(1, Number(quantity) || 1)
    if (editing) {
      update.mutate(
        { campaignId, deliverableId: existing!.id, name: name.trim(), deliverableTypeId: typeId || null, quantity: qty },
        { onSuccess: () => { onSaved('edited'); onClose() }, onError: (err) => { onFailed(err); onClose() } },
      )
      return
    }
    if (!ownerId) return setError(t('campaigns.deliverableDialog.ownerRequired'))
    if (requireWorkstream && !workstreamId) return setError(t('campaigns.deliverableDialog.workstreamRequired'))
    // ADR-0093 addendum d.7: never without a due date. Said here, and refused by the database too.
    if (!due) return setError(t('campaigns.deliverableDialog.dueRequired'))
    if (hasPhases && !phaseId) return setError(t('campaigns.deliverableDialog.phaseRequired'))
    const warned = arithmetic && (arithmetic.severity === 'tight' || arithmetic.severity === 'impossible' || arithmetic.severity === 'after_go_live')
    add.mutate(
      {
        campaignId,
        name: name.trim(),
        ownerUserId: ownerId,
        deliverableTypeId: typeId || null,
        quantity: qty,
        dueAt: endOfWorkingDay(due).toISOString(),
        phaseId: hasPhases ? phaseId : null,
        workstreamId: requireWorkstream ? workstreamId : null,
        // One record per proceed: the go-live warning where it fired, else the phase-end one.
        dueDateOverride: warned
          ? { severity: arithmetic.severity, workingDaysLeft: arithmetic.workingDaysToGoLive, requiredDays: arithmetic.requiredDays, boundary: 'go_live' }
          : afterPhaseEnd
            ? { severity: 'after_phase_end', workingDaysLeft: 0, requiredDays: 0, boundary: 'phase_end' }
            : null,
      },
      { onSuccess: () => { onSaved('added'); onClose() }, onError: (err) => { onFailed(err); onClose() } },
    )
  }

  return (
    <Modal onClose={onClose} card={false}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t(editing ? 'campaigns.deliverableDialog.editTitle' : 'campaigns.deliverableDialog.addTitle')}
        onSubmit={onSubmit}
        data-testid="campaign-deliverable-form"
      >
        <h2>{t(editing ? 'campaigns.deliverableDialog.editTitle' : 'campaigns.deliverableDialog.addTitle')}</h2>
        <p className="muted">{t(editing ? 'campaigns.deliverableDialog.editIntro' : 'campaigns.deliverableDialog.addIntro')}</p>

        {/* ADR-0097 d.7: "Deliverable" — one of the 260, searchable — never "Type". */}
        <label className="form-field-wide">
          {t('campaigns.deliverableDialog.deliverable')}
          <DeliverablePicker
            items={catalogue.items}
            value={typeId}
            onChange={chooseEntry}
            autoFocus={!editing}
            testId="campaign-deliverable-form-type"
          />
        </label>
        <p className="muted" data-testid="campaign-deliverable-form-type-note">
          {t(existing?.deliverableTypeId ? 'campaigns.deliverableDialog.typeLockedNote' : 'campaigns.deliverableDialog.typeNote')}
        </p>

        <label>
          {t('campaigns.deliverableDialog.label')}
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setNameTouched(true) }}
            maxLength={200}
            placeholder={chosenEntry?.name ?? ''}
            data-testid="campaign-deliverable-form-name"
          />
        </label>

        <label>
          {t('campaigns.deliverableDialog.quantity')}
          <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="campaign-deliverable-form-quantity" />
        </label>

        {!editing && (
          <>
            {requireWorkstream && (
              <label className="form-field-wide">
                {t('campaigns.deliverableDialog.workstream')}
                {workstreams.length > 0 ? (
                  <select value={workstreamId} onChange={(e) => setWorkstreamId(e.target.value)} data-testid="campaign-deliverable-form-workstream">
                    <option value="">{t('campaigns.deliverableDialog.chooseWorkstream')}</option>
                    {workstreams.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                ) : (
                  <span className="field-hint" data-testid="campaign-deliverable-form-no-workstream">{t('campaigns.deliverableDialog.noWorkstreamYet')}</span>
                )}
              </label>
            )}
            <label className="form-field-wide">
              {t('campaigns.page.colOwner')}
              <PersonPicker
                people={ownerOptions}
                value={ownerId}
                onChange={setOwnerId}
                placeholder={t('campaigns.deliverableDialog.ownerHint')}
                testId="campaign-deliverable-form-owner"
              />
            </label>
            {hasPhases && (
              <label>
                {t('campaigns.phases.phase')}
                <select value={phaseId} onChange={(e) => setPhaseId(e.target.value)} data-testid="campaign-deliverable-form-phase">
                  {phases.map((p) => (
                    <option key={p.id} value={p.id}>{p.number}. {p.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              {t('deliverables.subDue')}
              <DateField value={due} onChange={(v) => setDue(v)} data-testid="campaign-deliverable-form-due" />
            </label>
            <DueDateWarning arithmetic={arithmetic} testId="campaign-deliverable-form-due-warning" />
            <PhaseEndWarning dueDay={due} phase={chosenPhase} testId="campaign-deliverable-form-phase-warning" />
          </>
        )}

        {error && <p className="form-error" role="alert" data-testid="campaign-deliverable-form-error">{error}</p>}

        <div className="dialog-actions">
          <Button variant="secondary" type="button" onClick={onClose} disabled={busy} data-testid="campaign-deliverable-form-cancel">
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" busy={busy} disabled={busy} data-testid="campaign-deliverable-form-submit">
            {t(editing ? 'common.save' : 'campaigns.deliverableDialog.add')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
