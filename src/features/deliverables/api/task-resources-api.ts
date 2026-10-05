import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase'
import { deliverableKeys } from './deliverables-api'

/**
 * The resources a TASK needs (ADR-0042) — the other direction from a booking, which is a booking
 * *of* a resource. Lives in this feature because `deliverables` owns sub-tasks; the schedule's
 * booking modal imports the component, not these hooks.
 *
 * Every write re-materialises the task's schedule. That is the whole point of the feature: adding
 * "this needs the RED camera" must actually book the camera, or the requirement is a note nobody
 * acts on. `subtask-schedule` returns a REPORT — what it placed, what is contested, what it could
 * not place — which the caller surfaces rather than swallowing (ADR-0042 d.6: a clash raises).
 */

export const taskResourceKeys = {
  all: ['task-resources'] as const,
  forTask: (subTaskId: string) => [...taskResourceKeys.all, subTaskId] as const,
}

export interface TaskResourceRow {
  id: string
  resourceId: string
  resourceName: string
  resourceKind: 'human' | 'equipment' | 'room'
  /** Total hours the resource is needed for — not the task's span (ADR-0042 d.3). */
  hours: number
  /** Pins the requirement to a date; null means the task's first booked day. */
  startsOn: string | null
  notes: string | null
}

/** What the scheduler managed to do with the requirements — surfaced, never swallowed. */
export interface RequirementReport {
  placed: number
  contested: string[]
  overCapacity: string[]
  unplaced: { resource: string; reason: string }[]
}

export function useTaskResources(subTaskId: string | null) {
  return useQuery({
    queryKey: taskResourceKeys.forTask(subTaskId ?? 'none'),
    enabled: subTaskId != null,
    queryFn: async (): Promise<TaskResourceRow[]> => {
      // The embed names its constraint. sub_task_resources → resources is a COMPOSITE foreign key,
      // and an embed PostgREST cannot resolve returns empty rather than erroring — which reads as
      // "no requirements" instead of "broken query". Twice bitten on this project.
      const { data, error } = await supabase
        .from('sub_task_resources')
        .select('id, resource_id, hours, starts_on, notes, resources!fk_sub_task_resources_resource(name, kind)')
        .eq('sub_task_id', subTaskId!)
        .order('created_at')
      if (error) throw error
      return (data ?? []).map((r) => {
        const res = r.resources as unknown as { name: string; kind: string } | null
        return {
          id: r.id,
          resourceId: r.resource_id,
          resourceName: res?.name ?? '—',
          resourceKind: (res?.kind ?? 'equipment') as TaskResourceRow['resourceKind'],
          hours: Number(r.hours),
          startsOn: r.starts_on,
          notes: r.notes,
        }
      })
    },
  })
}

/** Everything bookable in the tenant, for the picker. Active only — you cannot require a retired camera. */
export function useBookableResources() {
  return useQuery({
    queryKey: ['bookable-resources'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('resources')
        .select('id, name, kind, department_id')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return (data ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind as TaskResourceRow['resourceKind'],
      }))
    },
  })
}

/**
 * Re-materialise the task so a requirement change reaches the calendar.
 *
 * Best-effort by design: the requirement row is already committed and survives on its own (that is
 * why ADR-0042 modelled it rather than leaning on bookings). A failure here means the calendar is
 * behind, not that the requirement was lost — so it is reported, never thrown.
 */
export async function rescheduleTask(subTaskId: string): Promise<RequirementReport | null> {
  const { data, error } = await supabase.functions.invoke('subtask-schedule', {
    body: { subTaskId },
  })
  if (error) return null
  return ((data as { requirements?: RequirementReport } | null)?.requirements) ?? null
}

interface MutationResult {
  report: RequirementReport | null
}

function useRequirementMutation<TArgs>(
  subTaskId: string,
  run: (args: TArgs) => Promise<void>,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: TArgs): Promise<MutationResult> => {
      await run(args)
      return { report: await rescheduleTask(subTaskId) }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: taskResourceKeys.forTask(subTaskId) })
      // The task's bookings changed, so anything showing them is stale.
      void qc.invalidateQueries({ queryKey: deliverableKeys.all })
      void qc.invalidateQueries({ queryKey: ['schedule'] })
    },
  })
}

export function useAddTaskResource(subTaskId: string, tenantId: string | null) {
  return useRequirementMutation<{ resourceId: string; hours: number; startsOn: string | null }>(
    subTaskId,
    async (a) => {
      const { error } = await supabase.from('sub_task_resources').insert({
        tenant_id: tenantId!,
        sub_task_id: subTaskId,
        resource_id: a.resourceId,
        hours: a.hours,
        starts_on: a.startsOn,
      })
      if (error) throw error
    },
  )
}

export function useUpdateTaskResource(subTaskId: string) {
  return useRequirementMutation<{ id: string; hours: number; startsOn: string | null }>(
    subTaskId,
    async (a) => {
      const { error } = await supabase
        .from('sub_task_resources')
        .update({ hours: a.hours, starts_on: a.startsOn })
        .eq('id', a.id)
      if (error) throw error
    },
  )
}

export function useRemoveTaskResource(subTaskId: string) {
  return useRequirementMutation<{ id: string }>(subTaskId, async (a) => {
    const { error } = await supabase.from('sub_task_resources').delete().eq('id', a.id)
    if (error) throw error
  })
}

/**
 * Write several requirements at once, then place them — for the NEW-task flow, where the rows are
 * staged in the dialog before a `sub_task_id` exists to hang them on.
 *
 * Imperative rather than a hook because it runs inside the create dialog's existing submit
 * sequence, which already handles the hard case: the task RPC commits before scheduling, so a
 * failure here must never re-open submit. It reports and lets the task stand — pressing the button
 * again is what produced six duplicates of one task on 23 Aug.
 */
export async function addTaskResources(
  subTaskId: string,
  tenantId: string,
  rows: { resourceId: string; hours: number; startsOn: string | null }[],
): Promise<RequirementReport | null> {
  if (rows.length === 0) return null
  const { error } = await supabase.from('sub_task_resources').insert(
    rows.map((r) => ({
      tenant_id: tenantId,
      sub_task_id: subTaskId,
      resource_id: r.resourceId,
      hours: r.hours,
      starts_on: r.startsOn,
    })),
  )
  if (error) throw error
  return rescheduleTask(subTaskId)
}
