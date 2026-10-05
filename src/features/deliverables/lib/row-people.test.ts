import { describe, expect, it } from 'vitest'
import { assigneeNamesOf, assignerNamesOf, blockingReviewerNamesOf } from './row-people'
import type { TaskReviewer } from '../../../lib/reviewers/task-reviewers'

const rev = (name: string, isMandatory: boolean, approvedAt: string | null = null): TaskReviewer => ({
  userId: name, name, isMandatory, approvedAt, respondedAt: null, response: null, isActive: true,
})

/**
 * I40.22. Three people-questions the page kept collapsing into one: who is accountable (the owner),
 * who is doing it (the assignees), and who is holding it up (the mandatory reviewers). These cover
 * the last two.
 */
describe('assigneeNamesOf', () => {
  it('names the people on the live tasks', () => {
    expect(assigneeNamesOf([
      { id: 't1', status: 'in_progress', assigneeName: 'Sara' },
      { id: 't2', status: 'todo', assigneeName: 'Yusuf' },
    ])).toEqual(['Sara', 'Yusuf'])
  })

  it('leaves out finished and cancelled work — that is nobody’s outstanding load', () => {
    expect(assigneeNamesOf([
      { id: 't1', status: 'done', assigneeName: 'Sara' },
      { id: 't2', status: 'cancelled', assigneeName: 'Yusuf' },
      { id: 't3', status: 'review', assigneeName: 'Amir' },
    ])).toEqual(['Amir'])
  })

  it('names somebody once however many tasks they are on', () => {
    expect(assigneeNamesOf([
      { id: 't1', status: 'todo', assigneeName: 'Sara' },
      { id: 't2', status: 'in_progress', assigneeName: 'Sara' },
    ])).toEqual(['Sara'])
  })

  it('skips unassigned tasks rather than rendering a blank name', () => {
    expect(assigneeNamesOf([
      { id: 't1', status: 'todo', assigneeName: null },
      { id: 't2', status: 'todo', assigneeName: '  ' },
    ])).toEqual([])
  })

  it('is empty rather than undefined when there are no tasks at all', () => {
    expect(assigneeNamesOf(null)).toEqual([])
    expect(assigneeNamesOf([])).toEqual([])
  })
})

/**
 * I40.22. On ad-hoc the deliverable's owner and its task's assignee are the same person — the
 * schedule creates both from one action — so an Owner column repeated the next one and said nothing.
 * Who handed the work out is the half that was missing (Edward, 8 Sep).
 */
describe('assignerNamesOf', () => {
  it('names whoever handed out the live work', () => {
    expect(assignerNamesOf([
      { id: 't1', status: 'todo', assignerName: 'Amir' },
      { id: 't2', status: 'review', assignerName: 'Lina' },
    ])).toEqual(['Amir', 'Lina'])
  })

  it('ignores finished and cancelled work, like the assignee column', () => {
    expect(assignerNamesOf([
      { id: 't1', status: 'done', assignerName: 'Amir' },
      { id: 't2', status: 'cancelled', assignerName: 'Lina' },
    ])).toEqual([])
  })

  it('names somebody once however many tasks they handed out', () => {
    expect(assignerNamesOf([
      { id: 't1', status: 'todo', assignerName: 'Amir' },
      { id: 't2', status: 'in_progress', assignerName: 'Amir' },
    ])).toEqual(['Amir'])
  })

  it('is empty where nobody was recorded — legacy work predates the column', () => {
    expect(assignerNamesOf([{ id: 't1', status: 'todo', assignerName: null }])).toEqual([])
    expect(assignerNamesOf(null)).toEqual([])
  })
})

describe('blockingReviewerNamesOf', () => {
  const tasks = [{ id: 't1', status: 'review' as const, assigneeName: 'Sara' }]

  it('names the mandatory reviewer who has not acted', () => {
    const m = new Map([['t1', [rev('Mandatory Mo', true)]]])
    expect(blockingReviewerNamesOf(tasks, m).names).toEqual(['Mandatory Mo'])
  })

  it('leaves out OPTIONAL reviewers when somebody required is outstanding', () => {
    const m = new Map([['t1', [rev('Mandatory Mo', true), rev('Optional Ola', false)]]])
    const out = blockingReviewerNamesOf(tasks, m)
    expect(out.names).toEqual(['Mandatory Mo'])
    expect(out.allRequired).toBe(true)
  })

  /**
   * `is_mandatory` DEFAULTS TO FALSE (ADR-0043 d.5) — with nobody required, the first approval
   * completes the task. So on real data most appointments are optional, and a mandatory-only column
   * is blank on a task that has genuinely been waiting a week. Edward found exactly that.
   * "The UI never blocks — an empty narrowed list falls back to the full one."
   */
  it('falls back to whoever IS outstanding when nobody was marked required', () => {
    const m = new Map([['t1', [rev('Optional Ola', false), rev('Optional Omar', false)]]])
    const out = blockingReviewerNamesOf(tasks, m)
    expect(out.names).toEqual(['Optional Ola', 'Optional Omar'])
    // ...and says so, so the row is not read as a hard block.
    expect(out.allRequired).toBe(false)
  })

  it('leaves out anyone who has already approved', () => {
    const m = new Map([['t1', [rev('Done Dana', true, '2026-09-01T00:00:00Z'), rev('Waiting Wael', true)]]])
    expect(blockingReviewerNamesOf(tasks, m).names).toEqual(['Waiting Wael'])
  })

  /**
   * The status check earns its place. A reviewer appointed to a task nobody has submitted is not
   * waiting for anything, and listing them would make every planned task look blocked.
   */
  it('says nothing about a task that is not in review, however many reviewers it has', () => {
    const m = new Map([['t1', [rev('Mandatory Mo', true)]]])
    expect(blockingReviewerNamesOf([{ id: 't1', status: 'todo', assigneeName: 'Sara' }], m).names).toEqual([])
    expect(blockingReviewerNamesOf([{ id: 't1', status: 'in_progress', assigneeName: 'Sara' }], m).names).toEqual([])
  })

  it('names somebody once across several tasks in review', () => {
    const m = new Map([
      ['t1', [rev('Mandatory Mo', true)]],
      ['t2', [rev('Mandatory Mo', true)]],
    ])
    expect(blockingReviewerNamesOf([
      { id: 't1', status: 'review', assigneeName: 'Sara' },
      { id: 't2', status: 'review', assigneeName: 'Yusuf' },
    ], m).names).toEqual(['Mandatory Mo'])
  })

  it('copes with a task the reviewer read returned nothing for', () => {
    expect(blockingReviewerNamesOf(tasks, new Map()).names).toEqual([])
  })
})
