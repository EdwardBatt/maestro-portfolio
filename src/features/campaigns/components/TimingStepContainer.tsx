import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Field } from '../../../components/Field'
import { InfoTip } from '../../../components/InfoTip'
import {
  classifyDueDate,
  isAfterPhaseEnd,
  type GoLiveRule,
  type WorkingCalendar,
} from '../../../lib/campaigns/go-live-dates'
import {
  DEFAULT_GO_LIVE_RULE,
  IRAQ_WORKING_CALENDAR,
  formatPlanDay,
  phaseForDay,
  phaseStartAfter,
  planCampaign,
  previousWorkingDay,
  startFromDue,
  workingDaysAvailable,
  type PlanPhase,
  type PlanPiece,
  type PlannedPiece,
} from '../../../lib/timing/plan-back'
import type { DueDateOverride } from '../api/campaign-api'
import { AddPhaseDialog } from './AddPhaseDialog'
import { DueDateWarning, PhaseEndWarning } from './DueDateWarning'
import { TimingCan, TimingRows, TimingStep } from './TimingStep'
import { TimingPieceDialog } from './TimingPieceDialog'
import { DateField } from '../../../components/DateField'

/**
 * **The timing step, wired up** (`I56.11`, Figma `CB-v3-04`, with the Edit on phases and pieces
 * Edward asked for on 24 Sep).
 *
 * `TimingStep`, `AddPhaseDialog` and `TimingPieceDialog` are presentational; `lib/timing/plan-back.ts`
 * is pure arithmetic. This file is the seam between them and the wizard's draft: it maps drafts to
 * plan inputs, calls `planCampaign` once, owns which phase is open and which dialog is up, and turns
 * a dialog's answer into something the wizard can store.
 *
 * IT DECIDES NOTHING AND IT STORES NOTHING. Every date comes out of `plan-back`; every change goes
 * out through a callback. The wizard owns the draft (it is what is saved and resumed), and a second
 * copy living in here is how two screens end up disagreeing about what the campaign says.
 *
 * A DATE CHOOSES THE PHASE (Edward, 24 Sep). A piece given a day inside another phase — earlier or
 * later — moves into it. And because a phase's dates can now be edited too, the same rule runs the
 * other way: when a phase's range changes, every piece with its OWN date is read against the new
 * ranges and moves where its date now falls. The phase dialog says which ones before the press.
 *
 * WHAT IT CARRIES OVER AND MUST NOT LOSE. A due date that is tight, impossible, after the go-live
 * or after its phase's end WARNS and is ALLOWED (I41.8 / ADR-0075 d.9 / ADR-0093 / ADR-0096 d.7).
 * The warning the person went ahead past is handed back as a `DueDateOverride` at the moment the
 * choice is made.
 *
 * WITHOUT PHASES (ADR-0096 d.1) there is nothing to count back from, so every piece has a date of
 * its own. It is the same screen in the same look — the same rows, the same Edit, the same dialog
 * — as one list, with the campaign's go-live as an optional date at the top.
 */

/** A phase as the wizard holds it (`ADR-0096` d.2). */
export interface TimingPhaseDraft {
  id: string
  name: string
  /** Empty only on a draft that predates the start date; the range then begins after the phase before. */
  startsOn: string
  endsOn: string
}

/** A piece as this screen needs it. */
export interface TimingPieceDraft {
  id: string
  /** The per-campaign code (`I56.9`). Empty before the campaign exists — it is stamped on insert. */
  code: string
  name: string
  /** The department that does it; the capacity line is that department's (Q14). */
  departmentId: string | null
  departmentName: string | null
  /** Which phase holds it. Null on a campaign without phases, or a piece not placed yet. */
  phaseId: string | null
  /** Working days of work, INCLUSIVE of the due day — the type's lead time. Null takes the run-up. */
  needsWorkingDays: number | null
  /** A date of its own. With phases, null means "wherever the phase puts it"; without, it is THE date. */
  dueOn: string | null
  /** A MARKER only (Q4) — no second date, no evidence. */
  givenToClient: boolean
}

export interface TimingPieceChange {
  /** Null: take the phase's own date. */
  dueOn: string | null
  /** The day it will actually be due — a Friday typed is the Thursday before. */
  effectiveDueOn: string
  /** Where the date put it. Null without phases. */
  phaseId: string | null
  /** Counted back from `effectiveDueOn` — for the campaign without phases, which stores it. */
  startsOn: string
  givenToClient: boolean
  override: DueDateOverride | null
}

export interface TimingStepContainerProps {
  phases: readonly TimingPhaseDraft[]
  pieces: readonly TimingPieceDraft[]
  /** Today in the office's day. Availability is measured from here. */
  today: string
  goLiveOn?: string | null
  /** Without phases, the go-live is set here. Null hides the field. */
  onGoLiveChange?: ((value: string) => void) | null
  /** What setting the go-live just did to the list ("3 dates filled in, 1 left as typed"). */
  goLiveNote?: React.ReactNode
  calendar?: WorkingCalendar
  rule?: GoLiveRule
  /** The department's load for the piece's due week, drawn by the caller (it reads the schedule). */
  renderCapacity?: (piece: { id: string; departmentId: string | null; departmentName: string | null; dueOn: string }) => React.ReactNode
  onSavePiece: (pieceId: string, change: TimingPieceChange) => void
  /**
   * The season changed — a phase edited or added. The whole list comes back, with the next phase's
   * start pushed where the edit would have overlapped it, and the pieces whose own dates now fall
   * in a different phase.
   */
  onPhasesChange: (phases: TimingPhaseDraft[], moved: { pieceId: string; phaseId: string }[]) => void
  testId?: string
}

function toPlanPhase(p: TimingPhaseDraft): PlanPhase {
  return { id: p.id, name: p.name, eventName: null, endsOn: p.endsOn, startsOn: p.startsOn || null }
}

export function TimingStepContainer({
  phases,
  pieces,
  today,
  goLiveOn = null,
  onGoLiveChange = null,
  goLiveNote = null,
  calendar = IRAQ_WORKING_CALENDAR,
  rule = DEFAULT_GO_LIVE_RULE,
  renderCapacity,
  onSavePiece,
  onPhasesChange,
  testId = 'timing',
}: TimingStepContainerProps) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language === 'ar' ? 'ar' : 'en'
  const day = (iso: string) => formatPlanDay(iso, loc)
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null)
  const [editingPieceId, setEditingPieceId] = useState<string | null>(null)
  /** `'new'` adds at the end of the season; an id edits that phase. */
  const [phaseDialog, setPhaseDialog] = useState<string | null>(null)

  const phased = phases.length > 0

  /**
   * Only a phase with an end can be planned backwards from one. The wizard cannot leave step 1
   * with an undated phase, so in practice this never bites — and if every phase were undated the
   * screen shows them all rather than going blank, because the UI never dead-ends.
   */
  const planPhases = useMemo(() => {
    const all = phases.map(toPlanPhase)
    const dated = all.filter((p) => p.endsOn)
    return dated.length > 0 ? dated : all
  }, [phases])

  const planPieces = useMemo<PlanPiece[]>(
    () =>
      pieces
        .filter((p) => p.phaseId && planPhases.some((ph) => ph.id === p.phaseId))
        .map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          departmentName: p.departmentName,
          phaseId: p.phaseId as string,
          needsWorkingDays: p.needsWorkingDays,
          pulledDueOn: p.dueOn,
          isEvent: false,
          givenToClient: p.givenToClient,
        })),
    [pieces, planPhases],
  )

  const ctx = useMemo(() => ({ today, calendar, rule }), [today, calendar, rule])
  const plan = useMemo(() => planCampaign(planPhases, planPieces, ctx), [planPhases, planPieces, ctx])

  /**
   * The plain list, for a campaign without phases: the same row shape as the plan, from each
   * piece's own date. A piece with no date yet is a row that says so — never left off the list.
   */
  const plainRows = useMemo<PlannedPiece[]>(() => {
    if (phased) return []
    return pieces.map((p) => {
      const dueOn = p.dueOn ? previousWorkingDay(p.dueOn, calendar) : ''
      const needs = p.needsWorkingDays ?? rule.commenceDaysBeforeDelivery
      const available = dueOn ? workingDaysAvailable(today, dueOn, calendar) : 0
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        departmentName: p.departmentName,
        phaseId: '',
        isEvent: false,
        givenToClient: p.givenToClient,
        dueOn,
        startsOn: dueOn ? startFromDue(dueOn, needs, calendar) : '',
        needsWorkingDays: needs,
        workingDaysAvailable: available,
        fit: dueOn && available < needs ? 'reduced_scope' : 'fits',
        pulled: false,
        clampedToPhaseEnd: false,
        phaseDueOn: '',
        phaseEndsOn: '',
        eventName: null,
      }
    })
  }, [phased, pieces, today, calendar, rule])

  /** Every row on screen, whichever shape the campaign has — for the dialog and the capacity cells. */
  const shown: PlannedPiece[] = phased ? plan.flatMap((p) => p.pieces) : plainRows

  /** Pieces nobody has placed in a phase. Named and editable, never silently dropped. */
  const unplaced = phased ? pieces.filter((p) => !planPieces.some((q) => q.id === p.id)) : []

  /**
   * What a due date means against the go-live, then against the phase's end — the SAME reading,
   * in the same order, that the wizard records on submit. Go-live first: it is the client's date.
   */
  function overrideFor(dueOn: string, phase: { endsOn: string } | null): DueDateOverride | null {
    const arithmetic = dueOn && goLiveOn ? classifyDueDate({ dueDay: dueOn, goLiveDay: goLiveOn, calendar, rule }) : null
    if (arithmetic && (arithmetic.severity === 'tight' || arithmetic.severity === 'impossible' || arithmetic.severity === 'after_go_live')) {
      return { severity: arithmetic.severity, workingDaysLeft: arithmetic.workingDaysToGoLive, requiredDays: arithmetic.requiredDays, boundary: 'go_live' }
    }
    if (phase && isAfterPhaseEnd(dueOn, phase)) {
      return { severity: 'after_phase_end', workingDaysLeft: 0, requiredDays: 0, boundary: 'phase_end' }
    }
    return null
  }

  /** The warnings, per row, under the piece they are about. Every one warns and allows. */
  const warnings = useMemo(() => {
    const out: Record<string, React.ReactNode> = {}
    const golive = (piece: PlannedPiece) =>
      goLiveOn && piece.dueOn ? classifyDueDate({ dueDay: piece.dueOn, goLiveDay: goLiveOn, calendar, rule }) : null
    if (!phased) {
      for (const piece of plainRows) {
        out[piece.id] = <DueDateWarning arithmetic={golive(piece)} testId={`${testId}-due-warning-${piece.id}`} />
      }
      return out
    }
    for (const planned of plan) {
      for (const piece of planned.pieces) {
        // The phase-end warning reads the date the person ASKED for: plan-back brings a date past
        // the end back to it and flags it, and saying nothing then would hide ADR-0096 d.7.
        const asked = pieces.find((p) => p.id === piece.id)?.dueOn ?? null
        const phaseEndDay = piece.clampedToPhaseEnd && asked ? asked : piece.dueOn
        out[piece.id] = (
          <>
            <DueDateWarning arithmetic={golive(piece)} testId={`${testId}-due-warning-${piece.id}`} />
            <PhaseEndWarning
              dueDay={phaseEndDay}
              phase={{ name: planned.phase.name, endsOn: planned.phase.endsOn }}
              testId={`${testId}-phase-warning-${piece.id}`}
            />
          </>
        )
      }
    }
    return out
  }, [phased, plan, plainRows, pieces, goLiveOn, calendar, rule, testId])

  const capacity = useMemo(() => {
    if (!renderCapacity) return undefined
    const out: Record<string, React.ReactNode> = {}
    for (const row of shown) {
      const draft = pieces.find((p) => p.id === row.id)
      if (!draft || !row.dueOn) continue
      out[row.id] = renderCapacity({ id: row.id, departmentId: draft.departmentId, departmentName: draft.departmentName, dueOn: row.dueOn })
    }
    return out
  }, [renderCapacity, shown, pieces])

  // ---- the piece dialog ---------------------------------------------------------------------
  const editing = editingPieceId ? pieces.find((p) => p.id === editingPieceId) ?? null : null
  const editingRow = editing ? shown.find((r) => r.id === editing.id) ?? null : null

  function savePiece(v: { dueOn: string | null; effectiveDueOn: string; phaseId: string | null; givenToClient: boolean }) {
    if (!editing) return
    const target = v.phaseId ? planPhases.find((p) => p.id === v.phaseId) ?? null : null
    const needs = editing.needsWorkingDays ?? rule.commenceDaysBeforeDelivery
    onSavePiece(editing.id, {
      ...v,
      startsOn: startFromDue(v.effectiveDueOn, needs, calendar),
      override: overrideFor(v.effectiveDueOn, target),
    })
    // The piece's new phase is the one worth looking at: it just moved there.
    if (v.phaseId) setSelectedPhaseId(v.phaseId)
    setEditingPieceId(null)
  }

  // ---- the phase dialog ---------------------------------------------------------------------
  const phaseIndex = phaseDialog && phaseDialog !== 'new' ? phases.findIndex((p) => p.id === phaseDialog) : phases.length
  const phaseEditing = phaseDialog && phaseDialog !== 'new' ? phases[phaseIndex] ?? null : null
  const phaseBefore = phaseIndex > 0 ? phases[phaseIndex - 1] ?? null : null
  const phaseAfter = phaseEditing ? phases[phaseIndex + 1] ?? null : null

  /** The season with the dialog's values applied, and the next phase pushed clear if they overlap. */
  function applied(v: { name: string; startsOn: string; endsOn: string }): TimingPhaseDraft[] {
    const next = phases.map((p) => ({ ...p }))
    if (phaseEditing) {
      next[phaseIndex] = { ...next[phaseIndex]!, ...v }
      const after = next[phaseIndex + 1]
      if (after && after.startsOn && after.startsOn <= v.endsOn) after.startsOn = phaseStartAfter(v.endsOn)
    } else {
      next.push({ id: `phase-${Date.now()}`, ...v })
    }
    return next
  }

  /** Pieces with their own date whose phase changes under a new season. Pieces on the phase's date follow it. */
  function movedBy(next: TimingPhaseDraft[]): { pieceId: string; phaseId: string; name: string; to: string; day: string }[] {
    const nextPlan = next.map(toPlanPhase).filter((p) => p.endsOn)
    const out: { pieceId: string; phaseId: string; name: string; to: string; day: string }[] = []
    for (const p of pieces) {
      if (!p.dueOn) continue
      const due = previousWorkingDay(p.dueOn, calendar)
      const home = phaseForDay(nextPlan, due)
      if (home && home.id !== p.phaseId) out.push({ pieceId: p.id, phaseId: home.id, name: p.code ? `${p.code} · ${p.name}` : p.name, to: home.name, day: day(due) })
    }
    return out
  }

  function checkPhase(v: { name: string; startsOn: string; endsOn: string }): { error: string | null; notes: string[] } {
    if (phaseBefore && v.startsOn <= phaseBefore.endsOn) {
      return { error: t('timing.editPhase.overlapsBefore', { phase: phaseBefore.name, day: day(phaseBefore.endsOn) }), notes: [] }
    }
    if (phaseAfter && v.endsOn >= phaseAfter.endsOn) {
      return { error: t('timing.editPhase.passesAfter', { phase: phaseAfter.name, day: day(phaseAfter.endsOn) }), notes: [] }
    }
    const notes: string[] = []
    if (phaseAfter && phaseAfter.startsOn && phaseAfter.startsOn <= v.endsOn) {
      notes.push(t('timing.editPhase.pushesNext', { phase: phaseAfter.name, day: day(phaseStartAfter(v.endsOn)) }))
    }
    for (const m of movedBy(applied(v))) notes.push(t('timing.editPhase.pieceMoves', { piece: m.name, phase: m.to, day: m.day }))
    return { error: null, notes }
  }

  function savePhase(v: { name: string; startsOn: string; endsOn: string }) {
    const next = applied(v)
    onPhasesChange(next, movedBy(next).map((m) => ({ pieceId: m.pieceId, phaseId: m.phaseId })))
    setPhaseDialog(null)
  }

  const lastPhase = phases[phases.length - 1] ?? null

  return (
    <div className="timing-container" data-testid={`${testId}-container`}>
      {phased ? (
        <TimingStep
          plan={plan}
          selectedPhaseId={selectedPhaseId}
          onSelectPhase={setSelectedPhaseId}
          onEditPhase={(id) => setPhaseDialog(id)}
          onAddPhase={() => setPhaseDialog('new')}
          onEditPiece={setEditingPieceId}
          capacity={capacity}
          warnings={warnings}
          calendar={calendar}
          testId={testId}
        />
      ) : (
        <div className="timing-step" data-testid={testId}>
          <h2 className="timing-title">{t('timing.plain.title')}</h2>
          <p className="timing-lede">{t('timing.plain.lede')}</p>

          <TimingCan keys={['editPiecePlain', 'givenToClient', 'willNotFit', 'goLive']} testId={testId} />

          {onGoLiveChange && (
            <section className="timing-season timing-golive" aria-labelledby={`${testId}-golive-label`}>
              <Field
                as="div"
                label={
                  <span className="timing-golive-label" id={`${testId}-golive-label`}>
                    {t('timing.plain.goLive')}
                    <InfoTip
                      label={t('timing.plain.goLiveTipLabel')}
                      lines={[t('timing.plain.goLiveTip', { delivery: rule.deliveryDaysBeforeGoLive, commence: rule.commenceDaysBeforeDelivery })]}
                      testId={`${testId}-golive-tip`}
                    />
                  </span>
                }
              >
                <DateField aria-labelledby={`${testId}-golive-label`} value={goLiveOn ?? ''} onChange={(v) => onGoLiveChange(v)} data-testid="wizard-golive" />
              </Field>
              {goLiveNote}
            </section>
          )}

          <section className="timing-table-card" aria-labelledby={`${testId}-table`}>
            <div className="timing-section-head">
              <h3 className="timing-section-title" id={`${testId}-table`}>
                {t('timing.plain.heading')}
              </h3>
              <span className="timing-count">{t('timing.plain.count', { count: plainRows.length })}</span>
            </div>
            <TimingRows
              pieces={plainRows}
              capacity={capacity}
              warnings={warnings}
              onEditPiece={setEditingPieceId}
              label={t('timing.plain.heading')}
              emptyText={t('timing.plain.empty')}
              testId={testId}
            />
            <p className="timing-footnote">{t('timing.plain.footnote')}</p>
          </section>
        </div>
      )}

      {/* Named AND placeable: the same Edit the rows use gives it a date, and the date gives it a
          phase. Sending somebody back a step to fix what they are looking at is a dead end. */}
      {unplaced.length > 0 && (
        <div className="timing-unplaced" data-testid={`${testId}-unplaced`}>
          <span>{t('timing.notInAPhase', { count: unplaced.length })}</span>
          <ul className="timing-unplaced-list">
            {unplaced.map((u) => (
              <li key={u.id}>
                <span className="timing-piece-name">{u.code ? `${u.code} · ${u.name}` : u.name}</span>
                <button type="button" className="timing-action" onClick={() => setEditingPieceId(u.id)} data-testid={`${testId}-place-${u.id}`}>
                  {t('timing.edit')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && (
        <TimingPieceDialog
          piece={{ id: editing.id, code: editing.code, name: editing.name, departmentName: editing.departmentName, givenToClient: editing.givenToClient }}
          needsWorkingDays={editing.needsWorkingDays}
          dueOn={editingRow?.dueOn ?? editing.dueOn ?? ''}
          phaseId={phased ? editing.phaseId : null}
          phases={phased ? planPhases : []}
          today={today}
          goLiveOn={goLiveOn}
          calendar={calendar}
          rule={rule}
          onSave={savePiece}
          onCancel={() => setEditingPieceId(null)}
          testId={`${testId}-piece`}
        />
      )}

      {phaseDialog && (
        <AddPhaseDialog
          previousPhase={phaseBefore ? { name: phaseBefore.name, endsOn: phaseBefore.endsOn } : lastPhase && !phaseEditing ? { name: lastPhase.name, endsOn: lastPhase.endsOn } : null}
          initial={phaseEditing ? { name: phaseEditing.name, startsOn: phaseEditing.startsOn, endsOn: phaseEditing.endsOn } : null}
          check={checkPhase}
          onAdd={savePhase}
          onCancel={() => setPhaseDialog(null)}
          testId={`${testId}-phase-dialog`}
        />
      )}
    </div>
  )
}
