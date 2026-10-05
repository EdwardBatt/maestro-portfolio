import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { fetchUserNames } from '../../../lib/users/user-names'
import { useAuth } from '../../../app/auth-context'
import { deliverableKeys } from './deliverables-api'
import { extensionKeys } from './extensions-api'
import { pendingApprovalKeys } from './pending-approvals-api'
import { requirementKeys } from './requirements-api'

/**
 * I59 Track 6 — what the Needs-you dialogs and the task page's new parts WRITE, and the reads
 * the task page adds: the blocks on a task, the questions on a piece, the piece's people, the
 * round's timing. Every write is the database's own RPC or an insert its RLS admits (ADR-0107 –
 * 0113); the client decides nothing — a refusal comes back as the server's sentence.
 */

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

export const requestKeys = {
  all: ['requests'] as const,
  taskInputs: (deliverableId: string, subTaskId: string) => [...requestKeys.all, 'task-inputs', deliverableId, subTaskId] as const,
  questions: (pieceKey: string) => [...requestKeys.all, 'questions', pieceKey] as const,
  people: (deliverableId: string, subTaskId: string) => [...requestKeys.all, 'piece-people', deliverableId, subTaskId] as const,
  everyone: () => [...requestKeys.all, 'everyone'] as const,
  timing: (subTaskId: string) => [...requestKeys.all, 'round-timing', subTaskId] as const,
}

/** After any answer, everything that shows "what waits on whom" is read again. */
function useInvalidateRequests() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: requestKeys.all })
    // Needs you's sources live under deliverableKeys.all ('needs-you'), with the task reads.
    void qc.invalidateQueries({ queryKey: deliverableKeys.all })
    void qc.invalidateQueries({ queryKey: extensionKeys.all })
    void qc.invalidateQueries({ queryKey: pendingApprovalKeys.all })
    void qc.invalidateQueries({ queryKey: requirementKeys.all })
    void qc.invalidateQueries({ queryKey: ['schedule'] })
  }
}

function rpc(name: string, args: Record<string, unknown>) {
  return async () => {
    const { data, error } = await supabaseUntyped.rpc(name, args)
    if (error) throw error
    return data as unknown
  }
}

// ---------------------------------------------------------------- messages (ADR-0113) ----

export function useNudge() {
  const invalidate = useInvalidateRequests()
  return useMutation({
    mutationFn: (a: { deliverableId: string | null; subTaskId: string | null; personId: string; body: string }) =>
      rpc('nudge', { p_deliverable: a.deliverableId, p_sub_task: a.subTaskId, p_person: a.personId, p_body: a.body.trim() || null })(),
    onSuccess: invalidate,
  })
}

export function useAskQuestion() {
  const invalidate = useInvalidateRequests()
  return useMutation({
    mutationFn: (a: { deliverableId: string | null; subTaskId: string | null; recipients: string[]; body: string }) =>
      rpc('ask_question', { p_deliverable: a.deliverableId, p_sub_task: a.subTaskId, p_recipients: a.recipients, p_body: a.body.trim() })(),
    onSuccess: invalidate,
  })
}

export function useReplyToQuestion() {
  const invalidate = useInvalidateRequests()
  return useMutation({
    mutationFn: (a: { questionId: string; body: string }) => rpc('reply_to_question', { p_question: a.questionId, p_body: a.body.trim() })(),
    onSuccess: invalidate,
  })
}

export function useSayTooMuch() {
  const invalidate = useInvalidateRequests()
  return useMutation({
    mutationFn: (a: { subTaskId: string; note: string }) => rpc('say_too_much', { p_task: a.subTaskId, p_note: a.note.trim() || null })(),
    onSuccess: invalidate,
  })
}

export function useAnswerTooMuch() {
  const invalidate = useInvalidateRequests()
  return useMutation({
    mutationFn: (a: { messageId: string; answer: 'rebalance' | 'keep' }) => rpc('answer_too_much', { p_message: a.messageId, p_answer: a.answer })(),
    onSuccess: invalidate,
  })
}

// ------------------------------------------------------------ extensions (ADR-0109) ----

/** The owner forwards, with the note the addendum makes required (checked here and by the dialog). */
export function useForwardExtension() {
  const invalidate = useInvalidateRequests()
  return useMutation({
    mutationFn: (a: { requestId: string; note: string }) => rpc('forward_extension', { p_request: a.requestId, p_note: a.note.trim() })(),
    onSuccess: invalidate,
  })
}

export function useOwnerDeclineExtension() {
  const invalidate = useInvalidateRequests()
  return useMutation({
    mutationFn: (a: { requestId: string; reason: string }) =>
      rpc('owner_decline_extension', { p_request: a.requestId, p_reason: a.reason.trim() })(),
    onSuccess: invalidate,
  })
}

/** The account manager's answer: approve (as asked, or a shorter `toDay`), or refuse. */
export function useDecideExtensionStep() {
  const invalidate = useInvalidateRequests()
  return useMutation({
    mutationFn: (a: { requestId: string; approve: boolean; note?: string | null; toDay?: string | null }) =>
      rpc('sub_task_extension_decide', {
        p_request: a.requestId,
        p_approve: a.approve,
        p_note: a.note?.trim() || null,
        p_to_day: a.toDay || null,
      })(),
    onSuccess: invalidate,
  })
}

// ------------------------------------------------------- change requests (ADR-0110) ----

export function useAnswerChangeRequest() {
  const invalidate = useInvalidateRequests()
  return useMutation({
    mutationFn: (a: { requestId: string; answer: 'accept' | 'decline' | 'push_back'; text?: string | null; date?: string | null }) =>
      rpc('answer_change_request', { p_request: a.requestId, p_answer: a.answer, p_text: a.text?.trim() || null, p_date: a.date || null })(),
    onSuccess: invalidate,
  })
}

export function useResolveChangeRequest() {
  const invalidate = useInvalidateRequests()
  return useMutation({
    mutationFn: (a: { requestId: string; resolution: 'accept_counter' | 'withdraw' }) =>
      rpc('resolve_change_request', { p_request: a.requestId, p_resolution: a.resolution })(),
    onSuccess: invalidate,
  })
}

export function useCloseChangeRequest() {
  const invalidate = useInvalidateRequests()
  return useMutation({
    mutationFn: (requestId: string) => rpc('close_change_request', { p_request: requestId })(),
    onSuccess: invalidate,
  })
}

// ------------------------------------------------------------- blocks (ADR-0107) ----

export type BlockKind = 'copy' | 'client' | 'file' | 'decision' | 'other'
export const BLOCK_KINDS: readonly BlockKind[] = ['copy', 'client', 'file', 'decision', 'other']

/**
 * "I'm blocked": an input on the maker's OWN task (`deliverable_pending_inputs.sub_task_id`), the
 * three fields required — the RLS policy `deliverable_pending_inputs_assignee_insert` admits it, and
 * the guard stamps `requested_at` itself. The owner and the account manager are told by the trigger.
 */
export function useRaiseBlock() {
  const invalidate = useInvalidateRequests()
  const { claims, session } = useAuth()
  return useMutation({
    mutationFn: async (a: { deliverableId: string; subTaskId: string; kind: BlockKind; awaitedFrom: string; description: string }) => {
      const { error } = await supabaseUntyped.from('deliverable_pending_inputs').insert({
        tenant_id: claims.tenantId,
        deliverable_id: a.deliverableId,
        sub_task_id: a.subTaskId,
        kind: a.kind,
        awaited_from: a.awaitedFrom.trim(),
        description: a.description.trim(),
        created_by: session?.user.id ?? null,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/**
 * Clearing an input: `satisfied_at` set. For the maker or the owner the guard stamps the server's
 * own now() (ADR-0107 d.2); a manager's write is kept as sent. A cleared block is not re-opened —
 * a new one is raised (the addendum), so nothing here un-clears.
 */
export function useClearInput() {
  const invalidate = useInvalidateRequests()
  return useMutation({
    mutationFn: async (inputId: string) => {
      const { error } = await supabaseUntyped
        .from('deliverable_pending_inputs')
        .update({ satisfied_at: new Date().toISOString() })
        .eq('id', inputId)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export interface TaskInput {
  id: string
  /** Null = on the whole deliverable (it holds every task, ADR-0069 d.7); else this task's own. */
  subTaskId: string | null
  kind: string | null
  description: string
  awaitedFrom: string | null
  requestedAt: string
  satisfiedAt: string | null
}

/** What holds THIS task: the deliverable's inputs and the task's own, outstanding first. */
export function useTaskInputs(deliverableId: string | null, subTaskId: string) {
  return useQuery({
    queryKey: requestKeys.taskInputs(deliverableId ?? 'none', subTaskId),
    enabled: !!deliverableId,
    refetchOnWindowFocus: true,
    refetchInterval: 20_000,
    queryFn: async (): Promise<TaskInput[]> => {
      const { data, error } = await supabaseUntyped
        .from('deliverable_pending_inputs')
        .select('id, sub_task_id, kind, description, awaited_from, requested_at, satisfied_at')
        .eq('deliverable_id', deliverableId!)
        .or(`sub_task_id.is.null,sub_task_id.eq.${subTaskId}`)
        .order('requested_at', { ascending: true })
      if (error) throw error
      return ((data ?? []) as {
        id: string; sub_task_id: string | null; kind: string | null; description: string
        awaited_from: string | null; requested_at: string; satisfied_at: string | null
      }[]).map((r) => ({
        id: r.id,
        subTaskId: r.sub_task_id,
        kind: r.kind,
        description: r.description,
        awaitedFrom: r.awaited_from,
        requestedAt: r.requested_at,
        satisfiedAt: r.satisfied_at,
      }))
    },
  })
}

// ------------------------------------------------------------ the round's timing ----

export interface RoundTiming {
  startedAt: string | null
  elapsedMinutes: number | null
  thresholdMinutes: number
  isUntimed: boolean
  allocatedHours: number | null
  blockedMinutesSoFar: number
}

/** `task_round_timing` (ADR-0106 d.2 / ADR-0107 d.3): would sending now be untimed, the allocation,
 *  and the blocked minutes so far — the server's figures, shown as they come. */
export function useRoundTiming(subTaskId: string | null, enabled = true) {
  return useQuery({
    queryKey: requestKeys.timing(subTaskId ?? 'none'),
    enabled: !!subTaskId && enabled,
    refetchInterval: 60_000,
    queryFn: async (): Promise<RoundTiming | null> => {
      const { data, error } = await supabaseUntyped.rpc('task_round_timing', { p_sub_task: subTaskId })
      if (error) throw error
      const r = one((data ?? null) as Record<string, unknown> | Record<string, unknown>[] | null)
      if (!r) return null
      const num = (v: unknown) => (v == null ? null : Number(v))
      return {
        startedAt: (r.started_at as string | null) ?? null,
        elapsedMinutes: num(r.elapsed_minutes),
        thresholdMinutes: Number(r.threshold_minutes ?? 15),
        isUntimed: r.is_untimed === true,
        allocatedHours: num(r.allocated_hours),
        blockedMinutesSoFar: Number(r.blocked_minutes_so_far ?? 0),
      }
    },
  })
}

// ------------------------------------------------------------ questions on a piece ----

export interface PieceQuestion {
  id: string
  authorId: string
  authorName: string | null
  recipients: { id: string; name: string | null }[]
  body: string
  createdAt: string
  replies: { id: string; authorId: string; authorName: string | null; body: string; createdAt: string }[]
}

/**
 * Every question asked about this piece and its replies, newest first (plan View 4, ADR-0113 d.2) —
 * a plain select on `piece_messages` (read tenant-wide). The piece is the deliverable; a standalone
 * task (no deliverable) is its own piece.
 */
export function usePieceQuestions(deliverableId: string | null, subTaskId: string) {
  const pieceKey = deliverableId ? `d:${deliverableId}` : `t:${subTaskId}`
  return useQuery({
    queryKey: requestKeys.questions(pieceKey),
    refetchOnWindowFocus: true,
    refetchInterval: 20_000,
    queryFn: async (): Promise<PieceQuestion[]> => {
      let q = supabaseUntyped
        .from('piece_messages')
        .select('id, kind, parent_id, author_id, body, recipients, created_at')
        .in('kind', ['question', 'reply'])
        .order('created_at', { ascending: true })
      q = deliverableId ? q.eq('deliverable_id', deliverableId) : q.eq('sub_task_id', subTaskId)
      const { data, error } = await q
      if (error) throw error
      const rows = (data ?? []) as {
        id: string; kind: string; parent_id: string | null; author_id: string; body: string | null
        recipients: string[] | null; created_at: string
      }[]
      const names = await fetchUserNames(rows.flatMap((r) => [r.author_id, ...(r.recipients ?? [])]))
      const questions = rows.filter((r) => r.kind === 'question')
      return questions
        .map((qn) => ({
          id: qn.id,
          authorId: qn.author_id,
          authorName: names.get(qn.author_id) ?? null,
          recipients: (qn.recipients ?? []).map((id) => ({ id, name: names.get(id) ?? null })),
          body: qn.body ?? '',
          createdAt: qn.created_at,
          replies: rows
            .filter((r) => r.kind === 'reply' && r.parent_id === qn.id)
            .map((r) => ({ id: r.id, authorId: r.author_id, authorName: names.get(r.author_id) ?? null, body: r.body ?? '', createdAt: r.created_at })),
        }))
        .reverse()
    },
  })
}

// ---------------------------------------------------------------- the piece's people ----

export type PiecePart = 'account_manager' | 'owner' | 'assigner' | 'reviewer' | 'maker'

export interface PiecePerson {
  id: string
  name: string
  parts: PiecePart[]
}

export interface PiecePeople {
  people: PiecePerson[]
  ownerId: string | null
  ownerName: string | null
  accountManagerId: string | null
  accountManagerName: string | null
}

/**
 * The people on a piece, each with their part (plan View 6, Ask someone: "the piece's people listed
 * first with their part, the AM pre-selected"): its account manager (the campaign's, else the
 * client's — `app.deliverable_account_manager`'s rule), its owner, whoever gave out and holds its
 * tasks, and the tasks' reviewers.
 */
export function usePiecePeople(deliverableId: string | null, subTaskId: string) {
  return useQuery({
    queryKey: requestKeys.people(deliverableId ?? 'none', subTaskId),
    staleTime: 60_000,
    queryFn: async (): Promise<PiecePeople> => {
      const parts = new Map<string, Set<PiecePart>>()
      const add = (id: string | null | undefined, part: PiecePart) => {
        if (!id) return
        parts.set(id, (parts.get(id) ?? new Set()).add(part))
      }
      let ownerId: string | null = null
      let amId: string | null = null
      if (deliverableId) {
        type AmRef = { account_manager_id: string | null }
        const { data, error } = await supabaseUntyped
          .from('deliverables')
          .select('owner_user_id, streams(campaigns(account_manager_id, clients(account_manager_id)))')
          .eq('id', deliverableId)
          .maybeSingle()
        if (error) throw error
        const d = data as { owner_user_id: string | null; streams: unknown } | null
        ownerId = d?.owner_user_id ?? null
        const campaign = one(one(d?.streams as { campaigns: unknown } | null)?.campaigns as
          { account_manager_id: string | null; clients: AmRef | AmRef[] | null } | null)
        amId = campaign?.account_manager_id ?? one(campaign?.clients ?? null)?.account_manager_id ?? null
      }
      add(amId, 'account_manager')
      add(ownerId, 'owner')

      const tasksQ = supabaseUntyped.from('sub_tasks').select('id, assignee_id, assigned_by, status')
      const { data: tasks, error: te } = deliverableId ? await tasksQ.eq('deliverable_id', deliverableId) : await tasksQ.eq('id', subTaskId)
      if (te) throw te
      const live = ((tasks ?? []) as { id: string; assignee_id: string | null; assigned_by: string | null; status: string }[])
        .filter((t) => t.status !== 'cancelled')
      for (const t of live) {
        add(t.assigned_by, 'assigner')
        add(t.assignee_id, 'maker')
      }
      if (live.length > 0) {
        const { data: revs, error: re } = await supabaseUntyped
          .from('sub_task_reviewers')
          .select('user_id')
          .in('sub_task_id', live.map((t) => t.id))
        if (re) throw re
        for (const r of (revs ?? []) as { user_id: string }[]) add(r.user_id, 'reviewer')
      }
      const names = await fetchUserNames([...parts.keys()])
      const ORDER: PiecePart[] = ['account_manager', 'owner', 'assigner', 'reviewer', 'maker']
      const people = [...parts.entries()]
        .map(([id, set]) => ({ id, name: names.get(id) || '—', parts: ORDER.filter((p) => set.has(p)) }))
        .sort((a, b) => ORDER.indexOf(a.parts[0]!) - ORDER.indexOf(b.parts[0]!) || a.name.localeCompare(b.name))
      return {
        people,
        ownerId,
        ownerName: ownerId ? names.get(ownerId) ?? null : null,
        accountManagerId: amId,
        accountManagerName: amId ? names.get(amId) ?? null : null,
      }
    },
  })
}

/** Everyone active in the tenant — the rest of the Ask list, and the Nudge picker (anyone, ADR-0113 d.2). */
export function useEveryone() {
  return useQuery({
    queryKey: requestKeys.everyone(),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data, error } = await supabaseUntyped
        .from('user_profiles')
        .select('id, display_name')
        .eq('is_active', true)
        .order('display_name')
      if (error) throw error
      return ((data ?? []) as { id: string; display_name: string | null }[]).map((u) => ({ id: u.id, name: u.display_name ?? '—' }))
    },
  })
}

// ------------------------------------------------------ reduced scope (SJ-v3-S2) ----

export type AckVia = 'whatsapp' | 'email' | 'phone' | 'meeting' | 'internal' | 'other'
export const ACK_VIA: readonly AckVia[] = ['whatsapp', 'email', 'phone', 'meeting', 'internal', 'other']

/**
 * The client's answer to a reduced scope, recorded on the job (`scope_acknowledgements`, one per
 * job — written under `projects:manage`, its policy). `needsDays` / `hasDays` are the arithmetic
 * the job was released against; the form never asks for them.
 */
export function useRecordScopeAcknowledgement() {
  const invalidate = useInvalidateRequests()
  const { claims, session } = useAuth()
  return useMutation({
    mutationFn: async (a: {
      campaignId: string; needsDays: number; hasDays: number
      by: string; via: AckVia; at: string; note: string
    }) => {
      const { error } = await supabaseUntyped.from('scope_acknowledgements').insert({
        tenant_id: claims.tenantId,
        campaign_id: a.campaignId,
        needs_days: a.needsDays,
        has_days: a.hasDays,
        acknowledged_by: a.by.trim(),
        acknowledged_via: a.via,
        acknowledged_at: a.at,
        note: a.note.trim() || null,
        recorded_by: session?.user.id,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}
