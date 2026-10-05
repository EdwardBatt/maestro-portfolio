import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import type { TaskReviewer } from '../../../lib/reviewers/task-reviewers'

/**
 * The reviewer inbox query (ADR-0043 d.7).
 *
 * Two things are asserted, and the first is the reason this file exists at all: the query must not
 * start from "my appointments where approved_at is null". On a pool task the first approval
 * completes it and every other reviewer's row stays null for ever, so that list grows with every
 * appointment the person never personally acted on, over the life of the account, and ends up as an
 * `in.(…)` filter long enough to blow the PostgREST URL. Starting from the tasks in review bounds it
 * by live work.
 *
 * `lib/supabase` reaches `lib/env`, which throws when the VITE_ vars are absent (they are, in CI),
 * so the client is stubbed — traps.md.
 */

type Recorded = { table: string; method: string; args: unknown[] }

const state = vi.hoisted(() => ({
  calls: [] as { table: string; method: string; args: unknown[] }[],
  subTasks: [] as Record<string, unknown>[],
  reviewers: new Map<string, TaskReviewer[]>(),
}))

vi.mock('../../../lib/supabase', () => {
  // A thenable stub of the PostgREST builder: every filter records itself and returns `this`, and
  // awaiting it yields whatever rows the test staged.
  const build = (table: string) => {
    const self: Record<string, unknown> = {}
    // `range` answers only its slice and an unranged read at most 1,000 rows — the server's max_rows.
    let span: [number, number] = [0, 999]
    for (const method of ['select', 'eq', 'in', 'is', 'neq', 'order', 'single', 'maybeSingle', 'range']) {
      self[method] = (...args: unknown[]) => {
        state.calls.push({ table, method, args })
        if (method === 'range') span = [args[0] as number, args[1] as number]
        return self
      }
    }
    self.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: table === 'sub_tasks' ? state.subTasks.slice(span[0], span[1] + 1) : [], error: null }).then(resolve, reject)
    return self
  }
  return {
    supabase: { functions: { invoke: vi.fn() } },
    supabaseUntyped: { from: (table: string) => build(table), rpc: vi.fn() },
  }
})

vi.mock('../../../lib/reviewers/task-reviewers-api', () => ({
  fetchTaskReviewers: (ids: string[]) =>
    Promise.resolve(new Map(ids.map((id) => [id, state.reviewers.get(id) ?? []]))),
}))

import { useAssignableUsers, useAwaitingMyReview } from './deliverables-api'

const ME = 'me'
const appointment = (over: Partial<TaskReviewer> & { userId: string }): TaskReviewer => ({
  name: over.userId,
  isMandatory: false,
  approvedAt: null,
  respondedAt: null,
  response: null,
  isActive: true,
  ...over,
})

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return createElement(QueryClientProvider, { client: qc }, children)
}

const calledOn = (table: string, method: string): Recorded[] =>
  state.calls.filter((c) => c.table === table && c.method === method)

describe('useAwaitingMyReview (ADR-0043 d.7)', () => {
  beforeEach(() => {
    state.calls = []
    state.subTasks = []
    state.reviewers = new Map()
  })

  it('asks the server for tasks in review, not for every appointment I ever had', async () => {
    state.subTasks = [{ id: 't1', title: 'Retouch', due_at: null, assignee: null, deliverables: null }]
    state.reviewers.set('t1', [appointment({ userId: ME })])

    const { result } = renderHook(() => useAwaitingMyReview(ME), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(calledOn('sub_tasks', 'eq')).toContainEqual(
      expect.objectContaining({ args: ['status', 'review'] }),
    )
    // The unbounded read: "every sub_task_reviewers row that is mine and unapproved", whose result
    // was then spread into an `.in('id', …)`. It must not happen.
    expect(calledOn('sub_task_reviewers', 'eq')).toEqual([])
    expect(calledOn('sub_tasks', 'in')).toEqual([])
  })

  it('keeps a task only while MY verdict is still owed', async () => {
    state.subTasks = [
      { id: 'mine', title: 'Mine', due_at: null, assignee: null, deliverables: null },
      { id: 'acted', title: 'Already judged', due_at: null, assignee: null, deliverables: null },
      { id: 'theirs', title: 'Not my problem', due_at: null, assignee: null, deliverables: null },
    ]
    state.reviewers.set('mine', [
      appointment({ userId: ME, isMandatory: true }),
      appointment({ userId: 'colleague', approvedAt: '2026-08-27T09:00:00Z' }),
    ])
    // A colleague has agreed, but I have not — d.7: the thing that gates the task must not vanish
    // from the queue of the person who gates it.
    state.reviewers.set('acted', [appointment({ userId: ME, approvedAt: '2026-08-27T09:00:00Z' })])
    state.reviewers.set('theirs', [appointment({ userId: 'colleague' })])

    const { result } = renderHook(() => useAwaitingMyReview(ME), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.map((i) => i.subTaskId)).toEqual(['mine'])
    expect(result.current.data?.[0]?.mineIsMandatory).toBe(true)
    // The row carries everyone, so the reviewer can see whether their own Approve finishes it.
    expect(result.current.data?.[0]?.reviewers).toHaveLength(2)
  })

  // ADR-0089 d.12: an optional reviewer's inbox row leaves when they have ANSWERED, not when they
  // have approved — which they no longer can.
  it('keeps a task for an OPTIONAL reviewer only until they answer (ADR-0089 d.12)', async () => {
    state.subTasks = [
      { id: 'silent', title: 'Not answered', due_at: null, assignee: null, deliverables: null },
      { id: 'answered', title: 'Answered', due_at: null, assignee: null, deliverables: null },
    ]
    state.reviewers.set('silent', [
      appointment({ userId: 'lead', isMandatory: true }),
      appointment({ userId: ME }),
    ])
    state.reviewers.set('answered', [
      appointment({ userId: 'lead', isMandatory: true }),
      appointment({ userId: ME, respondedAt: '2026-09-11T09:00:00Z', response: 'no_comment' }),
    ])

    const { result } = renderHook(() => useAwaitingMyReview(ME), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.map((i) => i.subTaskId)).toEqual(['silent'])
    expect(result.current.data?.[0]?.mineIsMandatory).toBe(false)
  })

  // I59.35: every task in review in the tenant is read and then narrowed to mine, and the server
  // answers 1,000 rows at a time — a task of mine past the first thousand must still be found.
  it('finds my task past the server’s first thousand rows', async () => {
    state.subTasks = Array.from({ length: 1500 }, (_, i) => ({ id: `t${i}`, title: `Task ${i}`, due_at: null, assignee: null, deliverables: null }))
    state.reviewers.set('t1234', [appointment({ userId: ME })])

    const { result } = renderHook(() => useAwaitingMyReview(ME), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.map((i) => i.subTaskId)).toEqual(['t1234'])
    expect(calledOn('sub_tasks', 'range').map((c) => c.args)).toEqual([[0, 999], [1000, 1999]])
  })
})

/**
 * ADR-0061 d.5 — bookable means one thing everywhere.
 *
 * This query is the single source for every person-picker in the app. It used to select
 * `user_profiles` with NO filter at all — not the resource, not even the user's own active flag —
 * so a deactivated person, or one who never had a calendar row, could be handed work that could
 * never appear anywhere. Edward found it by deactivating somebody who then stayed assignable.
 */
describe('useAssignableUsers (ADR-0061 d.5)', () => {
  it('asks only for active people with an active human resource', async () => {
    state.calls = []
    const { result } = renderHook(() => useAssignableUsers(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const calls = state.calls.filter((c) => c.table === 'user_profiles')

    // The user's own flag: a deactivated person is not a candidate for new work.
    expect(calls).toContainEqual(expect.objectContaining({ method: 'eq', args: ['is_active', true] }))
    // And the calendar row behind them — the same flag /schedule filters on.
    expect(calls).toContainEqual(expect.objectContaining({ method: 'eq', args: ['resources.kind', 'human'] }))
    expect(calls).toContainEqual(expect.objectContaining({ method: 'eq', args: ['resources.is_active', true] }))
  })

  // `!inner` is load-bearing: PostgREST embeds are LEFT joins by default, so without it every
  // person comes back regardless of whether they have a resource — the filter would read as
  // present and do nothing.
  it('embeds resources as an INNER join, or the filter is decorative', async () => {
    state.calls = []
    const { result } = renderHook(() => useAssignableUsers(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const select = state.calls.find((c) => c.table === 'user_profiles' && c.method === 'select')
    expect(String(select?.args[0])).toContain('resources!inner')
  })
})
