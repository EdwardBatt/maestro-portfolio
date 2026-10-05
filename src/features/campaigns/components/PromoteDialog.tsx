import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Modal, ModalFooter, ModalHeader } from '../../../components/Modal'

/**
 * SJ-A2 — turning a single job into a campaign (ADR-0086 d.10/d.11).
 *
 * A row action on the campaigns list, pressed on a released single job. The two columns say plainly
 * what carries across untouched and what a campaign adds, so the one-way step is taken with eyes
 * open. Nothing is retyped — the row, its receipt, brief, deliverable and owner are already there
 * (d.10); promotion sets `kind` and opens the campaign page (0086 addendum, 11 Sep: the wizard
 * resumes drafts only, so a released job opens as the campaign it now is).
 *
 * Presentation only: the name and two callbacks in.
 */
export function PromoteDialog({
  name,
  busy,
  onConfirm,
  onCancel,
}: {
  name: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const comes = ['comes1', 'comes2', 'comes3', 'comes4'] as const
  const adds = ['adds1', 'adds2', 'adds3', 'adds4', 'adds5'] as const

  return (
    <Modal onClose={() => !busy && onCancel()} labelledById="promote-title" testId="campaign-promote" size="wide">
      <ModalHeader
        id="promote-title"
        eyebrow={t('intake.promote.eyebrow')}
        title={t('intake.promote.title')}
        subtitle={t('intake.promote.message', { name })}
      />
      <div className="modal-body">
        <div className="promote-cols">
          <section className="promote-col promote-comes">
            <span className="promote-col-head">{t('intake.promote.comesHead')}</span>
            <ul>
              {comes.map((k) => <li key={k}>{t(`intake.promote.${k}`)}</li>)}
            </ul>
          </section>
          <section className="promote-col promote-adds">
            <span className="promote-col-head">{t('intake.promote.addsHead')}</span>
            <ul>
              {adds.map((k) => <li key={k}>{t(`intake.promote.${k}`)}</li>)}
            </ul>
          </section>
        </div>
        {/* Kept from the accepted copy: what promotion opens, in our built behaviour. */}
        <p className="muted promote-detail" data-testid="campaign-promote-detail">{t('intake.promote.oneWay')}</p>
      </div>
      <ModalFooter note={t('intake.promote.note')}>
        <Button
          type="button"
          variant="primary"
          busy={busy}
          onClick={onConfirm}
          data-testid="campaign-promote-confirm"
        >
          {t('intake.promote.confirm')}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel} data-testid="campaign-promote-cancel">
          {t('intake.promote.keepSingle')}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
