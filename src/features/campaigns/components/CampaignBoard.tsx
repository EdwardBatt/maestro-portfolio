import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { ProgressBar, ProgressTip } from '../../../components/DeliverableProgress'
import { formatIraqShortDate } from '../../../lib/time/iraq'
import { isOverdue } from '../../../lib/campaigns/status'
import type { DeliverableRow } from '../../deliverables/api/deliverables-api'
import { boardColumns, type BoardColumn } from '../lib/board-columns'
import { isLive, requestLine, type ChangeRequestRow } from '../lib/change-request'

/** How many cards a column shows before "+ N more". */
const FIRST = 3

/**
 * The campaign Board (Figma CG-05, I57.8): every live piece as a card, in the column of the stage
 * it is at — Unassigned · Not started · In progress · Waiting · In review · Delivered.
 *
 * Edward, 24 Sep: *"the card reads the deliverable and the deliverable owner, it does not display
 * tasks. If the user needs to see the details they can click on the card and the pop-up can display
 * the breakdown by task."* So a card is the code, the piece and its OWNER — never a task's person —
 * and pressing it opens the piece drawer (CG-04).
 *
 * No dragging: nothing sets a piece's stage by hand; the columns move themselves as the work moves
 * (`lib/board-columns.ts` holds the rule). The frame's Blocked column is Waiting (the 3 Sep rule).
 *
 * `outstandingInputs` is taken as a prop rather than read here: the page calls
 * `useOutstandingInputs(campaignId)` once and hands the same map to the Board and the Timeline, and
 * the views stay presentation only.
 */
export function CampaignBoard({
  pieces,
  outstandingInputs,
  onOpenPiece,
  onEditPiece,
  changeRequests,
  today,
}: {
  pieces: readonly DeliverableRow[]
  /** deliverableId → outstanding external inputs (`useOutstandingInputs`). */
  outstandingInputs: ReadonlyMap<string, number>
  onOpenPiece: (id: string) => void
  onEditPiece: ((id: string) => void) | null
  /** ADR-0110: the newest change request per piece (`useCampaignChangeRequests`); a live one is said on the card. */
  changeRequests?: ReadonlyMap<string, ChangeRequestRow>
  /** The instant "late" is measured from; the clock by default (tests pin it). */
  today?: number
}) {
  const { t } = useTranslation()
  const now = today ?? Date.now()
  const columns = useMemo(() => boardColumns(pieces, outstandingInputs), [pieces, outstandingInputs])
  const [open, setOpen] = useState<ReadonlySet<BoardColumn>>(new Set())
  const toggle = (c: BoardColumn) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })

  return (
    <div role="tabpanel" className="campaign-board" data-testid="campaign-panel-board">
      <div className="board-columns">
        {columns.map(({ column, pieces: inColumn }) => {
          const expanded = open.has(column)
          const shown = expanded ? inColumn : inColumn.slice(0, FIRST)
          const hidden = inColumn.length - FIRST
          return (
            <section key={column} className={`board-column is-${column}`} data-testid={`board-column-${column}`} aria-label={t(`campaigns.board.columns.${column}`)}>
              <header className="board-column-head">
                <span className="board-dot" aria-hidden="true" />
                <span className="board-column-name">{t(`campaigns.board.columns.${column}`)}</span>
                <span className="board-count" data-testid={`board-count-${column}`}>{inColumn.length}</span>
              </header>
              {inColumn.length === 0 ? (
                <p className="board-empty">{t('campaigns.board.emptyColumn')}</p>
              ) : (
                <ul className="board-cards">
                  {shown.map((p) => {
                    const late = isOverdue(p, now)
                    const inputs = outstandingInputs.get(p.id) ?? 0
                    const change = changeRequests?.get(p.id)
                    const changeLine = change && isLive(change) ? requestLine(change, p.ownerName) : null
                    return (
                      <li key={p.id} className={`board-card${late ? ' is-late' : ''}`}>
                        <button type="button" className="board-card-open" onClick={() => onOpenPiece(p.id)} data-testid={`board-card-${p.id}`}>
                          {p.code && <span className="board-card-code">{p.code}</span>}
                          <span className="board-card-name">{p.name}</span>
                          <span className="board-card-owner" data-testid={`board-card-owner-${p.id}`}>
                            {p.ownerName ?? t('campaigns.board.noOwner')}
                          </span>
                          {/* I67.4: the card sits under its status (the column); the bar shows the mix, the card the numbers. */}
                          <ProgressTip progress={p.progress} status={t(`campaigns.board.columns.${column}`)} testId={`progress-tip-${p.id}`}>
                            <ProgressBar progress={p.progress} testId={`progress-bar-${p.id}`} />
                          </ProgressTip>
                          {late && p.dueAt && (
                            <span className="board-card-late" data-testid={`board-card-late-${p.id}`}>
                              {t('campaigns.board.late', { date: formatIraqShortDate(p.dueAt) })}
                            </span>
                          )}
                          {changeLine && (
                            <span className={`board-card-change is-${change!.status}`} data-testid={`board-card-change-${p.id}`}>
                              {t(changeLine.key, changeLine.values)}
                            </span>
                          )}
                          {column === 'waiting' && inputs > 0 && (
                            <span className="board-card-waiting">{t('campaigns.board.waitingOn', { count: inputs })}</span>
                          )}
                        </button>
                        {onEditPiece && (
                          <Button variant="link" size="sm" className="board-card-edit" onClick={() => onEditPiece(p.id)} data-testid={`board-card-edit-${p.id}`}>
                            {t('campaigns.board.edit')}
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              {hidden > 0 && (
                <Button variant="link" size="sm" className="board-more" onClick={() => toggle(column)} aria-expanded={expanded} data-testid={`board-more-${column}`}>
                  {expanded ? t('campaigns.board.fewer') : t('campaigns.board.more', { count: hidden })}
                </Button>
              )}
            </section>
          )
        })}
      </div>
      <p className="board-note">{t('campaigns.board.note')}</p>
    </div>
  )
}
