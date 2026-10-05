import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../../components/Button'
import { rankPeople } from '../../../../lib/people/rank-people'
import { useAskQuestion, useEveryone, usePiecePeople } from '../../api/requests-api'
import { errorText, joinNames } from '../../lib/requests-text'
import { RequestDialog } from './RequestDialog'

/**
 * Ask someone (plan View 6, ADR-0113 d.2): the asker picks ANYONE — the piece's people listed first,
 * each with their part, the account manager ticked to begin with — several allowed, and writes the
 * question. Each is told by notification and email; the question is logged under Questions.
 */
export function AskDialog({
  deliverableId,
  subTaskId,
  pieceLabel,
  meId,
  onClose,
  testId = 'ask',
}: {
  deliverableId: string | null
  subTaskId: string
  pieceLabel: string
  meId: string | null
  onClose: () => void
  testId?: string
}) {
  const { t } = useTranslation()
  const piece = usePiecePeople(deliverableId, subTaskId)
  const everyone = useEveryone()
  const ask = useAskQuestion()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  // The account manager starts ticked (ADR-0113 d.2) — once the piece's people have loaded, and
  // never the asker themself.
  const amId = piece.data?.accountManagerId ?? null
  const chosen = picked ?? new Set(amId && amId !== meId ? [amId] : [])

  const pieceIds = useMemo(() => new Set((piece.data?.people ?? []).map((p) => p.id)), [piece.data])
  const list = useMemo(() => {
    const first = (piece.data?.people ?? [])
      .filter((p) => p.id !== meId)
      .map((p) => ({ id: p.id, name: p.name, hint: p.parts.map((x) => t(`requests.part.${x}`)).join(' · ') }))
    const rest = (everyone.data ?? []).filter((p) => p.id !== meId && !pieceIds.has(p.id)).map((p) => ({ id: p.id, name: p.name, hint: null }))
    return { first: rankPeople(first, query), rest: rankPeople(rest, query) }
  }, [piece.data, everyone.data, pieceIds, meId, query, t])

  const nameOf = (id: string) =>
    piece.data?.people.find((p) => p.id === id)?.name ?? everyone.data?.find((p) => p.id === id)?.name ?? null

  function toggle(id: string) {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }

  function send() {
    setError(null)
    ask.mutate(
      { deliverableId, subTaskId, recipients: [...chosen], body },
      { onSuccess: onClose, onError: (e) => setError(errorText(e, t('requests.failed'))) },
    )
  }

  const row = (p: { id: string; name: string; hint?: string | null }) => (
    <li key={p.id}>
      <label className="check rq-person">
        <input type="checkbox" checked={chosen.has(p.id)} onChange={() => toggle(p.id)} data-testid={`${testId}-person-${p.id}`} />
        <span>{p.name}</span>
        {p.hint && <span className="muted rq-part">{p.hint}</span>}
      </label>
    </li>
  )

  return (
    <RequestDialog
      testId={testId}
      title={t('requests.ask.title')}
      subtitle={pieceLabel}
      told={joinNames([...chosen].map(nameOf), t('requests.listAnd'), t('requests.listSep'))}
      error={error}
      onClose={onClose}
      actions={
        <>
          <Button
            variant="primary"
            busy={ask.isPending}
            disabled={chosen.size === 0 || !body.trim() || ask.isPending}
            onClick={send}
            data-testid={`${testId}-send`}
          >
            {t('requests.ask.send')}
          </Button>
          <Button variant="secondary" onClick={onClose} data-testid={`${testId}-cancel`}>{t('common.cancel')}</Button>
        </>
      }
    >
      <label>
        {t('requests.to')}
        <input
          type="search"
          value={query}
          placeholder={t('requests.ask.search')}
          onChange={(e) => setQuery(e.target.value)}
          data-testid={`${testId}-search`}
        />
      </label>
      <div className="rq-people" data-testid={`${testId}-people`}>
        {list.first.length > 0 && (
          <>
            <p className="rq-people-head">{t('requests.ask.onThePiece')}</p>
            <ul className="rq-people-list" data-testid={`${testId}-piece-people`}>{list.first.map(row)}</ul>
          </>
        )}
        {list.rest.length > 0 && (
          <>
            <p className="rq-people-head">{t('requests.ask.everyoneElse')}</p>
            <ul className="rq-people-list">{list.rest.map(row)}</ul>
          </>
        )}
        {list.first.length === 0 && list.rest.length === 0 && <p className="muted">{t('requests.ask.nobody')}</p>}
      </div>
      <label>
        {t('requests.ask.question')}
        <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} data-testid={`${testId}-body`} dir="auto" />
      </label>
    </RequestDialog>
  )
}
