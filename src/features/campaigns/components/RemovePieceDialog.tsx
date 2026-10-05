import { useState } from 'react'
import { InfoTip } from '../../../components/InfoTip'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Modal } from '../../../components/Modal'

/**
 * Remove a piece of work (Figma `CB-v3-P6`, `I56.3`).
 *
 * The reason is **required and goes on the campaign record**. That is the whole point of the
 * dialog: a piece disappearing from a campaign with no trace is how an agency ends up arguing
 * about what was agreed, and the frame makes the field required rather than optional.
 *
 * Two things the frame says that this must keep saying:
 *
 *  - **why it is safe now** — *"Nobody has started it, so this is clean."* The sentence changes
 *    with the piece, because removing something nobody has touched is a different act from
 *    removing something somebody is mid-way through;
 *  - **what it would be if work had started** — an amber note, not a block: *"A piece somebody is
 *    already on cannot just vanish. The team lead has to accept it, and the hours already spent
 *    stay on the record."* That is a change request, which is not built in this section — so the
 *    note explains rather than promises.
 *
 * And the quiet line the frame closes on: *"Restorable from the campaign record for 30 days."*
 * Warn-and-allow, with a way back (maestro-design: inform, don't obstruct).
 *
 * Presentational: it collects a reason and hands it back.
 */
export function RemovePieceDialog({
  pieceName,
  workstreamName,
  /** True where somebody is already assigned or has started — the amber note applies to them. */
  workStarted = false,
  onRemove,
  onCancel,
  busy = false,
  testId = 'remove-piece',
}: {
  pieceName: string
  workstreamName: string
  workStarted?: boolean
  onRemove: (reason: string) => void
  onCancel: () => void
  busy?: boolean
  testId?: string
}) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')

  return (
    <Modal onClose={onCancel} testId={`${testId}-dialog`} labelledById={`${testId}-title`}>
      <div className="remove-piece">
        <span className="piece-eyebrow piece-eyebrow-danger">
          {t('removePiece.from', { workstream: workstreamName })}
        </span>
        <h2 id={`${testId}-title`} className="piece-title">
          {t('removePiece.title', { name: pieceName })}
          {/* Explains, never blocks — and standing advice is an (i), not an amber box (Edward,
              24 Sep). Change requests are a later section; until then a lead being asked to
              accept is a conversation, and saying so beats pretending otherwise. */}
          <InfoTip
            label={t('removePiece.noteHead')}
            title={t('removePiece.noteHead')}
            lines={[t('removePiece.noteBody')]}
            testId={`${testId}-note`}
          />
        </h2>
        <p className="piece-lede">
          {workStarted ? t('removePiece.ledeStarted') : t('removePiece.ledeClean')}
        </p>

        <label className="field">
          <span className="field-label">
            {t('removePiece.why')} <span className="req-chip">{t('piece.required')}</span>
          </span>
          <input
            // The reason is what this dialog is for — focus it, not the (i) in the title.
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            data-testid={`${testId}-reason`}
          />
        </label>

        <p className="remove-piece-foot">{t('removePiece.restorable')}</p>

        <div className="piece-actions">
          <Button
            variant="danger"
            busy={busy}
            disabled={reason.trim().length === 0}
            onClick={() => onRemove(reason.trim())}
            data-testid={`${testId}-confirm`}
          >
            {t('removePiece.remove')}
          </Button>
          <Button variant="secondary" onClick={onCancel} data-testid={`${testId}-keep`}>
            {t('removePiece.keep')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
