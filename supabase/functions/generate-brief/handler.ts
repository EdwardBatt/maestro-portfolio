// generate-brief — fills one discipline's brief from the master brief (ADR-0048 d.5, I16.4).
//
// One call per discipline present in the confirmed deliverable list. It is handed the
// template's field list (from `brief_templates`, ADR-0048 d.2), the master brief, and that
// discipline's own deliverables, and it returns a value per field.
//
// `N/A`, NOT BLANK, for a field the source does not address (d.6). That is the agency's own
// convention from the deck — "if a field doesn't apply, write N/A, never leave it blank" — and
// it is better than an empty string because blank cannot distinguish "does not apply" from
// "nobody has filled it in", and only one of those should be chased.
//
// SPLIT FROM index.ts so Vitest can reach this (index.ts calls `Deno.serve` at load time).
import { z } from 'npm:zod@4'
import { callModelJson, ModelCallError } from '../_shared/model.ts'
import { FACT_RULE, UNTRUSTED_BRIEF_NOTICE } from '../_shared/brief-rules.ts'
import {
  MAX_BRIEF_CHARS,
  MAX_FIELD_CHARS,
  isWithinFieldLimit,
  tidyFieldValue,
} from '../../../src/lib/brief/fields.ts'

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** A brief is up to ~17 fields of prose. 16,000 leaves room without inviting an essay. */
const MAX_OUTPUT_TOKENS = 16_000

/** No template in the deck approaches this. A longer one is a configuration mistake. */
const MAX_TEMPLATE_FIELDS = 40

export const NOT_APPLICABLE = 'N/A'

const fieldSchema = z
  .object({
    key: z.string().min(1).max(80),
    en: z.string().min(1).max(200),
    guidance: z.string().max(500).optional().default(''),
  })
  .strict()

const requestSchema = z
  .object({
    /**
     * ADR-0072 d.2/d.3. Added 5 Sep: without these the function CANNOT be scoped — it had no way to
     * know whose department it was writing for, or whether the campaign was approved, so it asked
     * the only question it could ("do you hold projects:manage anywhere") and answered yes to both
     * a Creative lead generating Production's brief and to generating against a draft.
     */
    campaignId: z.uuid(),
    departmentId: z.uuid(),
    brief: z.string().min(1).max(MAX_BRIEF_CHARS),
    disciplineName: z.string().min(1).max(120),
    /** That discipline's deliverables, as confirmed by a person (d.4). */
    deliverables: z.array(z.string().max(200)).max(50).default([]),
    fields: z.array(fieldSchema).min(1).max(MAX_TEMPLATE_FIELDS),
  })
  .strict()

/** What `public.may_generate_department_brief` answers (ADR-0072). A reason, never a boolean. */
export type GenerateVerdict = 'ok' | 'forbidden' | 'campaign_not_approved' | 'not_found'

export interface GenerateBriefDeps {
  authenticate: (authHeader: string) => Promise<boolean>
  /**
   * ADR-0037: authorization is read in the database. This is one RPC, not three checks assembled
   * here — grant, scope and campaign status are one question and the answer lives in SQL.
   */
  mayGenerate: (
    authHeader: string,
    campaignId: string,
    departmentId: string,
  ) => Promise<GenerateVerdict>
  openaiApiKey: string
  model: string
  fetchImpl: typeof fetch
  timeoutMs: number
}

export interface GenerateBriefBody {
  /** key → value. Every requested key is present; unaddressed ones carry `N/A`. */
  values: Record<string, string>
  /** Keys whose answer was too long to use. The user is told, never quietly shortened. */
  oversized: string[]
}

type ErrorBody = { error: { code: string; message: string } }

function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function fail(status: number, code: string, message: string, headers: Record<string, string>) {
  return json(status, { error: { code, message } } satisfies ErrorBody, headers)
}

/** The schema is built per template, so strict mode gets a closed object either way. */
export function briefValuesSchema(fields: { key: string; en: string; guidance: string }[]) {
  const properties: Record<string, { type: 'string'; description: string }> = {}
  for (const f of fields) {
    properties[f.key] = {
      type: 'string',
      description: f.guidance ? `${f.en}. ${f.guidance}` : f.en,
    }
  }
  return {
    type: 'object',
    properties,
    required: fields.map((f) => f.key),
    additionalProperties: false,
  }
}

export function briefSystemPrompt(disciplineName: string, deliverables: string[]): string {
  return [
    `You write the ${disciplineName} brief for a campaign, from the campaign's master brief.`,
    'You are filling a form the agency already uses. A person reviews and edits everything you write.',
    '',
    ...UNTRUSTED_BRIEF_NOTICE,
    '',
    deliverables.length
      ? `This discipline is delivering: ${deliverables.join('; ')}. Write for that work specifically.`
      : 'This discipline has no named deliverables yet. Write for the discipline in general.',
    '',
    'Rules:',
    '- Fill a field only from what the master brief actually says, or from what follows from it directly.',
    // I34.3: shared with `propose-concepts`, which may propose an approach but not a fact.
    FACT_RULE,
    `- If the brief does not address a field, answer exactly "${NOT_APPLICABLE}". Never leave a field empty.`,
    '- Write in the language the master brief is written in. Do not translate it.',
    `- Keep every field under ${MAX_FIELD_CHARS} characters.`,
    '- Reply with the JSON object and nothing else.',
  ].join('\n')
}

/**
 * Validate, tidy and drop. A field that came back unusable is reported as oversized rather
 * than truncated — the same argument ADR-0044 d.2 makes about input, applied to output: a
 * value cut mid-sentence and shown as a finished brief field reads as complete.
 */
export function sanitizeBriefValues(
  raw: unknown,
  fields: { key: string }[],
): GenerateBriefBody {
  const answer = (raw ?? {}) as Record<string, unknown>
  const values: Record<string, string> = {}
  const oversized: string[] = []
  for (const f of fields) {
    const v = answer[f.key]
    if (typeof v !== 'string') {
      values[f.key] = NOT_APPLICABLE
      continue
    }
    // The same tidy rule the ingest path uses — imported, not re-implemented, so the two
    // cannot drift into treating whitespace differently.
    const tidied = tidyFieldValue(v)
    if (tidied === null) {
      // An empty answer means the model ignored d.6. Treat it as the N/A it should have been
      // rather than passing a blank through, where it would read as "nobody filled this in".
      values[f.key] = NOT_APPLICABLE
      continue
    }
    if (!isWithinFieldLimit(tidied)) {
      oversized.push(f.key)
      values[f.key] = NOT_APPLICABLE
      continue
    }
    values[f.key] = tidied
  }
  return { values, oversized }
}

export function createGenerateBriefHandler(
  deps: GenerateBriefDeps,
  headers: Record<string, string>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'POST only.', headers)

    const authHeader = req.headers.get('authorization') ?? ''
    if (!(await deps.authenticate(authHeader)))
      return fail(401, 'unauthenticated', 'Sign in to use this.', headers)
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return fail(400, 'invalid_input', 'Expected a JSON body.', headers)
    }
    const input = requestSchema.safeParse(body)
    if (!input.success) {
      const tooLong = typeof (body as { brief?: unknown })?.brief === 'string' &&
        (body as { brief: string }).brief.length > MAX_BRIEF_CHARS
      if (tooLong)
        return fail(413, 'too_long', 'The master brief is too long to write from.', headers)
      return fail(
        400,
        'invalid_input',
        'Expected { campaignId, departmentId, brief, disciplineName, fields }.',
        headers,
      )
    }

    const { campaignId, departmentId, brief, disciplineName, deliverables, fields } = input.data

    // ADR-0072 d.2/d.3 — AFTER parsing, because the check needs the ids the body carries. One RPC:
    // grant, scope and campaign status are one question, and ADR-0037 keeps the answer in SQL.
    //
    // The reasons are kept apart on purpose. A department lead who is simply EARLY must not be told
    // they lack permission — that sends them to an administrator for a problem an approval fixes,
    // which is the wrong conversation and the one ADR-0072 names in its Consequences.
    const verdict = await deps.mayGenerate(authHeader, campaignId, departmentId)
    if (verdict === 'not_found')
      return fail(404, 'not_found', 'That campaign could not be found.', headers)
    if (verdict === 'campaign_not_approved')
      return fail(
        409,
        'campaign_not_approved',
        'This campaign has not been approved yet. Department briefs are written after approval.',
        headers,
      )
    if (verdict !== 'ok')
      return fail(
        403,
        'forbidden',
        'You cannot write this department\u2019s brief. It belongs to that department.',
        headers,
      )

    try {
      const raw = await callModelJson({
        apiKey: deps.openaiApiKey,
        model: deps.model,
        systemPrompt: briefSystemPrompt(disciplineName, deliverables),
        userText: `<brief>\n${brief}\n</brief>`,
        schema: briefValuesSchema(fields),
        schemaName: 'discipline_brief',
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        fetchImpl: deps.fetchImpl,
        timeoutMs: deps.timeoutMs,
      })
      return json(200, sanitizeBriefValues(raw, fields), headers)
    } catch (e) {
      const code = e instanceof ModelCallError ? e.code : 'model_unavailable'
      // Surfaces in `supabase functions logs generate-brief`. Brief text is NOT logged.
      console.error(`generate-brief: ${code}`, e instanceof Error ? e.message : e)
      if (code === 'model_truncated')
        return fail(
          502,
          'model_truncated',
          'The brief was too long to write in one pass. Shorten the master brief, or write this one yourself.',
          headers,
        )
      return fail(
        502,
        'model_unavailable',
        'This brief could not be written automatically. Write it yourself.',
        headers,
      )
    }
  }
}

// ---- the entry point --------------------------------------------------------

export interface CallerClient {
  auth: { getUser: () => PromiseLike<{ data: { user: unknown }; error: unknown }> }
  rpc: (fn: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
}

export interface GenerateBriefEnvironment {
  getEnv: (key: string) => string | undefined
  makeCallerClient: (authHeader: string) => CallerClient
  fetchImpl: typeof fetch
  timeoutMs: number
}

export const DEFAULT_MODEL = 'gpt-5.6-luna'

export function createGenerateBriefEntry(
  env: GenerateBriefEnvironment,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })

    const apiKey = env.getEnv('OPENAI_API_KEY')
    if (!apiKey)
      return fail(503, 'model_unconfigured', 'Brief writing is not configured yet.', corsHeaders)

    return createGenerateBriefHandler(
      {
        authenticate: async (authHeader) => {
          if (!authHeader) return false
          const { data, error } = await env.makeCallerClient(authHeader).auth.getUser()
          return !error && Boolean(data.user)
        },
        // Fail-closed by construction, like `hasPermission`: any error — the migration not yet
        // applied, a network blip, a policy refusal — reads as 'forbidden', never as a pass. That
        // is what makes "migration first, function second" safe to get wrong.
        mayGenerate: async (authHeader, campaignId, departmentId) => {
          const { data, error } = await env
            .makeCallerClient(authHeader)
            .rpc('may_generate_department_brief', {
              p_campaign: campaignId,
              p_department: departmentId,
            })
          if (error || typeof data !== 'string') return 'forbidden'
          return data as GenerateVerdict
        },
        openaiApiKey: apiKey,
        model: env.getEnv('OPENAI_MODEL') ?? DEFAULT_MODEL,
        fetchImpl: env.fetchImpl,
        timeoutMs: env.timeoutMs,
      },
      corsHeaders,
    )(req)
  }
}
