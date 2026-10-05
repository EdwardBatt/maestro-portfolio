import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { inChunks } from '../../../lib/query/in-chunks'
import { invalidateTaskViews } from '../../../lib/query/task-views'
import {
  aboutHours,
  num,
  type ChangeAskAnswer,
  type ChangeAskKind,
  type ChangeAskRow,
  type ChangeAskStatus,
} from '../lib/change-ask'

/**
 * The one change form (ADR-0141 d.2–d.4, I74.14–I74.16) — its reads and its three writes.
 *
 *  - `usePieceAskContext(id)` — what the form and the piece header say: the piece's name, code and due day, its
 *    campaign, its account manager (the campaign's, else the client's — `app.deliverable_account_manager`'s rule),
 *    and its tasks with their hours ("About 12").
 *  - `usePieceChangeAsks(id)` — every ask on the piece, newest first, with who asked and who answered.
 *  - `useAskDeliverableChange` / `useWithdrawDeliverableChange` / `useAnswerDeliverableChange` — the RPCs. The
 *    database decides who may ask (the owner and the leads of the department) and who answers (the account manager's
 *    gate); the screen only words its refusals.
 *
 * Keys sit under `['deliverables', …]` so Needs you and every task view refresh with them.
 */
export const changeAskKeys = {
  all: ['deliverables', 'change-asks'] as const,
  piece: (deliverableId: string) => ['deliverables', 'change-asks', 'piece', deliverableId] as const,
  context: (deliverableId: string) => ['deliverables', 'change-asks', 'context', deliverableId] as const,
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

export interface PieceAskTask {
  id: string
  title: string
  status: string
  hours: number | null
  dueAt: string | null
  assigneeId: string | null
  assigneeName: string | null
}

export interface PieceAskContext {
  id: string
  name: string
  code: string | null
  dueAt: string | null
  channel: string | null
  /** ADR-0117 addendum (Q18): the deliverable's languages, in the order chosen. */
  languages: string[]
  quantity: number | null
  typeName: string | null
  campaignId: string | null
  campaignName: string | null
  accountManagerId: string | null
  accountManagerName: string | null
  /** The live tasks' hours, summed — "About 12" (a deliverable has no hours of its own). */
  hours: number | null
  tasks: PieceAskTask[]
}

type AmRef = { account_manager_id: string | null }
type TypeName = { name_en: string | null; name_ar: string | null }
interface PieceRaw {
  id: string
  name: string
  code: string | null
  due_at: string | null
  channel: string | null
  languages: string[] | null
  quantity: number | null
  stream_id: string | null
  deliverable_types: TypeName | TypeName[] | null
  streams: { campaign_id: string | null; campaigns: unknown } | { campaign_id: string | null; campaigns: unknown }[] | null
}
interface CampaignRaw {
  name: string
  account_manager_id: string | null
  clients: AmRef | AmRef[] | null
}

export function usePieceAskContext(deliverableId: string | null, locale: 'en' | 'ar' = 'en') {
  return useQuery({
    queryKey: [...changeAskKeys.context(deliverableId ?? ''), locale],
    enabled: Boolean(deliverableId),
    queryFn: async (): Promise<PieceAskContext | null> => {
      const { data, error } = await supabaseUntyped
        .from('deliverables')
        .select(
          'id, name, code, due_at, channel, languages, quantity, stream_id, deliverable_types(name_en, name_ar), ' +
            'streams(campaign_id, campaigns(name, account_manager_id, clients(account_manager_id)))',
        )
        .eq('id', deliverableId!)
        .maybeSingle()
      if (error) throw error
      const d = data as PieceRaw | null
      if (!d) return null
      const stream = one(d.streams)
      const campaign = one(stream?.campaigns as CampaignRaw | CampaignRaw[] | null)
      const amId = campaign?.account_manager_id ?? one(campaign?.clients ?? null)?.account_manager_id ?? null
      const [am, tasks] = await Promise.all([
        amId
          ? supabaseUntyped.from('user_profiles').select('display_name').eq('id', amId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabaseUntyped
          .from('sub_tasks')
          .select('id, title, status, sla_hours, due_at, sort_order, unit_index, assignee_id, assignee:user_profiles!sub_tasks_assignee_id_fkey(display_name)')
          .eq('deliverable_id', deliverableId!)
          .order('sort_order', { ascending: true })
          .order('unit_index', { ascending: true }),
      ])
      if (tasks.error) throw tasks.error
      type Who = { display_name?: string | null }
      const taskRows = ((tasks.data ?? []) as {
        id: string; title: string; status: string; sla_hours: unknown; due_at: string | null; assignee_id: string | null; assignee: Who | Who[] | null
      }[]).map((x) => ({
        id: x.id,
        title: x.title,
        status: x.status,
        hours: num(x.sla_hours),
        dueAt: x.due_at,
        assigneeId: x.assignee_id,
        assigneeName: one(x.assignee)?.display_name ?? null,
      }))
      return {
        id: d.id,
        name: d.name,
        code: d.code,
        dueAt: d.due_at,
        channel: d.channel,
        languages: d.languages ?? [],
        quantity: d.quantity,
        typeName: (() => {
          const ty = one(d.deliverable_types)
          return (locale === 'ar' ? ty?.name_ar || ty?.name_en : ty?.name_en || ty?.name_ar) ?? null
        })(),
        campaignId: stream?.campaign_id ?? null,
        campaignName: campaign?.name ?? null,
        accountManagerId: amId,
        accountManagerName: (am.data as { display_name?: string } | null)?.display_name ?? null,
        hours: aboutHours(taskRows),
        tasks: taskRows,
      }
    },
  })
}

export interface AskRaw {
  id: string
  deliverable_id: string
  asked_by: string
  kinds: string[]
  requested_due_day: string | null
  requested_hours: unknown
  reason: string
  from_sub_task_id: string | null
  status: ChangeAskStatus
  answered_by: string | null
  answered_at: string | null
  answer_note: string | null
  applied_due_day: string | null
  applied_hours: unknown
  escalated_at: string | null
  created_at: string
}
export const ASK_COLUMNS =
  'id, deliverable_id, asked_by, kinds, requested_due_day, requested_hours, reason, from_sub_task_id, status, ' +
  'answered_by, answered_at, answer_note, applied_due_day, applied_hours, escalated_at, created_at'

/** Raw rows → `ChangeAskRow`, with the asker's and the answerer's names (one flat read). */
export async function withAskNames(rows: readonly AskRaw[]): Promise<ChangeAskRow[]> {
  const ids = [...new Set(rows.flatMap((r) => [r.asked_by, r.answered_by]).filter((x): x is string => !!x))]
  const people = await inChunks<{ id: string; display_name: string | null }>(ids, (chunk) =>
    supabaseUntyped.from('user_profiles').select('id, display_name').in('id', chunk))
  const nameOf = new Map(people.map((p) => [p.id, p.display_name]))
  return rows.map((r) => ({
    id: r.id,
    deliverableId: r.deliverable_id,
    askedBy: r.asked_by,
    askedByName: nameOf.get(r.asked_by) ?? null,
    kinds: (r.kinds ?? []) as ChangeAskKind[],
    requestedDueDay: r.requested_due_day,
    requestedHours: num(r.requested_hours),
    reason: r.reason,
    fromSubTaskId: r.from_sub_task_id,
    status: r.status,
    answeredBy: r.answered_by,
    answeredByName: r.answered_by ? nameOf.get(r.answered_by) ?? null : null,
    answeredAt: r.answered_at,
    answerNote: r.answer_note,
    appliedDueDay: r.applied_due_day,
    appliedHours: num(r.applied_hours),
    escalatedAt: r.escalated_at,
    createdAt: r.created_at,
  }))
}

export function usePieceChangeAsks(deliverableId: string | null) {
  return useQuery({
    queryKey: changeAskKeys.piece(deliverableId ?? ''),
    enabled: Boolean(deliverableId),
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ChangeAskRow[]> => {
      const { data, error } = await supabaseUntyped
        .from('deliverable_change_asks')
        .select(ASK_COLUMNS)
        .eq('deliverable_id', deliverableId!)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return withAskNames((data ?? []) as unknown as AskRaw[])
    },
  })
}

export interface AskArgs {
  deliverableId: string
  kinds: ChangeAskKind[]
  reason: string
  /** YYYY-MM-DD — the piece's new due day (due at the close of that working day). */
  dueDay: string | null
  hours: number | null
  fromSubTaskId: string | null
}

export function useAskDeliverableChange() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: AskArgs): Promise<string> => {
      const { data, error } = await supabaseUntyped.rpc('ask_deliverable_change', {
        p_deliverable: a.deliverableId,
        p_kinds: a.kinds,
        p_reason: a.reason.trim(),
        p_due_day: a.dueDay,
        p_hours: a.hours,
        p_from_sub_task: a.fromSubTaskId,
      })
      if (error) throw error
      return data as unknown as string
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: changeAskKeys.all })
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export function useWithdrawDeliverableChange() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (askId: string): Promise<void> => {
      const { error } = await supabaseUntyped.rpc('withdraw_deliverable_change', { p_ask: askId })
      if (error) throw error
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: changeAskKeys.all })
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export interface AnswerArgs {
  askId: string
  answer: ChangeAskAnswer
  dueDay: string | null
  hours: number | null
  note: string | null
}

export interface AnswerResult {
  answer: ChangeAskAnswer
  dueDay: string | null
  hours: number | null
  dueMoved: boolean
}

export function useAnswerDeliverableChange() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: AnswerArgs): Promise<AnswerResult> => {
      const { data, error } = await supabaseUntyped.rpc('answer_deliverable_change', {
        p_ask: a.askId,
        p_answer: a.answer,
        p_due_day: a.dueDay,
        p_hours: a.hours,
        p_note: a.note?.trim() ? a.note.trim() : null,
      })
      if (error) throw error
      const r = (data ?? {}) as { answer?: ChangeAskAnswer; due_day?: string | null; hours?: unknown; due_moved?: boolean }
      return { answer: r.answer ?? a.answer, dueDay: r.due_day ?? null, hours: num(r.hours), dueMoved: r.due_moved === true }
    },
    // An accepted due date moves the piece: every view of it is out of date.
    onSettled: () => {
      invalidateTaskViews(qc)
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}
