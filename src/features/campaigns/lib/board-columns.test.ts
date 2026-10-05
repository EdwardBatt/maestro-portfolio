import { describe, expect, it } from 'vitest'
import type { WorkPhase } from '../../../lib/deliverables/work-phase'
import type { DeliverableState } from '../../../lib/deliverables/state-machine'
import { BOARD_COLUMNS, boardColumnOf, boardColumns } from './board-columns'

const piece = (id: string, state: DeliverableState, phase: WorkPhase, total = 2, unassigned = 0) => ({
  id, state, progress: { phase, total, unassigned, done: 0, everTotal: total, inReview: 0, inProgress: 0, notStarted: 0 },
})

describe('boardColumnOf — CG-05, the stage read from the piece, never set by hand (I57.8)', () => {
  it('leaves a closed piece off the board', () => {
    expect(boardColumnOf(piece('a', 'archived', 'complete'), 0)).toBeNull()
  })

  // Edward, 24 Sep: the internal approval shows as Approved; Delivered is the client's, by hand.
  it('Delivered is the client-approved piece; internally approved is Approved', () => {
    expect(boardColumnOf(piece('a', 'delivered', 'delivered'), 0)).toBe('delivered')
    expect(boardColumnOf(piece('a', 'approved', 'complete'), 0)).toBe('approved')
    // An input still outstanding does not pull finished work back into Waiting.
    expect(boardColumnOf(piece('a', 'approved', 'complete'), 2)).toBe('approved')
    expect(boardColumnOf(piece('a', 'delivered', 'delivered'), 1)).toBe('delivered')
  })

  it('an unfinished piece with an outstanding input is Waiting, whatever its tasks say — there is no Blocked', () => {
    expect(boardColumnOf(piece('a', 'in_progress', 'in_progress'), 1)).toBe('waiting')
    expect(boardColumnOf(piece('a', 'draft', 'not_started', 2, 2), 3)).toBe('waiting')
    expect(boardColumnOf(piece('a', 'in_progress', 'in_review'), 1)).toBe('waiting')
    // The legacy blocked state is the old word for the same thing.
    expect(boardColumnOf(piece('a', 'blocked', 'blocked'), 0)).toBe('waiting')
  })

  it('reads where the tasks are: in review / awaiting sign-off → In review, started → In progress', () => {
    expect(boardColumnOf(piece('a', 'in_progress', 'in_review'), 0)).toBe('inReview')
    expect(boardColumnOf(piece('a', 'in_progress', 'awaiting_signoff', 0, 0), 0)).toBe('inReview')
    expect(boardColumnOf(piece('a', 'in_progress', 'in_progress', 3, 1), 0)).toBe('inProgress')
  })

  it('nobody started: Unassigned when a live task has nobody or there are no tasks; else Not started', () => {
    expect(boardColumnOf(piece('a', 'draft', 'not_started', 3, 1), 0)).toBe('unassigned')
    expect(boardColumnOf(piece('a', 'draft', 'no_tasks', 0, 0), 0)).toBe('unassigned')
    expect(boardColumnOf(piece('a', 'draft', 'cancelled', 0, 0), 0)).toBe('unassigned')
    expect(boardColumnOf(piece('a', 'draft', 'not_started', 3, 0), 0)).toBe('notStarted')
  })
})

describe('boardColumns', () => {
  it('returns all seven columns in order, empty ones included, pieces in the order given', () => {
    const cols = boardColumns(
      [
        piece('p1', 'draft', 'not_started', 2, 0),
        piece('p2', 'in_progress', 'in_progress'),
        piece('p3', 'draft', 'not_started', 2, 0),
        piece('p4', 'archived', 'complete'),
        piece('p5', 'in_progress', 'in_progress'),
      ],
      new Map([['p5', 1]]),
    )
    expect(cols.map((c) => c.column)).toEqual(BOARD_COLUMNS)
    expect(cols.map((c) => c.column)).toEqual(['unassigned', 'notStarted', 'inProgress', 'waiting', 'inReview', 'approved', 'delivered'])
    const ids = Object.fromEntries(cols.map((c) => [c.column, c.pieces.map((p) => p.id)]))
    expect(ids).toEqual({ unassigned: [], notStarted: ['p1', 'p3'], inProgress: ['p2'], waiting: ['p5'], inReview: [], approved: [], delivered: [] })
  })
})
