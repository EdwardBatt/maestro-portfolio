import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { inChunks } from '../../../lib/query/in-chunks'
import { assessRisk, type RiskTask } from '../../../lib/deadlines/at-risk'
import type { DeliverableState } from '../../../lib/deliverables/state-machine'
import { deliverableKeys } from '../../deliverables/api/deliverables-api'
import { pieceSince, type PieceRisk } from '../lib/where-is-everything'
import { readHoursVsBooked } from './hours-vs-booked-read'
import { readClientCalendars } from '../../../lib/calendar/client-calendar'

/**
 * One campaign's pieces through the at-risk rule (ADR-0075, `assessRisk`) — what Where is everything
 * (CG-03, I57.10) reads for its clock, its Waiting status and its "for how long".
 *
 * The campaign page's own read (`useCampaignDeliverables`) does not carry what the rule needs: the
 * committed span and hours of each task, when a task in review was submitted, the outstanding inputs.
 * So this reads them, FLAT and chunked, the way `campaign-pulse-api.ts` does for the campaigns list —
 * an embed PostgREST cannot resolve comes back empty rather than as an error, and a long id list in
 * one request is a 414 (I49.75).
 *
 * "Since" — how long the piece has been where it is:
 *   - approved (out with the client): when the piece row last changed, which is the approval;
 *   - a task in review: that task's latest submission;
 *   - a task in progress: the earliest start among the tasks now in progress (each task's current
 *     round, `task_time_entries.started_at`);
 *   - not started, with its task list approved: the approval of the list;
 *   - otherwise: when the piece was created.
 * `waitingSince` is the oldest outstanding input's request, for a piece that is Waiting.
 *
 * Keyed under the campaign's deliverables, so whatever refreshes the page's pieces refreshes this.
 */

interface PieceRaw {
  id: string
  state: DeliverableState
  due_at: string | null
  tasks_approved_at: string | null
  created_at: string
  updated_at: string
}
interface TaskRaw {
  id: string
  deliverable_id: string
  status: RiskTask['status']
  assignee_id: string | null
  committed_starts_at: string | null
  committed_due_at: string | null
  committed_hours: number | null
  sla_hours: number | null
  revision_number: number | null
}
interface EntryRaw { sub_task_id: string; started_at: string | null; submitted_at: string | null }
interface InputRaw { deliverable_id: string; requested_at: string }

export const campaignRiskKey = (campaignId: string) => [...deliverableKeys.byCampaign(campaignId), 'risk'] as const

export function useCampaignRisk(campaignId: string | null) {
  return useQuery({
    queryKey: campaignRiskKey(campaignId ?? 'none'),
    enabled: !!campaignId,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Map<string, PieceRisk>> => {
      const [{ data: streamData, error: streamError }, { data: campaignRow, error: campaignError }, calendars] = await Promise.all([
        supabaseUntyped.from('streams').select('id').eq('campaign_id', campaignId!),
        supabaseUntyped.from('campaigns').select('client_id').eq('id', campaignId!).maybeSingle(),
        readClientCalendars(),
      ])
      if (streamError) throw streamError
      if (campaignError) throw campaignError
      // ADR-0123 d.3: the campaign's pieces are judged by its client's working week.
      const clientId = (campaignRow as { client_id: string | null } | null)?.client_id
      const calendar = (clientId ? calendars.byClient.get(clientId) : undefined) ?? calendars.fallback
      const streamIds = ((streamData ?? []) as { id: string }[]).map((s) => s.id)

      const pieces = await inChunks<PieceRaw>(streamIds, (chunk) =>
        supabaseUntyped
          .from('deliverables')
          .select('id, state, due_at, tasks_approved_at, created_at, updated_at')
          .neq('state', 'archived')
          .in('stream_id', chunk))
      const pieceIds = pieces.map((p) => p.id)

      const [tasks, inputs] = await Promise.all([
        inChunks<TaskRaw>(pieceIds, (chunk) =>
          supabaseUntyped
            .from('sub_tasks')
            .select('id, deliverable_id, status, assignee_id, committed_starts_at, committed_due_at, committed_hours, sla_hours, revision_number')
            .in('deliverable_id', chunk)),
        inChunks<InputRaw>(pieceIds, (chunk) =>
          supabaseUntyped
            .from('deliverable_pending_inputs')
            .select('deliverable_id, requested_at')
            .is('satisfied_at', null)
            .in('deliverable_id', chunk)),
      ])

      // Time entries only for the tasks whose moment matters: in review (the submission) and in
      // progress (the start).
      const moving = tasks.filter((t) => t.status === 'review' || t.status === 'in_progress').map((t) => t.id)
      const now = Date.now()
      const [entries, judgedHours] = await Promise.all([
        inChunks<EntryRaw>(moving, (chunk) =>
          supabaseUntyped.from('task_time_entries').select('sub_task_id, started_at, submitted_at').in('sub_task_id', chunk)),
        // ADR-0075 d.4's first clause — the SAME read the campaigns list's card uses, so the two
        // screens cannot disagree on what is at risk (I57.20).
        readHoursVsBooked(tasks.map((t) => ({ ...t, hours: t.committed_hours ?? t.sla_hours })), now),
      ])

      const submittedOf = new Map<string, string>()
      const startedOf = new Map<string, string>()   // the latest start: the current round's
      for (const e of entries) {
        if (e.submitted_at && (submittedOf.get(e.sub_task_id) ?? '') < e.submitted_at) submittedOf.set(e.sub_task_id, e.submitted_at)
        if (e.started_at && (startedOf.get(e.sub_task_id) ?? '') < e.started_at) startedOf.set(e.sub_task_id, e.started_at)
      }
      const inputsOf = new Map<string, { count: number; oldest: string }>()
      for (const i of inputs) {
        const prev = inputsOf.get(i.deliverable_id)
        inputsOf.set(i.deliverable_id, {
          count: (prev?.count ?? 0) + 1,
          oldest: prev && prev.oldest < i.requested_at ? prev.oldest : i.requested_at,
        })
      }
      const tasksOf = new Map<string, TaskRaw[]>()
      for (const t of tasks) tasksOf.set(t.deliverable_id, [...(tasksOf.get(t.deliverable_id) ?? []), t])

      const out = new Map<string, PieceRisk>()
      for (const p of pieces) {
        const ts = tasksOf.get(p.id) ?? []
        const input = inputsOf.get(p.id)
        // ADR-0069 d.7: an outstanding input cascades to the piece's tasks — they are WAITING.
        const waiting = (input?.count ?? 0) > 0
        const assessment = assessRisk(
          {
            state: p.state,
            dueAt: p.due_at,
            taskListApprovedAt: p.tasks_approved_at,
            tasks: ts.map((t) => ({
              id: t.id,
              status: t.status,
              assigneeId: t.assignee_id,
              committedStartsAt: t.committed_starts_at,
              committedDueAt: t.committed_due_at,
              hours: t.committed_hours ?? t.sla_hours,
              submittedAt: t.status === 'review' ? submittedOf.get(t.id) ?? null : null,
              waitingOnPrerequisite: waiting,
              ...(judgedHours.get(t.id) ?? {}),
            })),
          },
          { now, calendar },
        )
        out.set(p.id, {
          assessment,
          outstandingInputs: input?.count ?? 0,
          since: pieceSince(
            { state: p.state, tasksApprovedAt: p.tasks_approved_at, createdAt: p.created_at, updatedAt: p.updated_at },
            ts.map((t) => ({ status: t.status, submittedAt: submittedOf.get(t.id) ?? null, startedAt: startedOf.get(t.id) ?? null })),
          ),
          waitingSince: input?.oldest ?? null,
        })
      }
      return out
    },
  })
}

