import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import type { DeliverableRow } from '../../deliverables/api/deliverables-api'
import type { WorkPhase } from '../../../lib/deliverables/work-phase'
import { endOfWorkingDay } from '../../../lib/time/iraq'
import { CampaignTimeline } from './CampaignTimeline'

// Thursday 24 Sep 2026 in Baghdad: the window is Mon 21 Sep … Sun 4 Oct.
const NOW = Date.parse('2026-09-24T07:00:00Z')
const due = (day: string) => endOfWorkingDay(day).toISOString()

const piece = (id: string, over: Partial<DeliverableRow> & { phase?: WorkPhase; total?: number; unassigned?: number } = {}): DeliverableRow => ({
  id, name: `Piece ${id}`, state: 'in_progress', dueAt: due('2026-09-29'), revisionRound: 0, revisionLimit: null,
  streamId: 's', streamName: null, taskCount: 2, unassignedCount: over.unassigned ?? 0, typeName: null, ownerUserId: 'o', ownerName: 'Fadia',
  progress: { phase: over.phase ?? 'in_progress', total: over.total ?? 2, unassigned: over.unassigned ?? 0, done: 0, everTotal: 2, inReview: 0, inProgress: 0, notStarted: 0 },
  assigneeNames: ['Zubaida'], assignerNames: [], blockingReviewers: { names: [], allRequired: false }, discipline: 'Creative',
  departmentId: 'c', campaignId: 'cam', approvedVersion: null, tasksApprovedAt: null, tasksApprovedBy: null, canApproveTasks: false,
  campaignKind: 'campaign', workstreamId: null, code: `DA-${id}`,
  taskList: [{ id: `${id}-t`, title: 'Create artwork', hours: 8, status: 'in_progress', assigneeName: 'Zubaida', startsAt: '2026-09-22T06:00:00Z', dueAt: null }],
  ...over,
})

const renderTimeline = (pieces: DeliverableRow[], props: Partial<Parameters<typeof CampaignTimeline>[0]> = {}) => {
  const onOpenPiece = vi.fn()
  const onEditPiece = vi.fn()
  render(<CampaignTimeline pieces={pieces} outstandingInputs={new Map()} onOpenPiece={onOpenPiece} onEditPiece={onEditPiece} today={NOW} {...props} />)
  return { onOpenPiece, onEditPiece }
}

describe('CampaignTimeline — CG-06 (I57.9)', () => {
  it('heads fourteen days from three before today, with Friday and Saturday shaded', () => {
    renderTimeline([piece('1')])
    expect(screen.getByTestId('campaign-panel-timeline')).toHaveAttribute('role', 'tabpanel')
    expect(screen.getByTestId('timeline-day-2026-09-21')).toBeInTheDocument()
    expect(screen.getByTestId('timeline-day-2026-10-04')).toBeInTheDocument()
    expect(screen.queryByTestId('timeline-day-2026-09-20')).toBeNull()
    expect(screen.getByTestId('timeline-day-2026-09-25')).toHaveClass('is-off')
    expect(screen.getByTestId('timeline-day-2026-09-26')).toHaveClass('is-off')
    expect(screen.getByTestId('timeline-day-2026-09-27')).not.toHaveClass('is-off')
    expect(screen.getByTestId('timeline-day-2026-09-24')).toHaveClass('is-today')
  })

  it('one row per live piece — code, name, OWNER — and a bar from its first task start to its due date', () => {
    renderTimeline([piece('1'), piece('x', { state: 'archived', phase: 'complete' })])
    const row = screen.getByTestId('timeline-row-1')
    expect(row).toHaveTextContent('DA-1')
    expect(row).toHaveTextContent('Piece 1')
    expect(screen.getByTestId('timeline-owner-1')).toHaveTextContent('Fadia')
    expect(row).not.toHaveTextContent('Zubaida')
    expect(screen.queryByTestId('timeline-row-x')).toBeNull()
    const bar = screen.getByTestId('timeline-bar-1')
    // Tue 22 is column 2, Tue 29 column 9.
    expect(bar.style.gridColumn).toMatch(/^2 \/ 10$/)
    expect(bar).toHaveAttribute('data-tone', 'inProgress')
    expect(bar).toHaveAttribute('aria-label', expect.stringMatching(/6 working days/))
  })

  it('a late bar is red and says how late; a hollow one has nobody on it', () => {
    renderTimeline([
      piece('late', { dueAt: due('2026-09-22') }),
      piece('nobody', { state: 'draft', phase: 'not_started', total: 2, unassigned: 2 }),
    ])
    expect(screen.getByTestId('timeline-bar-late')).toHaveAttribute('data-tone', 'late')
    expect(screen.getByTestId('timeline-label-late')).toHaveTextContent('2 days late')
    expect(screen.getByTestId('timeline-bar-nobody')).toHaveAttribute('data-hollow', 'true')
    expect(screen.getByTestId('timeline-label-nobody')).toHaveTextContent('nobody yet')
  })

  it('labels a piece waiting on an input', () => {
    renderTimeline([piece('1')], { outstandingInputs: new Map([['1', 1]]) })
    expect(screen.getByTestId('timeline-bar-1')).toHaveAttribute('data-tone', 'waiting')
    expect(screen.getByTestId('timeline-label-1')).toHaveTextContent('blocked')
  })

  it('lists a piece with no due date with no bar and one line', () => {
    renderTimeline([piece('1', { dueAt: null })])
    expect(screen.queryByTestId('timeline-bar-1')).toBeNull()
    expect(screen.getByTestId('timeline-nodue-1')).toHaveTextContent('No due date yet')
  })

  it('pressing a bar opens the drawer; Edit opens the edit dialog; none offered to a viewer who may not edit', () => {
    const { onOpenPiece, onEditPiece } = renderTimeline([piece('1')])
    fireEvent.click(screen.getByTestId('timeline-bar-1'))
    expect(onOpenPiece).toHaveBeenCalledWith('1')
    fireEvent.click(screen.getByTestId('timeline-edit-1'))
    expect(onEditPiece).toHaveBeenCalledWith('1')
  })

  it('Next and Previous move the window a week, and a bar outside it is said in words', () => {
    const later = piece('1', { dueAt: due('2026-10-08'), taskList: [{ id: 't', title: 'Artwork', hours: 8, status: 'todo', assigneeName: 'Zubaida', startsAt: '2026-10-05T06:00:00Z', dueAt: null }] })
    renderTimeline([later])
    // Mon 5 – Thu 8 Oct is after this window (21 Sep – 4 Oct).
    expect(screen.queryByTestId('timeline-bar-1')).toBeNull()
    expect(screen.getByTestId('timeline-outside-1')).toHaveTextContent(/after these days/)
    fireEvent.click(screen.getByTestId('timeline-next'))
    expect(screen.getByTestId('timeline-day-2026-09-28')).toBeInTheDocument()
    expect(screen.queryByTestId('timeline-day-2026-09-21')).toBeNull()
    expect(screen.getByTestId('timeline-day-2026-10-11')).toBeInTheDocument()
    // 28 Sep is column 1: 5 Oct column 8, 8 Oct column 11.
    expect(screen.getByTestId('timeline-bar-1').style.gridColumn).toMatch(/^8 \/ 12$/)
    fireEvent.click(screen.getByTestId('timeline-prev'))
    fireEvent.click(screen.getByTestId('timeline-prev'))
    expect(screen.getByTestId('timeline-day-2026-09-14')).toBeInTheDocument()
    expect(screen.queryByTestId('timeline-bar-1')).toBeNull()
  })

  it('shows no Edit when the viewer may not edit', () => {
    renderTimeline([piece('1')], { onEditPiece: null })
    expect(screen.queryByTestId('timeline-edit-1')).toBeNull()
  })
})
