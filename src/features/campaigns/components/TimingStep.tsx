import { useTranslation } from 'react-i18next'
import { IconButton } from '../../../components/Button'
import { Tag } from '../../../components/Tag'
import {
  IRAQ_WORKING_CALENDAR,
  formatPlanDay,
  formatPlanRange,
  formatWeekday,
  workingWeekSpan,
  type PlannedPhase,
  type PlannedPiece,
  type WorkingCalendar,
} from '../../../lib/timing/plan-back'

/**
 * **Timing** — step 4 of the campaign wizard (Figma `CB-v3-04`, `I56.11`).
 *
 * *"Every phase plans back from its own end date."* A due date here is DERIVED: `lib/timing/
 * plan-back.ts` counts every piece back from its phase's end, and this file shows the answer.
 *
 * WHAT CHANGED FROM THE FRAME, AND WHY (Edward, 24 Sep). The frame had no way to change a date once
 * it was on screen — no edit on a phase, and "Move" as the only thing a piece could do. So:
 *
 *   - every phase block on the strip carries an EDIT, which opens the same name/start/end dialog
 *     step 1 uses. Moving an end re-plans everything in it;
 *   - every piece row carries an EDIT (where the frame put MOVE), which opens one small dialog: its
 *     due date, the start counted back from it, and "given to the client". A date that lands in
 *     another phase MOVES the piece into that phase — earlier or later — and the screen re-draws;
 *   - a phase is its dates. The frame's "ends on an event" is gone (Edward: an event is not
 *     something anybody can define), so the strip names the end day, not an event.
 *
 * WHY THE ARITHMETIC IS NOT IN HERE. These dates are what a missed deadline is made of, so they
 * live in a pure file with a suite behind it. This component takes a `PlannedPhase[]` already
 * computed and calls nothing (AGENTS.md §4). It cannot disagree with the plan because it never
 * does the sum.
 *
 * THE COLOURS. The strip is violet, in shades — the frame's, and one family on purpose: a phase is
 * a stretch of time, not a status, and a rainbow of phases reads as a legend to decode. Green and
 * amber appear only in the capacity column and on a row short of its run-up, which is the one use
 * status colour is kept for.
 */

export interface TimingStepProps {
  /** Every phase, already planned. The order is the season's order. */
  plan: readonly PlannedPhase[]
  /** The phase whose table is open. The strip is a picker, not decoration. */
  selectedPhaseId: string | null
  onSelectPhase: (phaseId: string) => void
  /** Opens the phase dialog on that phase. Null where the caller may not change phases. */
  onEditPhase: ((phaseId: string) => void) | null
  /** Opens the dialog for a new phase at the end of the season. Null hides the tile. */
  onAddPhase: (() => void) | null
  /** Opens the piece dialog — its date, and whether the date has been given to the client. */
  onEditPiece: (pieceId: string) => void
  /**
   * The department's load for the week the piece is due, per piece id — the caller's, because it
   * is a read of the schedule and this file paints (Q14: a department, never a person).
   */
  capacity?: Record<string, React.ReactNode | undefined>
  /**
   * A warning to print under a row, by piece id — the due-date warnings (I41.8, ADR-0075 d.9,
   * ADR-0093, ADR-0096 d.7) the caller computed. Nothing here refuses; the warning sits beside the
   * date and the plan stands (warn-and-allow, design §2.2).
   */
  warnings?: Record<string, React.ReactNode | undefined>
  calendar?: WorkingCalendar
  testId?: string
}

/**
 * The violet a phase block is drawn in: the family's strongest at the start of the season, a step
 * lighter for each phase after. Never below a readable floor, so a season of twelve still reads.
 */
function phaseShade(index: number, count: number): number {
  if (count <= 1) return 38
  const strongest = 44
  const lightest = 18
  return Math.round(strongest - ((strongest - lightest) * index) / (count - 1))
}

export function TimingStep({
  plan,
  selectedPhaseId,
  onSelectPhase,
  onEditPhase,
  onAddPhase,
  onEditPiece,
  capacity,
  warnings,
  calendar = IRAQ_WORKING_CALENDAR,
  testId = 'timing',
}: TimingStepProps) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language === 'ar' ? 'ar' : 'en'
  const day = (iso: string) => formatPlanDay(iso, loc)

  // The UI never blocks: a selection that no longer exists falls back to the first phase rather
  // than showing an empty screen with no way out.
  const open = plan.find((p) => p.phase.id === selectedPhaseId) ?? plan[0] ?? null

  const week = workingWeekSpan(calendar)
  const weekLabel = week
    ? t('timing.workingWeek', { from: formatWeekday(week.from, loc), to: formatWeekday(week.to, loc) })
    : t('timing.workingWeekMixed')

  return (
    <div className="timing-step" data-testid={testId}>
      <h2 className="timing-title">{t('timing.title')}</h2>
      <p className="timing-lede">{t('timing.lede')}</p>

      <TimingCan testId={testId} />

      {/* The season: one block per phase — its name, its dates, an Edit — and the day it ends. */}
      <section className="timing-season" aria-labelledby={`${testId}-season`}>
        <div className="timing-section-head">
          <h3 className="timing-section-title" id={`${testId}-season`}>
            {t('timing.season')}
          </h3>
          <span className="timing-week-chip">{weekLabel}</span>
        </div>
        <div className="timing-strip">
          <div className="timing-strip-tabs" role="tablist" aria-label={t('timing.season')}>
            {plan.map((p, i) => {
              const isOpen = open?.phase.id === p.phase.id
              return (
                <div
                  key={p.phase.id}
                  className="timing-phase-block"
                  data-open={isOpen || undefined}
                  style={{ ['--phase-shade' as string]: `${phaseShade(i, plan.length)}%` }}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isOpen}
                    className="timing-phase"
                    data-open={isOpen || undefined}
                    data-testid={`${testId}-phase-${p.phase.id}`}
                    onClick={() => onSelectPhase(p.phase.id)}
                  >
                    <span className="timing-phase-name">{p.phase.name}</span>
                    <span className="timing-phase-dates">{formatPlanRange(p.phase.startsOn, p.phase.endsOn, loc)}</span>
                    {p.reducedScopeCount > 0 && (
                      <span className="timing-phase-short">{t('timing.willNotFit', { count: p.reducedScopeCount })}</span>
                    )}
                  </button>
                  {onEditPhase && (
                    <IconButton
                      icon="edit"
                      size="sm"
                      className="timing-phase-edit"
                      label={t('timing.editPhaseLabel', { phase: p.phase.name })}
                      onClick={() => onEditPhase(p.phase.id)}
                      data-testid={`${testId}-phase-edit-${p.phase.id}`}
                    />
                  )}
                  <span className="timing-event" aria-hidden="true">
                    ▲ {day(p.phase.endsOn)}
                  </span>
                </div>
              )
            })}
          </div>
          {onAddPhase && (
            <button type="button" className="timing-phase-add" onClick={onAddPhase} data-testid={`${testId}-add-phase`}>
              <span className="timing-phase-add-plus" aria-hidden="true">+</span>
              {t('timing.addPhase.title')}
            </button>
          )}
        </div>
      </section>

      {open && (
        <section className="timing-table-card" aria-labelledby={`${testId}-table`}>
          <div className="timing-section-head">
            <h3 className="timing-section-title" id={`${testId}-table`}>
              {t('timing.plannedBack', { phase: open.phase.name, day: day(open.phase.endsOn) })}
            </h3>
            <span className="timing-count">{t('timing.piecesInPhase', { count: open.pieces.length })}</span>
          </div>

          <TimingRows
            pieces={open.pieces}
            capacity={capacity}
            warnings={warnings}
            onEditPiece={onEditPiece}
            label={t('timing.plannedBack', { phase: open.phase.name, day: day(open.phase.endsOn) })}
            emptyText={t('timing.noPieces')}
            testId={testId}
          />

          <p className="timing-footnote">{t('timing.footnote')}</p>
        </section>
      )}
    </div>
  )
}

/** "What you can do here" — four cards. Every control on this screen is unusual, so it is explained first. */
export function TimingCan({ keys = ['editPhase', 'editPiece', 'givenToClient', 'willNotFit'], testId }: { keys?: readonly string[]; testId: string }) {
  const { t } = useTranslation()
  return (
    <section className="timing-can" aria-labelledby={`${testId}-can`}>
      <h3 className="timing-can-head" id={`${testId}-can`}>
        {t('timing.can.heading')}
      </h3>
      <div className="timing-can-cards">
        {keys.map((k) => (
          <div className="timing-can-card" key={k}>
            <span className="timing-can-title">{t(`timing.can.${k}.title`)}</span>
            <span className="timing-can-body">{t(`timing.can.${k}.body`)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * The rows — shared by the phased table and the plain list a campaign without phases gets, so the
 * two cannot drift into two looks for one question.
 */
export function TimingRows({
  pieces,
  capacity,
  warnings,
  onEditPiece,
  label,
  emptyText,
  testId,
}: {
  pieces: readonly PlannedPiece[]
  capacity?: Record<string, React.ReactNode | undefined>
  warnings?: Record<string, React.ReactNode | undefined>
  onEditPiece: (pieceId: string) => void
  label: string
  emptyText: string
  testId: string
}) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language === 'ar' ? 'ar' : 'en'
  return (
    <div className="timing-rows" role="table" aria-label={label}>
      <div className="timing-head-row" role="row">
        <span role="columnheader">{t('timing.col.piece')}</span>
        <span role="columnheader">{t('timing.col.department')}</span>
        <span role="columnheader">{t('timing.col.needs')}</span>
        <span role="columnheader">{t('timing.col.starts')}</span>
        <span role="columnheader">{t('timing.col.due')}</span>
        <span role="columnheader">{t('timing.col.capacity')}</span>
        <span role="columnheader" className="timing-sr-only">
          {t('timing.col.actions')}
        </span>
      </div>
      {pieces.map((p) => (
        <TimingRow
          key={p.id}
          piece={p}
          capacity={capacity?.[p.id]}
          warning={warnings?.[p.id]}
          locale={loc}
          onEdit={() => onEditPiece(p.id)}
          testId={testId}
        />
      ))}
      {pieces.length === 0 && <p className="timing-empty">{emptyText}</p>}
    </div>
  )
}

function TimingRow({
  piece,
  capacity,
  warning,
  locale,
  onEdit,
  testId,
}: {
  piece: PlannedPiece
  capacity: React.ReactNode | undefined
  warning: React.ReactNode | undefined
  locale: string
  onEdit: () => void
  testId: string
}) {
  const { t } = useTranslation()
  const day = (iso: string) => formatPlanDay(iso, locale)
  const short = piece.fit === 'reduced_scope'
  // A piece is only nameless of a code before the campaign exists — the code is stamped when the
  // row is written (I56.9). No stray separator in front of the name meanwhile.
  const title = piece.code ? `${piece.code} · ${piece.name}` : piece.name
  const undated = !piece.dueOn

  return (
    <div
      className="timing-row"
      role="row"
      data-fit={piece.fit}
      data-undated={undated || undefined}
      data-testid={`${testId}-row-${piece.id}`}
    >
      <span className="timing-piece" role="cell">
        <span className="timing-piece-name">{title}</span>
        <span className="timing-piece-tags">
          {short && <Tag tone="warn">{t('timing.reducedScope')}</Tag>}
          {piece.givenToClient && (
            <span data-testid={`${testId}-given-tag-${piece.id}`}>
              <Tag tone="ok">{t('timing.givenToClientTag')}</Tag>
            </span>
          )}
          {piece.clampedToPhaseEnd && <Tag tone="warn">{t('timing.broughtBack')}</Tag>}
          {piece.pulled && !piece.clampedToPhaseEnd && <Tag tone="neutral">{t('timing.ownDateTag')}</Tag>}
        </span>
        {short && (
          <span className="timing-short-line" data-testid={`${testId}-short-${piece.id}`}>
            {t('timing.shortOfLeadTime', { count: piece.workingDaysAvailable, needs: piece.needsWorkingDays ?? 0 })}
          </span>
        )}
        {/* The caller's warning, under the piece it is about — where step 4 has always put it. */}
        {warning}
      </span>
      <span className="timing-dept" role="cell">
        {piece.departmentName ?? '—'}
      </span>
      <span className="timing-needs" role="cell" data-label={t('timing.col.needs')} data-testid={`${testId}-needs-${piece.id}`}>
        {piece.needsWorkingDays == null ? t('timing.fixed') : t('timing.needsDays', { count: piece.needsWorkingDays })}
      </span>
      <span className="timing-date" role="cell" data-label={t('timing.col.starts')} data-testid={`${testId}-starts-${piece.id}`}>
        {undated ? '—' : day(piece.startsOn)}
      </span>
      <span className={`timing-date timing-due${undated ? ' is-missing' : ''}`} role="cell" data-label={t('timing.col.due')} data-testid={`${testId}-due-${piece.id}`}>
        {undated ? t('timing.noDate') : day(piece.dueOn)}
      </span>
      <span className="timing-capacity" role="cell" data-testid={`${testId}-capacity-${piece.id}`}>
        {undated ? '' : capacity}
      </span>
      <span className="timing-actions" role="cell">
        <button
          type="button"
          className="timing-action"
          onClick={onEdit}
          aria-label={t('timing.editPieceLabel', { piece: title })}
          data-testid={`${testId}-edit-${piece.id}`}
        >
          {t('timing.edit')}
        </button>
      </span>
    </div>
  )
}
