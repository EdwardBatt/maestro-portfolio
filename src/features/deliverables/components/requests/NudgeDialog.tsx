import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../../components/Button'
import { PersonPicker } from '../../../../components/PersonPicker'
import { useEveryone, useNudge } from '../../api/requests-api'
import { errorText, personNamed } from '../../lib/requests-text'
import { RequestDialog } from './RequestDialog'

/**
 * Nudge (plan View 6, ADR-0113 d.1): to one named person — pre-filled when the item names somebody
 * who is a person here — with a message pre-written from the item, editable. A notification and an
 * email, recorded against the piece; it stops no clock.
 */
export function NudgeDialog({
  deliverableId,
  subTaskId,
  pieceLabel,
  suggestedName,
  draft,
  onClose,
  testId = 'nudge',
}: {
  deliverableId: string | null
  subTaskId: string | null
  pieceLabel: string
  /** Free text from the item ("who has it"); matched to a person by exact name. */
  suggestedName?: string | null
  draft: string
  onClose: () => void
  testId?: string
}) {
  const { t } = useTranslation()
  const everyone = useEveryone()
  const nudge = useNudge()
  const [personId, setPersonId] = useState('')
  const [body, setBody] = useState(draft)
  const [error, setError] = useState<string | null>(null)
  const people = useMemo(() => everyone.data ?? [], [everyone.data])

  // Pre-fill once the people have loaded — only an exact, single match.
  useEffect(() => {
    if (personId || !suggestedName) return
    const hit = personNamed(people, suggestedName)
    if (hit) setPersonId(hit.id)
  }, [people, suggestedName, personId])

  const name = people.find((p) => p.id === personId)?.name ?? null

  function send() {
    setError(null)
    nudge.mutate(
      { deliverableId, subTaskId, personId, body },
      { onSuccess: onClose, onError: (e) => setError(errorText(e, t('requests.failed'))) },
    )
  }

  return (
    <RequestDialog
      testId={testId}
      title={t('requests.nudge.title')}
      subtitle={pieceLabel}
      told={name}
      error={error}
      onClose={onClose}
      actions={
        <>
          <Button variant="primary" busy={nudge.isPending} disabled={!personId || nudge.isPending} onClick={send} data-testid={`${testId}-send`}>
            {t('requests.nudge.send')}
          </Button>
          <Button variant="secondary" onClick={onClose} data-testid={`${testId}-cancel`}>{t('common.cancel')}</Button>
        </>
      }
    >
      <label>
        {t('requests.to')}
        <PersonPicker people={people} value={personId} onChange={setPersonId} testId={`${testId}-person`} />
        {suggestedName && !personId && (
          <span className="field-hint" data-testid={`${testId}-no-match`}>{t('requests.nudge.noMatch', { name: suggestedName })}</span>
        )}
      </label>
      <label>
        {t('requests.message')}
        <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} data-testid={`${testId}-body`} dir="auto" />
      </label>
    </RequestDialog>
  )
}
