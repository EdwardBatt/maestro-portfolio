import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '../../../lib/i18n'
import {
  TimingStepContainer,
  type TimingPhaseDraft,
  type TimingPieceDraft,
} from './TimingStepContainer'

/**
 * `I56.11` — the seam between the wizard's draft and the timing screen (`CB-v3-04`), with the Edit
 * on phases and pieces Edward asked for on 24 Sep.
 *
 * The arithmetic has its own suite and the screen has its own. What is worth holding HERE is what
 * this file decides by wiring: a date CHOOSES the phase — earlier or later (Edward: "Move it to that
 * phase") — and a day in no phase is refused, naming the ranges; a phase edit pushes the next one
 * clear rather than overlapping it, and says so; pieces with their own dates follow the new ranges;
 * a warning the person went past is handed back as the override; and a campaign without phases
 * gets the same rows and the same dialog as one list.
 *
 * 2026: Fri 25 Sept and Fri 2 Oct end the two phases; the office works Sun–Thu.
 */
const PHASES: TimingPhaseDraft[] = [
  { id: 'p1', name: 'Week 1', startsOn: '2026-09-18', endsOn: '2026-09-25' },
  { id: 'p2', name: 'Week 2', startsOn: '2026-09-26', endsOn: '2026-10-02' },
]

const piece = (over: Partial<TimingPieceDraft> & { id: string }): TimingPieceDraft => ({
  code: '',
  name: over.id,
  departmentId: 'dep-c',
  departmentName: 'Creative',
  phaseId: 'p1',
  needsWorkingDays: 4,
  dueOn: null,
  givenToClient: false,
  ...over,
})

const PIECES: TimingPieceDraft[] = [
  piece({ id: 'da', code: 'DA-017', name: 'Group mechanic explainer' }),
  piece({ id: 'mc', code: 'MC-003', name: 'Mini TVC 20s', departmentName: 'Content', phaseId: 'p2', needsWorkingDays: 9 }),
]

function view(over: Partial<React.ComponentProps<typeof TimingStepContainer>> = {}) {
  const props = {
    phases: PHASES,
    pieces: PIECES,
    today: '2026-09-14',
    onSavePiece: vi.fn(),
    onPhasesChange: vi.fn(),
    ...over,
  }
  render(<TimingStepContainer {...props} />)
  return props
}

const calls = (f: unknown) => (f as ReturnType<typeof vi.fn>).mock.calls

function editPiece(id: string, day: string) {
  fireEvent.click(screen.getByTestId(`timing-edit-${id}`))
  fireEvent.change(screen.getByTestId('timing-piece-due'), { target: { value: day } })
}

// I66.8: a date shows its year only when it is not this year, so pin "today" (the date only).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-29T09:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

describe('TimingStepContainer (CB-v3-04, wired up)', () => {
  it('maps the draft onto the plan the frame prints', () => {
    view()
    // Week 1 ends Fri 25 Sept, so delivery is Wed 23 Sept — two working days before it — and four
    // working days of work COUNTING the due day start on Sun 20 Sept (20, 21, 22, 23).
    expect(screen.getByTestId('timing-row-da')).toHaveTextContent('DA-017')
    expect(screen.getByTestId('timing-starts-da')).toHaveTextContent('Sun, 20 Sep')
    expect(screen.getByTestId('timing-due-da')).toHaveTextContent('Wed, 23 Sep')
  })

  it('a date in a LATER phase moves the piece there, says so first, and hands back phase and date', () => {
    const p = view()
    editPiece('da', '2026-09-29')
    expect(screen.getByTestId('timing-piece-moves')).toHaveTextContent('This moves it from Week 1 to Week 2.')
    expect(screen.getByTestId('timing-piece-starts')).toHaveTextContent('Work starts Thu, 24 Sep — 4 working days')
    expect(screen.getByTestId('timing-piece-save')).toHaveTextContent('Save — move to Week 2')
    fireEvent.click(screen.getByTestId('timing-piece-save'))
    expect(p.onSavePiece).toHaveBeenCalledWith('da', {
      dueOn: '2026-09-29',
      effectiveDueOn: '2026-09-29',
      phaseId: 'p2',
      startsOn: '2026-09-24',
      givenToClient: false,
      override: null,
    })
  })

  it('a date in an EARLIER phase moves it back the same way', () => {
    const p = view()
    fireEvent.click(screen.getByTestId('timing-phase-p2'))
    editPiece('mc', '2026-09-22')
    expect(screen.getByTestId('timing-piece-moves')).toHaveTextContent('from Week 2 to Week 1')
    fireEvent.click(screen.getByTestId('timing-piece-save'))
    expect(p.onSavePiece).toHaveBeenCalledWith('mc', expect.objectContaining({ phaseId: 'p1', dueOn: '2026-09-22' }))
  })

  it('refuses a day inside no phase, naming the ranges, and saves nothing', () => {
    const p = view()
    editPiece('da', '2026-10-20')
    const dialog = screen.getByTestId('timing-piece-dialog')
    expect(dialog).toHaveTextContent('That day is outside every phase. The phases run: Week 1 18 Sep – 25 Sep · Week 2 26 Sep – 2 Oct.')
    // Nothing is counted back from a day that cannot be used.
    expect(screen.queryByTestId('timing-piece-starts')).toBeNull()
    expect(screen.getByTestId('timing-piece-save')).toBeDisabled()
    fireEvent.click(screen.getByTestId('timing-piece-save'))
    expect(p.onSavePiece).not.toHaveBeenCalled()
  })

  it('judges the phase by the day it will ACTUALLY be due — a Saturday is the Thursday before', () => {
    view()
    // Sat 26 Sept opens Week 2, but nobody works it: the piece is due Thu 24 Sept, in Week 1.
    editPiece('da', '2026-09-26')
    expect(screen.getByTestId('timing-piece-not-working')).toHaveTextContent('Sat, 26 Sep is not a working day, so it is due Thu, 24 Sep.')
    expect(screen.getByTestId('timing-piece-in-phase')).toHaveTextContent('Week 1')
    expect(screen.queryByTestId('timing-piece-moves')).toBeNull()
  })

  it("stores the phase's own date as no date at all, so it keeps following the phase's end", () => {
    const p = view()
    // Wed 30 Sept is exactly what Week 2 gives a piece.
    editPiece('da', '2026-09-30')
    fireEvent.click(screen.getByTestId('timing-piece-save'))
    expect(p.onSavePiece).toHaveBeenCalledWith('da', expect.objectContaining({ dueOn: null, phaseId: 'p2' }))
  })

  it('marks the date as given to the client', () => {
    const p = view()
    editPiece('da', '2026-09-22')
    fireEvent.click(screen.getByTestId('timing-piece-given'))
    fireEvent.click(screen.getByTestId('timing-piece-save'))
    expect(p.onSavePiece).toHaveBeenCalledWith('da', expect.objectContaining({ givenToClient: true }))
  })

  it('records the override when the date lands after go-live — warned, and allowed (ADR-0093)', () => {
    const p = view({ goLiveOn: '2026-09-24' })
    editPiece('da', '2026-09-29')
    expect(screen.getByTestId('timing-piece-golive-warning')).toBeInTheDocument()
    expect(screen.getByTestId('timing-piece-save')).toBeEnabled()
    fireEvent.click(screen.getByTestId('timing-piece-save'))
    expect(p.onSavePiece).toHaveBeenCalledWith('da', expect.objectContaining({
      override: expect.objectContaining({ severity: 'after_go_live', boundary: 'go_live' }),
    }))
  })

  it('an edited phase end that overlaps the next pushes it clear, and says so before the press', () => {
    const p = view()
    fireEvent.click(screen.getByTestId('timing-phase-edit-p1'))
    fireEvent.change(screen.getByTestId('timing-phase-dialog-date'), { target: { value: '2026-09-28' } })
    expect(screen.getByTestId('timing-phase-dialog-consequences')).toHaveTextContent('Week 2 will now start on Tue, 29 Sep, so the two do not overlap.')
    fireEvent.click(screen.getByTestId('timing-phase-dialog-submit'))
    const [list, moved] = calls(p.onPhasesChange)[0]!
    expect(list).toEqual([
      { id: 'p1', name: 'Week 1', startsOn: '2026-09-18', endsOn: '2026-09-28' },
      { id: 'p2', name: 'Week 2', startsOn: '2026-09-29', endsOn: '2026-10-02' },
    ])
    expect(moved).toEqual([])
  })

  it('a piece whose own date now falls in another phase moves with the edit, named first', () => {
    const p = view({ pieces: [PIECES[0]!, { ...PIECES[1]!, dueOn: '2026-09-27' }] })
    fireEvent.click(screen.getByTestId('timing-phase-edit-p1'))
    fireEvent.change(screen.getByTestId('timing-phase-dialog-date'), { target: { value: '2026-09-28' } })
    expect(screen.getByTestId('timing-phase-dialog-consequences')).toHaveTextContent('MC-003 · Mini TVC 20s moves to Week 1 — its own date, Sun, 27 Sep, falls there now.')
    fireEvent.click(screen.getByTestId('timing-phase-dialog-submit'))
    expect(calls(p.onPhasesChange)[0]![1]).toEqual([{ pieceId: 'mc', phaseId: 'p1' }])
  })

  it('refuses a phase that would start inside the one before, or end past the one after — named', () => {
    const p = view()
    fireEvent.click(screen.getByTestId('timing-phase-edit-p2'))
    fireEvent.change(screen.getByTestId('timing-phase-dialog-starts'), { target: { value: '2026-09-24' } })
    expect(screen.getByTestId('timing-phase-dialog-clash')).toHaveTextContent('It starts before Week 1 ends on Fri, 25 Sep.')
    expect(screen.getByTestId('timing-phase-dialog-submit')).toBeDisabled()
    fireEvent.click(screen.getByTestId('timing-phase-dialog-cancel'))

    fireEvent.click(screen.getByTestId('timing-phase-edit-p1'))
    fireEvent.change(screen.getByTestId('timing-phase-dialog-date'), { target: { value: '2026-10-03' } })
    expect(screen.getByTestId('timing-phase-dialog-clash')).toHaveTextContent('Week 2 ends on Fri, 2 Oct. End this one before that')
    expect(screen.getByTestId('timing-phase-dialog-submit')).toBeDisabled()
    expect(p.onPhasesChange).not.toHaveBeenCalled()
  })

  it('adds a phase at the end of the season, its start filled from the last phase', () => {
    const p = view()
    fireEvent.click(screen.getByTestId('timing-add-phase'))
    expect(screen.getByTestId('timing-phase-dialog-starts')).toHaveValue('2026-10-03')
    fireEvent.change(screen.getByTestId('timing-phase-dialog-name'), { target: { value: 'Week 3' } })
    fireEvent.change(screen.getByTestId('timing-phase-dialog-date'), { target: { value: '2026-10-09' } })
    fireEvent.click(screen.getByTestId('timing-phase-dialog-submit'))
    const [list] = calls(p.onPhasesChange)[0]!
    expect(list).toHaveLength(3)
    expect(list[2]).toEqual(expect.objectContaining({ name: 'Week 3', startsOn: '2026-10-03', endsOn: '2026-10-09' }))
  })

  it('asks the caller for each row’s department load, for the week it is due', () => {
    const renderCapacity = vi.fn((q: { departmentName: string | null }) => <span>{q.departmentName} load</span>)
    view({ renderCapacity })
    expect(renderCapacity).toHaveBeenCalledWith(expect.objectContaining({ id: 'da', departmentId: 'dep-c', dueOn: '2026-09-23' }))
    expect(screen.getByTestId('timing-capacity-da')).toHaveTextContent('Creative load')
  })

  it('names a piece in no phase and lets its Edit give it one', () => {
    const p = view({ pieces: [...PIECES, piece({ id: 'loose', name: 'Loose piece', phaseId: null })] })
    expect(screen.getByTestId('timing-unplaced')).toHaveTextContent('One deliverable is not in a phase yet')
    fireEvent.click(screen.getByTestId('timing-place-loose'))
    fireEvent.change(screen.getByTestId('timing-piece-due'), { target: { value: '2026-09-22' } })
    fireEvent.click(screen.getByTestId('timing-piece-save'))
    expect(p.onSavePiece).toHaveBeenCalledWith('loose', expect.objectContaining({ phaseId: 'p1' }))
  })
})

describe('TimingStepContainer — a campaign without phases (ADR-0096 d.1)', () => {
  const PLAIN: TimingPieceDraft[] = [
    piece({ id: 'a', name: 'Key visual', phaseId: null, dueOn: '2026-09-30' }),
    piece({ id: 'b', name: 'Caption', phaseId: null, dueOn: null }),
  ]

  it('is the same rows as one list, a piece with no date saying so', () => {
    view({ phases: [], pieces: PLAIN })
    expect(screen.getByText('When each deliverable is due')).toBeInTheDocument()
    expect(screen.getByTestId('timing-due-a')).toHaveTextContent('Wed, 30 Sep')
    expect(screen.getByTestId('timing-starts-a')).toHaveTextContent('Sun, 27 Sep')
    expect(screen.getByTestId('timing-due-b')).toHaveTextContent('No date yet')
    expect(screen.queryByTestId('timing-phase-p1')).toBeNull()
  })

  it('offers the go-live, optional, at the top — only where the caller takes it', () => {
    const onGoLiveChange = vi.fn()
    view({ phases: [], pieces: PLAIN, onGoLiveChange })
    fireEvent.change(screen.getByTestId('wizard-golive'), { target: { value: '2026-10-08' } })
    expect(onGoLiveChange).toHaveBeenCalledWith('2026-10-08')
  })

  it('the Edit gives a date and the start counted back from it, with no phase', () => {
    const p = view({ phases: [], pieces: PLAIN })
    editPiece('b', '2026-10-01')
    const dialog = screen.getByTestId('timing-piece-dialog')
    expect(within(dialog).queryByTestId('timing-piece-moves')).toBeNull()
    fireEvent.click(screen.getByTestId('timing-piece-save'))
    expect(p.onSavePiece).toHaveBeenCalledWith('b', expect.objectContaining({ dueOn: '2026-10-01', phaseId: null, startsOn: '2026-09-28' }))
  })
})
