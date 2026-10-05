import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'
import { supabaseUntyped } from '../../../lib/supabase'
import { uploadAssetToFolder } from '../../../lib/assets/upload-asset'
import { useAuth } from '../../../app/auth-context'
import { mapBriefHeadings } from '../../../lib/brief/fallback'
import {
  BRIEF_FIELD_KEYS,
  MAX_BRIEF_CHARS,
  isBriefFieldKey,
  tidyFieldValue,
  type BriefFieldKey,
  type BriefFields,
} from '../../../lib/brief/fields'

/**
 * Brief ingestion (ADR-0044, I14.3). Two mutations, one interface between them:
 *
 *   useIngestBrief()      plain text in → brief fields out, with the SOURCE stated.
 *                         The model path and the heading-matching fallback return the
 *                         same shape, so nothing downstream has to know which ran.
 *   useFileBriefSource()  the source document is filed, not discarded — into the
 *                         campaign's References folder (ADR-0022 / ADR-0044 §8).
 *
 * The API key is not here and cannot be: it is an Edge Function secret read by
 * `ingest-brief` from its own environment. Nothing in this file — or anywhere else in
 * `src/` — reads it, and no `VITE_`-prefixed variable exists for it, which is the only
 * route a value has into the browser bundle.
 */

/** Which path produced the fields. The wizard says so out loud when it was the fallback. */
export type BriefIngestSource = 'model' | 'fallback'

export interface BriefIngestResult {
  fields: BriefFields
  /** Fields the answer had to drop for length — the user is told, never quietly shortened. */
  oversized: BriefFieldKey[]
  source: BriefIngestSource
}

/**
 * The function's answer, re-validated on arrival. The Edge Function already validated the
 * model's output against this same field list; doing it again here costs nothing and means
 * a compromised or simply out-of-date function still cannot put an unexpected key into the
 * form. Unknown keys are stripped by Zod's default object behaviour.
 *
 * No per-field `.max()` here: the function is the length authority and reports what it had
 * to drop. Re-imposing the limit on arrival would silently discard a field the user had
 * just been told about.
 */
function briefFieldShape(): Record<BriefFieldKey, z.ZodType<string | undefined>> {
  const shape = {} as Record<BriefFieldKey, z.ZodType<string | undefined>>
  for (const key of BRIEF_FIELD_KEYS) {
    shape[key] = z.string().optional().catch(undefined)
  }
  return shape
}

const ingestResponseSchema = z.object({
  fields: z.object(briefFieldShape()),
  oversized: z.array(z.string()).optional().catch([]),
})

function cleanFields(raw: Record<string, string | undefined>): BriefFields {
  const fields: BriefFields = {}
  for (const key of BRIEF_FIELD_KEYS) {
    const value = raw[key]
    if (typeof value !== 'string') continue
    const tidied = tidyFieldValue(value)
    if (tidied) fields[key] = tidied
  }
  return fields
}

/** Over-cap input, refused before the call — the fallback would have the same problem. */
export class BriefTooLongError extends Error {
  readonly code = 'too_long'
  constructor() {
    super('brief_too_long')
    this.name = 'BriefTooLongError'
  }
}

/**
 * A refusal the SERVER made deliberately, as opposed to a service that fell over.
 *
 * This distinction has to survive the round trip. `functions.invoke` reports every non-2xx
 * as one opaque `FunctionsHttpError`, so without unpacking it a caller who simply lacks
 * `projects:manage` is told "the reading service was unavailable" — which is false, sends
 * them to the wrong person, and buries the honest 403 the function took care to write.
 */
export class BriefIngestRefusedError extends Error {
  /** `mismatch` = the server rejected the REQUEST, so the two are out of step. Falling back to
   *  heading matching and blaming the service would send the reader to the wrong problem. */
  readonly code: 'unauthenticated' | 'forbidden' | 'too_long' | 'mismatch'
  constructor(code: BriefIngestRefusedError['code']) {
    super(code)
    this.name = 'BriefIngestRefusedError'
    this.code = code
  }
}

/** Statuses that mean "the server considered this and said no", not "the server is down". */
const REFUSAL_BY_STATUS: Record<number, BriefIngestRefusedError['code']> = {
  // A 400 means this client and that function disagree about the request — almost always a
  // deployed function a version behind. It must NOT become "the service was unavailable, so
  // the headings were matched instead": that is a true sentence about a false cause.
  400: 'mismatch',
  401: 'unauthenticated',
  403: 'forbidden',
  413: 'too_long',
}

/**
 * `FunctionsHttpError` carries the raw `Response` on `.context`. Anything else — a network
 * failure, a relay error — has no status and is a genuine outage.
 */
function refusalFor(error: unknown): BriefIngestRefusedError | null {
  const status = (error as { context?: { status?: unknown } } | null)?.context?.status
  if (typeof status !== 'number') return null
  const code = REFUSAL_BY_STATUS[status]
  return code ? new BriefIngestRefusedError(code) : null
}

/**
 * Read a brief. Calls `ingest-brief`; if that fails because the service is unreachable,
 * unconfigured, out of quota or simply could not read the document, it falls back to
 * heading matching and says which ran.
 *
 * Two failures are NOT swallowed into the fallback, because the fallback is not the right
 * answer to either: over-cap input (send the brief, not the pack) and a deliberate refusal
 * from the server (sign in, or ask for the grant). Pretending those are outages tells the
 * user to wait for something that will never change on its own.
 */
export function useIngestBrief() {
  return useMutation<BriefIngestResult, Error, { text: string }>({
    mutationFn: async ({ text }) => {
      if (text.length > MAX_BRIEF_CHARS) throw new BriefTooLongError()

      try {
        const res = await supabaseUntyped.functions.invoke('ingest-brief', { body: { text } })
        if (res.error) throw res.error
        const parsed = ingestResponseSchema.safeParse(res.data)
        if (!parsed.success) throw new Error('unexpected_ingest_response')
        return {
          fields: cleanFields(parsed.data.fields),
          oversized: (parsed.data.oversized ?? []).filter(isBriefFieldKey),
          source: 'model',
        }
      } catch (e) {
        const refusal = refusalFor(e)
        if (refusal || e instanceof BriefIngestRefusedError) throw refusal ?? e
        // Everything left really is "the service could not answer", and every one of those
        // has the same answer for the user: here is what the headings gave us.
        console.warn('ingest-brief unavailable, falling back to heading matching', e)
        return { fields: mapBriefHeadings(text), oversized: [], source: 'fallback' }
      }
    },
  })
}

/**
 * File the source document into the campaign's References folder. Called AFTER submit,
 * because the campaign — and therefore its folder tree — does not exist until then
 * (the same staging shape as task requirements in I13.1(e)).
 *
 * It can genuinely fail: `uploadAssetToFolder` needs `assets:manage`, which the wizard
 * itself does not require, so an Account Manager without it creates the campaign and then
 * cannot file the document. The campaign is already saved, so this is never a failed
 * submit — but the wizard promised the document would be filed, so the wizard must say
 * when it was not. It surfaces the failure and offers a retry; nothing here is swallowed.
 */
export function useFileBriefSource() {
  const { claims, session } = useAuth()
  return useMutation<void, Error, { campaignId: string; file: File }>({
    mutationFn: async ({ campaignId, file }) => {
      const { data, error } = await supabaseUntyped
        .from('asset_folders')
        .select('id')
        .eq('campaign_id', campaignId)
        .eq('kind', 'asset_type')
        .eq('name', 'References')
        .maybeSingle()
      if (error) throw error
      const folderId = (data as { id: string } | null)?.id
      if (!folderId) throw new Error('references_folder_missing')

      await uploadAssetToFolder({
        folderId,
        file,
        tenantId: claims.tenantId,
        uploadedBy: session?.user.id ?? null,
      })
    },
  })
}
