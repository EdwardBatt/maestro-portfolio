import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../supabase'
import { allRows } from '../query/all-pages'
import { fetchUserNames } from '../users/user-names'
import { RULES_KEY } from '../brief/rules'
import { BRIEF_FIELD_KEYS, isPerformanceField } from '../brief/fields'
import { fetchAssetDownloadUrl } from '../assets/download-url'

/**
 * Read-only reads of a campaign's parts that more than one feature shows (I59 Track 6, AGENTS.md
 * §3 — shared code lives in `lib/`, not copied into a second feature): the piece's brief as its
 * department's tab shows it, how the request came in (the receipt and its screenshot), and the
 * campaign's References folder with its files. Existing tables, existing RLS; nothing here writes.
 *
 * Moved from `features/deliverables/api/task-page-api.ts`, where the task page (I59.11) first
 * wrote them as small copies; that module re-exports them so its callers stand.
 */

const keys = {
  brief: (campaignId: string, departmentId: string) => ['campaign-reads', 'brief', campaignId, departmentId] as const,
  receipt: (campaignId: string) => ['campaign-reads', 'receipt', campaignId] as const,
  referencesFolder: (campaignId: string) => ['campaign-reads', 'references-folder', campaignId] as const,
  referenceFiles: (folderId: string) => ['campaign-reads', 'reference-files', folderId] as const,
  assetUrl: (assetId: string) => ['campaign-reads', 'asset-url', assetId] as const,
}

// ------------------------------------------------------------------------- the brief ----

export interface TaskBriefField {
  key: string
  en: string
  ar: string
  value: string
  /** I59.56: a campaign-brief field is labelled from the wording file, as the Brief view labels it. */
  labelKey?: string
}

/** Keys a brief carries that are not the brief's words (the same two BriefView hides). */
const HIDDEN = new Set(['briefType', RULES_KEY])

/**
 * The piece's brief: its department's brief on the campaign, in the template's field order with the
 * template's labels — what the campaign page shows on the department's tab, read only. A key the
 * template does not know is shown after the template's own, under its key, so nothing written is
 * hidden. Null when the department has no brief on the campaign.
 */
export function useTaskBrief(campaignId: string | null, deliverableId: string | null) {
  return useQuery({
    queryKey: keys.brief(campaignId ?? 'none', deliverableId ?? 'none'),
    enabled: Boolean(campaignId),
    queryFn: async (): Promise<TaskBriefField[] | null> => {
      // Edward, 27 Sep: a task sits under a deliverable, and the DELIVERABLE carries the owner and the
      // owner's department (ADR-0102) — so the brief is found by the deliverable's department, not the
      // task's own.
      let departmentId: string | null = null
      if (deliverableId) {
        const d = await supabaseUntyped.from('deliverables').select('department_id').eq('id', deliverableId).maybeSingle()
        if (d.error) throw d.error
        departmentId = (d.data as { department_id: string | null } | null)?.department_id ?? null
      }
      if (!departmentId) return campaignBrief(campaignId!)
      const { data, error } = await supabaseUntyped
        .from('campaign_briefs')
        .select('brief_type, values')
        .eq('campaign_id', campaignId!)
        .eq('department_id', departmentId!)
        .maybeSingle()
      if (error) throw error
      // I59.56: no department brief — since ADR-0100 a campaign has ONE brief, on the campaign itself.
      // Its fields, in the Brief view's order and under its labels; none written reads as no brief.
      if (!data) return campaignBrief(campaignId!)
      const row = data as { brief_type: string | null; values: Record<string, unknown> | null }
      const values = row.values ?? {}
      let template: { key: string; en: string; ar?: string }[] = []
      if (row.brief_type) {
        const t = await supabaseUntyped.from('brief_templates').select('fields').eq('brief_type', row.brief_type).maybeSingle()
        if (t.error) throw t.error
        const f = (t.data as { fields?: unknown } | null)?.fields
        template = Array.isArray(f)
          ? f.filter((x): x is { key: string; en: string; ar?: string } => !!x && typeof x.key === 'string' && typeof x.en === 'string')
          : []
      }
      const text = (v: unknown) => (typeof v === 'string' ? v : '')
      const known = new Set(template.map((f) => f.key))
      return [
        ...template.filter((f) => !HIDDEN.has(f.key)).map((f) => ({ key: f.key, en: f.en, ar: f.ar ?? '', value: text(values[f.key]) })),
        ...Object.keys(values)
          .filter((k) => !known.has(k) && !HIDDEN.has(k))
          .map((k) => ({ key: k, en: k, ar: '', value: text(values[k]) })),
      ]
    },
  })
}

/** I59.56: the campaign's own brief (ADR-0100) as brief fields, or null when it has no words in it. */
async function campaignBrief(campaignId: string): Promise<TaskBriefField[] | null> {
  const { data, error } = await supabaseUntyped.from('campaigns').select('brief').eq('id', campaignId).maybeSingle()
  if (error) throw error
  const brief = ((data as { brief?: unknown } | null)?.brief ?? {}) as Record<string, unknown>
  const perf = (brief.performance && typeof brief.performance === 'object' ? brief.performance : {}) as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' ? v : '')
  const fields = BRIEF_FIELD_KEYS.map((k) => {
    const value = text(brief[k]) || text(perf[k])
    return { key: k, en: k, ar: '', value, labelKey: isPerformanceField(k) ? `campaigns.performance.${k}` : `campaigns.strategy.${k}` }
  })
  // The performance flight is shown only when it was filled; the creative brief's fields always are.
  const shown = fields.filter((f) => !isPerformanceField(f.key as (typeof BRIEF_FIELD_KEYS)[number]) || f.value.trim())
  return shown.some((f) => f.value.trim()) ? shown : null
}

// ------------------------------------------------------------ how the request came in ----

export interface TaskReceipt {
  subject: string | null
  receivedAt: string | null
  recordedBy: string | null
  /** The screenshot, filed in the campaign's References (ADR-0066 d.2). Null once deleted. */
  assetId: string | null
}

/** The campaign's first receipt (ADR-0066) — the one its clock reads. Null when none was recorded. */
export function useTaskReceipt(campaignId: string | null) {
  return useQuery({
    queryKey: keys.receipt(campaignId ?? 'none'),
    enabled: !!campaignId,
    queryFn: async (): Promise<TaskReceipt | null> => {
      const { data, error } = await supabaseUntyped
        .from('campaign_brief_receipts')
        .select('subject, received_at, created_by, asset_id')
        .eq('campaign_id', campaignId!)
        .order('received_at', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const r = data as { subject: string | null; received_at: string | null; created_by: string | null; asset_id: string | null }
      const names = await fetchUserNames([r.created_by])
      return {
        subject: r.subject,
        receivedAt: r.received_at,
        recordedBy: r.created_by ? names.get(r.created_by) ?? null : null,
        assetId: r.asset_id ?? null,
      }
    },
  })
}

/**
 * A viewable address for one asset — the receipt's screenshot. The same short-lived download URL
 * the Library hands out (ADR-0022); an `<img>` renders it whatever its disposition says. Refetched
 * well inside its lifetime.
 */
export function useAssetUrl(assetId: string | null) {
  return useQuery({
    queryKey: keys.assetUrl(assetId ?? 'none'),
    enabled: !!assetId,
    staleTime: 4 * 60_000,
    queryFn: () => fetchAssetDownloadUrl(assetId!),
  })
}

// --------------------------------------------------------------- the reference files ----

/** The campaign's References folder (the one the wizard and the receipt file into). */
export function useCampaignReferencesFolderId(campaignId: string | null) {
  return useQuery({
    queryKey: keys.referencesFolder(campaignId ?? 'none'),
    enabled: !!campaignId,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabaseUntyped
        .from('asset_folders')
        .select('id')
        .eq('campaign_id', campaignId!)
        .eq('kind', 'asset_type')
        .eq('name', 'References')
        .maybeSingle()
      if (error) throw error
      return (data as { id: string } | null)?.id ?? null
    },
  })
}

export interface ReferenceFile {
  id: string
  name: string
}

/** The live files in a folder. */
export function useReferenceFiles(folderId: string | null) {
  return useQuery({
    queryKey: keys.referenceFiles(folderId ?? 'none'),
    enabled: !!folderId,
    queryFn: async (): Promise<ReferenceFile[]> => {
      // Every page (I59.35), as the Library reads a folder.
      return allRows<ReferenceFile>((a, b) =>
        supabaseUntyped
          .from('assets')
          .select('id, name')
          .eq('folder_id', folderId!)
          .eq('retention_state', 'active')
          .order('name')
          .order('id')
          .range(a, b))
    },
  })
}

/** A short-lived download address from `asset-url` — the Library's own door. */
export const fetchReferenceDownloadUrl = fetchAssetDownloadUrl
