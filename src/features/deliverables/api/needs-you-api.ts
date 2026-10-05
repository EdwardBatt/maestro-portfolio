import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { allRows } from '../../../lib/query/all-pages'
import { deliverableKeys } from './deliverables-api'
import type { UnassignedPiece } from '../lib/needs-you'

/**
 * The reads behind "Needs you" that no other panel already makes (I59.10). One query per source
 * (ADR-0105 Consequences); the shapes and the grouping are in `lib/needs-you.ts`.
 *
 * Sources already read elsewhere and reused as they are: `usePendingApprovals` (the six approval
 * kinds), `useAwaitingMyReview` (reviews), `useMyAssignedWork` (changes came back, new on you).
 */

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

/** Closed pieces are nobody's to assign. */
const CLOSED = ['approved', 'delivered', 'archived']
/** Tasks that still need somebody. */
const OPEN_TASK = (status: string) => status !== 'cancelled' && status !== 'done'

interface PieceRaw {
  id: string
  name: string
  state: string
  department_id: string | null
  tasks_approved_at: string | null
  departments: { name: string } | { name: string }[] | null
  streams: { campaign_id: string | null; campaigns: { name: string } | { name: string }[] | null } | null
  sub_tasks: { id: string; assignee_id: string | null; status: string; due_at: string | null; created_at: string | null }[] | null
}

/**
 * "Assign" (ADR-0105 d.2, Q3): the deliverables I OWN that still have a task with nobody on it —
 * the owner approves the task list and assigns (ADR-0100), so it is in the owner's list only.
 *
 * Offered only where the Schedule would accept the assignment: each campaign's
 * `assignable_deliverables` (ADR-0090 d.3a) — the same function the picker and the gate read — so a
 * held piece is absent here too, rather than an Assign that the Schedule then refuses.
 */
export function useUnassignedPiecesIOwn(userId: string | null) {
  return useQuery({
    queryKey: [...deliverableKeys.all, 'unassigned-i-own', userId ?? 'none'] as const,
    enabled: !!userId,
    refetchOnWindowFocus: true,
    refetchInterval: 20_000,
    queryFn: async (): Promise<UnassignedPiece[]> => {
      // Every page (I59.35): one owner held 1,015 pieces locally on 25 Sep.
      const data = await allRows((a, b) =>
        supabaseUntyped
          .from('deliverables')
          .select(
            'id, name, state, department_id, tasks_approved_at, departments(name), ' +
              'streams(campaign_id, campaigns(name)), sub_tasks(id, assignee_id, status, due_at, created_at)',
          )
          .eq('owner_user_id', userId!)
          .order('id')
          .range(a, b))
      const pieces = (data as unknown as PieceRaw[])
        .filter((p) => !CLOSED.includes(p.state))
        .map((p) => ({ p, open: (p.sub_tasks ?? []).filter((t) => t.assignee_id == null && OPEN_TASK(t.status)) }))
        .filter(({ p, open }) => open.length > 0 && p.streams?.campaign_id)

      const campaigns = [...new Set(pieces.map(({ p }) => p.streams!.campaign_id!))]
      const assignable = new Set<string>()
      for (const c of campaigns) {
        const { data: rows, error: e } = await supabaseUntyped.rpc('assignable_deliverables', { p_campaign: c })
        if (e) throw e
        for (const r of (rows ?? []) as { id: string }[]) assignable.add(r.id)
      }

      return pieces
        .filter(({ p }) => assignable.has(p.id))
        .map(({ p, open }) => {
          const dues = open.map((t) => t.due_at).filter((d): d is string => !!d).sort()
          const created = open.map((t) => t.created_at).filter((d): d is string => !!d).sort()
          return {
            deliverableId: p.id,
            name: p.name,
            campaignId: p.streams!.campaign_id!,
            campaignName: one(p.streams?.campaigns)?.name ?? null,
            departmentId: p.department_id,
            department: one(p.departments)?.name ?? null,
            unassignedCount: open.length,
            since: p.tasks_approved_at ?? created[0] ?? null,
            dueAt: dues[0] ?? null,
          }
        })
    },
  })
}
