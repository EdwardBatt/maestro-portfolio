import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Modal } from '../../../components/Modal'
import { formatDeadline, iraqDay } from '../../../lib/time/iraq'
import { useDueDateChecks } from '../hooks/use-due-date-checks'
import {
  isRefused,
  useChangeDeliverableDueAt,
} from '../../deliverables/api/extensions-api'
import { fetchCampaignReferencesFolder, useFileDocuments } from '../api/document-filing-api'
import { DueDateWarning } from './DueDateWarning'
import { DateField } from '../../../components/DateField'

/**
 * Changing a deliverable's promised date on the client's agreement (ADR-0088 d.7a, relaxed by I59 E5).
 *
 * The mirror of the brief receipt (ADR-0066): the promise was made on evidence of what the client
 * asked, so the client's agreement is ASKED for — never required (E5, Edward 25 Sep: "this is logged
 * so we can see the record"). An attachment given is filed FIRST, through the ordinary asset path
 * into the campaign's References, and then named to the RPC; without one the date still changes and
 * the server logs that none came with it (`deadline_changed.evidence_attached`). No further approval:
 * "via the AM for now", and the AM is the person the client agreed with.
 *
 * This is NOT a task extension (d.1–d.6). The two are different acts by different rules and neither
 * implies the other; the account manager may do both, and has to do both.
 */
export interface DeliverableDueAtDialogProps {
  deliverableId: string
  deliverableName: string
  campaignId: string
  clientId: string
  currentDueAt: string | null
  goLiveAt: string | null
  /** A day to start from instead of the current one — the new phase's planned date (I57.36). */
  initialDay?: string | null
  /** One line above the form saying why it opened — "moved to Week 2, planned for …". */
  reason?: string | null
  onClose: () => void
  /** Called once the date has been changed, just before `onClose` — so the caller knows which
   *  way the question was answered (I59.47: one notice, after the answer). */
  onSaved?: () => void
  testId?: string
}

export function DeliverableDueAtDialog({
  deliverableId,
  deliverableName,
  campaignId,
  clientId,
  currentDueAt,
  goLiveAt,
  initialDay = null,
  reason = null,
  onClose,
  onSaved,
  testId = 'deliverable-due-change',
}: DeliverableDueAtDialogProps) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language === 'ar' ? 'ar' : 'en'
  const file = useFileDocuments()
  const change = useChangeDeliverableDueAt()
  // ADR-0123 d.3 / ADR-0093: the client's calendar, the go-live arithmetic and its record — shared (I68.12).
  const checks = useDueDateChecks({ deliverableId, clientId, goLiveAt })
  const [day, setDay] = useState(initialDay ?? (currentDueAt ? iraqDay(currentDueAt) : ''))
  const [evidence, setEvidence] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // I41.8 (ADR-0075 d.9): the arithmetic — working days before go-live against the rule, open hours against the days.
  const arithmetic = checks.arithmetic(day)
  // ADR-0093: a date after go-live warns and is allowed. E5: the evidence is asked for, not required.
  const canSave = !!day && !busy

  async function save() {
    setError(null)
    setBusy(true)
    try {
      // 1. The agreement, when there is one, is filed where the receipt goes — the campaign's References.
      let evidenceAssetId: string | null = null
      if (evidence) {
        const folderId = await fetchCampaignReferencesFolder(campaignId)
        if (!folderId) return setError(t('deadlineExtension.noReferencesFolder'))
        const [outcome] = await file.mutateAsync({ folderId, clientId, files: [evidence] })
        if (!outcome?.ok || !outcome.assetId) return setError(t('deadlineExtension.evidenceFailed'))
        evidenceAssetId = outcome.assetId
      }
      // 2. Change the date, naming the evidence or none (E5: the server logs which).
      await change.mutateAsync({ deliverableId, dueDay: day, evidenceAssetId, note: note.trim() || null })
      // 3. The override, when a warning was shown (ADR-0075 d.9: an unrecorded warning is a click;
      //    ADR-0093 adds after_go_live to the warnings).
      await checks.recordIfWarned(day, arithmetic)
      onSaved?.()
      onClose()
    } catch (err) {
      setError(
        isRefused(err)
          ? t('deadlineExtension.changePromiseRefused')
          : (err as Error).message || t('deadlineExtension.failed'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} card={false}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('deadlineExtension.changePromiseTitle')}
        data-testid={`${testId}-dialog`}
      >
        <h2>{t('deadlineExtension.changePromiseTitle')}</h2>
        <p className="muted">{t('deadlineExtension.changePromiseIntro', { name: deliverableName })}</p>
        {reason && <p className="timing-amber-note" data-testid={`${testId}-reason`}>{reason}</p>}
        <p className="muted" data-testid={`${testId}-current`}>
          {t('deadlineExtension.promisedNow', { date: currentDueAt ? formatDeadline(currentDueAt, loc) : '—' })}
        </p>

        <label>
          {t('deadlineExtension.newDate')}
          <DateField value={day} onChange={(v) => setDay(v)} data-testid={`${testId}-day`} />
        </label>
        <DueDateWarning arithmetic={arithmetic} testId={`${testId}-warning`} />

        <label>
          {t('deadlineExtension.evidence')}
          <input
            type="file"
            accept="image/*,.pdf,.eml,.msg,.txt"
            onChange={(e) => setEvidence(e.target.files?.[0] ?? null)}
            data-testid={`${testId}-evidence`}
          />
        </label>
        <p className="muted" data-testid={`${testId}-evidence-hint`}>{t('deadlineExtension.evidenceOptional')}</p>

        <label>
          {t('deadlineExtension.decisionNote')}
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} data-testid={`${testId}-note`} />
        </label>

        {error && <p className="form-error" role="alert" data-testid={`${testId}-error`}>{error}</p>}

        <div className="dialog-actions">
          <Button variant="secondary" onClick={onClose} data-testid={`${testId}-cancel`}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            busy={busy}
            disabled={!canSave}
            onClick={() => void save()}
            data-testid={`${testId}-save`}
          >
            {t('deadlineExtension.changePromiseSave')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
