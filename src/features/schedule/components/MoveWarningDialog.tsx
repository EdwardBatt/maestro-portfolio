import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Modal, ModalFooter, ModalHeader } from '../../../components/Modal'
import { Tag } from '../../../components/Tag'
import type { DropCheck } from '../lib/drop-check'
import { formatCalendarDay } from '../../../lib/time/iraq'

/**
 * The move warnings (Figma L6 / L7, plan View 9, ADR-0105 d.5) — ONE dialog for the Schedule's drag
 * and the team timeline's, so the two screens cannot word the same move two ways.
 *
 * What it says is whatever `assessDrop` found: the day is off, blacked out, over the warn level, or
 * the moved work ends after the task's committed date. What it offers follows from that:
 *
 *  - **Past the committed date (L6):** keep the date and give it to someone with room · ask the account
 *    manager to change the piece (the one form, ADR-0141 — the extension is retired) · move it anyway · cancel.
 *  - **Over the warn level (L7):** give it to the freest person instead · give it to this person
 *    anyway · cancel.
 *  - **A day off or a blackout:** move it anyway · cancel — as the Schedule has always offered.
 *
 * Warn, never refuse (ADR-0061 d.2): every path ends in a way through. Nothing moves until a choice
 * is pressed. Presentation only — the caller decides what each choice writes.
 */
export interface MovePerson {
  resourceId: string
  name: string
  /** booked this week, whole percent */
  pct: number
}

export interface MoveWarningDialogProps {
  testId: string
  /** "Post 2 carousel" — what is being moved */
  taskLabel: string
  /** who it was dropped onto */
  targetName: string
  targetIsoDate: string
  check: DropCheck
  /** the target person's week before the move, when they are a person */
  targetWeekPct?: number | null
  /** people with room this week, emptiest first, the target excluded */
  room: readonly MovePerson[]
  /** the task's current first day — "keep the date". Null leaves the option out. */
  keepDateIso?: string | null
  /** offer "Ask for the extension" (a task with a commitment) */
  canAskExtension: boolean
  busy?: boolean
  onProceed: () => void
  /** the same day, another person */
  onInstead: (resourceId: string) => void
  /** the kept day, another person */
  onKeepDate: (resourceId: string) => void
  onAskExtension: () => void
  onCancel: () => void
}

export function MoveWarningDialog(p: MoveWarningDialogProps) {
  const { t } = useTranslation()
  const [picking, setPicking] = useState(false)
  const day = (iso: string) => formatCalendarDay(iso)

  const late = p.check.pastCommitment ?? null
  const overload = p.check.overload
  const freest = p.room[0] ?? null
  const kind: 'late' | 'ceiling' | 'other' = late ? 'late' : overload ? 'ceiling' : 'other'

  const title =
    kind === 'late'
      ? t('teamView.move.titleLate')
      : kind === 'ceiling' && p.targetWeekPct != null
        ? t('teamView.move.titleCeiling', { name: p.targetName, pct: p.targetWeekPct })
        : t('teamView.move.titleOther')

  const message =
    kind === 'late'
      ? t('teamView.move.bodyLate', {
          task: p.taskLabel,
          due: day(late!.committedDay),
          lands: day(late!.landsOn),
          count: late!.daysLate,
        })
      : t('teamView.move.body', { task: p.taskLabel, name: p.targetName, day: day(p.targetIsoDate) })

  const detail = [
    p.check.nonWorking ? t('schedule.dropWarn.nonWorking') : null,
    p.check.blackout ? t('schedule.dropWarn.blackout') : null,
    overload?.pct != null
      ? t('schedule.dropWarn.overloadPct', { pct: Math.round(overload.pct) })
      : overload
        ? t('schedule.dropWarn.overloadCount', { count: overload.count ?? 0 })
        : null,
    kind !== 'other'
      ? p.room.length > 0
        ? t('teamView.move.roomLine', {
            names: p.room.slice(0, 3).map((r) => t('teamView.move.personPct', { name: r.name, pct: r.pct })).join(' · '),
          })
        : t('teamView.move.noRoom')
      : null,
  ].filter((x): x is string => x !== null)

  const proceedLabel =
    kind === 'ceiling' ? t('teamView.move.anyway', { name: p.targetName }) : t('teamView.move.moveAnyway')

  return (
    <Modal onClose={p.onCancel} testId={p.testId} labelledById={`${p.testId}-title`}>
      <div data-testid={`${p.testId}-dialog`} className={`move-warning move-warning-${kind}`}>
        <ModalHeader
          id={`${p.testId}-title`}
          eyebrow={
            <Tag tone={kind === 'late' ? 'breach' : 'warn'}>
              {t('teamView.move.eyebrow', { task: p.taskLabel, name: p.targetName, day: day(p.targetIsoDate) })}
            </Tag>
          }
          title={title}
          subtitle={<span data-testid={`${p.testId}-message`}>{message}</span>}
        />
        <div className="modal-body">
          {detail.length > 0 && (
            <ul className="move-warning-detail" data-testid={`${p.testId}-detail`}>
              {detail.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {picking && (
            <div className="move-warning-pick" data-testid={`${p.testId}-room`}>
              {p.room.length === 0 ? (
                <p className="muted">{t('teamView.move.noRoom')}</p>
              ) : (
                p.room.map((r) => (
                  <Button
                    key={r.resourceId}
                    variant="secondary"
                    size="sm"
                    busy={p.busy}
                    onClick={() => p.onKeepDate(r.resourceId)}
                    data-testid={`${p.testId}-keep-date-${r.resourceId}`}
                  >
                    {t('teamView.move.giveOn', { name: r.name, pct: r.pct, day: day(p.keepDateIso ?? p.targetIsoDate) })}
                  </Button>
                ))
              )}
            </div>
          )}
        </div>
        <ModalFooter note={t('teamView.move.note')}>
          {kind === 'late' && p.keepDateIso && (
            <Button variant="primary" onClick={() => setPicking(true)} data-testid={`${p.testId}-keep-date`}>
              {t('teamView.move.keepDate', { day: day(p.keepDateIso) })}
            </Button>
          )}
          {kind === 'ceiling' && freest && (
            <Button variant="primary" busy={p.busy} onClick={() => p.onInstead(freest.resourceId)} data-testid={`${p.testId}-instead`}>
              {t('teamView.move.instead', { name: freest.name })}
            </Button>
          )}
          {kind === 'late' && p.canAskExtension && (
            <Button variant="secondary" onClick={p.onAskExtension} data-testid={`${p.testId}-extension`}>
              {t('changeAsk.moveOffer')}
            </Button>
          )}
          <Button variant="secondary" busy={p.busy} onClick={p.onProceed} data-testid={`${p.testId}-confirm`}>
            {proceedLabel}
          </Button>
          <Button variant="secondary" onClick={p.onCancel} data-testid={`${p.testId}-cancel`}>
            {t('teamView.move.cancel')}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  )
}
