import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Modal, ModalFooter, ModalHeader } from '../../../components/Modal'
import { useRenameCampaign } from '../api/campaign-detail-api'

/**
 * Rename a live campaign or single job (ADR-0137, I73.2). Offered to its approval authority only; the
 * database decides again (`campaign_name_guard`). A look-alike name is refused as the wizard refuses it
 * (ADR-0135), and the campaign's Library folder follows the new name.
 */
export function RenameCampaignDialog({ campaignId, name, isJob, onClose }: { campaignId: string; name: string; isJob: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const rename = useRenameCampaign()
  const [value, setValue] = useState(name)
  const [error, setError] = useState<string | null>(null)
  const clean = value.trim()
  const save = () => {
    if (!clean || clean === name) return
    setError(null)
    rename.mutate({ campaignId, name: clean }, {
      onSuccess: onClose,
      onError: (e) => {
        const code = (e as { code?: string }).code
        setError(code === '23505' ? t('campaigns.wizard.duplicateName')
          : code === '42501' ? t('campaigns.rename.notYours')
          : t('campaigns.rename.failed'))
      },
    })
  }
  return (
    <Modal onClose={onClose} labelledById="campaign-rename-title" testId="campaign-rename">
      <ModalHeader id="campaign-rename-title" title={t(isJob ? 'campaigns.rename.titleJob' : 'campaigns.rename.title')} subtitle={t('campaigns.rename.sub')} />
      <div className="modal-body">
        <label className="field">
          <span>{t('campaigns.rename.label')}</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save() }}
            autoFocus
            data-testid="campaign-rename-input"
          />
        </label>
        {error && <p className="form-error" role="alert" data-testid="campaign-rename-error">{error}</p>}
      </div>
      <ModalFooter>
        <Button variant="primary" onClick={save} disabled={!clean || clean === name} busy={rename.isPending} data-testid="campaign-rename-save">
          {t('campaigns.rename.save')}
        </Button>
        <Button variant="link" onClick={onClose}>{t('common.cancel')}</Button>
      </ModalFooter>
    </Modal>
  )
}
