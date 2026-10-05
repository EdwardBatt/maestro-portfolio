// generate-deliverables — proposes the deliverable list a brief implies, FROM THE CATALOGUE
// (ADR-0048 d.4, ADR-0097).
//
// The model PROPOSES WHAT TO MAKE — one of the tenant's own catalogue entries per row, by code —
// and never who makes it (ADR-0050 d.6): no discipline, no owner, no department. It never names a
// row in its own words (ADR-0097 d.2); a code outside the catalogue flags the row for a person to
// choose (d.4). With phases given it may suggest WHEN (ADR-0096 d.8).
//
// What it returns arrives in the wizard as editable rows with an empty owner, and the Account
// Manager fills that in. A wrong sentence in a brief field is read and corrected; a wrong
// owner is somebody's week.
//
// SPLIT FROM index.ts so Vitest can reach this (index.ts calls `Deno.serve` at load time).
import { z } from 'npm:zod@4'
import { callModelJson, ModelCallError } from '../_shared/model.ts'
import { allRowsResult } from '../_shared/all-pages.ts'
import {
  deliverablesJsonSchema,
  deliverablesSystemPrompt,
  sanitizeProposal,
  vocabularyOutcome,
  type DeliverableVocabulary,
  type ProposalPhase,
  type ProposedDeliverable,
  type ProposedGroup,
  type VocabularyOutcome,
} from '../../../src/lib/brief/deliverables.ts'
import { MAX_BRIEF_CHARS } from '../../../src/lib/brief/fields.ts'

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/**
 * A list is short. 4,000 tokens carries 25 rows with room to spare, and a smaller budget is
 * a smaller bill on a feature with no aggregate cap (ADR-0044 d.9, ADR-0048 consequences).
 */
const MAX_OUTPUT_TOKENS = 4_000

const phaseSchema = z
  .object({
    number: z.number().int().min(1).max(99),
    name: z.string().min(1).max(120),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict()

const requestSchema = z
  .object({
    // The assembled brief text — whatever the wizard holds, however it got there. ADR-0048
    // d.3: one flow, hand-typed and ingested alike, so this endpoint cannot tell and does
    // not ask.
    brief: z.string().min(1).max(MAX_BRIEF_CHARS),
    // ADR-0096 d.8 / ADR-0097 d.6: the wizard's phases, so the model can suggest WHEN. The
    // caller's own planning input, not a vocabulary — the catalogue is still read server-side.
    phases: z.array(phaseSchema).max(99).optional(),
    // ADR-0101 d.9: the campaign's workstreams switch. Absent means grouped — the default.
    grouped: z.boolean().optional(),
  })
  .strict()

export interface GenerateDeps {
  authenticate: (authHeader: string) => Promise<boolean>
  /** ADR-0037: asks `public.has_permission` on the CALLER-scoped client. Never a grant-table read. */
  hasProjectsManage: (authHeader: string) => Promise<boolean>
  /**
   * ADR-0054 d.2: the tenant's own active taxonomy, read on the CALLER-scoped client at call time.
   *
   * Never client-supplied. The request schema stays `.strict()` and one field wide, so the browser
   * cannot influence what the model is allowed to say — and because the read runs as the caller it
   * is RLS-fenced by construction: it can only ever see that caller's tenant, with no service key
   * anywhere in the path. This is a REFERENCE table, not a grant table, so ADR-0037 is untouched
   * and authorization still happens above, before the body is parsed.
   *
   * Returns null when the read fails. A vocabulary that cannot be offered degrades visibly (d.5) —
   * the proposal still happens, the rows arrive untyped, and the response says so.
   */
  readVocabulary: (authHeader: string) => Promise<DeliverableVocabulary | null>
  /** Read from the Edge Function environment. Never reaches the browser (AGENTS.md §1). */
  openaiApiKey: string
  model: string
  fetchImpl: typeof fetch
  timeoutMs: number
}

export interface GenerateResponseBody {
  deliverables: ProposedDeliverable[]
  /** ADR-0101: the proposed workstreams; each row's `group` indexes into this. */
  groups: ProposedGroup[]
  /**
   * What happened to each of the two lists (ADR-0054 d.5). An empty dropdown must never look like
   * a model that had no opinion, so the wizard is told which it was rather than left to guess.
   */
  vocabulary: VocabularyOutcome
  /** ADR-0097 d.5: how many rows came back outside the catalogue and need a person to choose. */
  needsType: number
}

type ErrorBody = { error: { code: string; message: string } }

function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function fail(
  status: number,
  code: string,
  message: string,
  headers: Record<string, string>,
): Response {
  return json(status, { error: { code, message } } satisfies ErrorBody, headers)
}

/**
 * ONE PASS (ADR-0097 d.1). The catalogue is a menu in the prompt and the code comes back as a
 * plain string checked afterwards (d.3) — which is why this does not re-open the 29 Aug failure:
 * that answer went empty because the SCHEMA demanded one of 240 enum values on every row, and an
 * empty list satisfied it for free. A menu in the prompt makes nothing cheaper.
 *
 * A tenant with no catalogue gets no proposals and the reason (d.5) — never prose rows.
 */
async function propose(
  brief: string,
  vocab: DeliverableVocabulary | null,
  phases: readonly ProposalPhase[],
  grouped: boolean,
  deps: GenerateDeps,
): Promise<GenerateResponseBody> {
  const outcome = vocabularyOutcome(vocab)
  if (!vocab || vocab.types.length === 0) {
    return { deliverables: [], groups: [], vocabulary: outcome, needsType: 0 }
  }

  const raw = await callModelJson({
    apiKey: deps.openaiApiKey,
    model: deps.model,
    systemPrompt: deliverablesSystemPrompt(vocab, phases, grouped),
    userText: `<brief>\n${brief}\n</brief>`,
    schema: deliverablesJsonSchema(vocab, phases, grouped),
    schemaName: 'proposed_deliverables',
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs,
  })

  const { groups, rows } = sanitizeProposal(raw, vocab, phases)
  return {
    deliverables: rows,
    groups,
    vocabulary: outcome,
    needsType: rows.filter((r) => r.needsType).length,
  }
}

export function createGenerateHandler(
  deps: GenerateDeps,
  headers: Record<string, string>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'POST only.', headers)

    // Authorize BEFORE parsing, so an anonymous caller cannot drive validation and cannot
    // tell a too-long body from a malformed one without a token (the ADR-0044 review's
    // finding, applied here from the start).
    const authHeader = req.headers.get('authorization') ?? ''
    if (!(await deps.authenticate(authHeader)))
      return fail(401, 'unauthenticated', 'Sign in to use this.', headers)
    if (!(await deps.hasProjectsManage(authHeader)))
      return fail(
        403,
        'forbidden',
        'You do not have permission to plan campaigns. Ask an administrator for the Projects grant.',
        headers,
      )

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
        return fail(413, 'too_long', 'The brief is too long to plan from in one pass.', headers)
      return fail(400, 'invalid_input', 'Expected { brief, phases?, grouped? }.', headers)
    }

    try {
      // The read is a NEW failure point in a path that had none, so it degrades rather than
      // fails: `readVocabulary` returns null and the brief is still planned, untyped (d.5).
      // `.catch` and not merely a contract: d.5 says the vocabulary degrades VISIBLY, and a
      // read that threw would otherwise become a 502 on a call the model could still answer.
      const vocab = await deps.readVocabulary(authHeader).catch(() => null)
      return json(
        200,
        await propose(input.data.brief, vocab, input.data.phases ?? [], input.data.grouped ?? true, deps),
        headers,
      )
    } catch (e) {
      const code = e instanceof ModelCallError ? e.code : 'model_unavailable'
      // Surfaces in `supabase functions logs generate-deliverables`. Brief text is NOT logged.
      console.error(`generate-deliverables: ${code}`, e instanceof Error ? e.message : e)
      if (code === 'model_truncated')
        return fail(
          502,
          'model_truncated',
          'The brief was too long to plan from in one pass. Add the deliverables yourself.',
          headers,
        )
      return fail(
        502,
        'model_unavailable',
        'Deliverables could not be proposed. Add them yourself.',
        headers,
      )
    }
  }
}

// ---- the entry point --------------------------------------------------------

/** What a PostgREST select chain looks like from here. Enough to read three reference tables and
 *  no more — this function has no elevated client and writes nothing. */
export interface CallerTableQuery extends PromiseLike<{ data: unknown; error: unknown }> {
  select: (columns: string) => CallerTableQuery
  eq: (column: string, value: unknown) => CallerTableQuery
  order: (column: string) => CallerTableQuery
  range: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>
}

export interface CallerClient {
  auth: { getUser: () => PromiseLike<{ data: { user: unknown }; error: unknown }> }
  rpc: (fn: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
  from: (table: string) => CallerTableQuery
}

/**
 * Read the caller's own active taxonomy (ADR-0054 d.2).
 *
 * Three reads on the caller-scoped client: the types, the category names that head the legend, and
 * the tenant's `channel` attribute list. No `tenant_id` filter appears anywhere — RLS supplies it
 * from the JWT, and a filter written here would be a tenant fence made of client-reachable code
 * (AGENTS.md §6: tenant isolation is structural).
 *
 * Any error, on any of the three, yields null: the brief is still planned, and the rows arrive
 * untyped with the response saying so. A taxonomy read must never cost somebody their proposal.
 */
export async function readCallerVocabulary(
  caller: CallerClient,
): Promise<DeliverableVocabulary | null> {
  try {
    const [types, categories, channels, departments] = await Promise.all([
      // I59.39: paged. The type catalogue is the one list here that grows (269 on the local seed
      // alone), and past PostgREST's 1,000-row cut the model would silently lose every later code.
      allRowsResult((from, to) =>
        caller.from('deliverable_types').select('code, name_en, category_code').eq('is_active', true).order('code').order('id').range(from, to),
      ),
      caller.from('deliverable_categories').select('code, name_en').eq('is_active', true).order('sort_order'),
      caller
        .from('deliverable_attribute_values')
        .select('code, label_en')
        .eq('attribute', 'channel')
        .eq('is_active', true)
        .order('sort_order'),
      // ADR-0101 d.2: names only, read as the caller like the rest — RLS keeps it to their tenant.
      caller.from('departments').select('id, name').order('name'),
    ])
    if (types.error || categories.error || channels.error) return null

    const typeRows = (types.data ?? []) as { code: string; name_en: string; category_code: string }[]
    const categoryRows = (categories.data ?? []) as { code: string; name_en: string }[]
    const channelRows = (channels.data ?? []) as { code: string; label_en: string }[]
    // A department read that fails costs only the departments: groups arrive with none (d.3).
    const departmentRows = departments.error ? [] : ((departments.data ?? []) as { id: string; name: string }[])
    return {
      types: typeRows.map((r) => ({ code: r.code, name: r.name_en, categoryCode: r.category_code })),
      categories: categoryRows.map((r) => ({ code: r.code, label: r.name_en })),
      channels: channelRows.map((r) => ({ code: r.code, label: r.label_en })),
      departments: departmentRows.map((r) => ({ code: r.id, label: r.name })),
    }
  } catch {
    return null
  }
}

export interface GenerateEnvironment {
  getEnv: (key: string) => string | undefined
  makeCallerClient: (authHeader: string) => CallerClient
  hasPermission: (caller: CallerClient, resource: string, action: string) => Promise<boolean>
  fetchImpl: typeof fetch
  timeoutMs: number
}

/** ADR-0049 d.2: model choice is config, not code. Same default as ingest-brief. */
export const DEFAULT_MODEL = 'gpt-5.6-luna'

export function createGenerateEntry(
  env: GenerateEnvironment,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })

    const apiKey = env.getEnv('OPENAI_API_KEY')
    if (!apiKey) {
      // Degrade, don't break: the wizard says so and the person types the list, which is
      // exactly what they do today.
      return fail(
        503,
        'model_unconfigured',
        'Deliverable proposals are not configured yet.',
        corsHeaders,
      )
    }

    const handler = createGenerateHandler(
      {
        authenticate: async (authHeader) => {
          if (!authHeader) return false
          const { data, error } = await env.makeCallerClient(authHeader).auth.getUser()
          return !error && Boolean(data.user)
        },
        hasProjectsManage: (authHeader) =>
          env.hasPermission(env.makeCallerClient(authHeader), 'projects', 'manage'),
        // Caller-scoped, exactly like the permission check above it. The browser never sends the
        // vocabulary and cannot influence it (ADR-0054 d.2).
        readVocabulary: (authHeader) => readCallerVocabulary(env.makeCallerClient(authHeader)),
        openaiApiKey: apiKey,
        model: env.getEnv('OPENAI_MODEL') ?? DEFAULT_MODEL,
        fetchImpl: env.fetchImpl,
        timeoutMs: env.timeoutMs,
      },
      corsHeaders,
    )
    return handler(req)
  }
}
