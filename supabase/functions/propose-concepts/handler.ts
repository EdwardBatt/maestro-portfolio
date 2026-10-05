// propose-concepts — the ONE working concept proposed against a department's brief (ADR-0065 and
// its 13 Sep addendum, I34.2 / I48.15).
//
// SAFETY, and it is the reason this is its own function rather than fields on `generate-brief`:
//
//   • The model gets no tools, no data access and no ability to write anything. It receives one
//     brief as text (and, on regeneration, the items a person kept) and returns one JSON object,
//     validated against a schema it was given.
//   • It may PROPOSE an approach. It may not produce a FACT the brief does not contain — the rule
//     is `FACT_RULE`, imported from `_shared/brief-rules.ts` and shared byte-for-byte with
//     `generate-brief` (I34.3), because two copies of that sentence would eventually disagree and
//     the disagreement would be invisible.
//   • The brief's field keys are read SERVER-SIDE on the caller's own client under RLS. A browser
//     cannot widen the vocabulary. Output is Zod-validated against the same list; an answer citing
//     a field that does not exist loses the citation, not the proposal.
//
// TWO MODES, ONE CALL (addendum d.10 / d.11):
//
//   • No concept yet → propose one: strategic thinking, creative direction, pillars. No content
//     types (d.9) — deliverables are already defined on the campaign.
//   • A concept exists and items were deleted → REGENERATE the removed ones only. The kept items
//     travel to the model as fixed context; the schema is narrowed to the shapes with open slots;
//     the answer is capped at the slot count per shape and appended to the kept items. The row is
//     updated in place, `slots` reset, `regenerations` bumped (the trigger stamps who/when).
//   • A concept exists and nothing was deleted → 409. There is nothing to fill.

import { z } from 'npm:zod@4'
import { callModelJson, ModelCallError } from '../_shared/model.ts'
import { FACT_RULE, UNTRUSTED_BRIEF_NOTICE } from '../_shared/brief-rules.ts'

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** A whole concept is a longer answer than a brief field, and nobody reads 16k of it. */
const MAX_OUTPUT_TOKENS = 8_000
/** Per proposal. Long enough for a paragraph, short enough that nothing runs away. */
export const MAX_PROPOSAL_CHARS = 2_000
/** More than this from one press is noise, not choice. */
export const MAX_PER_SHAPE = 6

export const requestSchema = z.object({ campaignBriefId: z.string().uuid() })

/** The three shapes of ADR-0065 d.3 minus d.9's content types, in the order a reviewer reads them. */
export const SHAPES = ['strategic_thinking', 'creative_direction', 'pillars'] as const
export type Shape = (typeof SHAPES)[number]

export interface Proposal {
  /** Addresses the item for keep/delete (addendum d.10). Minted here, never by the model. */
  id: string
  shape: Shape
  /** Pillars carry a short name; the other two do not. */
  name?: string
  text: string
  /** ADR-0065 d.4 — brief field keys this answers. Empty means unsupported (d.5), never dropped. */
  answers: string[]
  /** Set by `campaign_concept_mark_item('keep')`; a regeneration never touches it. */
  kept?: boolean
}

/** How many items each shape must produce — the slots deletions opened (addendum d.11). */
export type Slots = Partial<Record<Shape, number>>

/** Everything the prompt and the schema are built from, all of it read under RLS. */
export interface ConceptContext {
  /**
   * Taken from the BRIEF ROW, not asked for separately. A concept belongs to the same tenant as
   * the brief it answers, by definition — and the row is already in hand and already fenced by
   * RLS, so there is nothing to look up and nothing that can disagree.
   */
  tenantId: string
  departmentName: string
  briefText: string
  fieldKeys: string[]
  /** What this department is already delivering on this campaign. Context, never a constraint. */
  deliverableNames: string[]
  /** The working concept, when one exists. Null on the first press. */
  existing: { id: string; proposals: Proposal[]; slots: Slots; regenerations: number } | null
}

/** Which shapes the call must produce, and how many of each. Every shape, uncapped, on a first press. */
export function slotsToFill(ctx: ConceptContext): Slots | null {
  if (!ctx.existing) return null
  const out: Slots = {}
  for (const shape of SHAPES) {
    const n = Number(ctx.existing.slots[shape] ?? 0)
    if (Number.isInteger(n) && n > 0) out[shape] = Math.min(n, MAX_PER_SHAPE)
  }
  return out
}

const SHAPE_LABEL: Record<Shape, string> = {
  strategic_thinking: 'strategic thinking',
  creative_direction: 'creative direction',
  pillars: 'pillars',
}

// ---- the prompt -------------------------------------------------------------

export function conceptsSystemPrompt(ctx: ConceptContext): string {
  const slots = slotsToFill(ctx)
  const regenerating = slots != null && Object.keys(slots).length > 0
  return [
    `You propose a creative concept for the ${ctx.departmentName} team, from the brief they have been given.`,
    'A person reviews everything you write, keeps what is useful and deletes the rest.',
    '',
    ...UNTRUSTED_BRIEF_NOTICE,
    '',
    'Rules:',
    // The line this whole ADR turns on. A proposal may be new; a fact may not.
    FACT_RULE,
    '- You MAY propose an approach the brief does not mention. That is the point of this task.',
    '- Every proposal must ANSWER the brief: serve its objective, speak to its audience, respect its',
    '  tone and mandatories, and fit its constraints. A proposal that ignores them is off-brief, not bold.',
    '- For each proposal, list in "answers" the brief fields it responds to. Use only the field keys',
    '  offered by the schema. If a proposal genuinely answers none of them, return an empty list —',
    '  do not attach a field it does not address.',
    '- Do not describe what is trending, what audiences are doing now, or what other brands are doing.',
    '  You cannot check any of it, and an unverifiable claim presented as insight is worse than silence.',
    // Addendum d.9: the deliverables are decided. The concept is thinking, direction and pillars.
    '- Do NOT suggest deliverables, formats or content types. What will be made is already decided;',
    '  your job is the thinking behind it.',
    ctx.deliverableNames.length
      ? `This team is already delivering on this campaign: ${ctx.deliverableNames.join('; ')}. Write for that work.`
      : '',
    regenerating
      ? [
          '',
          // Addendum d.11: fill the gaps, do not redo the concept.
          'A working concept already exists. The person KEPT the items listed under <kept> and DELETED',
          'others. Write ONLY replacements for what was deleted — the counts below are exact — and make',
          'them sit alongside the kept items as one concept: consistent with them, not repeating them,',
          'and not re-proposing anything that was deleted in different words.',
          ...Object.entries(slots).map(([shape, n]) => `- ${SHAPE_LABEL[shape as Shape]}: exactly ${n} new item(s).`),
        ].join('\n')
      : `- At most ${MAX_PER_SHAPE} entries per section, each under ${MAX_PROPOSAL_CHARS} characters.`,
    '- Write in the language the brief is written in. Do not translate it.',
    '- Reply with the JSON object and nothing else.',
  ]
    .filter((line) => line !== '' || true)
    .join('\n')
}

export function conceptsUserText(ctx: ConceptContext): string {
  const kept = ctx.existing?.proposals ?? []
  const keptBlock = kept.length
    ? `\n<kept>\n${kept
        .map((p) => `- [${SHAPE_LABEL[p.shape]}]${p.name ? ` ${p.name}:` : ''} ${p.text}`)
        .join('\n')}\n</kept>`
    : ''
  return `<brief>\n${ctx.briefText}\n</brief>${keptBlock}`
}

// ---- the schema -------------------------------------------------------------

/**
 * Strict mode wants a closed object with every property required. An empty `enum: []` is not
 * valid JSON Schema, so a tenant with no template fields gets a plain string there and
 * `flattenProposals` drops what it cannot recognise — the ADR-0054 d.6 posture: the vocabulary
 * failing costs the citation, never the proposal.
 *
 * On regeneration the object is narrowed to the shapes with open slots, so the model cannot hand
 * back a whole new concept.
 */
export function conceptsJsonSchema(ctx: ConceptContext): Record<string, unknown> {
  const answers = {
    type: 'array',
    items: ctx.fieldKeys.length ? { type: 'string', enum: ctx.fieldKeys } : { type: 'string' },
  }
  const prose = (extra: Record<string, unknown> = {}, extraRequired: string[] = []) => ({
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'answers', ...extraRequired],
      properties: { text: { type: 'string' }, answers, ...extra },
    },
  })
  const slots = slotsToFill(ctx)
  const shapes = slots && Object.keys(slots).length ? (Object.keys(slots) as Shape[]) : [...SHAPES]
  const properties: Record<string, unknown> = {}
  for (const shape of shapes) {
    properties[shape] = shape === 'pillars' ? prose({ name: { type: 'string' } }, ['name']) : prose()
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: shapes,
    properties,
  }
}

// ---- validating the answer --------------------------------------------------

const entrySchema = z.object({
  text: z.string(),
  name: z.string().optional(),
  answers: z.array(z.string()).optional(),
})
const answerSchema = z.object({
  strategic_thinking: z.array(entrySchema).optional(),
  creative_direction: z.array(entrySchema).optional(),
  pillars: z.array(entrySchema).optional(),
})

/**
 * Flatten the sections into one ordered array, which is how `campaign_concepts.proposals` stores
 * them: a reviewer reads down a list, and the section is a property of the row rather than a level
 * of nesting nobody navigates. Each item is given an id here (addendum d.10).
 *
 * Drops: empty text, unknown field keys, anything beyond the cap — the per-shape cap, or on
 * regeneration the slot count. Keeps: a proposal whose citations were all dropped — that is d.5,
 * and it is rendered marked rather than hidden.
 */
export function flattenProposals(raw: unknown, ctx: ConceptContext, mintId: () => string = () => crypto.randomUUID()): Proposal[] {
  const parsed = answerSchema.safeParse(raw ?? {})
  if (!parsed.success) return []
  const keys = new Set(ctx.fieldKeys)
  const slots = slotsToFill(ctx)
  const regenerating = slots != null && Object.keys(slots).length > 0
  const out: Proposal[] = []

  for (const shape of SHAPES) {
    const cap = regenerating ? (slots[shape] ?? 0) : MAX_PER_SHAPE
    if (cap === 0) continue
    const rows = parsed.data[shape] ?? []
    // The cap counts what SURVIVES, not what arrived: slicing first would let two malformed rows
    // at the top of a section silently cost two good ones at the bottom.
    let kept = 0
    for (const row of rows) {
      if (kept >= cap) break
      const text = row.text.trim()
      if (!text || text.length > MAX_PROPOSAL_CHARS) continue
      const name = row.name?.trim()
      out.push({
        id: mintId(),
        shape,
        ...(shape === 'pillars' && name ? { name } : {}),
        text,
        answers: (row.answers ?? []).filter((k) => keys.has(k)),
      })
      kept += 1
    }
  }
  return out
}

/** The department brief as one readable document. Skips `N/A` — it is noise to reason from. */
export function renderBrief(values: Record<string, unknown>, fields: { key: string; label: string }[]): string {
  return fields
    .map((f) => ({ label: f.label, value: typeof values[f.key] === 'string' ? (values[f.key] as string).trim() : '' }))
    .filter((f) => f.value && f.value !== 'N/A')
    .map((f) => `${f.label}: ${f.value}`)
    .join('\n\n')
}

// ---- the request ------------------------------------------------------------

interface ErrorBody { error: { code: string; message: string } }

function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}
function fail(status: number, code: string, message: string, headers: Record<string, string>): Response {
  return json(status, { error: { code, message } } satisfies ErrorBody, headers)
}

export interface CallerResult {
  data: unknown
  error: unknown
}

/**
 * A PostgREST builder is ITSELF awaitable: `select().eq()` with no terminal call is a complete
 * query. Extending `PromiseLike` says that once, and every chain that ends without
 * `maybeSingle()` or `single()` type-checks the way it already behaved at runtime. `update` is new
 * here (addendum d.10 — the row is refined in place).
 */
export interface CallerTableQuery extends PromiseLike<CallerResult> {
  select: (columns: string) => CallerTableQuery
  eq: (column: string, value: unknown) => CallerTableQuery
  order: (column: string) => CallerTableQuery
  maybeSingle: () => PromiseLike<CallerResult>
  single: () => PromiseLike<CallerResult>
  insert: (row: Record<string, unknown>) => CallerTableQuery
  update: (row: Record<string, unknown>) => CallerTableQuery
}

export interface CallerClient {
  auth: { getUser: () => PromiseLike<{ data: { user: unknown }; error: unknown }> }
  rpc: (fn: string, params: Record<string, unknown>) => PromiseLike<CallerResult>
  from: (table: string) => CallerTableQuery
}

export interface ProposeDeps {
  authenticate: (authHeader: string) => Promise<boolean>
  hasProjectsManage: (authHeader: string) => Promise<boolean>
  makeCallerClient: (authHeader: string) => CallerClient
  openaiApiKey: string
  model: string
  fetchImpl: typeof fetch
  timeoutMs: number
}

/**
 * Everything the model is allowed to see, assembled on the CALLER's client so RLS decides what
 * that is. Nothing here is accepted from the browser — not the brief, not the field list, not the
 * kept items. A caller who cannot read the brief gets null and a 404, which is the same answer a
 * caller in another tenant gets, because RLS cannot tell them apart and should not.
 */
export async function readConceptContext(
  caller: CallerClient,
  campaignBriefId: string,
): Promise<ConceptContext | null> {
  const brief = await caller
    .from('campaign_briefs')
    .select('id, tenant_id, campaign_id, brief_type, department_id, values')
    .eq('id', campaignBriefId)
    .maybeSingle()
  if (brief.error || !brief.data) return null
  const b = brief.data as {
    tenant_id: string
    campaign_id: string
    brief_type: string
    department_id: string
    values: Record<string, unknown>
  }

  const [template, department, campaignWork, concept] = await Promise.all([
    caller.from('brief_templates').select('fields').eq('brief_type', b.brief_type).maybeSingle(),
    caller.from('departments').select('name').eq('id', b.department_id).maybeSingle(),
    // A deliverable reaches its campaign through `streams`, never directly — the filter has to go
    // through the embed, and `!inner` is what makes that a filter rather than a left join.
    caller
      .from('deliverables')
      .select('name, streams!inner(campaign_id)')
      .eq('department_id', b.department_id)
      .eq('streams.campaign_id', b.campaign_id),
    // The working concept, if there is one (addendum d.10: at most one per brief).
    caller.from('campaign_concepts').select('id, proposals, slots, regenerations').eq('campaign_brief_id', campaignBriefId).maybeSingle(),
  ])

  const rawFields = ((template.data as { fields?: unknown } | null)?.fields ?? []) as {
    key?: unknown
    en?: unknown
  }[]
  const fields = rawFields
    .filter((f): f is { key: string; en?: string } => typeof f.key === 'string')
    .map((f) => ({ key: f.key, label: typeof f.en === 'string' ? f.en : f.key }))

  const existingRow = concept.error
    ? null
    : (concept.data as { id: string; proposals: Proposal[] | null; slots: Slots | null; regenerations: number | null } | null)

  return {
    tenantId: b.tenant_id,
    departmentName: (department.data as { name?: string } | null)?.name ?? 'this',
    briefText: renderBrief(b.values ?? {}, fields),
    fieldKeys: fields.map((f) => f.key),
    deliverableNames: campaignWork.error
      ? []
      : ((campaignWork.data ?? []) as { name: string }[]).map((d) => d.name),
    existing: existingRow
      ? {
          id: existingRow.id,
          proposals: existingRow.proposals ?? [],
          slots: existingRow.slots ?? {},
          regenerations: existingRow.regenerations ?? 0,
        }
      : null,
  }
}

export function createProposeConceptsHandler(
  deps: ProposeDeps,
  headers: Record<string, string>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'POST only.', headers)

    // Authorize BEFORE parsing, so an anonymous caller cannot drive validation — the finding from
    // the ADR-0044 review, applied here from the start.
    const authHeader = req.headers.get('authorization') ?? ''
    if (!(await deps.authenticate(authHeader)))
      return fail(401, 'unauthorized', 'Sign in first.', headers)
    if (!(await deps.hasProjectsManage(authHeader)))
      return fail(403, 'forbidden', 'You cannot propose concepts on this campaign.', headers)

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return fail(400, 'invalid_input', 'Expected a JSON body.', headers)
    }
    const input = requestSchema.safeParse(body)
    if (!input.success) return fail(400, 'invalid_input', 'Expected { campaignBriefId }.', headers)

    const caller = deps.makeCallerClient(authHeader)
    const ctx = await readConceptContext(caller, input.data.campaignBriefId)
    if (!ctx) return fail(404, 'not_found', 'That brief could not be found.', headers)
    // Nothing written yet is not a failure to report as one: there is simply nothing to work from.
    if (!ctx.briefText.trim())
      return fail(422, 'brief_empty', 'This brief has nothing written in it yet.', headers)

    const slots = slotsToFill(ctx)
    const regenerating = slots != null
    if (regenerating && Object.keys(slots).length === 0)
      return fail(409, 'nothing_removed', 'Nothing has been removed from the concept, so there is nothing to regenerate. Delete an item first.', headers)

    let proposals: Proposal[]
    try {
      const raw = await callModelJson({
        apiKey: deps.openaiApiKey,
        model: deps.model,
        systemPrompt: conceptsSystemPrompt(ctx),
        userText: conceptsUserText(ctx),
        schema: conceptsJsonSchema(ctx),
        schemaName: 'campaign_concept',
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        fetchImpl: deps.fetchImpl,
        timeoutMs: deps.timeoutMs,
      })
      proposals = flattenProposals(raw, ctx)
    } catch (e) {
      const code = e instanceof ModelCallError ? e.code : 'model_unavailable'
      // Surfaces in `supabase functions logs propose-concepts`. Brief text is NOT logged.
      console.error(`propose-concepts: ${code}`, e instanceof Error ? e.message : e)
      if (code === 'model_truncated')
        return fail(502, 'model_truncated', 'The answer ran long. Try again, or shorten the brief.', headers)
      return fail(502, 'model_unavailable', 'Concepts could not be proposed right now.', headers)
    }

    // An answer that survived validation with nothing in it is not stored. An empty concept on the
    // screen is indistinguishable from a broken button, and storing one would make it permanent.
    if (proposals.length === 0)
      return fail(502, 'model_empty', 'Nothing usable came back. Try again.', headers)

    if (regenerating && ctx.existing) {
      // Addendum d.11: the new items take the deleted ones' place in the SAME concept. Kept items
      // are untouched; the slots close; the trigger stamps who regenerated and when.
      const merged = [...ctx.existing.proposals, ...proposals]
      const written = await caller
        .from('campaign_concepts')
        .update({ proposals: merged, slots: {}, regenerations: ctx.existing.regenerations + 1, model: deps.model })
        .eq('id', ctx.existing.id)
        .select('id, created_at')
        .single()
      if (written.error) {
        console.error('propose-concepts: update failed', written.error)
        return fail(502, 'not_saved', 'The regenerated items could not be saved.', headers)
      }
      const row = written.data as { id: string; created_at: string }
      return json(200, { id: row.id, createdAt: row.created_at, proposals: merged, regenerated: proposals.length }, headers)
    }

    // The tenant comes off the brief row (read above, under RLS). RLS is the fence either way — the
    // policy's WITH CHECK re-tests this against the JWT. `requested_by` is stamped by the trigger.
    const written = await caller
      .from('campaign_concepts')
      .insert({
        tenant_id: ctx.tenantId,
        campaign_brief_id: input.data.campaignBriefId,
        proposals,
        model: deps.model,
      })
      .select('id, created_at')
      .single()
    if (written.error) {
      console.error('propose-concepts: insert failed', written.error)
      return fail(502, 'not_saved', 'The concept could not be saved.', headers)
    }

    const row = written.data as { id: string; created_at: string }
    return json(200, { id: row.id, createdAt: row.created_at, proposals, regenerated: 0 }, headers)
  }
}

// ---- the entry point --------------------------------------------------------

export interface ProposeConceptsEnvironment {
  getEnv: (key: string) => string | undefined
  makeCallerClient: (authHeader: string) => CallerClient
  hasPermission: (caller: CallerClient, resource: string, action: string) => Promise<boolean>
  fetchImpl: typeof fetch
  timeoutMs: number
}

/** ADR-0065 d.9 / ADR-0049 d.2: model choice is configuration, not code. */
export const DEFAULT_MODEL = 'gpt-5.6-luna'

export function createProposeConceptsEntry(
  env: ProposeConceptsEnvironment,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })

    const apiKey = env.getEnv('OPENAI_API_KEY')
    if (!apiKey)
      return fail(503, 'model_unconfigured', 'Concept proposals are not configured yet.', corsHeaders)

    return createProposeConceptsHandler(
      {
        authenticate: async (authHeader) => {
          if (!authHeader) return false
          const { data, error } = await env.makeCallerClient(authHeader).auth.getUser()
          return !error && Boolean(data.user)
        },
        hasProjectsManage: (authHeader) =>
          env.hasPermission(env.makeCallerClient(authHeader), 'projects', 'manage'),
        makeCallerClient: env.makeCallerClient,
        openaiApiKey: apiKey,
        model: env.getEnv('OPENAI_MODEL') ?? DEFAULT_MODEL,
        fetchImpl: env.fetchImpl,
        timeoutMs: env.timeoutMs,
      },
      corsHeaders,
    )(req)
  }
}
