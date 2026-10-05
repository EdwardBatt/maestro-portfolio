import { fetchLeavingIds } from '../../../lib/people/leaving'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabaseUntyped } from '../../../lib/supabase'
import { allRows } from '../../../lib/query/all-pages'
import { useAuth } from '../../../app/auth-context'
import { useInvalidateFolders } from '../../../lib/assets/folders'
import { SINGLE_EXECUTION } from '../../../lib/brief/single-execution'
import type { TemplateField } from '../lib/single-job'
import { BriefIngestRefusedError, BriefTooLongError } from '../../campaigns/api/brief-ingest-api'
import { MAX_BRIEF_CHARS, tidyFieldValue } from '../../../lib/brief/fields'
import { normalizeRules, type ClientRule } from '../../../lib/brief/rules'

/**
 * The single-job flow's reads and writes (ADR-0082–0086, ADR-0090; I44).
 *
 * A single job is a campaign row (ADR-0083 d.3), so most of what the flow touches already has an
 * api in `features/campaigns` — the receipt, the filing, the wizard's reference data, the draft
 * update — and this file holds only what is NEW to the flow: the kind-aware draft, the release,
 * the single-execution brief, ingestion against that template, the duplicate check, attaching,
 * promotion, and who leads a department.
 *
 * **Two columns arrive from the database half of I44** — `campaigns.kind` (ADR-0086 d.8) and
 * `deliverables.tasks_approved_at` (ADR-0090 d.2). They are read through `*` rather than by name
 * here, and every mapper treats their absence as the pre-migration answer (`campaign`, not yet
 * approved), so nothing on this branch changes behaviour until that migration lands. The static
 * select guard (`src/test/postgrest-selects.test.ts`) is the reason for `*`: it fails a named
 * column no migration on the branch declares. Narrow these back once the types regenerate.
 */

export const intakeKeys = {
  all: ['intake'] as const,
  leads: () => [...intakeKeys.all, 'department-leads'] as const,
  teamLeads: () => [...intakeKeys.all, 'team-leads'] as const,
  template: () => [...intakeKeys.all, 'template', SINGLE_EXECUTION] as const,
  briefUsage: (clientId: string) => [...intakeKeys.all, 'brief-usage', clientId] as const,
  clientRules: (clientId: string) => [...intakeKeys.all, 'client-rules', clientId] as const,
  kinds: () => [...intakeKeys.all, 'campaign-kinds'] as const,
  job: (id: string) => [...intakeKeys.all, 'job', id] as const,
  brief: (id: string) => [...intakeKeys.all, 'brief', id] as const,
}

export type CampaignKind = 'single_job' | 'campaign'

// ---- Department leads (ADR-0083 d.8/d.9) ----

export interface DepartmentLead {
  id: string
  name: string
  departmentId: string
  teamId: string | null
}

/**
 * Who leads each department: an active person whose ROLE reaches the department
 * (`roles.scope = 'department'`, ADR-0009/0041). Read from the scope model, never from a role's
 * name — the same rule `department_brief_approvers` follows on the server. A department may have
 * more than one; the screen offers the first and says who else could hold it.
 */
export function useDepartmentLeads() {
  return useQuery({
    queryKey: intakeKeys.leads(),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<DepartmentLead[]> => {
      const leaving = await fetchLeavingIds()   // ADR-0133 d.1: nobody Leaving is offered for new work.
      const { data, error } = await supabaseUntyped
        .from('user_profiles')
        .select('id, display_name, department_id, team_id, roles!inner(scope)')
        .eq('is_active', true)
        .eq('roles.scope', 'department')
        .order('display_name')
      if (error) throw error
      return ((data ?? []) as { id: string; display_name: string; department_id: string | null; team_id: string | null }[])
        .filter((u) => u.department_id && !leaving.has(u.id))
        .map((u) => ({ id: u.id, name: u.display_name, departmentId: u.department_id!, teamId: u.team_id }))
    },
  })
}

/**
 * The team leads of each department (`roles.scope = 'team'`, ADR-0083 d.12), read the same way as
 * the department leads above — from the scope model, never a role name. Used where a department has
 * NO lead: the account manager names a team lead as the deliverable's owner instead of releasing it
 * ownerless (ADR-0083 d.11/d.12). `team_id` carries their team; a department's team leads are the
 * ones whose profile department is it.
 */
export function useTeamLeads() {
  return useQuery({
    queryKey: intakeKeys.teamLeads(),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<DepartmentLead[]> => {
      const leaving = await fetchLeavingIds()   // ADR-0133 d.1: nobody Leaving is offered for new work.
      const { data, error } = await supabaseUntyped
        .from('user_profiles')
        .select('id, display_name, department_id, team_id, roles!inner(scope)')
        .eq('is_active', true)
        .eq('roles.scope', 'team')
        .order('display_name')
      if (error) throw error
      return ((data ?? []) as { id: string; display_name: string; department_id: string | null; team_id: string | null }[])
        .filter((u) => u.department_id && !leaving.has(u.id))
        .map((u) => ({ id: u.id, name: u.display_name, departmentId: u.department_id!, teamId: u.team_id }))
    },
  })
}

// ---- Which briefs this client has had before (SJ-v3-01, 22 Sep) ----

/** Per brief type: how many briefs this client's campaigns hold, and the newest campaign's name. */
export interface BriefUsage {
  count: number
  lastCampaign: string
}

/**
 * The foot line on each brief card — "LUMA Season 2 · 3 briefs" — read from the client's own
 * campaign briefs. A job for a client who has never had that kind of brief says so; nothing is
 * invented from the department or the deck.
 */
export function useClientBriefUsage(clientId: string | null) {
  return useQuery({
    queryKey: intakeKeys.briefUsage(clientId ?? ''),
    enabled: Boolean(clientId),
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, BriefUsage>> => {
      // Every page (I59.35): one client already has 793 briefs locally.
      const data = await allRows<{ brief_type: string; campaigns: { name: string } | { name: string }[] | null }>((a, b) =>
        supabaseUntyped
          .from('campaign_briefs')
          .select('brief_type, created_at, campaigns!inner(name, client_id)')
          .eq('campaigns.client_id', clientId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(a, b))
      const out: Record<string, BriefUsage> = {}
      for (const r of data) {
        const c = Array.isArray(r.campaigns) ? r.campaigns[0] : r.campaigns
        const cur = out[r.brief_type]
        // Newest first, so the first row seen for a type names its latest campaign.
        out[r.brief_type] = { count: (cur?.count ?? 0) + 1, lastCampaign: cur?.lastCampaign ?? c?.name ?? '' }
      }
      return out
    },
  })
}

// ---- Dos and don'ts the job inherits (SJ-v3, 22 Sep) ----

/** The client's rules, from the profile's dos-and-don'ts list. */
export function useClientRules(clientId: string | null) {
  return useQuery({
    queryKey: intakeKeys.clientRules(clientId ?? ''),
    enabled: Boolean(clientId),
    queryFn: async (): Promise<ClientRule[]> => {
      const { data, error } = await supabaseUntyped.from('clients').select('profile').eq('id', clientId!).maybeSingle()
      if (error) throw error
      const profile = (data as { profile?: { rules?: unknown } } | null)?.profile
      return normalizeRules(profile?.rules)
    },
  })
}

// ---- The template (ADR-0084 d.1) ----

export function useSingleExecutionTemplate() {
  return useQuery({
    queryKey: intakeKeys.template(),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<TemplateField[]> => {
      const { data, error } = await supabaseUntyped
        .from('brief_templates')
        .select('fields')
        .eq('brief_type', SINGLE_EXECUTION)
        .maybeSingle()
      if (error) throw error
      const fields = (data as { fields: unknown } | null)?.fields
      return (Array.isArray(fields) ? fields : []) as TemplateField[]
    },
  })
}

// ---- Creating and releasing the job (ADR-0083, ADR-0085 d.2/d.8, on ADR-0067's draft path) ----

export interface SingleJobDeliverable {
  name: string
  ownerUserId: string | null
  dueAt: string | null
  deliverableTypeId: string | null
  quantity: number
  channel: string | null
  format: string | null
  /** SJ-v3-04: High / Medium / Low, or null. Lands on `deliverables.priority` (20260922160000). */
  priority: string | null
}

export interface StartSingleJob {
  clientId: string
  brandId: string | null
  name: string
  accountManagerId: string | null
}

/**
 * The job is created on Next from SJ-02 (ADR-0085 d.8) as a DRAFT — the same row the campaign
 * wizard creates on leaving its step 1 (ADR-0067 d.1), so the receipt and the attachments have a
 * campaign to file into. `p_kind` records what it is (ADR-0086 d.8), never inferred later from
 * what happens to be empty. Identity only: the request itself is saved into `campaigns.brief`
 * through the wizard's own `update_campaign_draft`, and the stream and the deliverable ROW are
 * written once, at release.
 */
export function useStartSingleJobDraft() {
  const qc = useQueryClient()
  const invalidateFolders = useInvalidateFolders()
  return useMutation({
    mutationFn: async (input: StartSingleJob): Promise<string> => {
      const { data, error } = await supabaseUntyped.rpc('start_campaign_draft', {
        p_client: input.clientId,
        p_brand: input.brandId,
        p_name: input.name.trim(),
        p_account_manager: input.accountManagerId,
        p_kind: 'single_job',
      })
      if (error) throw error
      return data as string
    },
    onSuccess: (_id, input) => {
      void qc.invalidateQueries({ queryKey: ['campaigns'] })
      // The INSERT provisioned this campaign's folders; the tree was read before they existed.
      void invalidateFolders(input.clientId)
    },
  })
}

export interface CompleteSingleJob {
  campaignId: string
  /** The request record `update_campaign_draft` has been saving, sent whole once more. */
  brief: Record<string, unknown>
  /** The job's deliverables — the first, then any added on step 3 (I54.33). */
  deliverables: SingleJobDeliverable[]
}

/**
 * Release, first half (ADR-0085 d.2): the draft is COMPLETED — its one stream and its one
 * deliverable written, the task list materialised and held (ADR-0090 d.1) — and moved to
 * `pending_approval`, so `approve_campaign` can run. The same RPC the wizard's submit uses; not
 * the wizard's hook, because that one rebuilds `campaigns.brief` from nine strategy fields and
 * would write over the request record a single job keeps there.
 */
export function useCompleteSingleJobDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CompleteSingleJob): Promise<string> => {
      const { data, error } = await supabaseUntyped.rpc('complete_campaign_draft', {
        p_campaign: input.campaignId,
        p_brief: input.brief,
        p_go_live: null,
        p_deliverables: input.deliverables,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campaigns'] })
      void qc.invalidateQueries({ queryKey: ['deliverables'] })
    },
  })
}

/** `complete_campaign_draft` refuses anything not a draft with this — a retry after a failed approval. */
export function isNotDraft(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null
  return e?.code === '23514' && (e.message ?? '').includes('campaign_not_draft')
}

// ---- The brief (ADR-0084 d.3) ----

export interface SaveSingleExecutionBrief {
  campaignId: string
  departmentId: string
  /** The template the brief is written from — chosen on SJ-v3-01 (22 Sep); `single_execution` before that. */
  briefType: string
  values: Record<string, string>
}

/**
 * One `campaign_briefs` row, `brief_type` = the template chosen on SJ-v3-01, the department from SJ-02 — the
 * same table and shape a department's own brief takes, so `/campaigns/:id`'s department tab reads
 * it with nothing written and offers to generate nothing (ADR-0084 d.3). Upserted on the unique
 * (campaign, department) so Back-and-Next corrects rather than collides.
 */
export function useSaveSingleExecutionBrief() {
  const qc = useQueryClient()
  const { claims } = useAuth()
  return useMutation({
    mutationFn: async (input: SaveSingleExecutionBrief): Promise<void> => {
      const { error } = await supabaseUntyped.from('campaign_briefs').upsert(
        {
          tenant_id: claims.tenantId,
          campaign_id: input.campaignId,
          department_id: input.departmentId,
          brief_type: input.briefType || SINGLE_EXECUTION,
          values: input.values,
        },
        { onConflict: 'campaign_id,department_id' },
      )
      if (error) throw error
    },
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: intakeKeys.brief(v.campaignId) })
      void qc.invalidateQueries({ queryKey: ['campaign-detail'] })
    },
  })
}

export interface SingleExecutionBrief {
  id: string
  departmentId: string
  briefType: string
  values: Record<string, string>
  approvedAt: string | null
}

export function useSingleExecutionBrief(campaignId: string | null) {
  return useQuery({
    queryKey: intakeKeys.brief(campaignId ?? 'none'),
    enabled: Boolean(campaignId),
    queryFn: async (): Promise<SingleExecutionBrief | null> => {
      // A single job holds ONE brief, whatever template it was written from (SJ-v3-01, 22 Sep) —
      // the type is no longer the filter; the job is.
      const { data, error } = await supabaseUntyped
        .from('campaign_briefs')
        .select('id, department_id, brief_type, values, approved_at')
        .eq('campaign_id', campaignId!)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const r = data as { id: string; department_id: string; brief_type: string; values: unknown; approved_at: string | null }
      return { id: r.id, departmentId: r.department_id, briefType: r.brief_type, values: asStringMap(r.values), approvedAt: r.approved_at }
    },
  })
}

function asStringMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'string') out[k] = val
    }
  }
  return out
}

// ---- Ingestion against the template (ADR-0084 d.6) ----

export interface SingleExecutionIngestResult {
  fields: Record<string, string>
  oversized: string[]
}

const ingestSchema = z.object({
  fields: z.record(z.string(), z.unknown()).catch({}),
  oversized: z.array(z.string()).optional().catch([]),
})

const REFUSAL_BY_STATUS: Record<number, BriefIngestRefusedError['code']> = {
  400: 'mismatch',
  401: 'unauthenticated',
  403: 'forbidden',
  413: 'too_long',
}

/**
 * `ingest-brief` with `briefType: 'single_execution'`: the function derives its prompt and its
 * output schema from the template's own fields and answers with those keys only. Re-validated
 * here against the keys the screen will render, so an out-of-date function cannot put a field on
 * screen that the template does not have.
 *
 * No heading fallback, deliberately. The campaign path's fallback matches fourteen known headings;
 * this template's six are the tenant's to edit, and guessing at them would fill fields with the
 * wrong text and mark them as read from the document.
 */
export function useIngestSingleExecution(keys: readonly string[], briefType: string = SINGLE_EXECUTION) {
  return useMutation<SingleExecutionIngestResult, Error, { text: string }>({
    mutationFn: async ({ text }) => {
      if (text.length > MAX_BRIEF_CHARS) throw new BriefTooLongError()
      let res: { data: unknown; error: unknown }
      try {
        res = await supabaseUntyped.functions.invoke('ingest-brief', {
          body: { text, briefType: briefType || SINGLE_EXECUTION },
        })
      } catch (e) {
        throw refusalFor(e) ?? (e instanceof Error ? e : new Error('ingest_failed'))
      }
      if (res.error) throw refusalFor(res.error) ?? new Error('ingest_failed')
      const parsed = ingestSchema.safeParse(res.data)
      if (!parsed.success) throw new Error('unexpected_ingest_response')
      const fields: Record<string, string> = {}
      for (const key of keys) {
        const raw = parsed.data.fields[key]
        if (typeof raw !== 'string') continue
        const tidied = tidyFieldValue(raw)
        if (tidied) fields[key] = tidied
      }
      return { fields, oversized: (parsed.data.oversized ?? []).filter((k) => keys.includes(k)) }
    },
  })
}

function refusalFor(error: unknown): BriefIngestRefusedError | null {
  const status = (error as { context?: { status?: unknown } } | null)?.context?.status
  if (typeof status !== 'number') return null
  const code = REFUSAL_BY_STATUS[status]
  return code ? new BriefIngestRefusedError(code) : null
}

// ---- The duplicate check and attaching (ADR-0086 SJ-A1) ----

export interface SimilarJob {
  campaignId: string
  name: string
  /** 0–1 trigram similarity on the title. Shown as a percent; never hidden (d.3). */
  score: number
  kind: CampaignKind
  departmentNames: string[]
  deliverableCount: number
  raisedBy: string | null
  raisedAt: string | null
  status: string
}

/** Runs on Approve, over this client's open jobs only (d.2). A mutation, not a query: it is asked once, at one moment. */
export function useSimilarOpenJobs() {
  return useMutation({
    mutationFn: async (input: { clientId: string; title: string; excludeCampaignId: string }): Promise<SimilarJob[]> => {
      const { data, error } = await supabaseUntyped.rpc('similar_open_jobs', {
        p_client: input.clientId,
        p_title: input.title.trim(),
        // The job being released is itself an open job on this client with exactly this title.
        p_exclude_campaign: input.excludeCampaignId,
      })
      if (error) throw error
      const rows = (data ?? []) as {
        campaign_id: string
        name: string
        score: number
        kind: CampaignKind
        department_names: string[] | null
        deliverable_count: number | null
        raised_by: string | null
        raised_at: string | null
        status: string
      }[]
      return rows.map((r) => ({
        campaignId: r.campaign_id,
        name: r.name,
        score: Number(r.score) || 0,
        kind: r.kind,
        departmentNames: r.department_names ?? [],
        deliverableCount: r.deliverable_count ?? 0,
        raisedBy: r.raised_by,
        raisedAt: r.raised_at,
        status: r.status,
      }))
    },
  })
}

/** d.5: re-parents the deliverable, brief, attachments and receipt onto the existing job, discards the draft. */
export function useAttachJobToCampaign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { draftCampaignId: string; targetCampaignId: string }): Promise<string> => {
      const { data, error } = await supabaseUntyped.rpc('attach_job_to_campaign', {
        p_draft_campaign: input.draftCampaignId,
        p_target_campaign: input.targetCampaignId,
      })
      if (error) throw error
      return (data as string | null) ?? input.targetCampaignId
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campaigns'] })
      void qc.invalidateQueries({ queryKey: ['deliverables'] })
      void qc.invalidateQueries({ queryKey: ['brief-receipt'] })
    },
  })
}

// ---- Promotion (ADR-0086 SJ-A2) ----

export function usePromoteSingleJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (campaignId: string): Promise<void> => {
      const { error } = await supabaseUntyped.rpc('promote_single_job', { p_campaign: campaignId })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campaigns'] })
      void qc.invalidateQueries({ queryKey: intakeKeys.kinds() })
    },
  })
}

/**
 * Which campaigns are single jobs (ADR-0086 d.8) — for the held-work label and the schedule's
 * picker. Read through `*` (see the file header); a row with no `kind` yet is a campaign, which
 * is what the backfill will say too. The campaigns list reads `kind` off its own view instead.
 */
export function useCampaignKinds() {
  return useQuery({
    queryKey: intakeKeys.kinds(),
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, CampaignKind>> => {
      // EVERY campaign (I59.35): past the server's 1,000 rows the rest read as plain campaigns,
      // single jobs included — 1,233 locally on 25 Sep.
      const data = await allRows<{ id: string; kind?: unknown }>((a, b) =>
        supabaseUntyped.from('campaigns').select().order('id').range(a, b))
      const out = new Map<string, CampaignKind>()
      for (const r of data) {
        out.set(r.id, r.kind === 'single_job' ? 'single_job' : 'campaign')
      }
      return out
    },
  })
}

// ---- Reading a job back (ADR-0085 d.8 — Cancel leaves a draft, so it must be resumable) ----

export interface SingleJobRecord {
  id: string
  name: string
  status: string
  kind: CampaignKind
  clientId: string
  brandId: string | null
  accountManagerId: string | null
  /** The request record and the deliverable specification, as `update_campaign_draft` saved them. */
  brief: Record<string, unknown>
}

/**
 * Any status, deliberately — unlike the wizard's `useCampaignDraft`, which answers only for a
 * draft. A single job whose release half-failed sits at `pending_approval` and must still be
 * picked up; the wizard tells the two apart from `status` and skips the half already done.
 */
export function useSingleJob(campaignId: string | null) {
  return useQuery({
    queryKey: intakeKeys.job(campaignId ?? 'none'),
    enabled: Boolean(campaignId),
    // Read fresh every time the job is opened, never from the cache. The wizard fills its form from
    // this ONCE, so a kept copy brought back whatever the job said when it was last opened: a title
    // changed on step 3, then Campaigns and back into the job, showed the old title until a reload.
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<SingleJobRecord | null> => {
      // `*` for `kind` — see the file header.
      const { data, error } = await supabaseUntyped.from('campaigns').select().eq('id', campaignId!).maybeSingle()
      if (error) throw error
      if (!data) return null
      const c = data as {
        id: string; name: string; status: string; kind?: unknown; client_id: string; brand_id: string | null
        account_manager_id: string | null; brief: unknown
      }
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        kind: c.kind === 'single_job' ? 'single_job' : 'campaign',
        clientId: c.client_id,
        brandId: c.brand_id,
        accountManagerId: c.account_manager_id,
        brief: (c.brief && typeof c.brief === 'object' ? c.brief : {}) as Record<string, unknown>,
      }
    },
  })
}
