import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'

/**
 * The two pickers Project mode narrows (ADR-0060 d.2, d.3).
 *
 * Both filters live in the query rather than the component, so this is where they can be asserted.
 * They matter for the same reason: the dialog should offer only work that can actually be handed
 * out, and the failures are opposite in shape —
 *
 *   * an UNAPPROVED campaign is refused by the database (ADR-0048 d.8), so listing it offers a
 *     choice that always fails, after the person has filled in a reviewer, hours and dates;
 *   * an ASSIGNED task would succeed, which is worse — two people could hand out the same task from
 *     two places, and the schedule already has a better route for moving one (drag it, or open it,
 *     both of which move the booking too).
 *
 * `lib/supabase` reaches `lib/env`, which throws when the VITE_ vars are absent (they are, in CI),
 * so the client is stubbed — traps.md.
 */

const state = vi.hoisted(() => ({
  calls: [] as { table: string; method: string; args: unknown[] }[],
  rows: [] as Record<string, unknown>[],
  /** What `rpc()` answers — the RPC row `update_task_assignment` returns (ADR-0087 d.2). */
  rpc: [] as Record<string, unknown>[],
  rpcCalls: [] as { fn: string; args: unknown }[],
  invoke: [] as { name: string; body: unknown }[],
}))

vi.mock('../../../lib/supabase', () => {
  // A thenable stub of the PostgREST builder: every filter records itself and returns `this`, and
  // awaiting it yields whatever rows the test staged.
  const build = (table: string) => {
    const self: Record<string, unknown> = {}
    // `range` answers only its slice and an unranged read at most 1,000 rows — the server's max_rows.
    let span: [number, number] = [0, 999]
    for (const method of ['select', 'eq', 'in', 'is', 'neq', 'not', 'lt', 'gt', 'order', 'single', 'maybeSingle', 'range']) {
      self[method] = (...args: unknown[]) => {
        state.calls.push({ table, method, args })
        if (method === 'range') span = [args[0] as number, args[1] as number]
        return self
      }
    }
    self.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: state.rows.slice(span[0], span[1] + 1), error: null }).then(resolve, reject)
    return self
  }
  const client = {
    from: (table: string) => build(table),
    rpc: (fn: string, args: unknown) => {
      state.rpcCalls.push({ fn, args })
      return Promise.resolve({ data: state.rpc, error: null })
    },
    functions: {
      invoke: (name: string, opts: { body: unknown }) => {
        state.invoke.push({ name, body: opts.body })
        return Promise.resolve({ data: { scheduled: 1 }, error: null })
      },
    },
  }
  return { supabase: client, supabaseUntyped: client }
})

import { useAssignableSubTasks, useCampaigns, useReassignTaskToResource, useScheduleBookings, useUpdateTaskAssignment } from './schedule-api'

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return createElement(QueryClientProvider, { client: qc }, children)
}

const callsOn = (table: string) => state.calls.filter((c) => c.table === table)

beforeEach(() => {
  state.calls = []
  state.rows = []
  state.rpc = []
  state.rpcCalls = []
  state.invoke = []
})

describe('useCampaigns (ADR-0060 d.2)', () => {
  it('asks only for approved campaigns', async () => {
    const { result } = renderHook(() => useCampaigns(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(callsOn('campaigns')).toContainEqual(
      expect.objectContaining({ method: 'eq', args: ['status', 'approved'] }),
    )
  })

  // I59.35: 826 approved campaigns locally on 25 Sep; past 1,000 the picker lost the rest.
  it('offers every approved campaign past the server’s first thousand rows', async () => {
    state.rows = Array.from({ length: 1200 }, (_, i) => ({ id: `c${i}`, name: `Campaign ${i}` }))
    const { result } = renderHook(() => useCampaigns(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1200)
    expect(result.current.data?.at(-1)?.id).toBe('c1199')
  })
})

// I59.35: the four-week schedule held 1,351 bookings locally on 25 Sep — 351 of them were missing
// from the grid and from every load figure, because the server answers 1,000 rows at a time.
describe('useScheduleBookings reads every page', () => {
  it('returns every booking in the window, not the first thousand', async () => {
    state.rows = Array.from({ length: 1351 }, (_, i) => ({
      id: `b${i}`, resource_id: 'r1', state: 'confirmed', starts_at: '2026-09-20T06:00:00Z', ends_at: '2026-09-20T14:00:00Z',
      load_pct: 100, notes: null, series_id: null, campaign_id: null, sub_task_id: null, deliverable_id: null, title: null, deliverables: null,
    }))
    const { result } = renderHook(() => useScheduleBookings({ start: Date.parse('2026-09-20T00:00:00Z'), end: Date.parse('2026-10-18T00:00:00Z') }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1351)
    expect(callsOn('bookings').filter((c) => c.method === 'range').map((c) => c.args)).toEqual([[0, 999], [1000, 1999]])
  })
})

describe('useAssignableSubTasks (ADR-0060 d.3)', () => {
  it('does not run until a deliverable is chosen', () => {
    renderHook(() => useAssignableSubTasks(null), { wrapper })
    expect(callsOn('sub_tasks')).toHaveLength(0)
  })

  it('asks only for tasks of that deliverable', async () => {
    const { result } = renderHook(() => useAssignableSubTasks('d1'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(callsOn('sub_tasks')).toContainEqual(
      expect.objectContaining({ method: 'eq', args: ['deliverable_id', 'd1'] }),
    )
  })

  // THE assertion. A task with somebody on it is already a chip on the grid; offering it here is a
  // second way to hand out work that has already been handed out.
  it('excludes anything already assigned', async () => {
    const { result } = renderHook(() => useAssignableSubTasks('d1'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(callsOn('sub_tasks')).toContainEqual(
      expect.objectContaining({ method: 'is', args: ['assignee_id', null] }),
    )
  })

  it('excludes settled work — done and cancelled', async () => {
    const { result } = renderHook(() => useAssignableSubTasks('d1'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(callsOn('sub_tasks')).toContainEqual(
      expect.objectContaining({ method: 'not', args: ['status', 'in', '("done","cancelled")'] }),
    )
  })

  // ADR-0052 d.14: the workflow's own order, so the dropdown reads like the task table rather than
  // by whatever happened to be created first.
  it('reads in the task list’s order, a step’s units by number, hand-added tasks last', async () => {
    const { result } = renderHook(() => useAssignableSubTasks('d1'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const orders = callsOn('sub_tasks').filter((c) => c.method === 'order')
    expect(orders[0]!.args[0]).toBe('sort_order')
    expect(orders[0]!.args[1]).toMatchObject({ nullsFirst: false })
    expect(orders[1]!.args[0]).toBe('unit_index') // I74.33: unit 1, 2, 3 of one step share its position
    expect(orders[2]!.args[0]).toBe('created_at')
  })

  it('returns the id and title the picker renders', async () => {
    state.rows = [{ id: 's1', title: 'Installation', sort_order: 7, created_at: 'x' }]
    const { result } = renderHook(() => useAssignableSubTasks('d1'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 's1', title: 'Installation' }])
  })
})

/**
 * ADR-0087 d.2/d.12: the server says whether the assignment happened or a REQUEST was recorded, and
 * the client reads that word rather than inferring success from the absence of an error. A request
 * assigns nothing, so nothing is scheduled — running `subtask-schedule` on it would be the
 * half-built state the ADR exists to prevent.
 */
describe('useUpdateTaskAssignment reads the outcome (ADR-0087 d.2)', () => {
  const args = {
    subTaskId: 's1', title: 'Studio day', assigneeId: 'u-maker', reviewers: null,
    startsAt: '2026-09-14T05:00:00Z', dueAt: '2026-09-15T13:00:00Z', hours: 16,
  }

  it('schedules after a direct assignment, as before', async () => {
    state.rpc = [{ sub_task_id: 's1', reschedule_needed: true, outcome: 'assigned', request_id: null }]
    const { result } = renderHook(() => useUpdateTaskAssignment(), { wrapper })
    const r = await result.current.mutateAsync(args)
    expect(r.outcome).toBe('assigned')
    expect(state.invoke).toEqual([{ name: 'subtask-schedule', body: { subTaskId: 's1' } }])
  })

  it('does NOT schedule a request — nothing was assigned — and hands back the request id', async () => {
    state.rpc = [{ sub_task_id: 's1', reschedule_needed: false, outcome: 'requested', request_id: 'q1' }]
    const { result } = renderHook(() => useUpdateTaskAssignment(), { wrapper })
    const r = await result.current.mutateAsync(args)
    expect(r).toMatchObject({ outcome: 'requested', requestId: 'q1' })
    expect(state.invoke).toHaveLength(0)
    expect(state.rpcCalls[0]).toMatchObject({ fn: 'update_task_assignment', args: expect.objectContaining({ p_assignee: 'u-maker' }) })
  })
})

describe('useReassignTaskToResource reads the outcome too (ADR-0087 d.12)', () => {
  it('leaves the chip where it was when the drop became a request', async () => {
    state.rows = [{ title: 'Studio day', sla_hours: 8, starts_at: '2026-09-14T05:00:00Z', due_at: '2026-09-14T13:00:00Z' }]
    state.rpc = [{ sub_task_id: 's1', reschedule_needed: false, outcome: 'requested', request_id: 'q1' }]
    const { result } = renderHook(() => useReassignTaskToResource(), { wrapper })
    const r = await result.current.mutateAsync({ subTaskId: 's1', targetUserId: 'u-maker', targetIsoDate: '2026-09-16', timezone: 'UTC' })
    expect(r?.outcome).toBe('requested')
    expect(state.invoke).toHaveLength(0)
  })
})
