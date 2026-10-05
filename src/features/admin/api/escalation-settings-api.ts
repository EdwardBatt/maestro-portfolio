import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { useAuth } from '../../../app/auth-context'

/**
 * Admin → Organization → Escalations (ADR-0108 d.2 / d.3 / d.6 + addendum; I59.24, I59.20, I59.27).
 *
 * One row per stall in `tenant_escalation_rules` — the REAL-TIME hours before the sweep escalates, any
 * roles, and any people relative to the piece — plus two numbers on `tenant_reminder_settings`: the
 * over-capacity percentage (d.6) and the untimed-round threshold (ADR-0106). Written behind
 * `organization:manage` (RLS), exactly as the scheduling rules beside it. Presentation only: the sweep
 * reads these rows, this screen only edits them.
 */

/** The people the resolver can find from a piece (the table's own CHECK). */
export const RELATIVE_RECIPIENTS = ['owner', 'account_manager', 'owner_department_lead', 'assignee_team_lead', 'reviewers'] as const
export type RelativeRecipient = (typeof RELATIVE_RECIPIENTS)[number]

/**
 * The order the rows are shown in — the ADR's table, top to bottom. `campaign_brief` is the E8 split
 * (added by its own migration); a kind this list does not know is shown after these, never hidden.
 */
export const KIND_ORDER = [
  'unassigned',
  'task_list',
  'campaign_brief',
  'change_request',
  'extension_owner',
  'extension_am',
  'blocked',
  'review_remind',
  'review_escalate',
  // ADR-0133 d.5 (I70.6): a leaving person's work not all handed over.
  'handover',
  // ADR-0139 d.5 (I74): a booking asked of another team, unanswered.
  'task_request',
  // ADR-0141 d.3 (I74): a change asked of the account manager, unanswered.
  'deliverable_change',
] as const

export interface EscalationRule {
  id: string
  kind: string
  hours: number
  roleIds: string[]
  relative: RelativeRecipient[]
}

export interface EscalationTimings {
  overCapacityPct: number
  untimedThresholdMinutes: number
}

export const DEFAULT_TIMINGS: EscalationTimings = { overCapacityPct: 110, untimedThresholdMinutes: 15 }

export const escalationKeys = {
  all: ['escalation-settings'] as const,
  rules: () => [...escalationKeys.all, 'rules'] as const,
  timings: () => [...escalationKeys.all, 'timings'] as const,
  nobody: () => [...escalationKeys.all, 'reaching-nobody'] as const,
}

export function sortRules(rules: EscalationRule[]): EscalationRule[] {
  const rank = (k: string) => {
    const i = (KIND_ORDER as readonly string[]).indexOf(k)
    return i === -1 ? KIND_ORDER.length : i
  }
  return [...rules].sort((a, b) => rank(a.kind) - rank(b.kind) || a.kind.localeCompare(b.kind))
}

export function useEscalationRules() {
  return useQuery({
    queryKey: escalationKeys.rules(),
    queryFn: async (): Promise<EscalationRule[]> => {
      const { data, error } = await supabaseUntyped
        .from('tenant_escalation_rules')
        .select('id, kind, hours, role_ids, relative')
      if (error) throw error
      const rows = (data ?? []) as { id: string; kind: string; hours: number; role_ids: string[] | null; relative: string[] | null }[]
      return sortRules(
        rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          hours: r.hours,
          roleIds: r.role_ids ?? [],
          relative: (r.relative ?? []).filter((x): x is RelativeRecipient =>
            (RELATIVE_RECIPIENTS as readonly string[]).includes(x),
          ),
        })),
      )
    },
  })
}

export function useEscalationTimings() {
  return useQuery({
    queryKey: escalationKeys.timings(),
    queryFn: async (): Promise<EscalationTimings> => {
      const { data, error } = await supabaseUntyped
        .from('tenant_reminder_settings')
        .select('over_capacity_pct, untimed_threshold_minutes')
        .maybeSingle()
      if (error) throw error
      const r = data as { over_capacity_pct?: number; untimed_threshold_minutes?: number } | null
      return {
        overCapacityPct: r?.over_capacity_pct ?? DEFAULT_TIMINGS.overCapacityPct,
        untimedThresholdMinutes: r?.untimed_threshold_minutes ?? DEFAULT_TIMINGS.untimedThresholdMinutes,
      }
    },
  })
}

/**
 * The kinds whose recipients resolve to nobody (E9) — `public.escalation_rules_reaching_nobody()`.
 * Read defensively: the RPC is new, and a failure here must never break the page, so an error is
 * "nothing to warn about" rather than a thrown query. Accepts a list of kinds or of rows with `kind`.
 */
export function parseReachingNobody(data: unknown): string[] {
  if (!Array.isArray(data)) return []
  const out: string[] = []
  for (const row of data) {
    if (typeof row === 'string') out.push(row)
    else if (row && typeof row === 'object') {
      const k = (row as Record<string, unknown>).kind ?? (row as Record<string, unknown>).escalation_rules_reaching_nobody
      if (typeof k === 'string') out.push(k)
    }
  }
  return out
}

export function useEscalationsReachingNobody() {
  return useQuery({
    queryKey: escalationKeys.nobody(),
    retry: false,
    queryFn: async (): Promise<string[]> => {
      try {
        const { data, error } = await supabaseUntyped.rpc('escalation_rules_reaching_nobody')
        if (error) return []
        return parseReachingNobody(data)
      } catch {
        return []
      }
    },
  })
}

/** The rows that differ from what was loaded — only those are written. */
export function changedRules(before: readonly EscalationRule[], after: readonly EscalationRule[]): EscalationRule[] {
  const byId = new Map(before.map((r) => [r.id, r]))
  const same = (a: readonly string[], b: readonly string[]) => {
    if (a.length !== b.length) return false
    const sb = [...b].sort()
    return [...a].sort().every((x, i) => x === sb[i])
  }
  return after.filter((r) => {
    const b = byId.get(r.id)
    return !b || b.hours !== r.hours || !same(b.roleIds, r.roleIds) || !same(b.relative, r.relative)
  })
}

export function useSaveEscalationSettings() {
  const qc = useQueryClient()
  const { claims } = useAuth()
  return useMutation({
    mutationFn: async (args: { rules: EscalationRule[]; timings: EscalationTimings | null }) => {
      const refused = () =>
        Object.assign(new Error('changing the escalation settings requires organization:manage'), { code: '42501' })
      for (const r of args.rules) {
        const { data, error } = await supabaseUntyped
          .from('tenant_escalation_rules')
          .update({ hours: r.hours, role_ids: r.roleIds, relative: r.relative })
          .eq('id', r.id)
          .select('id')
        if (error) throw error
        // RLS filters the row for somebody without organization:manage — zero rows IS the refusal.
        if (!data || (data as unknown[]).length === 0) throw refused()
      }
      if (args.timings) {
        const { data, error } = await supabaseUntyped
          .from('tenant_reminder_settings')
          .update({
            over_capacity_pct: args.timings.overCapacityPct,
            untimed_threshold_minutes: args.timings.untimedThresholdMinutes,
          })
          .eq('tenant_id', claims.tenantId)
          .select('tenant_id')
        if (error) throw error
        if (!data || (data as unknown[]).length === 0) throw refused()
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: escalationKeys.all }),
  })
}
