import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { inChunks } from '../../../lib/query/in-chunks'
import { allRows, inChunksPaged } from '../../../lib/query/all-pages'
import { useAuth } from '../../../app/auth-context'
import { deliverableKeys } from './deliverables-api'

/**
 * What a task is waiting for (ADR-0069) — the two kinds, read and written together because they
 * answer one question and are shown in one column (d.6).
 *
 *   • A DEPENDENCY on another task, which may sit in another deliverable and another department
 *     (d.1). Satisfied when that task is APPROVED — `done` — or cancelled (d.2).
 *   • An EXTERNAL INPUT on the deliverable, which cascades to every task under it (d.7): one
 *     "waiting on Acme's logo pack", not the same sentence copied onto six rows.
 *
 * Both tables were built in August under ADR-0030 and, until now, nothing in the frontend has ever
 * referenced either. Nothing about their shape changes here.
 *
 * SOFT, ALWAYS (d.3). Nothing in this file gates anything: it reads and writes what a task is
 * waiting for so a person can see it. Start is never disabled, and somebody who presses on anyway
 * is flagged `started_ahead`, which is a positive marker.
 */

export const requirementKeys = {
  all: ['requirements'] as const,
  deps: (deliverableId: string) => [...requirementKeys.all, 'deps', deliverableId] as const,
  inputs: (deliverableId: string) => [...requirementKeys.all, 'inputs', deliverableId] as const,
  candidates: (deliverableId: string) => [...requirementKeys.all, 'candidates', deliverableId] as const,
}

/** One "this task waits on that task" edge, with enough of the prerequisite to render it. */
export interface TaskDependency {
  id: string
  /** The waiting task. */
  subTaskId: string
  prerequisiteId: string
  prerequisiteTitle: string
  prerequisiteStatus: string
  /** Which deliverable the prerequisite lives in — the point of allowing this to cross one. */
  prerequisiteDeliverable: string
  /** ADR-0069 d.2: approved, or cancelled. `review` is NOT met. */
  met: boolean
}

interface DepRow {
  id: string
  sub_task_id: string
  depends_on_sub_task_id: string
  prerequisite: {
    title: string
    status: string
    deliverables: { name: string } | { name: string }[] | null
  } | null
}

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

/** ADR-0069 d.2, in the one place the UI decides it. `review` no longer counts. */
export function isRequirementMet(status: string): boolean {
  return status === 'done' || status === 'cancelled'
}

/**
 * Every dependency belonging to this deliverable's tasks.
 *
 * The embed is NAMED (`sub_task_dependencies_depends_on_sub_task_id_fkey`) because the table has
 * TWO foreign keys to `sub_tasks` — and an ambiguous embed returns EMPTY rather than erroring
 * (traps.md), which here would read as "nothing is waiting on anything" and be believed.
 */
export function useTaskDependencies(deliverableId: string | null) {
  return useQuery({
    queryKey: requirementKeys.deps(deliverableId ?? 'none'),
    enabled: Boolean(deliverableId),
    queryFn: async (): Promise<TaskDependency[]> => {
      const { data: tasks, error: taskErr } = await supabaseUntyped
        .from('sub_tasks')
        .select('id')
        .eq('deliverable_id', deliverableId!)
      if (taskErr) throw taskErr
      const ids = ((tasks ?? []) as { id: string }[]).map((t) => t.id)
      if (ids.length === 0) return []

      // In batches (I49.75): one address naming every task is refused as too long past ~230.
      const data = await inChunks<DepRow>(ids, (chunk) =>
        supabaseUntyped
          .from('sub_task_dependencies')
          .select(
            'id, sub_task_id, depends_on_sub_task_id, ' +
              'prerequisite:sub_tasks!sub_task_dependencies_depends_on_sub_task_id_fkey' +
              '(title, status, deliverables(name))',
          )
          .in('sub_task_id', chunk),
      )

      return data.map((r) => {
        const status = r.prerequisite?.status ?? ''
        return {
          id: r.id,
          subTaskId: r.sub_task_id,
          prerequisiteId: r.depends_on_sub_task_id,
          prerequisiteTitle: r.prerequisite?.title ?? '',
          prerequisiteStatus: status,
          prerequisiteDeliverable: one(r.prerequisite?.deliverables ?? null)?.name ?? '',
          met: isRequirementMet(status),
        }
      })
    },
  })
}

/** A task that could be picked as a requirement. */
export interface RequirementCandidate {
  id: string
  title: string
  /** Grouped by this in the picker, so a cross-deliverable pick is an informed one. */
  deliverableName: string
  sameDeliverable: boolean
}

/**
 * What the picker may offer (d.5): **the live task list**, never `workflow_steps`.
 *
 * `sub_tasks.workflow_step_id` is nullable and `on delete set null` and the title lives on the
 * task, so a renamed, hand-added or removed task has no reliable relationship to the template it
 * came from. A template-built picker would offer steps that no longer exist on this deliverable
 * and omit tasks that do.
 *
 * SCOPE, and it differs by the kind of work:
 *
 *   • CAMPAIGN work offers every live task in the same campaign, which is what makes
 *     cross-deliverable and cross-department dependencies pickable (d.1) — the hand-off from
 *     Creative to Production is the case the feature exists for.
 *   • AD-HOC work has no campaign, so the same rule would offer it nothing but itself. It is
 *     scoped to the CLIENT instead — a retouch waiting on that client's key visual is ordinary,
 *     and the client is wide enough to be useful while keeping the picker a list rather than a
 *     search problem.
 *
 * This deliverable's OWN tasks are always included, whatever else is (see the union below).
 * Cancelled tasks are excluded: picking one would create a requirement that is met on arrival.
 */
export function useRequirementCandidates(deliverableId: string | null) {
  return useQuery({
    queryKey: requirementKeys.candidates(deliverableId ?? 'none'),
    enabled: Boolean(deliverableId),
    queryFn: async (): Promise<RequirementCandidate[]> => {
      // THIS deliverable's own tasks are always offerable. They are the commonest requirement
      // there is — one step of a film waiting on the step before it — and the first cut made them
      // conditional on a join returning this deliverable among its siblings, so when that join did
      // not, the picker silently offered every OTHER deliverable's tasks and none of its own.
      // Found by Edward on the 60-second hero film, 3 Sep. A union, not a replacement.
      const deliverableIds = new Set<string>([deliverableId!])

      // Then everything else in the same CAMPAIGN, which is what makes a cross-deliverable and
      // cross-department requirement pickable (d.1) — the Creative-to-Production hand-off is the
      // case this feature exists for. Ad-hoc work has no campaign and simply keeps its own.
      //
      // Two plain queries rather than one filtered embed: `deliverables?streams.campaign_id=eq.X`
      // reads as a join but fails as an EMPTY RESULT rather than an error when anything about the
      // relationship is not what it looks like, and an empty result here is indistinguishable from
      // "this campaign has no other deliverables" (traps.md — the PostgREST embed rule).
      const { data: self, error: selfErr } = await supabaseUntyped
        .from('deliverables')
        .select('stream_id, job_id')
        .eq('id', deliverableId!)
        .maybeSingle()
      if (selfErr) throw selfErr
      const selfRow = self as { stream_id: string | null; job_id: string | null } | null
      const streamId = selfRow?.stream_id ?? null
      const jobId = selfRow?.job_id ?? null

      // AD-HOC work has no campaign, so "the campaign's tasks" would offer nothing but itself —
      // and ad-hoc work waiting on a campaign task is an ordinary thing (a retouch that needs the
      // key visual signed off first). Scoped to the CLIENT instead: wide enough to be useful,
      // narrow enough that the picker is a list rather than a search problem.
      if (!streamId && jobId) {
        const { data: job, error: jobErr } = await supabaseUntyped
          .from('jobs')
          .select('client_id')
          .eq('id', jobId)
          .maybeSingle()
        if (jobErr) throw jobErr
        const clientId = (job as { client_id: string } | null)?.client_id ?? null

        if (clientId) {
          // That client's campaign work… Every page, and the id lists in batches (I59.35): one
          // client had 1,095 campaigns and 1,257 pieces locally on 25 Sep — past the server's
          // 1,000 rows, and far past what one request's address can carry (I49.75, the 414).
          const campaigns = await allRows<{ id: string }>((a, b) =>
            supabaseUntyped.from('campaigns').select('id').eq('client_id', clientId).order('id').range(a, b))
          const streams = await inChunksPaged<{ id: string }>(campaigns.map((c) => c.id), (chunk, a, b) =>
            supabaseUntyped.from('streams').select('id').in('campaign_id', chunk).order('id').range(a, b))
          const campDeliverables = await inChunksPaged<{ id: string }>(streams.map((r) => r.id), (chunk, a, b) =>
            supabaseUntyped.from('deliverables').select('id').in('stream_id', chunk).order('id').range(a, b))
          for (const d of campDeliverables) deliverableIds.add(d.id)

          // …and its other ad-hoc work, which hangs off jobs rather than streams.
          const jobs = await allRows<{ id: string }>((a, b) =>
            supabaseUntyped.from('jobs').select('id').eq('client_id', clientId).order('id').range(a, b))
          const jobDeliverables = await inChunksPaged<{ id: string }>(jobs.map((j) => j.id), (chunk, a, b) =>
            supabaseUntyped.from('deliverables').select('id').in('job_id', chunk).order('id').range(a, b))
          for (const d of jobDeliverables) deliverableIds.add(d.id)
        }
      }

      if (streamId) {
        const { data: stream, error: streamErr } = await supabaseUntyped
          .from('streams')
          .select('campaign_id')
          .eq('id', streamId)
          .maybeSingle()
        if (streamErr) throw streamErr
        const campaignId = (stream as { campaign_id: string } | null)?.campaign_id ?? null

        if (campaignId) {
          const { data: streams, error: streamsErr } = await supabaseUntyped
            .from('streams')
            .select('id')
            .eq('campaign_id', campaignId)
          if (streamsErr) throw streamsErr
          const streamIds = ((streams ?? []) as { id: string }[]).map((r) => r.id)

          if (streamIds.length > 0) {
            const { data: siblings, error: sibErr } = await supabaseUntyped
              .from('deliverables')
              .select('id')
              .in('stream_id', streamIds)
            if (sibErr) throw sibErr
            for (const d of (siblings ?? []) as { id: string }[]) deliverableIds.add(d.id)
          }
        }
      }

      // Batched and paged for the same reason; the batches are put back in the task list's order.
      const data = await inChunksPaged<{
        id: string; title: string; deliverable_id: string; sort_order: number | null
        deliverables: { name: string } | { name: string }[] | null
      }>([...deliverableIds], (chunk, a, b) =>
        supabaseUntyped
          .from('sub_tasks')
          .select('id, title, deliverable_id, sort_order, deliverables(name)')
          .in('deliverable_id', chunk)
          .neq('status', 'cancelled')
          .order('sort_order')
          .order('unit_index', { ascending: true, nullsFirst: true })
          .order('id')
          .range(a, b))
      const bySortOrder = (x: number | null) => x ?? Number.POSITIVE_INFINITY

      return [...data].sort((x, y) => bySortOrder(x.sort_order) - bySortOrder(y.sort_order) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)).map((t) => ({
        id: t.id,
        title: t.title,
        deliverableName: one(t.deliverables)?.name ?? '',
        sameDeliverable: t.deliverable_id === deliverableId,
      }))
    },
  })
}

/**
 * A circular pick is refused by `app.tg_sub_task_dep_no_cycle`, which raises `22023`. It is the
 * one dependency error a person routinely causes — B waits on A, then somebody makes A wait on B —
 * so it reads as a sentence rather than as a trigger name.
 */
export function isCyclicDependency(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '22023'
}

export function useAddDependency(deliverableId: string) {
  const qc = useQueryClient()
  const { claims } = useAuth()
  return useMutation({
    mutationFn: async (args: { subTaskId: string; prerequisiteId: string }) => {
      const { error } = await supabaseUntyped.from('sub_task_dependencies').insert({
        tenant_id: claims.tenantId,
        sub_task_id: args.subTaskId,
        depends_on_sub_task_id: args.prerequisiteId,
      })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: requirementKeys.deps(deliverableId) }),
  })
}

export function useRemoveDependency(deliverableId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabaseUntyped.from('sub_task_dependencies').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: requirementKeys.deps(deliverableId) }),
  })
}

// ---- external inputs (ADR-0069 d.7–d.9) ----

export interface PendingInput {
  id: string
  description: string
  awaitedFrom: string | null
  requestedAt: string
  satisfiedAt: string | null
}

export function usePendingInputs(deliverableId: string | null) {
  return useQuery({
    queryKey: requirementKeys.inputs(deliverableId ?? 'none'),
    enabled: Boolean(deliverableId),
    queryFn: async (): Promise<PendingInput[]> => {
      const { data, error } = await supabaseUntyped
        .from('deliverable_pending_inputs')
        .select('id, description, awaited_from, requested_at, satisfied_at')
        .eq('deliverable_id', deliverableId!)
        .order('requested_at')
      if (error) throw error
      return ((data ?? []) as {
        id: string; description: string; awaited_from: string | null
        requested_at: string; satisfied_at: string | null
      }[]).map((r) => ({
        id: r.id,
        description: r.description,
        awaitedFrom: r.awaited_from,
        requestedAt: r.requested_at,
        satisfiedAt: r.satisfied_at,
      }))
    },
  })
}

export function useAddPendingInput(deliverableId: string) {
  const qc = useQueryClient()
  const { claims, session } = useAuth()
  return useMutation({
    mutationFn: async (args: { description: string; awaitedFrom: string }) => {
      const { error } = await supabaseUntyped.from('deliverable_pending_inputs').insert({
        tenant_id: claims.tenantId,
        deliverable_id: deliverableId,
        // Mandatory by schema, and that is the point: ADR-0030 refused a vague "blocked".
        description: args.description.trim(),
        awaited_from: args.awaitedFrom.trim() || null,
        created_by: session?.user.id ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: requirementKeys.inputs(deliverableId) }),
  })
}

/**
 * Clearing one is an explicit act, stamped (d.9) — which is the whole reason *how long were we
 * waiting* becomes answerable. It is cleared ONCE: the database refuses un-ticking `satisfied_at`
 * (I59, settled by the coordinator: "a cleared block is not re-opened — raise a new one",
 * `20260926135000`), so there is no Reopen here — something awaited again is a new input.
 */
export function useMarkInputArrived(deliverableId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabaseUntyped
        .from('deliverable_pending_inputs')
        .update({ satisfied_at: new Date().toISOString() })
        .eq('id', id)
        .is('satisfied_at', null)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: requirementKeys.inputs(deliverableId) })
      // A cleared input can release a task, and the task table shows that.
      void qc.invalidateQueries({ queryKey: deliverableKeys.all })
    },
  })
}
