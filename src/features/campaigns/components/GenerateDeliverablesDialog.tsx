import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, BusyNote, IconButton } from '../../../components/Button'
import { Modal } from '../../../components/Modal'
import { NoticeBox } from '../../../components/NoticeBox'
import { PersonPicker } from '../../../components/PersonPicker'
import { DeliverablePicker } from '../../../components/DeliverablePicker'
import { endOfWorkingDay } from '../../../lib/time/iraq'
import { isAfterPhaseEnd } from '../../../lib/campaigns/go-live-dates'
import { useDeliverableCatalogue } from '../../admin/api/deliverable-types-api'
import { useDeliverableOwnerCandidates } from '../../deliverables/api/deliverables-api'
import { useAddCampaignDeliverable, type CampaignPhase } from '../api/campaign-detail-api'
import { DeliverablesRefusedError, useGenerateDeliverables } from '../api/deliverables-generate-api'
import { PhaseEndWarning } from './DueDateWarning'
import { DateField } from '../../../components/DateField'
import { leadsOfDepartment } from '../../../lib/people/leads-of-department'

/**
 * Propose NEW deliverables for a campaign that already exists, from its (edited) master brief, and
 * add the ones the account manager keeps (I53.4 — the remainder of I48.43: a job promoted to a
 * campaign could grow neither its brief nor its list).
 *
 * The model proposes from the catalogue (ADR-0097) and is told what the campaign already has, so
 * it does not propose it again; what it returns is a table the person edits — deliverable, label,
 * quantity, owner, due date, phase — and then ADDS, row by row, through `add_campaign_deliverable`.
 * **Existing deliverables are never touched** (Edward, 20 Sep): nothing here updates or removes a
 * row; a proposal that duplicates one is simply removed from the table before adding.
 */
interface Row {
  id: string
  typeId: string
  /** The catalogue code the model answered with; resolved to `typeId` once the catalogue is in. */
  typeCode: string | null
  name: string
  quantity: number
  ownerId: string
  due: string
  phaseId: string
  needsType: boolean
  note: string | null
}

let seq = 0

export function GenerateDeliverablesDialog({
  campaignId,
  briefText,
  existingNames,
  phases,
  onDone,
  onClose,
  workstreams = [],
  requireWorkstream = false,
}: {
  campaignId: string
  /** The master brief as one document, the way the wizard hands it to the model. */
  briefText: string
  existingNames: readonly string[]
  phases: readonly CampaignPhase[]
  onDone: (outcome: { added: number; failed: number; firstError: unknown }) => void
  onClose: () => void
  /** ADR-0116 d.3: on a campaign, everything added goes into one of these, chosen once. */
  workstreams?: readonly { id: string; name: string; departmentId?: string | null }[]
  requireWorkstream?: boolean
}) {
  const { t } = useTranslation()
  const generate = useGenerateDeliverables()
  const add = useAddCampaignDeliverable()
  const catalogue = useDeliverableCatalogue()
  const owners = useDeliverableOwnerCandidates()
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<{ count: number; needsType: number; empty: boolean } | null>(null)
  const [adding, setAdding] = useState(false)
  const hasPhases = phases.length > 0
  const [workstreamId, setWorkstreamId] = useState(workstreams.length === 1 ? workstreams[0]!.id : '')
  // I66.9: the chosen workstream's department's leads — every lead only while none is chosen.
  const department = workstreams.find((w) => w.id === workstreamId)?.departmentId ?? null
  const ownerOptions = useMemo(
    () => leadsOfDepartment(owners.data ?? [], department).map((u) => ({ id: u.id, name: u.name, hint: null })),
    [owners.data, department],
  )

  // One call, on open. The existing list rides inside the brief text as a plain instruction: the
  // request is still `{ brief, phases }` and nothing about who does the work travels (ADR-0050 d.6).
  useEffect(() => {
    let cancelled = false
    const brief = existingNames.length > 0
      ? `${briefText}\n\nAlready planned on this campaign — do not propose these again:\n${existingNames.map((n) => `- ${n}`).join('\n')}`
      : briefText
    generate
      .mutateAsync({
        brief,
        ...(hasPhases ? { phases: phases.map((p) => ({ number: p.number, name: p.name, startsOn: p.startsOn, endsOn: p.endsOn })) } : {}),
      })
      .then((proposal) => {
        if (cancelled) return
        const existing = new Set(existingNames.map((n) => n.trim().toLowerCase()))
        const next: Row[] = proposal.rows
          .filter((r) => !existing.has(r.name.trim().toLowerCase()))
          .map((r) => {
            seq += 1
            const phase = r.phaseNumber != null ? phases.find((p) => p.number === r.phaseNumber) : null
            return {
              id: `g${seq}`,
              typeId: '',
              typeCode: r.typeCode,
              name: r.name,
              quantity: r.quantity,
              ownerId: '',
              due: '',
              phaseId: phase?.id ?? (phases[0]?.id ?? ''),
              // The function checked the code against the catalogue (ADR-0097 d.4); a code it
              // accepted is resolved to an id below, once the catalogue read is in.
              needsType: r.needsType || !r.typeCode,
              note: r.note,
            }
          })
        setRows(next)
        setOutcome({ count: next.length, needsType: next.filter((r) => r.needsType).length, empty: proposal.rows.length === 0 })
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof DeliverablesRefusedError ? t(`campaigns.propose.error.${e.code}`) : t('campaigns.propose.error.failed'))
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The catalogue read and the proposal race; whichever lands second resolves the codes.
  useEffect(() => {
    if (catalogue.items.length === 0) return
    setRows((prev) => prev.map((r) => {
      if (r.typeId || !r.typeCode) return r
      const entry = catalogue.items.find((x) => x.code === r.typeCode)
      return entry ? { ...r, typeId: entry.id, needsType: false } : { ...r, needsType: true }
    }))
  }, [catalogue.items, rows.length])

  function update(id: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  function choose(row: Row, typeId: string) {
    const entry = catalogue.items.find((x) => x.id === typeId) ?? null
    const previous = catalogue.items.find((x) => x.id === row.typeId)?.name ?? null
    const follow = !row.name.trim() || (previous != null && row.name.trim() === previous) || (row.needsType && row.name.trim() === (row.note ?? '').trim())
    update(row.id, { typeId, needsType: typeId ? false : row.needsType, ...(entry && follow ? { name: entry.name } : {}) })
  }
  function addRow() {
    seq += 1
    setRows((prev) => [...prev, { id: `g${seq}`, typeId: '', typeCode: null, name: '', quantity: 1, ownerId: '', due: '', phaseId: phases[0]?.id ?? '', needsType: false, note: null }])
  }

  const gaps = (r: Row): string[] => [
    ...(r.needsType && !r.typeId ? ['deliverable'] : []),
    ...(r.name.trim() ? [] : ['label']),
    ...(r.ownerId ? [] : ['owner']),
    ...(r.due ? [] : ['due']),
    ...(hasPhases && !r.phaseId ? ['phase'] : []),
  ]
  const ready = rows.length > 0 && rows.every((r) => gaps(r).length === 0) && (!requireWorkstream || Boolean(workstreamId))

  async function addAll() {
    if (!ready) {
      // I65.2: say the gap there is. Rows all filled and only the workstream missing (a promoted job has
      // none) is its own sentence — the rows' sentence named four things that were all there.
      const rowsDone = rows.length > 0 && rows.every((r) => gaps(r).length === 0)
      setError(rowsDone
        ? t(workstreams.length > 0 ? 'campaigns.generate.needsWorkstream' : 'campaigns.generate.needsFirstWorkstream')
        : t('campaigns.generate.incomplete'))
      return
    }
    setError(null)
    setAdding(true)
    let added = 0
    let failed = 0
    let firstError: unknown = null
    for (const r of rows) {
      const phase = phases.find((p) => p.id === r.phaseId) ?? null
      try {
        await add.mutateAsync({
          campaignId,
          name: r.name.trim(),
          ownerUserId: r.ownerId,
          deliverableTypeId: r.typeId || null,
          quantity: Math.max(1, r.quantity),
          dueAt: endOfWorkingDay(r.due).toISOString(),
          phaseId: hasPhases ? r.phaseId : null,
          workstreamId: requireWorkstream ? workstreamId : null,
          dueDateOverride: isAfterPhaseEnd(r.due, phase)
            ? { severity: 'after_phase_end', workingDaysLeft: 0, requiredDays: 0, boundary: 'phase_end' }
            : null,
        })
        added += 1
      } catch (e) {
        failed += 1
        firstError ??= e
      }
    }
    setAdding(false)
    onDone({ added, failed, firstError })
    onClose()
  }

  return (
    <Modal onClose={onClose} card={false}>
      <div className="dialog dialog-wide dialog-fit" role="dialog" aria-modal="true" aria-label={t('campaigns.generate.title')} data-testid="campaign-generate-dialog">
        <h2>{t('campaigns.generate.title')}</h2>
        <p className="muted">{t('campaigns.generate.intro')}</p>
        {requireWorkstream && (
          <label className="form-field-wide">
            {t('campaigns.deliverableDialog.workstream')}
            {workstreams.length > 0 ? (
              <select value={workstreamId} onChange={(e) => setWorkstreamId(e.target.value)} data-testid="campaign-generate-workstream">
                <option value="">{t('campaigns.deliverableDialog.chooseWorkstream')}</option>
                {workstreams.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            ) : (
              <span className="field-hint" data-testid="campaign-generate-no-workstream">{t('campaigns.deliverableDialog.noWorkstreamYet')}</span>
            )}
          </label>
        )}

        {generate.isPending && <BusyNote text={t('campaigns.propose.running')} />}
        {outcome && !outcome.empty && (
          <NoticeBox
            testId="campaign-generate-note"
            lines={[
              t('campaigns.generate.proposed', { count: outcome.count }),
              ...(outcome.needsType > 0 ? [t('campaigns.propose.needsChoice', { count: outcome.needsType })] : []),
            ]}
          />
        )}
        {outcome?.empty && (
          <NoticeBox role="status" testId="campaign-generate-none" lines={[t('campaigns.generate.none')]} />
        )}

        {!generate.isPending && (
          <table className="data-table" data-testid="campaign-generate-table">
            <thead>
              <tr>
                <th>{t('campaigns.wizard.colDeliverable')}</th>
                <th>{t('campaigns.wizard.colLabel')}</th>
                <th>{t('campaigns.wizard.quantity')}</th>
                <th>{t('campaigns.page.colOwner')}</th>
                {hasPhases && <th>{t('campaigns.phases.phase')}</th>}
                <th>{t('deliverables.subDue')}</th>
                <th>{t('admin.users.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const phase = phases.find((p) => p.id === r.phaseId) ?? null
                return (
                  <tr key={r.id} data-testid={`campaign-generate-row-${r.id}`} className={r.needsType && !r.typeId ? 'is-invalid' : undefined}>
                    <td>
                      <DeliverablePicker items={catalogue.items} value={r.typeId} onChange={(id) => choose(r, id)} testId={`campaign-generate-type-${r.id}`} />
                      {r.needsType && !r.typeId && <span className="cell-warn deliverable-note" data-testid={`campaign-generate-choose-${r.id}`}>{t('campaigns.wizard.chooseDeliverable')}</span>}
                      {r.note && <span className="muted deliverable-note">{r.note}</span>}
                    </td>
                    <td><input value={r.name} maxLength={200} onChange={(e) => update(r.id, { name: e.target.value })} data-testid={`campaign-generate-name-${r.id}`} /></td>
                    <td><input type="number" min={1} value={r.quantity} className="num-input" onChange={(e) => update(r.id, { quantity: Math.max(1, Number(e.target.value) || 1) })} data-testid={`campaign-generate-qty-${r.id}`} /></td>
                    <td>
                      <PersonPicker people={ownerOptions} value={r.ownerId} onChange={(id) => update(r.id, { ownerId: id })} placeholder={t('campaigns.deliverableDialog.ownerHint')} testId={`campaign-generate-owner-${r.id}`} />
                    </td>
                    {hasPhases && (
                      <td>
                        <select value={r.phaseId} onChange={(e) => update(r.id, { phaseId: e.target.value })} data-testid={`campaign-generate-phase-${r.id}`}>
                          {phases.map((p) => <option key={p.id} value={p.id}>{p.number}. {p.name}</option>)}
                        </select>
                      </td>
                    )}
                    <td>
                      <DateField value={r.due} required onChange={(v) => update(r.id, { due: v })} data-testid={`campaign-generate-due-${r.id}`} />
                      <PhaseEndWarning dueDay={r.due} phase={phase} testId={`campaign-generate-phase-warning-${r.id}`} />
                    </td>
                    <td className="row-actions">
                      <IconButton icon="trash" danger size="sm" label={t('campaigns.wizard.removeRow')} onClick={() => setRows((prev) => prev.filter((x) => x.id !== r.id))} data-testid={`campaign-generate-remove-${r.id}`} />
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan={hasPhases ? 7 : 6} className="muted" data-testid="campaign-generate-empty">{t('campaigns.generate.emptyTable')}</td></tr>
              )}
            </tbody>
          </table>
        )}
        {!generate.isPending && (
          <div className="org-add-form">
            <Button variant="secondary" size="sm" icon="plus" onClick={addRow} data-testid="campaign-generate-add-row">
              {t('campaigns.wizard.addRow')}
            </Button>
          </div>
        )}

        {error && <p className="form-error" role="alert" data-testid="campaign-generate-error">{error}</p>}

        <div className="dialog-actions">
          <Button variant="secondary" type="button" onClick={onClose} disabled={adding} data-testid="campaign-generate-cancel">
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="button" busy={adding} disabled={adding || generate.isPending || rows.length === 0} onClick={() => void addAll()} data-testid="campaign-generate-submit">
            {t('campaigns.generate.addAll', { count: rows.length })}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
