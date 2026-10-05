import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import type { ScheduleBooking, ScheduleResource } from '../api/schedule-api'
import type { AssignmentRequest } from '../../../lib/assignment-requests/requests'

// The whole authority surface the grid reads (I28). Everything is permitted here; refusal has its
// own path (`onBlocked`) and is not what these tests are about.
vi.mock('../hooks/use-write-scope.ts', () => ({
  useWriteScope: () => ({
    can: () => true, ready: true, scope: 'account',
    inScope: () => true, canWriteResource: () => true,
    refusalFor: () => ({ key: 'schedule.notAuthorised', params: {} }),
    routeFor: () => 'direct', canRequestResource: () => false,
  }),
}))

import { DayGrid, buildColumns } from './DayGrid'

// Thu 3 Sep 2026 through Mon the 7th. Baghdad works Sun-Thu, so the 4th and 5th are days off and
// the 6th (Sunday) is the next working day — the exact shape of the I41.2 case.
const THU = Date.parse('2026-09-03T00:00:00Z')
const COLUMNS = buildColumns(THU, 5)

const person: ScheduleResource = {
  id: 'r1', name: 'Sam', nickname: null, kind: 'human', userId: 'u1',
  departmentId: null, departmentName: null, teamId: null, teamName: null,
  officeId: 'o1', capacityModel: 'load_based', requiresApproval: false,
  warnAtPct: 100, ceilingPct: 200, poolSize: null,
  office: { name: 'Baghdad', timezone: 'UTC', workingDays: [7, 1, 2, 3, 4] },
} as unknown as ScheduleResource

const chip = (id: string, dayEpoch: number, loadPct: number): ScheduleBooking =>
  ({
    id, resourceId: 'r1', state: 'confirmed', loadPct,
    start: dayEpoch + 6 * 3_600_000, end: dayEpoch + 14 * 3_600_000,
    taskName: 'Hero KV', bookingTitle: null, notes: null, subTaskId: 'st1',
    campaignId: null, deliverableId: null, seriesId: null,
  }) as unknown as ScheduleBooking

function grid(bookings: ScheduleBooking[], onChipMove = vi.fn()) {
  render(
    <DayGrid
      resources={[person]}
      bookings={bookings}
      blackouts={[]}
      columns={COLUMNS}
      onAdd={vi.fn()}
      onChipClick={vi.fn()}
      onChipMove={onChipMove}
      onBlocked={vi.fn()}
    />,
  )
  return onChipMove
}

const dropOn = (isoDate: string, bookingId: string) =>
  fireEvent.drop(screen.getByTestId(`cell-r1-${isoDate}`), {
    dataTransfer: { getData: () => bookingId },
  })

/**
 * I41.5. The drop handler asked one question — "may I write this row" — and then moved the booking.
 * A day off, a blackout and a day already over capacity were all silent. That silence is half of
 * the I41.2 decision missing: hours slide forward off a Friday BECAUSE the assigner can drag them
 * back and be told what they are doing.
 */
describe('DayGrid — a drop that has something to say asks first (I41.5)', () => {
  it('moves straight away when the target day is a free working day', () => {
    const onChipMove = grid([chip('b1', THU, 50)])
    dropOn('2026-09-06', 'b1') // Sunday, worked, empty
    expect(onChipMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }), 'r1', '2026-09-06')
    expect(screen.queryByTestId('drop-warning-dialog')).toBeNull()
  })

  it('asks before dropping on a day the office does not work', () => {
    const onChipMove = grid([chip('b1', THU, 50)])
    dropOn('2026-09-04', 'b1') // Friday
    expect(onChipMove).not.toHaveBeenCalled()
    expect(screen.getByTestId('drop-warning-dialog')).toBeInTheDocument()
  })

  it('moves it once confirmed — it warns, it does not refuse (ADR-0061 d.2)', () => {
    const onChipMove = grid([chip('b1', THU, 50)])
    dropOn('2026-09-04', 'b1')
    fireEvent.click(screen.getByTestId('drop-warning-confirm'))
    expect(onChipMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }), 'r1', '2026-09-04')
  })

  it('moves nothing when the answer is no', () => {
    const onChipMove = grid([chip('b1', THU, 50)])
    dropOn('2026-09-04', 'b1')
    fireEvent.click(screen.getByTestId('drop-warning-cancel'))
    expect(onChipMove).not.toHaveBeenCalled()
    expect(screen.queryByTestId('drop-warning-dialog')).toBeNull()
  })

  it('asks before dropping onto a day that would go over capacity', () => {
    const SUN = Date.parse('2026-09-06T00:00:00Z')
    const onChipMove = grid([chip('b1', THU, 60), chip('full', SUN, 100)])
    dropOn('2026-09-06', 'b1') // a working day, but already at 100%
    expect(onChipMove).not.toHaveBeenCalled()
    expect(screen.getByTestId('drop-warning-dialog')).toBeInTheDocument()
  })

  it('does not invent a warning when a chip is dropped back on its own day', () => {
    // 60% is clean on its own. Counted twice it is 120%, over the warn line — which is exactly the
    // phantom this would report if the moving booking were not removed from the target day first.
    const onChipMove = grid([chip('b1', THU, 60)])
    dropOn('2026-09-03', 'b1')
    expect(screen.queryByTestId('drop-warning-dialog')).toBeNull()
    expect(onChipMove).toHaveBeenCalled()
  })
})

/**
 * ADR-0087 d.10/d.11. A pending request is drawn on the requested person's row for the days it asks
 * for — FROM THE REQUEST, since no booking exists — and counts toward nothing: not the overload
 * badge, not a drop check. Visually distinct from provisional so nobody reads it as a booking.
 */
describe('DayGrid — a requested chip is not a booking (ADR-0087 d.10, d.11)', () => {
  const request: AssignmentRequest = {
    id: 'q1', subTaskId: 'st9', resourceId: 'r1', resourceName: 'Sam', assigneeId: 'u1',
    requestedBy: 'u-lead', requesterName: 'Creative Lead', requestedAt: '2026-09-01T00:00:00Z',
    title: 'Studio day', startsAt: '2026-09-03T05:00:00Z', dueAt: '2026-09-04T13:00:00Z', hours: 16,
    status: 'pending', decidedBy: null, decidedAt: null, reason: null,
    departmentName: 'Production', taskTitle: 'Studio day', campaignName: 'Ramadan 2027',
  }

  function gridWith(requests: AssignmentRequest[], bookings: ScheduleBooking[] = []) {
    const onRequestClick = vi.fn()
    render(
      <DayGrid
        resources={[person]}
        bookings={bookings}
        blackouts={[]}
        columns={COLUMNS}
        onAdd={vi.fn()}
        onChipClick={vi.fn()}
        onChipMove={vi.fn()}
        onBlocked={vi.fn()}
        requests={requests}
        onRequestClick={onRequestClick}
      />,
    )
    return onRequestClick
  }

  it('draws the chip on the requested days only, styled as requested, and opens the request on click', () => {
    const onRequestClick = gridWith([request])
    const chips = screen.getAllByTestId('request-q1')
    expect(chips).toHaveLength(2) // Thu 3rd and Fri 4th — the span asked for
    expect(chips[0]!.className).toContain('chip-requested')
    expect(chips[0]!.className).not.toContain('chip-tentative')
    expect(chips[0]!.textContent).toContain('Studio day')
    expect(chips[0]!.textContent).toContain('8h') // 16 hours over the two days asked for
    expect(screen.getByTestId('cell-r1-2026-09-06').querySelector('[data-testid="request-q1"]')).toBeNull()
    fireEvent.click(chips[0]!)
    expect(onRequestClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'q1' }))
  })

  it('holds no capacity: a full request on a day at 60% raises no overload badge', () => {
    // 60% confirmed is under the warn line; a request "worth" 100% on the same day would tip it —
    // and must not, because a request the lead has not seen consumes nothing (d.10).
    gridWith([{ ...request, hours: 16, startsAt: '2026-09-03T05:00:00Z', dueAt: '2026-09-03T21:00:00Z' }], [chip('b1', THU, 60)])
    expect(screen.queryByTestId('overload-r1-2026-09-03')).toBeNull()
  })

  it('cannot be dragged — it is answered, not moved', () => {
    gridWith([request])
    expect(screen.getAllByTestId('request-q1')[0]!.getAttribute('draggable')).toBeNull()
  })

  it('draws nothing for a request whose payload carries no dates', () => {
    gridWith([{ ...request, startsAt: null, dueAt: null }])
    expect(screen.queryByTestId('request-q1')).toBeNull()
  })
})

/**
 * I54.15 — the chip says which work is urgent without anybody opening it (Edward, 23 Sep: *"use
 * color coded symbols"*).
 *
 * The grid is the densest surface in the system, so only high and medium earn a mark: "normal" is
 * the common case and a mark on every chip would cost the width the label needs while saying
 * nothing. The tooltip still names all three in words.
 */
describe('DayGrid — priority on a chip (I54.15)', () => {
  const withPriority = (id: string, priority: 'high' | 'medium' | 'low' | null) =>
    ({ ...chip(id, THU, 50), priority }) as ScheduleBooking

  it('marks a high-priority chip', () => {
    grid([withPriority('b-high', 'high')])
    expect(screen.getByTestId('booking-priority-b-high')).toHaveAttribute('data-priority', 'high')
  })

  it('marks a medium one too', () => {
    grid([withPriority('b-med', 'medium')])
    expect(screen.getByTestId('booking-priority-b-med')).toHaveAttribute('data-priority', 'medium')
  })

  it('leaves a normal chip unmarked — it is the common case and the grid is tight', () => {
    grid([withPriority('b-normal', 'low')])
    expect(screen.queryByTestId('booking-priority-b-normal')).not.toBeInTheDocument()
  })

  it('leaves a plain reservation with no deliverable unmarked', () => {
    grid([withPriority('b-none', null)])
    expect(screen.queryByTestId('booking-priority-b-none')).not.toBeInTheDocument()
  })

  it('names the priority in words in the tooltip, normal included', () => {
    grid([withPriority('b-normal', 'low')])
    expect(screen.getByTestId('booking-b-normal').parentElement).toHaveTextContent('Normal')
  })
})

/**
 * I59.13 (ADR-0105 d.5): the Schedule's drag gains the team timeline's new check — the move ends
 * after the task's committed date — in the same L6 dialog, with Move it anyway kept (D5).
 */
describe('DayGrid — a drop past the committed date warns (I59.13)', () => {
  const commitments = new Map([
    ['st1', { subTaskId: 'st1', title: 'Hero KV', startsAt: '2026-09-03T06:00:00Z', dueAt: '2026-09-03T14:00:00Z', committedDueAt: '2026-09-03T14:00:00Z', deliverableDueAt: '2026-09-04T14:00:00Z', goLiveAt: null }],
  ])
  function withCommitments(onChipMove = vi.fn(), onAskExtension = vi.fn(), pieceDueAt: string | null = '2026-09-04T14:00:00Z') {
    render(
      <DayGrid
        resources={[person]}
        bookings={[chip('b1', THU, 50)]}
        blackouts={[]}
        columns={COLUMNS}
        onAdd={vi.fn()}
        onChipClick={vi.fn()}
        onChipMove={onChipMove}
        onBlocked={vi.fn()}
        commitments={new Map([...commitments].map(([k, v]) => [k, { ...v, deliverableDueAt: pieceDueAt }]))}
        onAskExtension={onAskExtension}
      />,
    )
    return { onChipMove, onAskExtension }
  }

  it('asks before moving work to a working day after its commitment', () => {
    const { onChipMove } = withCommitments()
    dropOn('2026-09-06', 'b1') // Sunday — worked and empty, but after the 3rd
    expect(onChipMove).not.toHaveBeenCalled()
    expect(screen.getByTestId('drop-warning-message')).toHaveTextContent('3 days late')
  })

  it('Move it anyway still moves it', () => {
    const { onChipMove } = withCommitments()
    dropOn('2026-09-06', 'b1')
    fireEvent.click(screen.getByTestId('drop-warning-confirm'))
    expect(onChipMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }), 'r1', '2026-09-06')
  })

  it('Ask for the extension hands the task and the day it would end on to the page', () => {
    const { onChipMove, onAskExtension } = withCommitments()
    dropOn('2026-09-06', 'b1')
    fireEvent.click(screen.getByTestId('drop-warning-extension'))
    expect(onAskExtension).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }), '2026-09-06')
    expect(onChipMove).not.toHaveBeenCalled()
  })

  it("ADR-0141 d.2: past the task's commitment but not the piece's due date, no change form is offered", () => {
    withCommitments(vi.fn(), vi.fn(), '2026-09-10T14:00:00Z')
    dropOn('2026-09-06', 'b1')
    expect(screen.getByTestId('drop-warning-message')).toHaveTextContent('3 days late')
    expect(screen.queryByTestId('drop-warning-extension')).toBeNull()
  })

  it('a move inside the commitment says nothing', () => {
    const { onChipMove } = withCommitments()
    dropOn('2026-09-03', 'b1')
    expect(screen.queryByTestId('drop-warning-dialog')).toBeNull()
    expect(onChipMove).toHaveBeenCalled()
  })
})

/** I67.8 (Edward, 30 Sep, B): the chip's card says where the task stands and how its deliverable is doing. */
describe('DayGrid — the chip card', () => {
  const progress = { phase: 'in_progress' as const, total: 2, unassigned: 0, done: 1, everTotal: 3, inReview: 0, inProgress: 1, notStarted: 1 }
  it('names the task\'s status, then one line per status of its deliverable', () => {
    grid([{ ...chip('b1', THU, 50), taskStatus: 'in_progress', taskRevision: 0, pieceProgress: progress }])
    expect(screen.getByTestId('booking-status-b1')).toHaveTextContent('Status: In progress')
    const card = screen.getByTestId('booking-status-b1').parentElement!
    expect(card).toHaveTextContent('1 of 3 – Done')
    expect(card).toHaveTextContent('1 of 3 – In progress')
    expect(card).toHaveTextContent('1 of 3 – Not started')
  })
  it('says Changes requested when a round came back', () => {
    grid([{ ...chip('b1', THU, 50), taskStatus: 'in_progress', taskRevision: 1, pieceProgress: null }])
    expect(screen.getByTestId('booking-status-b1')).toHaveTextContent('Status: Changes requested')
  })
})

/**
 * I67.7: the day headers write September as every other date does — never en-GB's "Sept" (ADR-0127).
 * I74.24 (Figma L SC-01): a header is the weekday over the day's number, with the month only where a
 * month starts ("Thu / 1 Oct").
 */
describe('DayGrid — the day headers', () => {
  it('reads "1 Oct" where the month starts, the number elsewhere, never "Sept"', () => {
    render(
      <DayGrid resources={[person]} bookings={[]} blackouts={[]} columns={buildColumns(Date.parse('2026-09-27T00:00:00Z'), 7)}
        onAdd={vi.fn()} onChipClick={vi.fn()} onChipMove={vi.fn()} onBlocked={vi.fn()} />,
    )
    const heads = [...document.querySelectorAll('.dg-date')].map((n) => n.textContent)
    expect(heads).toContain('1 Oct')
    expect(heads).toContain('29')
    expect(heads.join(' ')).not.toMatch(/Sept/)
  })
})

/** I74.24: each person-day in words, through the drop check's own calculation. */
describe('DayGrid — free hours, Full, over', () => {
  it('an empty working day reads 8h free; a full one Full; past it, the hours over', () => {
    grid([chip('a', THU, 100), chip('b', THU + 3 * 86_400_000, 150)])
    expect(screen.getByTestId('state-r1-2026-09-03')).toHaveTextContent('Full')
    expect(screen.getByTestId('overload-r1-2026-09-06')).toHaveTextContent('4h over')
    expect(screen.getByTestId('state-r1-2026-09-07')).toHaveTextContent('8h free')
  })
  it('the row says what is free over the days shown — over days give nothing back', () => {
    grid([chip('b', THU + 3 * 86_400_000, 150)])
    // Thu 8 free, Fri/Sat off, Sun over, Mon 8 free.
    expect(screen.getByTestId('free-r1')).toHaveTextContent('16h free')
  })
})

/** I74.22 (SC-02): with a piece picked, a click on a day opens the booking window for that day. */
describe('DayGrid — picking a day for a piece', () => {
  it('a click on the cell, or on its +, picks that day; the + does not open the old booking', () => {
    const onCellPick = vi.fn()
    const onAdd = vi.fn()
    render(
      <DayGrid resources={[person]} bookings={[]} blackouts={[]} columns={COLUMNS}
        onAdd={onAdd} onChipClick={vi.fn()} onChipMove={vi.fn()} onBlocked={vi.fn()}
        picking onCellPick={onCellPick} dueIso="2026-09-06" />,
    )
    fireEvent.click(screen.getByTestId('cell-r1-2026-09-07'))
    fireEvent.click(screen.getByTestId('add-r1-2026-09-03'))
    expect(onCellPick.mock.calls).toEqual([['r1', '2026-09-07'], ['r1', '2026-09-03']])
    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.getByTestId('due-2026-09-06')).toBeInTheDocument()
  })
  it('a To book card dropped on a day hands the piece and the day to the page', () => {
    const onPieceDrop = vi.fn()
    render(
      <DayGrid resources={[person]} bookings={[]} blackouts={[]} columns={COLUMNS}
        onAdd={vi.fn()} onChipClick={vi.fn()} onChipMove={vi.fn()} onBlocked={vi.fn()} onPieceDrop={onPieceDrop} />,
    )
    fireEvent.drop(screen.getByTestId('cell-r1-2026-09-06'), { dataTransfer: { getData: (k: string) => (k === 'text/piece-id' ? 'd1' : '') } })
    expect(onPieceDrop).toHaveBeenCalledWith('d1', 'r1', '2026-09-06')
  })
})
