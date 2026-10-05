import { describe, expect, it } from 'vitest'
import { workProgress } from './work-phase'
import type { SubTaskStatus } from './work-phase'

const t = (status: SubTaskStatus, assigneeId: string | null = 'u1') => ({ status, assigneeId })

/**
 * I40.22. The list showed the deliverable's stored state, which reads "In progress" from the moment
 * the deliverable exists — so work nobody had begun was indistinguishable from work under way. The
 * whole point of these assertions is the gap between what the container is CALLED and where the
 * work IS.
 */
describe('workProgress (I40.22)', () => {
  it('calls assigned-but-untouched work NOT STARTED, however long it has sat there', () => {
    // `todo` is what a task holds from assignment until the assignee presses Start.
    expect(workProgress([t('todo'), t('todo')]).phase).toBe('not_started')
  })

  it('moves to in progress as soon as ONE person has pressed Start', () => {
    expect(workProgress([t('todo'), t('in_progress')]).phase).toBe('in_progress')
  })

  /**
   * I67.4 (Edward, 30 Sep, A): the word follows the LEAST advanced open task. One task in review used to make
   * the whole piece "In review" while others had not started — the mock's "Social statics" row.
   */
  it('is in review only when every open task is in review', () => {
    expect(workProgress([t('review'), t('review'), t('done')]).phase).toBe('in_review')
    expect(workProgress([t('in_progress'), t('review')]).phase).toBe('in_progress')
    expect(workProgress([t('todo'), t('review')]).phase).toBe('in_progress')
    expect(
      workProgress([t('done'), t('done'), t('review'), t('in_progress'), t('in_progress'), t('in_progress'), t('todo'), t('todo')]).phase,
    ).toBe('in_progress')
  })

  /**
   * BLOCKED belongs to the DELIVERABLE. `sub_tasks_status_check` admits only todo / in_progress /
   * review / done / cancelled — there is no blocked task, despite a leftover label saying there is.
   * It wins over everything because it is the exception worth surfacing.
   */
  it('reports BLOCKED over everything, from the deliverable rather than a task', () => {
    expect(workProgress([t('in_progress'), t('review'), t('todo')], 'blocked').phase).toBe('blocked')
    expect(workProgress([t('done')], 'blocked').phase).toBe('blocked')
  })

  it('ignores every other deliverable state — the tasks answer the question', () => {
    // `in_progress` is what a deliverable reads from the moment it exists. That is the defect.
    expect(workProgress([t('todo'), t('todo')], 'in_progress').phase).toBe('not_started')
  })

  /**
   * Every task done is NOT the same as finished. The badge said "Complete" while the row sat in the
   * LIVE group, because the badge counted tasks and the grouping read the deliverable's state — two
   * meanings of one word on one row (Edward, 8 Sep). "Complete" is now the deliverable's own answer
   * and nothing else's.
   */
  it('says AWAITING SIGN-OFF when the work is done but nobody has signed it off', () => {
    expect(workProgress([t('done'), t('done')]).phase).toBe('awaiting_signoff')
    expect(workProgress([t('done'), t('done')], 'in_review').phase).toBe('awaiting_signoff')
  })

  it('is complete only when the DELIVERABLE says so, which is what the grouping reads', () => {
    expect(workProgress([t('done'), t('done')], 'approved').phase).toBe('complete')
    expect(workProgress([t('done'), t('done')], 'archived').phase).toBe('complete')
  })

  /**
   * `delivered` is reachable only from `approved`, so the sign-off has already happened. Calling it
   * "awaiting sign-off" was plainly wrong. It stays LIVE deliberately — it is out with the client
   * and a revision can come back — so it gets its own answer rather than being folded into either.
   */
  it('says DELIVERED rather than awaiting a sign-off that already happened', () => {
    expect(workProgress([t('done')], 'delivered').phase).toBe('delivered')
  })

  it('still reports unfinished work as unfinished — and a finished task means the work has begun', () => {
    expect(workProgress([t('done'), t('todo')]).phase).toBe('in_progress')
  })

  it('separates "nothing planned" from "nothing done"', () => {
    expect(workProgress([]).phase).toBe('no_tasks')
    expect(workProgress(null).phase).toBe('no_tasks')
    expect(workProgress([t('todo')]).phase).toBe('not_started')
  })

  it('does not let a cancelled task make a finished deliverable look unfinished', () => {
    const p = workProgress([t('done'), t('cancelled')], 'approved')
    expect(p.phase).toBe('complete')
    expect(p.everTotal).toBe(1) // cancelled work is not owed by anybody
    expect(p.done).toBe(1)
  })

  /**
   * "Nothing was ever planned" and "the work was called off" are different facts, and they read as
   * the same one: 34 ad-hoc deliverables said "No tasks yet" about work created WITH its task from
   * the schedule, where having none is not possible (Edward, 8 Sep).
   */
  it('distinguishes work that was CALLED OFF from a deliverable that never had any', () => {
    expect(workProgress([t('cancelled'), t('cancelled')]).phase).toBe('cancelled')
    expect(workProgress([]).phase).toBe('no_tasks')
  })

  it('counts what is live, what nobody is on, and what is finished', () => {
    const p = workProgress([t('done'), t('in_progress'), t('todo', null), t('todo', null)])
    expect(p.total).toBe(3)      // live
    expect(p.unassigned).toBe(2) // planned, and forgotten
    expect(p.done).toBe(1)
    expect(p.everTotal).toBe(4)
  })

  it('reads a raw database row as happily as a mapped one', () => {
    // The campaign query hands back `assignee_id`; the mapped rows carry `assigneeId`.
    expect(workProgress([{ status: 'todo', assignee_id: null }]).unassigned).toBe(1)
  })
})
