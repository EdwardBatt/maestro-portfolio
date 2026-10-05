import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'

/**
 * A round's timing and a maker's blocks (ADR-0106, ADR-0107 — I59.20 / I59.21). Thin and typed: the
 * database decides everything — whether a round is untimed, what it records, who may raise or clear
 * a block — and this module only carries the calls and names the answers. No screen lives here.
 *
 * `new` objects are read through `supabaseUntyped`: `src/types/database.ts` is generated and lags
 * these migrations until `gen types` re-runs.
 */

export const timingKeys = {
  all: ['round-timing'] as const,
  round: (subTaskId: string) => [...timingKeys.all, 'round', subTaskId] as const,
  needsMeBlocks: () => [...timingKeys.all, 'needs-me-blocks'] as const,
}

/** What `public.task_round_timing` returns — the screen's warning reads this before Send. */
export interface RoundTiming {
  subTaskId: string
  round: number
  status: string
  /** Null while the round has not been started. */
  startedAt: string | null
  elapsedMinutes: number | null
  thresholdMinutes: number
  /** Would sending NOW record the allocation instead of the timer (ADR-0106 d.1)? */
  isUntimed: boolean
  /** sla_hours, else committed_hours; null when the task has neither. */
  allocatedHours: number | null
  blockedMinutesSoFar: number
}

interface RoundTimingRow {
  sub_task_id: string
  round: number
  status: string
  started_at: string | null
  elapsed_minutes: number | string | null
  threshold_minutes: number
  is_untimed: boolean
  allocated_hours: number | string | null
  blocked_minutes_so_far: number | string | null
}

/** PostgREST sends `numeric` as a JSON number, but a string is legal too; never let one through. */
const num = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v)

export function toRoundTiming(r: RoundTimingRow): RoundTiming {
  return {
    subTaskId: r.sub_task_id,
    round: r.round,
    status: r.status,
    startedAt: r.started_at,
    elapsedMinutes: num(r.elapsed_minutes),
    thresholdMinutes: r.threshold_minutes,
    isUntimed: r.is_untimed,
    allocatedHours: num(r.allocated_hours),
    blockedMinutesSoFar: num(r.blocked_minutes_so_far) ?? 0,
  }
}

export async function fetchRoundTiming(subTaskId: string): Promise<RoundTiming | null> {
  const { data, error } = await supabaseUntyped.rpc('task_round_timing', { p_sub_task: subTaskId })
  if (error) throw error
  const row = ((data ?? []) as RoundTimingRow[])[0]
  return row ? toRoundTiming(row) : null
}

export function useRoundTiming(subTaskId: string | null) {
  return useQuery({
    queryKey: timingKeys.round(subTaskId ?? 'none'),
    enabled: Boolean(subTaskId),
    queryFn: () => fetchRoundTiming(subTaskId!),
  })
}

// ---- sending a round (ADR-0106 d.2, d.3) ----

/** The database's refusal of an untimed send: HINT 'untimed', DETAIL the allocated hours ('' = none). */
export interface UntimedRefusal {
  allocatedHours: number | null
}

export function untimedRefusal(error: unknown): UntimedRefusal | null {
  if (!error || typeof error !== 'object') return null
  const e = error as { code?: unknown; hint?: unknown; details?: unknown }
  if (e.code !== '22023' || e.hint !== 'untimed') return null
  return { allocatedHours: typeof e.details === 'string' ? num(e.details) : null }
}

/**
 * Send a round for review. Without `acceptUntimed` an untimed round is refused — read it with
 * `untimedRefusal(error)`, warn, and send again with `acceptUntimed: true`.
 */
export async function sendRound(args: { subTaskId: string; acceptUntimed?: boolean }): Promise<void> {
  const { error } = await supabaseUntyped.rpc('sub_task_submit', {
    p_id: args.subTaskId,
    p_manual_minutes: null,
    p_accept_untimed: args.acceptUntimed ?? false,
  })
  if (error) throw error
}

// ---- "I'm blocked" (ADR-0107 d.1, d.2) ----

export const BLOCK_KINDS = ['copy', 'client', 'file', 'decision', 'other'] as const
export type BlockKind = (typeof BLOCK_KINDS)[number]

export interface RaiseBlockArgs {
  tenantId: string
  deliverableId: string
  subTaskId: string
  kind: BlockKind
  /** What you need — required (ADR-0069 d.7). */
  description: string
  /** Who has it — required for a task-level block. */
  awaitedFrom: string
}

/** The assignee raises a block on their own task. `requested_at` / `created_by` are the server's. */
export async function raiseBlock(args: RaiseBlockArgs): Promise<void> {
  const { error } = await supabaseUntyped.from('deliverable_pending_inputs').insert({
    tenant_id: args.tenantId,
    deliverable_id: args.deliverableId,
    sub_task_id: args.subTaskId,
    kind: args.kind,
    description: args.description.trim(),
    awaited_from: args.awaitedFrom.trim(),
  })
  if (error) throw error
}

/** The maker or the deliverable's owner clears a block. The server stamps the moment. */
export async function clearBlock(inputId: string): Promise<void> {
  const { error } = await supabaseUntyped
    .from('deliverable_pending_inputs')
    .update({ satisfied_at: new Date().toISOString() })
    .eq('id', inputId)
  if (error) throw error
}

/** One open block on a task of a deliverable I own — `public.needs_me_blocks()`. */
export interface NeedsMeBlock {
  inputId: string
  subTaskId: string
  taskTitle: string
  deliverableId: string
  deliverableName: string
  makerId: string | null
  makerName: string | null
  kind: BlockKind | null
  description: string
  awaitedFrom: string | null
  since: string
}

interface NeedsMeBlockRow {
  input_id: string
  sub_task_id: string
  task_title: string
  deliverable_id: string
  deliverable_name: string
  maker_id: string | null
  maker_name: string | null
  kind: string | null
  description: string
  awaited_from: string | null
  requested_at: string
}

const isBlockKind = (k: string | null): k is BlockKind =>
  k !== null && (BLOCK_KINDS as readonly string[]).includes(k)

export function toNeedsMeBlock(r: NeedsMeBlockRow): NeedsMeBlock {
  return {
    inputId: r.input_id,
    subTaskId: r.sub_task_id,
    taskTitle: r.task_title,
    deliverableId: r.deliverable_id,
    deliverableName: r.deliverable_name,
    makerId: r.maker_id,
    makerName: r.maker_name,
    kind: isBlockKind(r.kind) ? r.kind : null,
    description: r.description,
    awaitedFrom: r.awaited_from,
    since: r.requested_at,
  }
}

export async function fetchNeedsMeBlocks(): Promise<NeedsMeBlock[]> {
  const { data, error } = await supabaseUntyped.rpc('needs_me_blocks')
  if (error) throw error
  return ((data ?? []) as NeedsMeBlockRow[]).map(toNeedsMeBlock)
}

export function useNeedsMeBlocks(enabled = true) {
  return useQuery({
    queryKey: timingKeys.needsMeBlocks(),
    enabled,
    queryFn: fetchNeedsMeBlocks,
  })
}
