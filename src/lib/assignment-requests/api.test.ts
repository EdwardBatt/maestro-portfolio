import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'

/**
 * ADR-0087 — the request reader the grid, the task and the inbox share, and the one writer per verb.
 *
 * What is asserted is WHICH CALL IS MADE and what is done with the answer: the grid's fetch asks for
 * pending requests whose days touch the window (d.11); approval runs `subtask-schedule` AS THE
 * APPROVER only when the RPC assigned something (d.7), and a refusal schedules nothing (d.8).
 *
 * `lib/supabase` reaches `lib/env`, which throws when the VITE_ vars are absent — stubbed, traps.md.
 */

const state = vi.hoisted(() => ({
  calls: [] as { table: string; method: string; args: unknown[] }[],
  rows: [] as Record<string, unknown>[],
  rpc: [] as Record<string, unknown>[],
  rpcCalls: [] as { fn: string; args: unknown }[],
  invoke: [] as { name: string; body: unknown }[],
}))

vi.mock('../supabase', () => {
  const build = (table: string) => {
    const self: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'is', 'lt', 'gt', 'order', 'maybeSingle']) {
      self[method] = (...args: unknown[]) => {
        state.calls.push({ table, method, args })
        return self
      }
    }
    self.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: state.rows, error: null }).then(resolve, reject)
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
        return Promise.resolve({ data: { scheduled: 0, reason: 'assignee_no_office' }, error: null })
      },
    },
  }
  return { supabase: client, supabaseUntyped: client }
})

import {
  useDecideAssignmentRequest,
  usePendingAssignmentRequest,
  usePendingAssignmentRequests,
  useWithdrawAssignmentRequest,
} from './api'

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

describe('usePendingAssignmentRequests — the grid’s chip source (d.11)', () => {
  it('asks for PENDING requests whose requested days touch the window, from their own table', async () => {
    const window = { start: Date.parse('2026-09-13T00:00:00Z'), end: Date.parse('2026-09-20T00:00:00Z') }
    const { result } = renderHook(() => usePendingAssignmentRequests(window), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const calls = callsOn('sub_task_assignment_requests')
    expect(calls).toContainEqual(expect.objectContaining({ method: 'eq', args: ['status', 'pending'] }))
    expect(calls).toContainEqual(expect.objectContaining({ method: 'lt', args: ['starts_at', '2026-09-20T00:00:00.000Z'] }))
    expect(calls).toContainEqual(expect.objectContaining({ method: 'gt', args: ['due_at', '2026-09-13T00:00:00.000Z'] }))
    expect(callsOn('bookings')).toHaveLength(0)
  })

  it('names the embeds by FK — the single key to user_profiles by column, the composite keys by constraint name (PGRST200 otherwise)', async () => {
    const { result } = renderHook(() => usePendingAssignmentRequests({ start: 0, end: 1 }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const select = callsOn('sub_task_assignment_requests').find((c) => c.method === 'select')!.args[0] as string
    expect(select).toContain('requester:user_profiles!requested_by(')
    expect(select).toContain('resource:resources!fk_sub_task_assignment_requests_resource(')
    expect(select).toContain('sub_task:sub_tasks!fk_sub_task_assignment_requests_sub_task(')
  })
})

describe('usePendingAssignmentRequest — one task’s request', () => {
  it('does not run without a task, and keys the answer by task', async () => {
    renderHook(() => usePendingAssignmentRequest(null), { wrapper })
    expect(callsOn('sub_task_assignment_requests')).toHaveLength(0)

    state.rows = [{
      id: 'q1', sub_task_id: 's1', resource_id: 'r1', assignee_id: 'u', requested_by: 'me', requested_at: 'x',
      title: 'T', starts_at: null, due_at: null, hours: null, status: 'pending', decided_by: null, decided_at: null,
      reason: null, requester: null, resource: null, sub_task: null,
    }]
    const { result } = renderHook(() => usePendingAssignmentRequest('s1'), { wrapper })
    await waitFor(() => expect(result.current.data?.id).toBe('q1'))
    expect(callsOn('sub_task_assignment_requests')).toContainEqual(expect.objectContaining({ method: 'in', args: ['sub_task_id', ['s1']] }))
  })
})

describe('useDecideAssignmentRequest — approval IS the assignment, made by the approver (d.7)', () => {
  it('approves through the RPC and then schedules as the approver, reading the scheduler’s answer', async () => {
    state.rpc = [{ sub_task_id: 's1', deliverable_id: 'd1', reschedule_needed: true, outcome: 'approved' }]
    const { result } = renderHook(() => useDecideAssignmentRequest(), { wrapper })
    const r = await result.current.mutateAsync({ requestId: 'q1', approve: true })
    expect(state.rpcCalls[0]).toEqual({ fn: 'decide_assignment_request', args: { p_request: 'q1', p_approve: true, p_reason: null } })
    expect(state.invoke).toEqual([{ name: 'subtask-schedule', body: { subTaskId: 's1' } }])
    // ADR-0061 d.1: `scheduled: 0` with a reason is a warning the approver sees, not a green tick.
    expect(r).toMatchObject({ outcome: 'approved', subTaskId: 's1', scheduleWarning: 'schedule.unscheduled.assignee_no_office' })
  })

  it('refuses through the same RPC, with the reason, and schedules nothing (d.8)', async () => {
    state.rpc = [{ sub_task_id: 's1', deliverable_id: 'd1', reschedule_needed: false, outcome: 'refused' }]
    const { result } = renderHook(() => useDecideAssignmentRequest(), { wrapper })
    const r = await result.current.mutateAsync({ requestId: 'q1', approve: false, reason: '  Booked that week ' })
    expect(state.rpcCalls[0]).toEqual({ fn: 'decide_assignment_request', args: { p_request: 'q1', p_approve: false, p_reason: 'Booked that week' } })
    expect(state.invoke).toHaveLength(0)
    expect(r).toMatchObject({ outcome: 'refused', subTaskId: 's1' })
  })
})

describe('useWithdrawAssignmentRequest (d.9)', () => {
  it('calls the withdraw RPC with the request', async () => {
    const { result } = renderHook(() => useWithdrawAssignmentRequest(), { wrapper })
    await result.current.mutateAsync('q1')
    expect(state.rpcCalls).toEqual([{ fn: 'withdraw_assignment_request', args: { p_request: 'q1' } }])
  })
})
