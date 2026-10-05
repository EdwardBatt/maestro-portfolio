import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, supabaseUntyped } from '../supabase'
import { inChunks } from '../query/in-chunks'
import { liveOptions } from '../query/live'
import { invalidateTaskViews } from '../query/task-views'
import { scheduleWarningKey, type ScheduleOutcome } from '../bookings/schedule-outcome'
import type { TaskAsk, TaskAskStatus, TimeAsk } from './asks'

/**
 * ADR-0139 / ADR-0141 d.5 — reading and writing the asks between teams, and a maker's ask for more
 * time. Every write is a SECURITY DEFINER RPC that decides authority itself (`20261003110000`,
 * `20261003130000`); nothing here decides who may ask or answer. Who ANSWERS is read from the server
 * (`my_pending_approvals`, the same list the escalation reads), never mirrored.
 */

export const taskAskKeys = {
  all: ['task-asks'] as const,
  sent: (userId: string) => [...taskAskKeys.all, 'sent', userId] as const,
  toAnswer: () => [...taskAskKeys.all, 'to-answer'] as const,
  rule: () => [...taskAskKeys.all, 'rule'] as const,
  answerers: (resourceId: string) => [...taskAskKeys.all, 'answerers', resourceId] as const,
  timeToAnswer: () => [...taskAskKeys.all, 'time-to-answer'] as const,
  timeMine: (subTaskId: string) => [...taskAskKeys.all, 'time-mine', subTaskId] as const,
}

interface RequestRow {
  id: string
  sub_task_id: string
  team_id: string | null
  assignee_id: string | null
  requested_by: string
  requested_at: string | null
  created_at: string
  hours: number | string | null
  needed_by: string | null
  starts_at: string | null
  due_at: string | null
  note: string | null
  status: TaskAskStatus
  offered_starts_at: string | null
  offered_ends_at: string | null
  answered_by: string | null
  answer_note: string | null
  reason: string | null
  answered_at: string | null
  escalated_at: string | null
  title: string | null
}

const REQUEST_SELECT =
  'id, sub_task_id, team_id, assignee_id, requested_by, requested_at, created_at, hours, needed_by, starts_at, due_at, note, ' +
  'status, offered_starts_at, offered_ends_at, answered_by, answer_note, reason, answered_at, escalated_at, title'

/** The names around a set of requests — tasks, pieces, campaigns, people, teams — in flat reads (traps.md). */
async function enrich(rows: RequestRow[]): Promise<TaskAsk[]> {
  if (rows.length === 0) return []
  const tasks = await inChunks<{ id: string; title: string; deliverable_id: string | null }>(rows.map((r) => r.sub_task_id), (c) =>
    supabaseUntyped.from('sub_tasks').select('id, title, deliverable_id').in('id', c))
  const taskById = new Map(tasks.map((x) => [x.id, x]))
  const pieces = await inChunks<{ id: string; name: string; stream_id: string | null }>(
    tasks.map((x) => x.deliverable_id).filter((x): x is string => !!x), (c) =>
      supabaseUntyped.from('deliverables').select('id, name, stream_id').in('id', c))
  const pieceById = new Map(pieces.map((p) => [p.id, p]))
  const streams = await inChunks<{ id: string; campaign_id: string }>(
    pieces.map((p) => p.stream_id).filter((x): x is string => !!x), (c) =>
      supabaseUntyped.from('streams').select('id, campaign_id').in('id', c))
  const campaigns = await inChunks<{ id: string; name: string }>(streams.map((s) => s.campaign_id), (c) =>
    supabaseUntyped.from('campaigns').select('id, name').in('id', c))
  const campaignOfStream = new Map(streams.map((s) => [s.id, campaigns.find((c) => c.id === s.campaign_id)?.name ?? null]))
  const people = await inChunks<{ id: string; display_name: string; team_id: string | null }>(
    rows.flatMap((r) => [r.assignee_id, r.requested_by, r.answered_by]).filter((x): x is string => !!x), (c) =>
      supabaseUntyped.from('user_profiles').select('id, display_name, team_id').in('id', c))
  const personById = new Map(people.map((p) => [p.id, p]))
  const teams = await inChunks<{ id: string; name: string }>(
    [...rows.map((r) => r.team_id), ...people.map((p) => p.team_id)].filter((x): x is string => !!x), (c) =>
      supabaseUntyped.from('teams').select('id, name').in('id', c))
  const teamName = new Map(teams.map((t) => [t.id, t.name]))

  return rows.map((r) => {
    const task = taskById.get(r.sub_task_id)
    const piece = task?.deliverable_id ? pieceById.get(task.deliverable_id) : undefined
    const requester = personById.get(r.requested_by)
    return {
      id: r.id,
      subTaskId: r.sub_task_id,
      taskTitle: task?.title ?? r.title ?? '',
      deliverableId: task?.deliverable_id ?? null,
      pieceName: piece?.name ?? null,
      campaignId: piece?.stream_id ? (streams.find((x) => x.id === piece.stream_id)?.campaign_id ?? null) : null,
      campaignName: piece?.stream_id ? (campaignOfStream.get(piece.stream_id) ?? null) : null,
      teamId: r.team_id,
      teamName: r.team_id ? (teamName.get(r.team_id) ?? null) : null,
      assigneeId: r.assignee_id,
      assigneeName: r.assignee_id ? (personById.get(r.assignee_id)?.display_name ?? null) : null,
      requestedBy: r.requested_by,
      requesterName: requester?.display_name ?? null,
      requesterTeamName: requester?.team_id ? (teamName.get(requester.team_id) ?? null) : null,
      createdAt: r.requested_at ?? r.created_at,
      hours: r.hours == null ? null : Number(r.hours),
      neededBy: r.needed_by,
      startsAt: r.starts_at,
      dueAt: r.due_at,
      note: r.note,
      status: r.status,
      offeredStartsAt: r.offered_starts_at,
      offeredEndsAt: r.offered_ends_at,
      answeredBy: r.answered_by,
      answeredByName: r.answered_by ? (personById.get(r.answered_by)?.display_name ?? null) : null,
      answerNote: r.answer_note ?? r.reason,
      answeredAt: r.answered_at,
      escalatedAt: r.escalated_at,
    }
  })
}

/** "Asked of other teams" (SC-18, SC-30): my asks — open, and those answered in the last fortnight. */
export function useAsksISent(userId: string | null, opts?: { live?: boolean }) {
  return useQuery({
    ...liveOptions(opts?.live),
    queryKey: taskAskKeys.sent(userId ?? 'none'),
    enabled: Boolean(userId),
    queryFn: async (): Promise<TaskAsk[]> => {
      const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
      const { data, error } = await supabaseUntyped
        .from('sub_task_assignment_requests')
        .select(REQUEST_SELECT)
        .eq('requested_by', userId!)
        .in('status', ['pending', 'offered', 'approved', 'refused'])
        .gte('created_at', since)
        .order('created_at', { ascending: false })
      if (error) throw error
      return enrich((data ?? []) as unknown as RequestRow[])
    },
  })
}

/**
 * The asks I answer (SC-28, SC-29): exactly the `booking_request` rows of `my_pending_approvals` — the
 * server's own list of who may answer (ADR-0139 d.3, and after d.5's wait Traffic and the department
 * lead) — so the card and the answer's authority cannot disagree.
 */
export function useAsksToAnswer(opts?: { live?: boolean; enabled?: boolean }) {
  return useQuery({
    ...liveOptions(opts?.live),
    queryKey: taskAskKeys.toAnswer(),
    enabled: opts?.enabled ?? true,
    queryFn: async (): Promise<TaskAsk[]> => {
      const { data, error } = await supabaseUntyped.rpc('my_pending_approvals')
      if (error) throw error
      const ids = ((data ?? []) as { kind: string; id: string }[]).filter((r) => r.kind === 'booking_request').map((r) => r.id)
      if (ids.length === 0) return []
      const rows = await inChunks<RequestRow>(ids, (c) =>
        supabaseUntyped.from('sub_task_assignment_requests').select(REQUEST_SELECT).in('id', c).eq('status', 'pending'))
      const out = await enrich(rows)
      return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    },
  })
}

/** The tenant's wait before an ask goes to Traffic (ADR-0139 d.5, kind `task_request`) — null without a rule. */
export function useAskRuleHours() {
  return useQuery({
    queryKey: taskAskKeys.rule(),
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<number | null> => {
      const { data } = await supabaseUntyped.from('tenant_escalation_rules').select('hours').eq('kind', 'task_request').maybeSingle()
      const h = (data as { hours: number | string | null } | null)?.hours
      return h == null ? null : Number(h)
    },
  })
}

/**
 * Who answers an ask of a team (ADR-0139 d.3), named in the picker ("Anyone — Amira decides"): the
 * server's `assignment_request_approvers` over one of the team's calendars — the Team Leader, the
 * Deputy when she is on leave today, else the department lead.
 */
export function useAskAnswerers(sampleResourceId: string | null) {
  return useQuery({
    queryKey: taskAskKeys.answerers(sampleResourceId ?? 'none'),
    enabled: Boolean(sampleResourceId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data, error } = await supabaseUntyped.rpc('assignment_request_approvers', { p_resource: sampleResourceId })
      if (error) throw error
      return ((data ?? []) as { user_id: string; display_name: string }[]).map((r) => ({ id: r.user_id, name: r.display_name }))
    },
  })
}

/** After an answer that books: place it — `subtask-schedule` as the caller (ADR-0061 d.1: its answer is read). */
async function placeIfNeeded(row: { sub_task_id?: string; reschedule_needed?: boolean } | null): Promise<string | undefined> {
  if (!row?.reschedule_needed || !row.sub_task_id) return undefined
  const { data, error } = await supabase.functions.invoke('subtask-schedule', { body: { subTaskId: row.sub_task_id } })
  if (error) throw error
  return scheduleWarningKey(data as ScheduleOutcome) ?? undefined
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    invalidateTaskViews(qc)
    void qc.invalidateQueries({ queryKey: taskAskKeys.all })
    void qc.invalidateQueries({ queryKey: ['notifications'] })
  }
}

export interface AskArgs {
  subTaskId: string
  teamId: string
  assigneeId: string | null
  hours: number | null
  /** the Iraq day it is needed by */
  neededBy: string | null
  startsAt?: string | null
  dueAt?: string | null
  note: string
  /** who checks it — carried by the ask and written onto the task by the booking (I74.53); null keeps the task's own */
  reviewers?: { user_id: string; is_mandatory: boolean }[] | null
  reviewMode?: string | null
}

/** Ask a team (ADR-0139 d.2) — `request_task_booking`. Refused with hint `book_directly` within reach. */
export async function requestTaskBooking(a: AskArgs): Promise<string> {
  const { data, error } = await supabaseUntyped.rpc('request_task_booking', {
    p_sub_task: a.subTaskId,
    p_team: a.teamId || null,
    p_assignee: a.assigneeId,
    p_hours: a.hours,
    p_needed_by: a.neededBy,
    p_starts_at: a.startsAt ?? null,
    p_due_at: a.dueAt ?? null,
    p_note: a.note.trim() || null,
    p_reviewers: a.reviewers ?? null,
    p_review_mode: a.reviewMode ?? null,
  })
  if (error) throw error
  return data as unknown as string
}

export function useRequestTaskBooking() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: requestTaskBooking, onSettled: invalidate })
}

export interface AnswerArgs {
  requestId: string
  answer: 'book' | 'offer' | 'refuse'
  assigneeId?: string | null
  startsAt?: string | null
  dueAt?: string | null
  hours?: number | null
  note?: string | null
}

/** The lead answers (SC-29): book, offer another day, or say no with a reason. */
export function useAnswerTaskRequest() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (a: AnswerArgs) => {
      const { data, error } = await supabaseUntyped.rpc('answer_task_request', {
        p_request: a.requestId,
        p_answer: a.answer,
        p_assignee: a.assigneeId ?? null,
        p_starts_at: a.startsAt ?? null,
        p_due_at: a.dueAt ?? null,
        p_hours: a.hours ?? null,
        p_note: a.note?.trim() || null,
      })
      if (error) throw error
      const row = (Array.isArray(data) ? data[0] : data) as { sub_task_id?: string; reschedule_needed?: boolean; outcome?: string } | null
      const scheduleWarning = await placeIfNeeded(row)
      return { outcome: row?.outcome ?? a.answer, scheduleWarning }
    },
    onSettled: invalidate,
  })
}

/** The asker takes the offered day (SC-30) — then places it as herself (`app.task_booking_sanctioned`). */
export function useTakeTaskOffer() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { data, error } = await supabaseUntyped.rpc('take_task_offer', { p_request: requestId })
      if (error) throw error
      const row = (Array.isArray(data) ? data[0] : data) as { sub_task_id?: string; reschedule_needed?: boolean } | null
      return { scheduleWarning: await placeIfNeeded(row) }
    },
    onSettled: invalidate,
  })
}

/** The asker takes it back while it waits, or declines an offer (ADR-0139 d.4). */
export function useWithdrawTaskAsk() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabaseUntyped.rpc('withdraw_assignment_request', { p_request: requestId })
      if (error) throw error
    },
    onSettled: invalidate,
  })
}

// ------------------------------------------------------------------ more time (ADR-0141 d.5) ----

interface TimeAskRow {
  id: string; sub_task_id: string; asked_by: string; to_day: string; note: string | null
  status: TimeAsk['status']; created_at: string; answer_note: string | null
}

async function enrichTime(rows: TimeAskRow[]): Promise<TimeAsk[]> {
  if (rows.length === 0) return []
  const tasks = await inChunks<{ id: string; title: string; deliverable_id: string | null; due_at: string | null }>(rows.map((r) => r.sub_task_id), (c) =>
    supabaseUntyped.from('sub_tasks').select('id, title, deliverable_id, due_at').in('id', c))
  const taskById = new Map(tasks.map((x) => [x.id, x]))
  const pieces = await inChunks<{ id: string; name: string; due_at: string | null }>(
    tasks.map((x) => x.deliverable_id).filter((x): x is string => !!x), (c) =>
      supabaseUntyped.from('deliverables').select('id, name, due_at').in('id', c))
  const pieceById = new Map(pieces.map((p) => [p.id, p]))
  const people = await inChunks<{ id: string; display_name: string }>(rows.map((r) => r.asked_by), (c) =>
    supabaseUntyped.from('user_profiles').select('id, display_name').in('id', c))
  const name = new Map(people.map((p) => [p.id, p.display_name]))
  return rows.map((r) => {
    const task = taskById.get(r.sub_task_id)
    const piece = task?.deliverable_id ? pieceById.get(task.deliverable_id) : undefined
    return {
      id: r.id,
      subTaskId: r.sub_task_id,
      taskTitle: task?.title ?? '',
      deliverableId: task?.deliverable_id ?? null,
      pieceName: piece?.name ?? null,
      askedBy: r.asked_by,
      askerName: name.get(r.asked_by) ?? null,
      toDay: r.to_day,
      note: r.note,
      status: r.status,
      taskDueAt: task?.due_at ?? null,
      pieceDueAt: piece?.due_at ?? null,
      createdAt: r.created_at,
      answerNote: r.answer_note,
    }
  })
}

const TIME_SELECT = 'id, sub_task_id, asked_by, to_day, note, status, created_at, answer_note'

/**
 * Pending asks for more time from these people — the viewer's own people on the Schedule (SC-01). The
 * table is read tenant-wide; the answer's authority is the server's (`app.may_answer_time_ask`).
 */
export function useTimeAsksFrom(userIds: readonly string[], opts?: { live?: boolean }) {
  return useQuery({
    ...liveOptions(opts?.live),
    queryKey: [...taskAskKeys.timeToAnswer(), [...userIds].sort().join(',')] as const,
    enabled: userIds.length > 0,
    queryFn: async (): Promise<TimeAsk[]> => {
      const rows = await inChunks<TimeAskRow>([...userIds], (c) =>
        supabaseUntyped.from('sub_task_time_asks').select(TIME_SELECT).eq('status', 'pending').in('asked_by', c))
      return (await enrichTime(rows)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    },
  })
}

/** The maker's own latest ask on a task — pending, or the last answer (mock-up 9). */
export function useMyTimeAsk(subTaskId: string | null, userId: string | null) {
  return useQuery({
    queryKey: taskAskKeys.timeMine(subTaskId ?? 'none'),
    enabled: Boolean(subTaskId && userId),
    queryFn: async (): Promise<TimeAsk | null> => {
      const { data, error } = await supabaseUntyped
        .from('sub_task_time_asks')
        .select(TIME_SELECT)
        .eq('sub_task_id', subTaskId!)
        .eq('asked_by', userId!)
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) throw error
      const [one] = await enrichTime((data ?? []) as unknown as TimeAskRow[])
      return one ?? null
    },
  })
}

export function useAskMoreTime() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (a: { subTaskId: string; toDay: string; note: string }) => {
      const { data, error } = await supabaseUntyped.rpc('ask_more_time', { p_sub_task: a.subTaskId, p_to_day: a.toDay, p_note: a.note.trim() || null })
      if (error) throw error
      return data as unknown as string
    },
    onSettled: invalidate,
  })
}

export function useWithdrawMoreTime() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (askId: string) => {
      const { error } = await supabaseUntyped.rpc('withdraw_more_time', { p_ask: askId })
      if (error) throw error
    },
    onSettled: invalidate,
  })
}

/**
 * The lead answers a maker (SC-01): yes moves the task's due day (then it is placed again when the
 * server says so); `pastPieceDue` says the yes now runs past the piece's due date — the caller opens
 * the change form, filled in (ADR-0141 d.5).
 */
export function useAnswerMoreTime() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (a: { askId: string; give: boolean; note?: string | null }) => {
      const { data, error } = await supabaseUntyped.rpc('answer_more_time', { p_ask: a.askId, p_give: a.give, p_note: a.note?.trim() || null })
      if (error) throw error
      const row = (Array.isArray(data) ? data[0] : data) as { sub_task_id?: string; reschedule_needed?: boolean; past_piece_due?: boolean; outcome?: string } | null
      const scheduleWarning = await placeIfNeeded(row)
      return { outcome: row?.outcome ?? (a.give ? 'given' : 'refused'), pastPieceDue: Boolean(row?.past_piece_due), scheduleWarning }
    },
    onSettled: invalidate,
  })
}

/**
 * The maker's own lead — who answers her ask for more time (ADR-0141 d.5 → ADR-0139 d.3's order): the
 * server's `assignment_request_approvers` over her own calendar.
 */
export function useMyLead(userId: string | null) {
  return useQuery({
    queryKey: [...taskAskKeys.all, 'my-lead', userId ?? 'none'] as const,
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ id: string; name: string } | null> => {
      const { data: res } = await supabaseUntyped.from('resources').select('id').eq('user_id', userId!).eq('kind', 'human').eq('is_active', true).limit(1).maybeSingle()
      const rid = (res as { id: string } | null)?.id
      if (!rid) return null
      const { data, error } = await supabaseUntyped.rpc('assignment_request_approvers', { p_resource: rid })
      if (error) throw error
      const first = ((data ?? []) as { user_id: string; display_name: string }[]).find((r) => r.user_id !== userId)
      return first ? { id: first.user_id, name: first.display_name } : null
    },
  })
}
