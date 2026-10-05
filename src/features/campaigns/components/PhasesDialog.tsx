import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '../../../components/Button'
import { Modal } from '../../../components/Modal'
import {
  useDeleteCampaignPhase,
  useSaveCampaignPhase,
  useSetCampaignPhases,
  type CampaignPhase,
} from '../api/campaign-detail-api'
import { DateField } from '../../../components/DateField'

/**
 * Manage a campaign's phases (ADR-0096 d.2, d.5, d.6): rename, re-date, add at the next number,
 * delete an empty one, and turn phases off. Offered to the campaign's approval authority only; the
 * database words every refusal (a phase holding work cannot be deleted; phases cannot be turned off
 * while several hold work), so nothing here pre-empts it — the UI never blocks, the server refuses
 * in words (ADR-0092).
 *
 * Overlap is allowed on purpose (Edward: *"in the event that phases need to overlap or run in
 * parallel"*); a phase ending before it starts is the one thing the form refuses itself.
 */
export function PhasesDialog({
  campaignId,
  phases,
  countByPhase,
  onBanner,
  onClose,
}: {
  campaignId: string
  phases: readonly CampaignPhase[]
  /** Deliverables per phase id — shown beside the row, and why Delete is worded. */
  countByPhase: ReadonlyMap<string, number>
  onBanner: (b: { kind: 'ok' | 'error'; text: string; err?: unknown }) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const save = useSaveCampaignPhase()
  const remove = useDeleteCampaignPhase()
  const toggle = useSetCampaignPhases()
  const [drafts, setDrafts] = useState<Record<string, { name: string; startsOn: string; endsOn: string }>>({})
  const [add, setAdd] = useState({ name: '', startsOn: '', endsOn: '' })
  const [error, setError] = useState<string | null>(null)
  const busy = save.isPending || remove.isPending || toggle.isPending

  const draftOf = (p: CampaignPhase) => drafts[p.id] ?? { name: p.name, startsOn: p.startsOn, endsOn: p.endsOn }
  const changed = (p: CampaignPhase) => {
    const d = draftOf(p)
    return d.name !== p.name || d.startsOn !== p.startsOn || d.endsOn !== p.endsOn
  }

  function valid(d: { name: string; startsOn: string; endsOn: string }): string | null {
    if (!d.name.trim()) return t('campaigns.phases.nameRequired')
    if (!d.startsOn || !d.endsOn) return t('campaigns.phases.datesRequired')
    if (d.endsOn < d.startsOn) return t('campaigns.phases.endsBeforeStarts')
    return null
  }

  function savePhase(p: CampaignPhase) {
    const d = draftOf(p)
    const v = valid(d)
    if (v) return setError(v)
    setError(null)
    save.mutate(
      { campaignId, phaseId: p.id, name: d.name.trim(), startsOn: d.startsOn, endsOn: d.endsOn },
      {
        onSuccess: () => setDrafts((prev) => { const n = { ...prev }; delete n[p.id]; return n }),
        onError: (err) => onBanner({ kind: 'error', text: t('campaigns.phases.saveFailed'), err }),
      },
    )
  }

  function addPhase() {
    const v = valid(add)
    if (v) return setError(v)
    setError(null)
    save.mutate(
      { campaignId, phaseId: null, name: add.name.trim(), startsOn: add.startsOn, endsOn: add.endsOn },
      {
        onSuccess: () => setAdd({ name: '', startsOn: '', endsOn: '' }),
        onError: (err) => onBanner({ kind: 'error', text: t('campaigns.phases.saveFailed'), err }),
      },
    )
  }

  return (
    <Modal onClose={onClose} card={false}>
      <div className="dialog dialog-wide dialog-fit" role="dialog" aria-modal="true" aria-label={t('campaigns.phases.manage')} data-testid="campaign-phases-dialog">
        <h2>{t('campaigns.phases.manage')}</h2>
        <p className="muted">{t('campaigns.phases.manageIntro')}</p>

        <table className="data-table" data-testid="campaign-phases-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('campaigns.phases.name')}</th>
              <th>{t('campaigns.phases.startsOn')}</th>
              <th>{t('campaigns.phases.endsOn')}</th>
              <th>{t('campaigns.phases.deliverables')}</th>
              <th>{t('admin.users.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {phases.map((p) => {
              const d = draftOf(p)
              const n = countByPhase.get(p.id) ?? 0
              return (
                <tr key={p.id} data-testid={`campaign-phase-row-${p.id}`}>
                  <td>{p.number}</td>
                  <td>
                    <input value={d.name} maxLength={120} aria-label={t('campaigns.phases.name')}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [p.id]: { ...d, name: e.target.value } }))}
                      data-testid={`campaign-phase-name-${p.id}`} />
                  </td>
                  <td>
                    <DateField value={d.startsOn} aria-label={t('campaigns.phases.startsOn')}
                      onChange={(v) => setDrafts((prev) => ({ ...prev, [p.id]: { ...d, startsOn: v } }))}
                      data-testid={`campaign-phase-start-${p.id}`} />
                  </td>
                  <td>
                    <DateField value={d.endsOn} aria-label={t('campaigns.phases.endsOn')}
                      onChange={(v) => setDrafts((prev) => ({ ...prev, [p.id]: { ...d, endsOn: v } }))}
                      data-testid={`campaign-phase-end-${p.id}`} />
                  </td>
                  <td data-testid={`campaign-phase-count-${p.id}`}>{n}</td>
                  <td className="row-actions">
                    {changed(p) && (
                      <IconButton icon="check" size="sm" label={t('common.save')} disabled={busy} onClick={() => savePhase(p)} data-testid={`campaign-phase-save-${p.id}`} />
                    )}
                    <IconButton
                      icon="trash" size="sm" danger disabled={busy}
                      label={n > 0 ? t('campaigns.phases.deleteHolds', { count: n }) : t('campaigns.phases.delete')}
                      onClick={() =>
                        remove.mutate({ campaignId, phaseId: p.id }, {
                          onError: (err) => onBanner({ kind: 'error', text: t('campaigns.phases.deleteFailed'), err }),
                        })
                      }
                      data-testid={`campaign-phase-delete-${p.id}`}
                    />
                  </td>
                </tr>
              )
            })}
            <tr data-testid="campaign-phase-add-row">
              <td>{phases.length + 1}</td>
              <td>
                <input value={add.name} maxLength={120} placeholder={t('campaigns.phases.namePlaceholder')} aria-label={t('campaigns.phases.name')}
                  onChange={(e) => setAdd({ ...add, name: e.target.value })} data-testid="campaign-phase-add-name" />
              </td>
              <td>
                <DateField value={add.startsOn} aria-label={t('campaigns.phases.startsOn')}
                  onChange={(v) => setAdd({ ...add, startsOn: v })} data-testid="campaign-phase-add-start" />
              </td>
              <td>
                <DateField value={add.endsOn} aria-label={t('campaigns.phases.endsOn')}
                  onChange={(v) => setAdd({ ...add, endsOn: v })} data-testid="campaign-phase-add-end" />
              </td>
              <td>—</td>
              <td className="row-actions">
                <Button variant="secondary" size="sm" icon="plus" disabled={busy} onClick={addPhase} data-testid="campaign-phase-add">
                  {t('campaigns.phases.add')}
                </Button>
              </td>
            </tr>
          </tbody>
        </table>

        {error && <p className="form-error" role="alert" data-testid="campaign-phases-error">{error}</p>}

        <div className="dialog-actions">
          <Button
            variant="secondary" type="button" disabled={busy}
            onClick={() =>
              toggle.mutate({ campaignId, enabled: false }, {
                onSuccess: () => { onBanner({ kind: 'ok', text: t('campaigns.phases.turnedOff') }); onClose() },
                onError: (err) => onBanner({ kind: 'error', text: t('campaigns.phases.turnOffFailed'), err }),
              })
            }
            data-testid="campaign-phases-off"
          >
            {t('campaigns.phases.turnOff')}
          </Button>
          <Button variant="primary" type="button" onClick={onClose} data-testid="campaign-phases-done">
            {t('admin.briefTemplates.close')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
