import { fetchLeavingIds } from '../../../lib/people/leaving'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { deliverableKeys } from '../../deliverables/api/deliverables-api'
import {
  WORKSTREAM_OWNER_ROLES,
  type WorkstreamOwnerCandidate,
  type WorkstreamOwnerRole,
} from '../../../lib/campaigns/workstream-owners'

/**
 * A campaign's workstreams (ADR-0099, `I56.3`).
 *
 * Grouping is **optional** — a campaign may have none and a deliverable may belong to none — so
 * every read here tolerates an empty list and no caller treats "no groups" as a failure or as a
 * step on the way to something.
 *
 * Writes all go through the RPCs (`20260923210000`), never a direct table write, because each one
 * carries a rule a policy cannot express: a group's department moves the work in it, a move takes
 * the unassigned tasks along, and removing a group that still holds work is refused with the count.
 */
export const workstreamKeys = {
  all: ['workstreams'] as const,
  byCampaign: (campaignId: string) => [...workstreamKeys.all, campaignId] as const,
}

export interface Workstream {
  id: string
  name: string
  departmentId: string
  departmentName: string | null
  ownerUserId: string | null
  ownerName: string | null
  /** How many deliverables sit in it — what the refusal to delete counts, shown before they try. */
  deliverableCount: number
}

export function useWorkstreams(campaignId: string | null) {
  return useQuery({
    queryKey: workstreamKeys.byCampaign(campaignId ?? 'none'),
    enabled: !!campaignId,
    queryFn: async (): Promise<Workstream[]> => {
      const { data, error } = await supabaseUntyped
        .from('workstreams')
        .select(
          // Both embeds name their column, not their constraint: `workstreams` has exactly one FK
          // to each, so neither is ambiguous — unlike `deliverables` → `user_profiles`, which has
          // two and answers an unnamed embed with an EMPTY result rather than an error (traps.md).
          'id, name, department_id, owner_user_id, departments(name), ' +
            'owner:user_profiles(display_name), deliverables(id)',
        )
        .eq('campaign_id', campaignId!)
        .order('name')
      if (error) throw error
      return ((data ?? []) as unknown as Record<string, unknown>[]).map((w) => {
        const dept = w.departments as { name: string } | { name: string }[] | null
        const owner = w.owner as { display_name: string } | { display_name: string }[] | null
        const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)
        return {
          id: w.id as string,
          name: w.name as string,
          departmentId: w.department_id as string,
          departmentName: one(dept)?.name ?? null,
          ownerUserId: (w.owner_user_id as string | null) ?? null,
          ownerName: one(owner)?.display_name ?? null,
          deliverableCount: Array.isArray(w.deliverables) ? w.deliverables.length : 0,
        }
      })
    },
  })
}

export interface SaveWorkstreamArgs {
  campaignId: string
  name: string
  departmentId: string
  ownerUserId?: string | null
  /** Omitted makes a new one; an id renames and re-owns that one. */
  workstreamId?: string | null
  /** I59.54: typed letters when MAKING one; null for the rule's. Ignored on a rename. */
  codeLetters?: string | null
}

export function useSaveWorkstream() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: SaveWorkstreamArgs): Promise<string> => {
      const { data, error } = await supabaseUntyped.rpc('save_workstream', {
        p_campaign: args.campaignId,
        p_name: args.name,
        p_department: args.departmentId,
        p_owner: args.ownerUserId ?? null,
        p_workstream: args.workstreamId ?? null,
        p_code_letters: args.codeLetters ?? null,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workstreamKeys.all })
      // Renaming a group can move its work between departments, so the deliverables have to be
      // re-read too — otherwise the page shows the new group and the old departments.
      void qc.invalidateQueries({ queryKey: deliverableKeys.all })
    },
  })
}

export function useMoveDeliverableToWorkstream() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { deliverableId: string; workstreamId: string | null }) => {
      const { error } = await supabaseUntyped.rpc('move_deliverable_to_workstream', {
        p_deliverable: args.deliverableId,
        p_workstream: args.workstreamId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workstreamKeys.all })
      void qc.invalidateQueries({ queryKey: deliverableKeys.all })
    },
  })
}

export function useRemoveWorkstream() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (workstreamId: string) => {
      const { error } = await supabaseUntyped.rpc('remove_workstream', { p_workstream: workstreamId })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workstreamKeys.all })
      void qc.invalidateQueries({ queryKey: deliverableKeys.all })
    },
  })
}

/**
 * Who may own a workstream (ADR-0101 d.8): active department leads, team leads and deputy team
 * leads — the same three roles `app.tg_workstream_owner_is_a_lead` accepts, so the picker never
 * offers somebody the save would refuse. Ordering by department is the caller's: it depends on
 * which group the picker is for.
 */
export function useWorkstreamOwnerCandidates() {
  return useQuery({
    queryKey: [...workstreamKeys.all, 'owner-candidates'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<WorkstreamOwnerCandidate[]> => {
      const leaving = await fetchLeavingIds()   // ADR-0133 d.1: nobody Leaving is offered for new work.
      const { data, error } = await supabaseUntyped
        .from('user_profiles')
        // `!inner` is load-bearing: without it the embed is a LEFT join and everybody comes back.
        .select('id, display_name, department_id, roles!inner(key)')
        .eq('is_active', true)
        .in('roles.key', [...WORKSTREAM_OWNER_ROLES])
        .order('display_name')
      if (error) throw error
      return (
        (data ?? []) as {
          id: string
          display_name: string
          department_id: string | null
          roles: { key: string } | { key: string }[] | null
        }[]
      ).filter((u) => !leaving.has(u.id)).map((u) => ({
        id: u.id,
        name: u.display_name,
        departmentId: u.department_id,
        role: ((Array.isArray(u.roles) ? u.roles[0] : u.roles)?.key ?? 'team_lead') as WorkstreamOwnerRole,
      }))
    },
  })
}
