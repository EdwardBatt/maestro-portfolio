import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { inChunks } from '../../../lib/query/in-chunks'
import { allRows, inChunksPaged } from '../../../lib/query/all-pages'
import type { DeliverableState } from '../../../lib/deliverables/state-machine'
import type { PulsePiece, PulseTask } from '../../../lib/campaigns/pulse'
import { readHoursVsBooked } from './hours-vs-booked-read'
import { readClientCalendars } from '../../../lib/calendar/client-calendar'
import { campaignKeys } from './campaign-api'

/**
 * Everything the campaigns list (CG-00, I57.3) needs beyond `campaign_list_rows`: each campaign's
 * live pieces with their tasks — for the progress, the alert badges and "Mine" — and the words the
 * smart search looks through (piece codes and names, the people on it).
 *
 * FLAT reads, joined here, for two reasons this project has paid for: an embed PostgREST cannot
 * resolve comes back EMPTY rather than as an error (`sub_task_reviewers` has no foreign key to
 * embed through), and a tenant-wide read stops at the server's 1,000 rows — so the wide ones are
 * PAGED and the per-id ones go through `inChunks` (I49.75, the 414).
 *
 * The hours-vs-booked check (ADR-0075 d.4, I57.12) adds two reads in the round that already reads
 * reviewers, so the list waits for no extra round trip: the live assigned tasks' bookings and this
 * round's time entries (which also give the review tasks their submission time, as before).
 *
 * Tenant-wide by design: everyone sees every campaign (Edward, 24 Sep — the 12 Sep decision stands),
 * so the RLS that governs these tables is the tenant boundary, and that is what they are read under.
 */

export interface CampaignPulseSource {
  campaignId: string
  /** ADR-0123: the client pages group campaigns by it. */
  clientId: string | null
  accountManagerId: string | null
  hasPhases: boolean
  phases: { number: number; name: string; startsOn: string; endsOn: string }[]
  pieces: PulsePiece[]
  /** Lower-cased text the smart search matches: piece codes and names, the people's names. */
  searchText: string
}

/** A tenant-wide read, every page of it (lib/query/all-pages.ts). */
const paged = allRows

interface CampaignRaw { id: string; client_id: string | null; account_manager_id: string | null; has_phases: boolean | null }
interface StreamRaw { id: string; campaign_id: string | null }
interface PieceRaw {
  id: string
  stream_id: string
  name: string
  code: string | null
  state: DeliverableState
  due_at: string | null
  tasks_approved_at: string | null
  owner_user_id: string | null
  reviewer_id: string | null
  workstream_id: string | null
  finished_at: string | null
}
interface TaskRaw {
  id: string
  deliverable_id: string
  status: PulseTask['status']
  assignee_id: string | null
  committed_starts_at: string | null
  committed_due_at: string | null
  committed_hours: number | null
  sla_hours: number | null
  revision_number: number | null
}

export function useCampaignPulse() {
  return useQuery({
    queryKey: [...campaignKeys.list(), 'pulse'] as const,
    queryFn: async (): Promise<Map<string, CampaignPulseSource>> => {
      const [campaigns, streams, pieces, workstreams, phases, people, calendars] = await Promise.all([
        paged<CampaignRaw>((a, b) =>
          supabaseUntyped.from('campaigns').select('id, client_id, account_manager_id, has_phases').order('id').range(a, b)),
        paged<StreamRaw>((a, b) => supabaseUntyped.from('streams').select('id, campaign_id').order('id').range(a, b)),
        // Closed pieces are left out: they are not work anybody owes, and the card never counts them.
        paged<PieceRaw>((a, b) =>
          supabaseUntyped
            .from('deliverables')
            .select('id, stream_id, name, code, state, due_at, tasks_approved_at, owner_user_id, reviewer_id, workstream_id, finished_at')
            .neq('state', 'archived')
            .order('id')
            .range(a, b)),
        paged<{ id: string; owner_user_id: string | null }>((a, b) =>
          supabaseUntyped.from('workstreams').select('id, owner_user_id').order('id').range(a, b)),
        paged<{ campaign_id: string; number: number; name: string; starts_on: string; ends_on: string }>((a, b) =>
          supabaseUntyped.from('campaign_phases').select('campaign_id, number, name, starts_on, ends_on').order('campaign_id').order('number').range(a, b)),
        paged<{ id: string; display_name: string | null }>((a, b) =>
          supabaseUntyped.from('user_profiles').select('id, display_name').order('id').range(a, b)),
        // ADR-0123 d.3: a piece is late or at risk by its CLIENT's working week.
        readClientCalendars(),
      ])

      const pieceIds = pieces.map((p) => p.id)
      const [tasks, inputs] = await Promise.all([
        // Every task on those pieces, finished ones included — "who is on it" counts people whose
        // task is done. Live-ness is decided by the engines, not here.
        // Paged per batch too: a hundred pieces can carry more than a thousand tasks (I59.35).
        inChunksPaged<TaskRaw>(pieceIds, (chunk, a, b) =>
          supabaseUntyped
            .from('sub_tasks')
            .select('id, deliverable_id, status, assignee_id, committed_starts_at, committed_due_at, committed_hours, sla_hours, revision_number')
            .in('deliverable_id', chunk)
            .order('id')
            .range(a, b)),
        inChunks<{ deliverable_id: string }>(pieceIds, (chunk) =>
          supabaseUntyped.from('deliverable_pending_inputs').select('deliverable_id').is('satisfied_at', null).in('deliverable_id', chunk)),
      ])
      const taskIds = tasks.map((t) => t.id)
      const inReview = tasks.filter((t) => t.status === 'review').map((t) => t.id)
      const now = Date.now()
      const [reviewers, entries, judgedHours] = await Promise.all([
        inChunks<{ sub_task_id: string; user_id: string }>(taskIds, (chunk) =>
          supabaseUntyped.from('sub_task_reviewers').select('sub_task_id, user_id').in('sub_task_id', chunk)),
        // When a task in review went there: its latest submission.
        inChunksPaged<{ sub_task_id: string; submitted_at: string | null }>(inReview, (chunk, a, b) =>
          supabaseUntyped.from('task_time_entries').select('sub_task_id, submitted_at').not('submitted_at', 'is', null).in('sub_task_id', chunk)
            .order('id').range(a, b)),
        // d.4's first clause (I57.12) — the SAME read Where is everything uses (I57.20).
        readHoursVsBooked(tasks.map((t) => ({ ...t, hours: t.committed_hours ?? t.sla_hours })), now),
      ])
      /** d.4, first clause. A task never scheduled has nothing to judge it by — left to the other checks. */
      const hoursVsBooked = (t: TaskRaw) => judgedHours.get(t.id) ?? {}

      const campaignOfStream = new Map(streams.map((s) => [s.id, s.campaign_id]))
      const clientOfCampaign = new Map(campaigns.map((c) => [c.id, c.client_id]))
      const wsOwner = new Map(workstreams.map((w) => [w.id, w.owner_user_id]))
      const nameOf = new Map(people.map((u) => [u.id, u.display_name ?? '']))
      const inputsOf = new Map<string, number>()
      for (const i of inputs) inputsOf.set(i.deliverable_id, (inputsOf.get(i.deliverable_id) ?? 0) + 1)
      const reviewersOf = new Map<string, string[]>()
      for (const r of reviewers) reviewersOf.set(r.sub_task_id, [...(reviewersOf.get(r.sub_task_id) ?? []), r.user_id])
      const submittedOf = new Map<string, string>()
      for (const s of entries) {
        if (!s.submitted_at) continue
        const prev = submittedOf.get(s.sub_task_id)
        if (!prev || s.submitted_at > prev) submittedOf.set(s.sub_task_id, s.submitted_at)
      }
      const tasksOf = new Map<string, PulseTask[]>()
      for (const t of tasks) {
        const list = tasksOf.get(t.deliverable_id) ?? []
        list.push({
          id: t.id,
          status: t.status,
          assigneeId: t.assignee_id,
          committedStartsAt: t.committed_starts_at,
          committedDueAt: t.committed_due_at,
          hours: t.committed_hours ?? t.sla_hours,
          submittedAt: t.status === 'review' ? submittedOf.get(t.id) ?? null : null,
          reviewerIds: reviewersOf.get(t.id) ?? [],
          revisionNumber: t.revision_number ?? 0,
          ...hoursVsBooked(t),
        })
        tasksOf.set(t.deliverable_id, list)
      }

      const out = new Map<string, CampaignPulseSource>()
      for (const c of campaigns) {
        out.set(c.id, {
          campaignId: c.id,
          clientId: c.client_id,
          accountManagerId: c.account_manager_id,
          hasPhases: c.has_phases === true,
          phases: [],
          pieces: [],
          searchText: '',
        })
      }
      for (const ph of phases) {
        out.get(ph.campaign_id)?.phases.push({ number: ph.number, name: ph.name, startsOn: ph.starts_on, endsOn: ph.ends_on })
      }
      const words = new Map<string, string[]>()
      for (const p of pieces) {
        const cid = campaignOfStream.get(p.stream_id)
        const src = cid ? out.get(cid) : undefined
        if (!src) continue
        const ts = tasksOf.get(p.id) ?? []
        const piece: PulsePiece = {
          id: p.id,
          name: p.name,
          finishedAt: p.finished_at,
          state: p.state,
          dueAt: p.due_at,
          taskListApprovedAt: p.tasks_approved_at,
          ownerId: p.owner_user_id,
          reviewerId: p.reviewer_id,
          workstreamOwnerId: p.workstream_id ? wsOwner.get(p.workstream_id) ?? null : null,
          outstandingInputs: inputsOf.get(p.id) ?? 0,
          tasks: ts,
          calendar: calendars.byClient.get(clientOfCampaign.get(src.campaignId) ?? '') ?? calendars.fallback,
        }
        src.pieces.push(piece)
        const w = words.get(src.campaignId) ?? []
        w.push(p.code ?? '', p.name)
        for (const id of [piece.ownerId, piece.reviewerId, piece.workstreamOwnerId, ...ts.map((t) => t.assigneeId)]) {
          if (id) w.push(nameOf.get(id) ?? '')
        }
        words.set(src.campaignId, w)
      }
      for (const src of out.values()) {
        const w = words.get(src.campaignId) ?? []
        if (src.accountManagerId) w.push(nameOf.get(src.accountManagerId) ?? '')
        src.searchText = [...new Set(w.filter(Boolean))].join(' ').toLowerCase()
      }
      return out
    },
  })
}
