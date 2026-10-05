import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * timing-api (ADR-0106 / ADR-0107): the calls go to the right RPCs with the right arguments, the rows
 * come back named, and an untimed refusal is recognised by its HINT — and nothing else is.
 *
 * `lib/supabase` reaches `lib/env`, which throws when the VITE_ vars are absent (CI), so the client
 * is stubbed (traps.md).
 */

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  inserts: [] as { table: string; row: unknown }[],
  updates: [] as { table: string; patch: unknown; eq: [string, unknown] | null }[],
  error: null as unknown,
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: {},
  supabaseUntyped: {
    rpc: state.rpc,
    from: (table: string) => ({
      insert: (row: unknown) => {
        state.inserts.push({ table, row })
        return Promise.resolve({ error: state.error })
      },
      update: (patch: unknown) => {
        const rec = { table, patch, eq: null as [string, unknown] | null }
        state.updates.push(rec)
        return {
          eq: (col: string, v: unknown) => {
            rec.eq = [col, v]
            return Promise.resolve({ error: state.error })
          },
        }
      },
    }),
  },
}))

import {
  clearBlock,
  fetchNeedsMeBlocks,
  fetchRoundTiming,
  raiseBlock,
  sendRound,
  untimedRefusal,
} from './timing-api'

beforeEach(() => {
  state.rpc.mockReset()
  state.inserts = []
  state.updates = []
  state.error = null
})

describe('fetchRoundTiming', () => {
  it('reads task_round_timing and names the row, numbers as numbers', async () => {
    state.rpc.mockResolvedValue({
      data: [{
        sub_task_id: 't1', round: 0, status: 'in_progress', started_at: '2026-09-25T09:00:00Z',
        elapsed_minutes: '12.5', threshold_minutes: 15, is_untimed: true,
        allocated_hours: 32, blocked_minutes_so_far: null,
      }],
      error: null,
    })
    const t = await fetchRoundTiming('t1')
    expect(state.rpc).toHaveBeenCalledWith('task_round_timing', { p_sub_task: 't1' })
    expect(t).toEqual({
      subTaskId: 't1', round: 0, status: 'in_progress', startedAt: '2026-09-25T09:00:00Z',
      elapsedMinutes: 12.5, thresholdMinutes: 15, isUntimed: true, allocatedHours: 32,
      blockedMinutesSoFar: 0,
    })
  })

  it('is null for a task the caller cannot see (no row)', async () => {
    state.rpc.mockResolvedValue({ data: [], error: null })
    await expect(fetchRoundTiming('hidden')).resolves.toBeNull()
  })

  it('throws the database error', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(fetchRoundTiming('t1')).rejects.toEqual({ message: 'boom' })
  })
})

describe('sendRound and untimedRefusal', () => {
  it('sends without accepting by default, and with it when asked', async () => {
    state.rpc.mockResolvedValue({ data: null, error: null })
    await sendRound({ subTaskId: 't1' })
    await sendRound({ subTaskId: 't1', acceptUntimed: true })
    expect(state.rpc).toHaveBeenNthCalledWith(1, 'sub_task_submit', { p_id: 't1', p_manual_minutes: null, p_accept_untimed: false })
    expect(state.rpc).toHaveBeenNthCalledWith(2, 'sub_task_submit', { p_id: 't1', p_manual_minutes: null, p_accept_untimed: true })
  })

  it('recognises the untimed refusal and reads the allocation from DETAIL', async () => {
    const refusal = { code: '22023', hint: 'untimed', details: '32.00', message: 'this round was not timed' }
    state.rpc.mockResolvedValue({ data: null, error: refusal })
    const err = await sendRound({ subTaskId: 't1' }).catch((e: unknown) => e)
    expect(untimedRefusal(err)).toEqual({ allocatedHours: 32 })
    expect(untimedRefusal({ ...refusal, details: '' })).toEqual({ allocatedHours: null })
  })

  it('does not mistake any other refusal for it', () => {
    expect(untimedRefusal({ code: '22023', hint: null, message: 'this task cannot be sent for review (it is done)' })).toBeNull()
    expect(untimedRefusal({ code: '55000', hint: 'untimed' })).toBeNull()
    expect(untimedRefusal(null)).toBeNull()
    expect(untimedRefusal('untimed')).toBeNull()
  })
})

describe('blocks', () => {
  it('raises a block on the task with the words trimmed, and leaves the stamps to the server', async () => {
    await raiseBlock({
      tenantId: 'ten', deliverableId: 'd1', subTaskId: 't1', kind: 'copy',
      description: '  The Arabic headline ', awaitedFrom: ' Abeer ',
    })
    expect(state.inserts).toEqual([{
      table: 'deliverable_pending_inputs',
      row: { tenant_id: 'ten', deliverable_id: 'd1', sub_task_id: 't1', kind: 'copy', description: 'The Arabic headline', awaited_from: 'Abeer' },
    }])
  })

  it('throws when the database refuses the raise', async () => {
    state.error = { code: '42501' }
    await expect(raiseBlock({ tenantId: 'ten', deliverableId: 'd1', subTaskId: 't1', kind: 'other', description: 'x', awaitedFrom: 'y' }))
      .rejects.toEqual({ code: '42501' })
  })

  it('clears one block by id', async () => {
    await clearBlock('i1')
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0]?.table).toBe('deliverable_pending_inputs')
    expect(state.updates[0]?.eq).toEqual(['id', 'i1'])
    const patch = state.updates[0]?.patch as { satisfied_at?: unknown } | undefined
    expect(typeof patch?.satisfied_at).toBe('string')
  })

  it('reads needs_me_blocks and names each row; an unknown kind is null', async () => {
    state.rpc.mockResolvedValue({
      data: [
        { input_id: 'i1', sub_task_id: 't1', task_title: 'Design', deliverable_id: 'd1', deliverable_name: 'Poster',
          maker_id: 'u1', maker_name: 'Lujain', kind: 'client', description: 'Product shots', awaited_from: 'Kite Card',
          requested_at: '2026-09-25T08:00:00Z' },
        { input_id: 'i2', sub_task_id: 't2', task_title: 'Copy', deliverable_id: 'd1', deliverable_name: 'Poster',
          maker_id: null, maker_name: null, kind: 'mystery', description: 'Tagline', awaited_from: null,
          requested_at: '2026-09-25T09:00:00Z' },
      ],
      error: null,
    })
    const rows = await fetchNeedsMeBlocks()
    expect(state.rpc).toHaveBeenCalledWith('needs_me_blocks')
    expect(rows[0]).toEqual({
      inputId: 'i1', subTaskId: 't1', taskTitle: 'Design', deliverableId: 'd1', deliverableName: 'Poster',
      makerId: 'u1', makerName: 'Lujain', kind: 'client', description: 'Product shots', awaitedFrom: 'Kite Card',
      since: '2026-09-25T08:00:00Z',
    })
    expect(rows[1]?.kind).toBeNull()
  })
})
