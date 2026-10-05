import { describe, expect, it, vi, afterEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { invalidateTaskViews, TASK_VIEW_ROOTS } from './task-views'
import { debouncedTaskViewRefresh } from '../../app/work-channel'
import { bookingsKeys } from '../../features/bookings/api/bookings-api'
import { scheduleKeys } from '../../features/schedule/api/schedule-api'
import { teamViewKeys } from '../../features/team/api/team-view-api'
import { deliverableKeys } from '../../features/deliverables/api/deliverables-api'
import { pendingApprovalKeys } from '../../features/deliverables/api/pending-approvals-api'
import { requirementKeys } from '../../features/deliverables/api/requirements-api'

function invalidatedRoots(run: (qc: QueryClient) => void): string[] {
  const qc = new QueryClient()
  const spy = vi.spyOn(qc, 'invalidateQueries')
  run(qc)
  return spy.mock.calls.map((c) => String((c[0] as { queryKey: unknown[] }).queryKey[0]))
}

describe('invalidateTaskViews (I67.2)', () => {
  it('refreshes every view that shows tasks or bookings, by the roots their queries really use', () => {
    const roots = invalidatedRoots(invalidateTaskViews)
    // The roots the reading hooks are keyed under — read off their own key factories, so a renamed root fails here
    // instead of silently leaving a screen stale (the dead `['bookings']` key was exactly that).
    for (const key of [
      bookingsKeys.all, scheduleKeys.all, teamViewKeys.all, deliverableKeys.all, pendingApprovalKeys.all, requirementKeys.all,
    ]) {
      expect(roots).toContain(key[0])
    }
    expect(roots).toEqual(expect.arrayContaining(['dashboard', 'team', 'campaign-detail']))
  })

  it('never asks for the dead `bookings` key', () => {
    expect(TASK_VIEW_ROOTS).not.toContain('bookings' as never)
  })
})

describe('the live nudge is debounced', () => {
  afterEach(() => vi.useRealTimers())

  it('a burst of nudges refreshes the views once, after the quiet spell', () => {
    vi.useFakeTimers()
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const refresh = debouncedTaskViewRefresh(qc, 500)
    refresh.nudge()
    refresh.nudge()
    refresh.nudge()
    expect(spy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(spy).toHaveBeenCalledTimes(TASK_VIEW_ROOTS.length)
    refresh.nudge()
    vi.advanceTimersByTime(500)
    expect(spy).toHaveBeenCalledTimes(TASK_VIEW_ROOTS.length * 2)
  })

  it('leaving the page cancels a pending refresh', () => {
    vi.useFakeTimers()
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const refresh = debouncedTaskViewRefresh(qc, 500)
    refresh.nudge()
    refresh.cancel()
    vi.advanceTimersByTime(1000)
    expect(spy).not.toHaveBeenCalled()
  })
})
