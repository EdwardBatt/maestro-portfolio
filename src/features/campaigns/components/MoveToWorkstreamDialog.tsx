import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Modal, ModalFooter, ModalHeader } from '../../../components/Modal'

/**
 * **Move a piece to another workstream** — ADR-0099 d.3/d.4/d.9, `I56.3`.
 *
 * The frames have no such dialog, and for the work screen they are right: grouping is decided as
 * you type, and a dropdown on every row would be noise on the one screen that is meant to read
 * like a list. But the move itself is real — `move_deliverable_to_workstream` has existed since
 * 22 Sep — and until now the only place it surfaced was the campaign-page panel the work screen
 * replaces. Retiring that panel without this would have quietly removed the ability.
 *
 * It is built as a sibling of `MovePieceDialog` (moving between PHASES, `CB-v3-P7`) rather than as
 * its own invention: the same list of choices, each answering the same question about itself, and
 * the same shape of consequence line underneath. A person moving work should not have to learn
 * two controls for what is, to them, one act.
 *
 * **What the consequence line has to say**, because none of it is obvious from the list:
 *
 *  - the piece takes the new group's **department** (d.3) — this is the real effect, and the
 *    reason the group is not just a folder;
 *  - its **unassigned tasks follow** to that department, while anything somebody has already
 *    committed to stays where it is (d.9);
 *  - taking it **out** of a group changes the grouping and nothing else (d.4) — removing a
 *    grouping must never silently move work between departments.
 *
 * Presentational: it offers the choices and hands one back.
 */
export interface MoveWorkstreamOption {
  id: string
  name: string
  departmentName: string
  /** How much is already in it — the frame's own chip, and it answers "is that the busy one?". */
  pieceCount: number
}

export function MoveToWorkstreamDialog({
  pieceName,
  currentWorkstreamId,
  currentDepartmentName,
  options,
  /** d.4: offer "out of any group" only where the caller supports an ungrouped piece. */
  allowUngrouped = false,
  onMove,
  onCancel,
  busy = false,
  testId = 'move-workstream',
}: {
  pieceName: string
  currentWorkstreamId: string | null
  currentDepartmentName: string | null
  options: MoveWorkstreamOption[]
  allowUngrouped?: boolean
  onMove: (workstreamId: string | null) => void
  onCancel: () => void
  busy?: boolean
  testId?: string
}) {
  const { t } = useTranslation()
  const [chosen, setChosen] = useState<string | null>(currentWorkstreamId)

  const target = options.find((o) => o.id === chosen) ?? null
  const changesDepartment =
    chosen !== currentWorkstreamId &&
    target != null &&
    currentDepartmentName != null &&
    target.departmentName !== currentDepartmentName

  return (
    <Modal onClose={onCancel} labelledById={`${testId}-title`} testId={`${testId}-dialog`}>
      <ModalHeader
        id={`${testId}-title`}
        eyebrow={t('moveWorkstream.eyebrow')}
        title={t('moveWorkstream.title', { name: pieceName })}
        subtitle={t('moveWorkstream.intro')}
      />
      <div className="modal-body">
        <div className="timing-phase-choices" role="radiogroup" aria-label={t('moveWorkstream.title', { name: pieceName })}>
          {options.map((o) => {
            const here = o.id === currentWorkstreamId
            return (
              <button
                type="button"
                role="radio"
                aria-checked={chosen === o.id}
                key={o.id}
                className={`timing-phase-choice${chosen === o.id ? ' is-on' : ''}`}
                onClick={() => setChosen(o.id)}
                data-testid={`${testId}-option-${o.id}`}
              >
                <span className="timing-choice-dot" aria-hidden="true" />
                <span className="timing-choice-text">
                  <span className="timing-choice-name">{o.name}</span>
                  <span className="timing-choice-line">
                    {t('moveWorkstream.option', {
                      department: o.departmentName,
                      count: o.pieceCount,
                    })}
                    {here ? ` · ${t('moveWorkstream.itIsHere')}` : ''}
                  </span>
                </span>
              </button>
            )
          })}

          {/* d.4. Offered last, because it is the rarer answer and it is not a destination. */}
          {allowUngrouped && (
            <button
              type="button"
              role="radio"
              aria-checked={chosen === null}
              className={`timing-phase-choice${chosen === null ? ' is-on' : ''}`}
              onClick={() => setChosen(null)}
              data-testid={`${testId}-option-none`}
            >
              <span className="timing-choice-dot" aria-hidden="true" />
              <span className="timing-choice-text">
                <span className="timing-choice-name">{t('moveWorkstream.none')}</span>
                <span className="timing-choice-line">{t('moveWorkstream.noneLine')}</span>
              </span>
            </button>
          )}
        </div>

        {/* The department change is the consequence people do not expect, so it is said before
            the button rather than discovered afterwards. Warn and allow, never block. */}
        {changesDepartment && target && (
          <p className="timing-amber-note" data-testid={`${testId}-department-note`}>
            {t('moveWorkstream.changesDepartment', {
              from: currentDepartmentName,
              to: target.departmentName,
            })}
          </p>
        )}
        {chosen === null && currentWorkstreamId != null && (
          <p className="timing-note" data-testid={`${testId}-out-note`}>
            {t('moveWorkstream.outKeepsDepartment')}
          </p>
        )}
      </div>
      <ModalFooter note={t('moveWorkstream.footnote')}>
        <Button
          variant="primary"
          busy={busy}
          disabled={chosen === currentWorkstreamId}
          onClick={() => onMove(chosen)}
          data-testid={`${testId}-submit`}
        >
          {target ? t('moveWorkstream.submit', { workstream: target.name }) : t('moveWorkstream.submitOut')}
        </Button>
        <Button variant="secondary" onClick={onCancel} data-testid={`${testId}-cancel`}>
          {t('timing.cancel')}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
