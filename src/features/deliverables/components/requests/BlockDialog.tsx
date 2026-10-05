import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../../components/Button'
import { BLOCK_KINDS, useRaiseBlock, type BlockKind } from '../../api/requests-api'
import { errorText, joinNames } from '../../lib/requests-text'
import { RequestDialog } from './RequestDialog'

/**
 * I'm blocked (plan View 6, ADR-0107 d.2): what is missing (copy · the client · a file · a
 * decision · something else — the kind is required, the addendum), who has it, and what you need.
 * All three required. It becomes an input on this task alone; the deliverable's owner and its
 * account manager are told (the trigger), and blocked time starts — it comes off your timer.
 */
export function BlockDialog({
  deliverableId,
  subTaskId,
  taskTitle,
  ownerName,
  accountManagerName,
  onClose,
  testId = 'block',
}: {
  deliverableId: string
  subTaskId: string
  taskTitle: string
  ownerName: string | null
  accountManagerName: string | null
  onClose: () => void
  testId?: string
}) {
  const { t } = useTranslation()
  const raise = useRaiseBlock()
  const [kind, setKind] = useState<BlockKind | ''>('')
  const [who, setWho] = useState('')
  const [what, setWhat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ready = kind !== '' && who.trim().length > 0 && what.trim().length > 0

  function send() {
    if (kind === '') return
    setError(null)
    raise.mutate(
      { deliverableId, subTaskId, kind, awaitedFrom: who, description: what },
      { onSuccess: onClose, onError: (e) => setError(errorText(e, t('requests.failed'))) },
    )
  }

  return (
    <RequestDialog
      testId={testId}
      title={t('requests.block.title')}
      subtitle={taskTitle}
      told={joinNames([ownerName, accountManagerName], t('requests.listAnd'), t('requests.listSep'))}
      error={error}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" tone="caution" busy={raise.isPending} disabled={!ready || raise.isPending} onClick={send} data-testid={`${testId}-send`}>
            {t('requests.block.send')}
          </Button>
          <Button variant="secondary" onClick={onClose} data-testid={`${testId}-cancel`}>{t('common.cancel')}</Button>
        </>
      }
    >
      <fieldset className="radio-group" data-testid={`${testId}-kind`}>
        <legend className="field-label">{t('requests.block.whatMissing')}</legend>
        {BLOCK_KINDS.map((k) => (
          <label key={k} className="check">
            <input type="radio" name={`${testId}-kind`} value={k} checked={kind === k} onChange={() => setKind(k)} data-testid={`${testId}-kind-${k}`} />
            {t(`requests.blockKind.${k}`)}
          </label>
        ))}
      </fieldset>
      <label>
        {t('requests.block.who')}
        <input type="text" value={who} onChange={(e) => setWho(e.target.value)} data-testid={`${testId}-who`} dir="auto" />
      </label>
      <label>
        {t('requests.block.need')}
        <textarea rows={2} value={what} onChange={(e) => setWhat(e.target.value)} data-testid={`${testId}-need`} dir="auto" />
      </label>
      <p className="muted" data-testid={`${testId}-clock`}>{t('requests.block.clock')}</p>
    </RequestDialog>
  )
}
