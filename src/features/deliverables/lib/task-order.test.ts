import { describe, expect, it } from 'vitest'
import { moveTask, orderTasks, type Sequenced } from './task-order'

/**
 * ADR-0052 d.14 and its Unit acceptance line: `sort_order nulls last, created_at` puts a
 * hand-added task after the template's steps and keeps template steps in order.
 *
 * The reason this is a unit test and not an `order()` clause: a hand-added task has no
 * `workflow_step_id` and no `sort_order` (I19.3), so "where does it go?" is a rule with an exact
 * expected answer — and the failure it guards against (`null < 1` in JavaScript, which sorts every
 * hand-added task to the TOP) is invisible in any list where every row happens to be numbered.
 */

const task = (id: string, sortOrder: number | null, createdAt: string | null = null): Sequenced =>
  ({ id, sortOrder, createdAt })

const ids = (rows: readonly Sequenced[]) => rows.map((r) => r.id)

describe('orderTasks (ADR-0052 d.14)', () => {
  it('reads template steps in the sequence the template lays down', () => {
    const out = orderTasks([task('c', 3), task('a', 1), task('b', 2)])
    expect(ids(out)).toEqual(['a', 'b', 'c'])
  })

  it('puts a hand-added task AFTER the template steps, not before them', () => {
    // The regression: `null - 1` is NaN and `null < 1` is true, so a naive comparator hoists the
    // unnumbered row to the top of somebody's plan.
    const out = orderTasks([
      task('hand', null, '2026-08-20T09:00:00Z'),
      task('step1', 1),
      task('step2', 2),
    ])
    expect(ids(out)).toEqual(['step1', 'step2', 'hand'])
  })

  it('orders several hand-added tasks oldest first', () => {
    const out = orderTasks([
      task('newer', null, '2026-08-21T09:00:00Z'),
      task('older', null, '2026-08-20T09:00:00Z'),
      task('step', 1),
    ])
    expect(ids(out)).toEqual(['step', 'older', 'newer'])
  })

  it('is stable when two rows tie on both keys', () => {
    const rows = [task('first', null, null), task('second', null, null)]
    expect(ids(orderTasks(rows))).toEqual(['first', 'second'])
    expect(ids(orderTasks(orderTasks(rows)))).toEqual(['first', 'second'])
  })

  it('does not mutate the list it was given', () => {
    const rows = [task('c', 3), task('a', 1)]
    orderTasks(rows)
    expect(ids(rows)).toEqual(['c', 'a'])
  })
})

describe('moveTask (ADR-0052 d.14)', () => {
  const list = [task('a', 1), task('b', 2), task('c', 3)]

  it('swaps a task with the one above it and returns the whole list', () => {
    // The whole list, always: the RPC assigns each position from the array it is handed, so a
    // partial list would renumber the rows it contains and interleave the rest.
    expect(moveTask(list, 'b', 'up')).toEqual(['b', 'a', 'c'])
  })

  it('swaps a task with the one below it', () => {
    expect(moveTask(list, 'b', 'down')).toEqual(['a', 'c', 'b'])
  })

  it('returns null at either end, so the surface skips a write of the order it already has', () => {
    expect(moveTask(list, 'a', 'up')).toBeNull()
    expect(moveTask(list, 'c', 'down')).toBeNull()
  })

  it('returns null for a task that is not in the list', () => {
    expect(moveTask(list, 'ghost', 'up')).toBeNull()
  })
})
