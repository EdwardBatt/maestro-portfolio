import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Field } from '../../../components/Field'
import { InfoTip } from '../../../components/InfoTip'
import { Modal, ModalFooter, ModalHeader } from '../../../components/Modal'
import { classifyDueDate, type GoLiveRule, type WorkingCalendar } from '../../../lib/campaigns/go-live-dates'
import {
  IRAQ_WORKING_CALENDAR,
  formatPlanDay,
  formatPlanRange,
  phaseDueDate,
  phaseForDay,
  phaseRanges,
  previousWorkingDay,
  startFromDue,
  workingDaysAvailable,
  type PlanPhase,
} from '../../../lib/timing/plan-back'
import { DueDateWarning } from './DueDateWarning'
import { DateField } from '../../../components/DateField'

/**
 * **Edit a piece's date** — the timing step's one row action (`I56.11`; Edward, 24 Sep: the frame
 * `CB-v3-04` had no way to change a date).
 *
 * Three things, and only three: the due date, the start that is counted back from it, and whether
 * the date has been given to the client (a marker — Q4).
 *
 * A DATE CHOOSES THE PHASE. Edward, 24 Sep: *"if dates are changed .. this needs to move the
 * deliverable into the appropriate phase dynamically"*, and a date in a LATER phase moves it there
 * too. So the dialog reads the typed day against every phase's range and says, before anything is
 * saved, which phase the piece will land in — and "this moves it from Week 1 to Week 2" when that
 * is a change. A day inside no phase is refused, naming the ranges, because a piece outside every
 * phase has nothing to plan back from.
 *
 * The day the phase is judged by is the day the piece will ACTUALLY be due: a Friday becomes the
 * Thursday before (`previousWorkingDay`), so a Friday typed at the start of Week 2 lands in Week 1,
 * and the dialog says both things rather than letting the row surprise anybody.
 *
 * Without phases (ADR-0096 d.1) it is the same dialog with the phase lines left out: the date is
 * required, and the start is counted back from it the same way.
 */
export interface TimingPieceDialogProps {
  piece: { id: string; code: string; name: string; departmentName: string | null; givenToClient: boolean }
  /** Working days of work, counting the due day. Null takes the tenant's run-up. */
  needsWorkingDays: number | null
  /** The date it is due now — planned or its own. Empty when a plain-list piece has none yet. */
  dueOn: string
  /** Its phase now. Null on a campaign without phases. */
  phaseId: string | null
  /** The season, in order. Empty on a campaign without phases. */
  phases: readonly PlanPhase[]
  today: string
  goLiveOn?: string | null
  calendar?: WorkingCalendar
  rule: GoLiveRule
  /**
   * `dueOn` null means "take the phase's own date" — so nothing is pinned that a later move of the
   * phase end should have moved. `phaseId` is where the date put it.
   */
  onSave: (v: { dueOn: string | null; effectiveDueOn: string; phaseId: string | null; givenToClient: boolean }) => void
  onCancel: () => void
  testId?: string
}

export function TimingPieceDialog({
  piece,
  needsWorkingDays,
  dueOn,
  phaseId,
  phases,
  today,
  goLiveOn = null,
  calendar = IRAQ_WORKING_CALENDAR,
  rule,
  onSave,
  onCancel,
  testId = 'timing-piece',
}: TimingPieceDialogProps) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language === 'ar' ? 'ar' : 'en'
  const day = (iso: string) => formatPlanDay(iso, loc)
  const phased = phases.length > 0

  const [date, setDate] = useState(dueOn)
  const [given, setGiven] = useState(piece.givenToClient)

  const needs = needsWorkingDays ?? rule.commenceDaysBeforeDelivery
  const effective = date ? previousWorkingDay(date, calendar) : ''
  const ranges = phaseRanges(phases)
  const landingPhase = phased && effective ? phaseForDay(phases, effective) : null
  const landing = landingPhase ? ranges.find((r) => r.phase.id === landingPhase.id) ?? null : null
  const current = phases.find((p) => p.id === phaseId) ?? null
  const outside = phased && Boolean(effective) && landing == null
  const moves = landing != null && current != null && landing.phase.id !== current.id

  const startsOn = effective ? startFromDue(effective, needs, calendar) : ''
  const available = effective ? workingDaysAvailable(today, effective, calendar) : 0
  const short = Boolean(effective) && available < needs
  const arithmetic = effective && goLiveOn ? classifyDueDate({ dueDay: effective, goLiveDay: goLiveOn, calendar, rule }) : null

  // The phase's own date, for "back to the phase's date". Offered only when it would change something.
  const home = landing?.phase ?? current
  const homeDue = home ? phaseDueDate(home, calendar, rule) : ''

  const ready = Boolean(date) && !outside
  const title = piece.code ? `${piece.code} · ${piece.name}` : piece.name

  function save() {
    if (!ready) return
    const target = landing?.phase ?? null
    // The phase's own date is not a pin: stored as null, it keeps following the phase's end.
    const own = phased && target && effective === phaseDueDate(target, calendar, rule) ? null : date
    onSave({ dueOn: own, effectiveDueOn: effective, phaseId: target?.id ?? null, givenToClient: given })
  }

  return (
    <Modal onClose={onCancel} labelledById={`${testId}-title`} testId={`${testId}-dialog`}>
      <ModalHeader
        id={`${testId}-title`}
        eyebrow={t('timing.pieceDialog.eyebrow')}
        title={title}
        subtitle={piece.departmentName ?? undefined}
      />
      <form
        className="modal-body timing-piece-dialog"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Field
          label={t('timing.pieceDialog.due')}
          required
          error={outside ? t('timing.pieceDialog.outside', { ranges: ranges.map((r) => `${r.phase.name} ${formatPlanRange(r.from, r.to, loc)}`).join(' · ') }) : undefined}
        >
          <DateField
           
            autoFocus
            value={date}
            onChange={(v) => setDate(v)}
            data-testid={`${testId}-due`}
          />
        </Field>

        {/* What the date means, said before it is saved — every line re-read on each keystroke. */}
        <div className="timing-piece-lines" data-testid={`${testId}-lines`}>
          {date && effective !== date && (
            <p className="timing-piece-line" data-testid={`${testId}-not-working`}>
              {t('timing.pieceDialog.notWorking', { typed: day(date), day: day(effective) })}
            </p>
          )}
          {effective && !outside && (
            <p className="timing-piece-line" data-testid={`${testId}-starts`}>
              {t('timing.pieceDialog.starts', { day: day(startsOn), count: needs })}
            </p>
          )}
          {phased && landing && !moves && (
            <p className="timing-piece-line" data-testid={`${testId}-in-phase`}>
              {t('timing.pieceDialog.inPhase', { phase: landing.phase.name, range: formatPlanRange(landing.from, landing.to, loc) })}
            </p>
          )}
          {moves && (
            <p className="timing-piece-line is-move" data-testid={`${testId}-moves`}>
              {t('timing.pieceDialog.moves', { from: current!.name, to: landing!.phase.name })}
            </p>
          )}
          {short && !outside && (
            <p className="timing-piece-line is-warn" data-testid={`${testId}-short`}>
              {t('timing.shortOfLeadTime', { count: available, needs })}
            </p>
          )}
          <DueDateWarning arithmetic={outside ? null : arithmetic} testId={`${testId}-golive-warning`} />
        </div>

        {phased && home && homeDue && effective && effective !== homeDue && !outside && (
          <Button
            variant="link"
            size="sm"
            onClick={() => setDate(homeDue)}
            data-testid={`${testId}-phase-date`}
          >
            {t('timing.pieceDialog.usePhaseDate', { phase: home.name, day: day(homeDue) })}
          </Button>
        )}

        <label className="check timing-piece-given">
          <input
            type="checkbox"
            checked={given}
            onChange={(e) => setGiven(e.target.checked)}
            data-testid={`${testId}-given`}
          />
          <span>{t('timing.pieceDialog.given')}</span>
          <InfoTip
            label={t('timing.pieceDialog.givenTipLabel')}
            lines={[t('timing.pieceDialog.givenTip')]}
            testId={`${testId}-given-tip`}
          />
        </label>
      </form>
      <ModalFooter>
        <Button variant="primary" disabled={!ready} onClick={save} data-testid={`${testId}-save`}>
          {moves ? t('timing.pieceDialog.saveMove', { phase: landing!.phase.name }) : t('timing.pieceDialog.save')}
        </Button>
        <Button variant="secondary" onClick={onCancel} data-testid={`${testId}-cancel`}>
          {t('timing.cancel')}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
