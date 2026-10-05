import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { fetchUserNames } from '../../../lib/users/user-names'
import type { BriefTemplateField } from '../../admin/api/brief-templates-api'

/**
 * One campaign, whole (ADR-0048 d.9, I16.6, as corrected by ADR-0050).
 *
 * The campaign page is the single place a campaign is read and approved: the master brief, the
 * per-DEPARTMENT briefs, and the deliverables under each. Before ADR-0048 there was nowhere to
 * see a campaign as one thing — `/deliverables` showed a filtered list and nothing else.
 *
 * **This query was broken from 27 Aug until 28 Aug and the page never rendered.** It asked for
 * `streams.brief` and `work_types.brief_type`; neither column has ever existed. ADR-0048 d.5 put a
 * brief on the stream and a brief type on the work type, ADR-0050 replaced both with
 * `campaign_briefs (campaign_id, department_id, brief_type, values)`, the migration shipped, and
 * this file was never moved across. PostgREST rejected the whole select with 42703, `useCampaignDetail`
 * threw, and `CampaignPage` fell through to its "not found" branch — so the approval gate had no
 * reachable UI. Nothing caught it: there is no CampaignPage test, and no campaign existed to open.
 *
 * The lesson worth keeping: a query string is not type-checked. `supabaseUntyped` means PostgREST
 * is the only thing that will ever tell you a column is missing, and it tells you at runtime.
 */

/** One department's brief on this campaign (ADR-0050 d.4: one brief per department, not per deliverable). */
export interface DepartmentBrief {
  id: string
  departmentId: string
  departmentName: string
  briefType: string | null
  /** key → value, as generated and then edited. Empty until `generate-brief` is wired (I16.4). */
  values: Record<string, string>
  /** ADR-0070 d.1: when the department accepted it. Null is unapproved, and its work is gated. */
  approvedAt: string | null
  /** Who accepted it. The page names them, because "approved" without a name answers nothing. */
  approvedByName: string | null
}

export interface CampaignDetail {
  id: string
  name: string
  status: 'draft' | 'pending_approval' | 'approved' | 'closed'
  /** ADR-0086 d.8: a single job is a campaign row. The page shows the job's brief on the department
   *  tab and points the owner at the deliverable, rather than a (empty) campaign-level master brief. */
  kind: 'single_job' | 'campaign'
  clientId: string
  clientName: string
  brandName: string | null
  accountManagerId: string | null
  /** ADR-0048 d.9: who to chase, by name. Null when nobody is set at either level. */
  accountManagerName: string | null
  clientAccountManagerName: string | null
  /** I51.1: provenance, from `created_by` / `updated_by`. */
  createdAt: string | null
  updatedAt: string | null
  createdByName: string | null
  updatedByName: string | null
  /** The CLIENT's account manager. `app.approve_campaign` approves on
   *  `coalesce(campaigns.account_manager_id, clients.account_manager_id)`, so a surface that
   *  reads only the campaign's is stricter than the rule it is enforcing — and hides the
   *  button from the person actually allowed to press it (Edward, 29 Aug). */
  clientAccountManagerId: string | null
  approvedAt: string | null
  /** The client's go-live. ADR-0088 d.7: a deadline after it is refused; the arithmetic reads it. */
  goLiveAt: string | null
  /** ADR-0117: the languages it is made in (codes); empty when none were set. */
  languages?: string[]
  /** ADR-0096 d.1: whether this campaign runs in phases. Always false for a single job. */
  hasPhases: boolean
  briefType: string | null
  /** The master brief as authored in the wizard. */
  brief: Record<string, string>
  /** ADR-0104 d.2: a promoted job's own words and brief, kept under the campaign brief — what
   *  "Generate the campaign brief" reads. Null on a campaign that was never a single job. */
  promotedJob: { words: string | null; values: Record<string, string> } | null
  /** Only the departments that HAVE a brief. The page renders a section per department that has
   *  deliverables, and looks a brief up here — so a department with work and no brief yet still
   *  gets a section saying so, rather than disappearing. */
  briefs: DepartmentBrief[]
}

export const campaignDetailKeys = {
  detail: (id: string) => ['campaign-detail', id] as const,
  phases: (id: string) => ['campaign-phases', id] as const,
}

/** ADR-0096 d.2: one phase of a campaign — numbered in order, named, dated start and end. */
export interface CampaignPhase {
  id: string
  number: number
  name: string
  /** ISO day, `YYYY-MM-DD`. */
  startsOn: string
  endsOn: string
}

/**
 * The campaign's phases, in number order. Empty for a campaign whose phases are off. Read on
 * focus and on the clock like the deliverables (I52.9's class): a phase added in another tab is
 * a column heading here.
 */
export function useCampaignPhases(campaignId: string | null) {
  return useQuery({
    queryKey: campaignDetailKeys.phases(campaignId ?? ''),
    enabled: Boolean(campaignId),
    refetchOnWindowFocus: true,
    refetchInterval: 20_000,
    queryFn: async (): Promise<CampaignPhase[]> => {
      const { data, error } = await supabaseUntyped
        .from('campaign_phases')
        .select('id, number, name, starts_on, ends_on')
        .eq('campaign_id', campaignId!)
        .order('number')
      if (error) throw error
      return ((data ?? []) as Record<string, any>[]).map((r) => ({
        id: r.id, number: r.number, name: r.name, startsOn: r.starts_on, endsOn: r.ends_on,
      }))
    },
  })
}

function invalidatePhases(qc: ReturnType<typeof useQueryClient>, campaignId: string) {
  void qc.invalidateQueries({ queryKey: campaignDetailKeys.phases(campaignId) })
  void qc.invalidateQueries({ queryKey: campaignDetailKeys.detail(campaignId) })
  void qc.invalidateQueries({ queryKey: ['deliverables'] })
}

/** ADR-0096 d.5: turn phases on (one phase holding everything) or off (refused while several hold work). */
export function useSetCampaignPhases() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { campaignId: string; enabled: boolean }) => {
      const { error } = await supabaseUntyped.rpc('set_campaign_phases', { p_campaign: a.campaignId, p_enabled: a.enabled })
      if (error) throw error
    },
    onSuccess: (_d, v) => invalidatePhases(qc, v.campaignId),
  })
}

/** ADR-0096 d.2/d.6: add a phase (no id) at the next number, or rename / re-date one. */
export function useSaveCampaignPhase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { campaignId: string; phaseId: string | null; name: string; startsOn: string; endsOn: string }): Promise<string> => {
      const { data, error } = await supabaseUntyped.rpc('save_campaign_phase', {
        p_campaign: a.campaignId, p_phase: a.phaseId, p_name: a.name, p_starts_on: a.startsOn, p_ends_on: a.endsOn,
      })
      if (error) throw error
      return data as unknown as string
    },
    onSuccess: (_d, v) => invalidatePhases(qc, v.campaignId),
  })
}

/** ADR-0096 d.6: delete an EMPTY phase; the ones after it renumber down. */
export function useDeleteCampaignPhase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { campaignId: string; phaseId: string }) => {
      const { error } = await supabaseUntyped.rpc('delete_campaign_phase', { p_phase: a.phaseId })
      if (error) throw error
    },
    onSuccess: (_d, v) => invalidatePhases(qc, v.campaignId),
  })
}

/** ADR-0096 d.4: move a deliverable into another phase of its campaign. */
export function useMoveDeliverableToPhase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { campaignId: string; deliverableId: string; phaseId: string }) => {
      const { error } = await supabaseUntyped.rpc('move_deliverable_to_phase', { p_deliverable: a.deliverableId, p_phase: a.phaseId })
      if (error) throw error
    },
    onSuccess: (_d, v) => invalidatePhases(qc, v.campaignId),
  })
}

/** PostgREST types a to-one embed as an array; `maybeSingle()` returns the object. The two
 *  disagree, so every read of one goes through here rather than guessing. */
const one = (v: any): any => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

function asStringMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out[k] = v
  }
  return out
}

export function useCampaignDetail(campaignId: string | null) {
  return useQuery({
    queryKey: campaignDetailKeys.detail(campaignId ?? ''),
    enabled: Boolean(campaignId),
    queryFn: async (): Promise<CampaignDetail | null> => {
      const { data, error } = await supabaseUntyped
        .from('campaigns')
        .select(
          // ADR-0048 d.9: the page must NAME the approver. It had the id and no name, so the
          // best it could say was "the account manager" — useless to somebody trying to find out
          // who to chase. Both embeds are needed because the approver is
          // coalesce(campaign, client) and either one can be the answer.
          // I51.1: `created_by` / `updated_by` are read as ids and named in a second flat read —
          // they carry no foreign key, so they cannot be embedded (see lib/users/user-names.ts).
          'id, name, status, kind, client_id, brief, account_manager_id, approved_at, go_live_at, has_phases, languages, created_at, updated_at, created_by, updated_by, ' +
            'account_manager:user_profiles!campaigns_account_manager_id_fkey(display_name), ' +
            'clients(name, account_manager_id, account_manager:user_profiles!clients_account_manager_id_fkey(display_name)), ' +
            'brands(name), ' +
            'campaign_briefs(id, department_id, brief_type, values, approved_at, ' +
            // `campaign_briefs` has ONE fk to user_profiles, so this embed is unambiguous —
            // unlike `deliverables`, where an unnamed one returns EMPTY rather than erroring.
            'departments(name), approver:user_profiles(display_name))',
        )
        .eq('id', campaignId!)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const r = data as Record<string, any>
      const brief = (r.brief ?? {}) as Record<string, unknown>
      const who = await fetchUserNames([r.created_by, r.updated_by])
      return {
        id: r.id,
        name: r.name,
        status: r.status,
        kind: r.kind === 'single_job' ? 'single_job' : 'campaign',
        clientId: r.client_id,
        clientName: r.clients?.name ?? '',
        brandName: r.brands?.name ?? null,
        accountManagerId: r.account_manager_id ?? null,
        clientAccountManagerId:
          (Array.isArray(r.clients) ? r.clients[0] : r.clients)?.account_manager_id ?? null,
        accountManagerName: one(r.account_manager)?.display_name ?? null,
        clientAccountManagerName:
          one(one(r.clients)?.account_manager)?.display_name ?? null,
        approvedAt: r.approved_at ?? null,
        goLiveAt: r.go_live_at ?? null,
        // ADR-0117: the languages the campaign is made in — every deliverable starts with them (addendum, Q18).
        languages: Array.isArray(r.languages) ? (r.languages as string[]) : [],
        hasPhases: r.has_phases === true,
        createdAt: r.created_at ?? null,
        updatedAt: r.updated_at ?? null,
        createdByName: (r.created_by && who.get(r.created_by)) || null,
        updatedByName: (r.updated_by && who.get(r.updated_by)) || null,
        briefType: typeof brief.briefType === 'string' ? brief.briefType : null,
        brief: asStringMap(brief),
        promotedJob: brief.promotedJobBrief && typeof brief.promotedJobBrief === 'object'
          ? {
              words: (() => {
                const w = (brief.request as { words?: unknown } | undefined)?.words
                return typeof w === 'string' && w.trim() ? w : null
              })(),
              values: asStringMap((brief.promotedJobBrief as Record<string, unknown>).values),
            }
          : null,
        briefs: (r.campaign_briefs ?? []).map((b: Record<string, any>) => ({
          id: b.id,
          departmentId: b.department_id,
          departmentName: b.departments?.name ?? '',
          briefType: b.brief_type ?? null,
          values: asStringMap(b.values),
          approvedAt: b.approved_at ?? null,
          approvedByName: b.approver?.display_name ?? null,
        })),
      }
    },
  })
}

/** The field list for a brief type, so a generated brief renders with its real labels. */
export function useBriefTemplateFields(briefTypes: string[]) {
  const key = [...new Set(briefTypes)].sort().join(',')
  return useQuery({
    queryKey: ['brief-template-fields', key] as const,
    enabled: key.length > 0,
    queryFn: async (): Promise<Record<string, BriefTemplateField[]>> => {
      const { data, error } = await supabaseUntyped
        .from('brief_templates')
        .select('brief_type, fields')
        .in('brief_type', key.split(','))
      if (error) throw error
      const out: Record<string, BriefTemplateField[]> = {}
      for (const r of (data ?? []) as Record<string, any>[]) {
        out[r.brief_type] = Array.isArray(r.fields) ? r.fields : []
      }
      return out
    },
  })
}

/**
 * Approve the campaign (ADR-0048 d.9/d.10).
 *
 * There is no changes-requested counterpart, deliberately: the account manager edits in place
 * and approves. The person with the authority to approve is the person correcting it, so
 * sending it back would only add a hop.
 */
/** I52.17: change a campaign's account manager on its page. The trigger decides who may
 *  (`app.tg_campaign_account_manager_guard`); the person named must be eligible. */
/** I52.20: add a deliverable to an existing campaign or job, under the approval authority. */
export function useAddCampaignDeliverable() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: {
      campaignId: string; name: string; ownerUserId: string; deliverableTypeId: string | null; quantity: number
      dueAt: string | null
      dueDateOverride: { severity: string; workingDaysLeft: number; requiredDays: number; boundary?: 'go_live' | 'phase_end' } | null
      /** ADR-0096 d.8: required when the campaign runs in phases. */
      phaseId: string | null
      /** ADR-0116 d.3: required on a campaign — the workstream the piece goes into. */
      workstreamId?: string | null
    }): Promise<string> => {
      const { data, error } = await supabaseUntyped.rpc('add_campaign_deliverable', {
        p_campaign: a.campaignId, p_name: a.name, p_owner: a.ownerUserId, p_type: a.deliverableTypeId,
        p_quantity: a.quantity, p_due_at: a.dueAt, p_due_override: a.dueDateOverride, p_phase: a.phaseId,
        p_workstream: a.workstreamId ?? null,
      })
      if (error) throw error
      return data as unknown as string
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: campaignDetailKeys.detail(v.campaignId) })
      void qc.invalidateQueries({ queryKey: ['deliverables'] })
      void qc.invalidateQueries({ queryKey: ['campaigns'] })
    },
  })
}

/** I52.21: a deliverable's name, type and quantity. The trigger decides who may; setting a type
 *  where there was none materialises the task list (ADR-0052). */
export function useUpdateCampaignDeliverable() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { campaignId: string; deliverableId: string; name: string; deliverableTypeId: string | null; quantity: number }) => {
      const { error } = await supabaseUntyped.rpc('update_campaign_deliverable', {
        p_deliverable: a.deliverableId, p_name: a.name, p_type: a.deliverableTypeId, p_quantity: a.quantity,
      })
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: campaignDetailKeys.detail(v.campaignId) })
      void qc.invalidateQueries({ queryKey: ['deliverables'] })
    },
  })
}

/** I68.2 / ADR-0132 d.2: a deliverable's channel, languages and brief lines — `update_piece_details`. ADR-0117 addendum
 *  (Q18, 4 Oct): the languages are the deliverable's own list — any of the tenant's, at least one; its translation
 *  task follows them (Q20, in the database). */
export function useUpdatePieceDetails() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { campaignId: string; deliverableId: string; channel: string; languages: string[]; notes: string }) => {
      const { error } = await supabaseUntyped.rpc('update_piece_details', {
        p_deliverable: a.deliverableId, p_channel: a.channel, p_languages: a.languages, p_notes: a.notes,
      })
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: campaignDetailKeys.detail(v.campaignId) })
      void qc.invalidateQueries({ queryKey: ['deliverables'] })
    },
  })
}

export function useSetCampaignAccountManager() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ campaignId, userId }: { campaignId: string; userId: string | null }) => {
      const { error } = await supabaseUntyped.rpc('set_campaign_account_manager', { p_campaign: campaignId, p_user: userId })
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: campaignDetailKeys.detail(v.campaignId) })
      void qc.invalidateQueries({ queryKey: ['campaigns'] })
      void qc.invalidateQueries({ queryKey: ['campaign-detail'] })
    },
  })
}

/** I53.4: rewrite a released campaign's master brief on its page. The trigger decides who may. */
export function useUpdateCampaignBrief() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { campaignId: string; brief: Record<string, unknown> }) => {
      const { error } = await supabaseUntyped.rpc('update_campaign_brief', { p_campaign: a.campaignId, p_brief: a.brief })
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: campaignDetailKeys.detail(v.campaignId) })
      void qc.invalidateQueries({ queryKey: ['campaigns'] })
    },
  })
}

/** ADR-0137 (I73.2): rename a live campaign or single job. The guard decides who; ADR-0135 refuses a look-alike. */
export function useRenameCampaign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { campaignId: string; name: string }) => {
      const { data, error } = await supabaseUntyped.rpc('rename_campaign', { p_campaign: a.campaignId, p_name: a.name })
      if (error) throw error
      return data as string
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: campaignDetailKeys.detail(v.campaignId) })
      void qc.invalidateQueries({ queryKey: ['campaigns'] })
      // The campaign's Library folder follows its name.
      void qc.invalidateQueries({ queryKey: ['library'] })
    },
  })
}

/** ADR-0104 d.3: a released single job's brief, corrected by hand by the campaign's approval authority. */
export function useUpdateSingleJobBrief() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { campaignId: string; values: Record<string, string> }) => {
      const { error } = await supabaseUntyped.rpc('update_single_job_brief', { p_campaign: a.campaignId, p_values: a.values })
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: campaignDetailKeys.detail(v.campaignId) })
    },
  })
}

export function useApproveCampaign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (campaignId: string) => {
      const { error } = await supabaseUntyped.rpc('approve_campaign', { p_campaign: campaignId })
      if (error) throw error
    },
    onSuccess: (_d, campaignId) =>
      void qc.invalidateQueries({ queryKey: campaignDetailKeys.detail(campaignId) }),
  })
}
