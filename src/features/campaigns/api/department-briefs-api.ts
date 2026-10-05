import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, supabaseUntyped } from '../../../lib/supabase'
import { useAuth } from '../../../app/auth-context'
import { campaignDetailKeys } from './campaign-detail-api'

/**
 * Writing one brief per department (ADR-0048 d.5, I16.4).
 *
 * **The Edge Function has existed since 27 August and nothing has ever called it.** So
 * `campaign_briefs` was always empty, and every section of every campaign said *"this department's
 * brief has not been written yet"* — for ever, with no way to change that. The master brief was
 * there; the per-discipline briefs the whole approval package is supposed to consist of were not.
 *
 * `generate-brief` writes NOTHING itself: it takes the master brief, a department's name, that
 * department's deliverables and a field list, and returns a value per field. Persisting is this
 * file's job, so the same function can serve a wizard, a retry button, or a future regeneration
 * without any of them disagreeing about where a brief lives.
 *
 * **One call per department, and they are sequential.** ADR-0048's own cost note says a
 * six-discipline campaign is up to seven model calls where today it is one. Running them in
 * parallel would be faster and would also turn one accidental double-click into fourteen billable
 * calls; a person is watching a spinner either way.
 *
 * **A failure never loses anything.** Each department is independent: the ones that succeeded are
 * saved, the ones that failed are named, and the caller can run it again for those alone. That is
 * the same shape as the wizard's reference-document filing, and for the same reason — the campaign
 * is already committed by the time this runs.
 */

export interface DepartmentBriefRequest {
  departmentId: string
  departmentName: string
  /** The names of that department's deliverables — what the brief is being written ABOUT. */
  deliverables: string[]
  /**
   * The template THIS department writes from, carried per department rather than per campaign.
   *
   * That is the whole shape of the decision: a Production brief is written from the Production
   * template and a Social one from the Social template, and the link lives on the department so a
   * tenant sets it once in their own words. A campaign-wide type — which is what I built first —
   * cannot express that, and ADR-0048 d.5 never asked for one.
   */
  briefType: string
  fields: { key: string; en: string; guidance?: string }[]
}

export interface WriteDepartmentBriefsArgs {
  campaignId: string
  /** The master brief as prose. The function reads it, it does not parse our field keys. */
  masterBrief: string
  departments: DepartmentBriefRequest[]
}

/**
 * What a failed `generate-brief` call actually was (Edward, 17 Sep: a brief failed "with no reason
 * or report"). `functions.invoke` reports every non-2xx as one opaque error — "Edge Function
 * returned a non-2xx status code" — and keeps the Response the function wrote on `.context`. The
 * function's own `{ error: { code, message } }` is read back out of it; the ingest path has done
 * this since ADR-0072 and this one never did, so a missing model key, a timeout and a refusal all
 * read as "the brief could not be written".
 */
const REFUSAL_CODES = new Set(['campaign_not_approved', 'forbidden', 'not_found', 'unauthenticated', 'too_long', 'invalid_input'])
async function describeBriefFailure(e: unknown): Promise<{ reason: string; message?: string; refusal: boolean; cause?: unknown }> {
  const ctx = (e as { context?: unknown } | null)?.context
  if (ctx instanceof Response) {
    let body: { error?: { code?: string; message?: string } } | null = null
    try { body = await ctx.clone().json() } catch { /* not JSON — the status is the fact */ }
    const code = body?.error?.code ?? `http_${ctx.status}`
    const message = body?.error?.message
    const refusal = REFUSAL_CODES.has(code)
    return { reason: code, message, refusal, cause: refusal ? undefined : { code, message, status: ctx.status } }
  }
  const message = e instanceof Error ? e.message : String(e)
  const code = (e as { code?: string } | null)?.code
  // A database refusal on the upsert (42501) is a refusal; anything else is a failure.
  if (code === '42501') return { reason: 'forbidden', message, refusal: true }
  return { reason: code ?? message, message, refusal: false, cause: e }
}

export interface DepartmentBriefsOutcome {
  written: number
  /** Departments that failed, by name, with the reason. Named, never swallowed.
   *  `reason` is the function's own code (`campaign_not_approved`, `forbidden`, `not_found`,
   *  `model_unconfigured`, `model_unavailable`, `model_truncated`, `too_long`) or the write error;
   *  `cause` is what "Report to your administrator" carries (ADR-0092) — a failure is reportable,
   *  a refusal is not. */
  failed: { departmentName: string; reason: string; message?: string; refusal: boolean; cause?: unknown }[]
  /** Field keys the model answered at greater length than the template allows, by department.
   *  Reported rather than truncated (ADR-0048 d.6). */
  oversized: { departmentName: string; keys: string[] }[]
}

interface GenerateBriefResponse {
  values: Record<string, string>
  oversized: string[]
}

/** The master brief as one block of prose for the model. Field keys are ours, not its. */
export function masterBriefText(brief: Record<string, string>): string {
  return Object.entries(brief)
    .filter(([, v]) => typeof v === 'string' && v.trim() !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

export function useWriteDepartmentBriefs() {
  const qc = useQueryClient()
  const { claims } = useAuth()

  return useMutation({
    mutationFn: async (args: WriteDepartmentBriefsArgs): Promise<DepartmentBriefsOutcome> => {
      const out: DepartmentBriefsOutcome = { written: 0, failed: [], oversized: [] }

      for (const dept of args.departments) {
        try {
          const { data, error } = await supabase.functions.invoke('generate-brief', {
            body: {
              // ADR-0072 d.2/d.3. The function scopes on these: whose department, and is the
              // campaign approved. It refused everyone before them, because it could not tell.
              campaignId: args.campaignId,
              departmentId: dept.departmentId,
              brief: args.masterBrief,
              disciplineName: dept.departmentName,
              deliverables: dept.deliverables,
              fields: dept.fields,
            },
          })
          if (error) throw error
          const body = data as GenerateBriefResponse

          // `upsert` on the unique (campaign_id, department_id): running this again for a
          // department that already has one REPLACES it rather than failing on the constraint,
          // which is what a retry has to do. A brief somebody has edited is not protected here —
          // that is a question for the editing surface (I16.6), not for a writer.
          const { error: writeErr } = await supabaseUntyped
            .from('campaign_briefs')
            .upsert(
              {
                tenant_id: claims.tenantId,
                campaign_id: args.campaignId,
                department_id: dept.departmentId,
                brief_type: dept.briefType,
                values: body.values,
              },
              { onConflict: 'campaign_id,department_id' },
            )
          if (writeErr) throw writeErr

          out.written += 1
          if (body.oversized?.length) {
            out.oversized.push({ departmentName: dept.departmentName, keys: body.oversized })
          }
        } catch (e) {
          out.failed.push({ departmentName: dept.departmentName, ...(await describeBriefFailure(e)) })
        }
      }
      return out
    },
    onSuccess: (_r, args) => {
      void qc.invalidateQueries({ queryKey: campaignDetailKeys.detail(args.campaignId) })
    },
  })
}

/**
 * Edit a department's brief in place (ADR-0048 d.9, I16.6).
 *
 * **The approver is the corrector.** ADR-0048 refuses a changes-requested state on purpose: sending
 * a brief back only adds a hop, because the person reading it to approve it is the person who can
 * fix it. So the whole package is editable on the page where it is read.
 *
 * A generated brief was read-only until 30 Aug — written by the model and then frozen, which made
 * "review and edit before approving" impossible and left the model's wording as the final word.
 *
 * The WHOLE value map is written, not a patch: a brief is one document, the person edits it as one,
 * and a per-field write would let two halves of the same edit land separately.
 */
export function useSaveDepartmentBrief() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { briefId: string; campaignId: string; values: Record<string, string> }) => {
      const { error } = await supabaseUntyped
        .from('campaign_briefs')
        .update({ values: a.values })
        .eq('id', a.briefId)
      if (error) throw error
    },
    onSuccess: (_r, a) => {
      void qc.invalidateQueries({ queryKey: campaignDetailKeys.detail(a.campaignId) })
    },
  })
}
