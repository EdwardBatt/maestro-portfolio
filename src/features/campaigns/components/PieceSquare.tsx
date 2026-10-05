import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { ProgressTip } from '../../../components/DeliverableProgress'
import type { DeliverableRow } from '../../deliverables/api/deliverables-api'
import type { SquareStatus } from '../lib/season-map'

/**
 * One piece as one coloured square (CG-02's season map and CG-07's "What it produced", I57.6/I57.7).
 * Coloured by `squareStatus`; pressing it opens the piece drawer (CG-04). Its label names the piece
 * and where it is, so a square is readable without the colour.
 */
export function PieceSquare({
  piece,
  status,
  onOpen,
}: {
  piece: Pick<DeliverableRow, 'id' | 'code' | 'name'> & Partial<Pick<DeliverableRow, 'progress'>>
  status: SquareStatus
  onOpen: (id: string) => void
}) {
  const { t } = useTranslation()
  const word = t(`campaigns.seasonMap.status.${status}`)
  const label = [piece.code, piece.name].filter(Boolean).join(' ') + ` — ${word}`
  const square = (
    <Button
      variant="link"
      className={`piece-square is-${status}`}
      aria-label={label}
      title={piece.progress ? undefined : label}
      onClick={() => onOpen(piece.id)}
      data-testid={`season-square-${piece.id}`}
    />
  )
  // I67.4: too small for a bar — the square carries the hover card only, headed by the piece's name.
  if (!piece.progress) return square
  return (
    <ProgressTip progress={piece.progress} status={`${[piece.code, piece.name].filter(Boolean).join(' ')} — ${word}`} testId={`progress-tip-${piece.id}`}>
      {square}
    </ProgressTip>
  )
}

/** The frames' five colours, and Waiting — the frames' "Blocked", which does not exist (3 Sep). */
export function SquareLegend({ testId }: { testId: string }) {
  const { t } = useTranslation()
  return (
    <ul className="piece-square-legend" data-testid={testId}>
      {(['delivered', 'approved', 'in_progress', 'in_review', 'waiting', 'not_started', 'late'] as const).map((s) => (
        <li key={s}>
          <span className={`piece-square-dot is-${s}`} aria-hidden="true" />
          {t(`campaigns.seasonMap.status.${s}`)}
        </li>
      ))}
    </ul>
  )
}
