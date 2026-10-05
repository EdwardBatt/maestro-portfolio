import { describe, expect, it, vi } from 'vitest'
import {
  MAX_PER_SHAPE,
  MAX_PROPOSAL_CHARS,
  conceptsJsonSchema,
  conceptsSystemPrompt,
  conceptsUserText,
  createProposeConceptsHandler,
  flattenProposals,
  renderBrief,
  slotsToFill,
  type CallerClient,
  type ConceptContext,
} from './handler'
import { FACT_RULE } from '../_shared/brief-rules'

/**
 * propose-concepts (ADR-0065 + the 13 Sep addendum, I34.2 / I48.15). The model call is stubbed;
 * what is under test is everything around it — the prompt's two halves (may propose, may not
 * state a fact), the closed vocabulary, the two modes (propose / regenerate removed), and what
 * survives validation.
 *
 * The assertion that matters most is `d.5`: a proposal whose citations were all dropped is KEPT.
 * Dropping it would be the easy implementation and would silently hide either a thin brief or an
 * off-brief idea, which are the two things a reviewer most needs to see.
 */

interface SchemaSection {
  items: { properties: Record<string, { enum?: string[]; items?: unknown; type?: string }> }
}
const schemaProps = (schema: Record<string, unknown>) =>
  (schema as { properties: Record<string, SchemaSection> }).properties

const ctx: ConceptContext = {
  tenantId: 'tenant-a',
  departmentName: 'Creative',
  briefText: 'Objective: launch the card.\n\nAudience: 25-34 in Cairo.',
  fieldKeys: ['objective', 'audience', 'tone'],
  deliverableNames: ['Ramadan TVC'],
  existing: null,
}

/** A working concept with one pillar deleted and one kept. */
const regenCtx: ConceptContext = {
  ...ctx,
  existing: {
    id: 'concept-1',
    proposals: [
      { id: 'p1', shape: 'pillars', name: 'Warmth', text: 'Family first.', answers: ['audience'], kept: true },
      { id: 's1', shape: 'strategic_thinking', text: 'Own the moment.', answers: ['objective'] },
    ],
    slots: { pillars: 1 },
    regenerations: 0,
  },
}

describe('the prompt (ADR-0065 d.2)', () => {
  const prompt = conceptsSystemPrompt(ctx)

  it('carries the SHARED fact rule, not a paraphrase of it', () => {
    // I34.3. If this ever fails because someone reworded one prompt, that is the drift the shared
    // constant exists to prevent — fix the constant, not this test.
    expect(prompt).toContain(FACT_RULE)
  })

  it('permits proposing an approach, which is what separates it from generate-brief', () => {
    expect(prompt).toContain('You MAY propose an approach the brief does not mention')
    expect(prompt).toContain('must ANSWER the brief')
  })

  it('forbids trend claims explicitly (d.12)', () => {
    expect(prompt).toContain('Do not describe what is trending')
  })

  // Addendum d.9: deliverables are decided on the campaign; the model no longer suggests formats.
  it('forbids suggesting deliverables or content types (addendum d.9)', () => {
    expect(prompt).toContain('Do NOT suggest deliverables, formats or content types')
    expect(prompt).not.toContain('content_types')
  })

  it('names what the team is already delivering, as context', () => {
    expect(prompt).toContain('Ramadan TVC')
  })
})

describe('regeneration (addendum d.11)', () => {
  it('a first press fills every shape; a regeneration fills only the open slots', () => {
    expect(slotsToFill(ctx)).toBeNull()
    expect(slotsToFill(regenCtx)).toEqual({ pillars: 1 })
    expect(slotsToFill({ ...regenCtx, existing: { ...regenCtx.existing!, slots: {} } })).toEqual({})
  })

  it('tells the model the exact counts and hands it the kept items as fixed context', () => {
    const prompt = conceptsSystemPrompt(regenCtx)
    expect(prompt).toContain('pillars: exactly 1 new item(s)')
    expect(prompt).toContain('Write ONLY replacements for what was deleted')
    const user = conceptsUserText(regenCtx)
    expect(user).toContain('<kept>')
    expect(user).toContain('Warmth: Family first.')
    expect(user).toContain('Own the moment.')
  })

  it('narrows the schema to the shapes with slots, so a whole new concept cannot come back', () => {
    const schema = conceptsJsonSchema(regenCtx)
    expect(Object.keys(schemaProps(schema))).toEqual(['pillars'])
    expect((schema as { required: string[] }).required).toEqual(['pillars'])
  })

  it('caps the answer at the slot count, whatever the model sent', () => {
    const out = flattenProposals(
      { pillars: [{ name: 'A', text: 'a', answers: [] }, { name: 'B', text: 'b', answers: [] }] },
      regenCtx,
      () => 'new',
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'new', shape: 'pillars', name: 'A' })
  })
})

describe('the schema', () => {
  it('closes the citation vocabulary to the caller’s own field keys and has no content types', () => {
    const p = schemaProps(conceptsJsonSchema(ctx))
    expect(Object.keys(p)).toEqual(['strategic_thinking', 'creative_direction', 'pillars'])
    expect((p.pillars.items.properties.answers.items as { enum: string[] }).enum).toEqual(['objective', 'audience', 'tone'])
  })

  it('falls back to a plain string rather than emitting an invalid empty enum', () => {
    const p = schemaProps(conceptsJsonSchema({ ...ctx, fieldKeys: [] }))
    expect(p.pillars.items.properties.answers.items).toEqual({ type: 'string' })
  })
})

describe('flattenProposals', () => {
  it('flattens the sections into one ordered list, tagged by shape, each with an id', () => {
    let n = 0
    const out = flattenProposals(
      {
        strategic_thinking: [{ text: 'own the moment', answers: ['objective'] }],
        creative_direction: [{ text: 'warm, handheld', answers: ['tone', 'audience'] }],
        pillars: [{ name: 'Belonging', text: 'a place at the table', answers: ['audience'] }],
      },
      ctx,
      () => `id-${++n}`,
    )
    expect(out.map((p) => p.shape)).toEqual(['strategic_thinking', 'creative_direction', 'pillars'])
    expect(out.map((p) => p.id)).toEqual(['id-1', 'id-2', 'id-3'])
    expect(out[2]).toMatchObject({ name: 'Belonging', answers: ['audience'] })
  })

  it('KEEPS a proposal whose citations were all invalid, with no answers (d.5)', () => {
    const out = flattenProposals({ strategic_thinking: [{ text: 'x', answers: ['budget', 'nope'] }] }, ctx)
    expect(out).toHaveLength(1)
    expect(out[0]!.answers).toEqual([])
  })

  it('ignores a content_types section if the model sends one anyway (d.9)', () => {
    const out = flattenProposals({ content_types: [{ text: 'reel', type_code: 'SOC-004', answers: [] }] }, ctx)
    expect(out).toHaveLength(0)
  })

  it('drops empty and over-long text, and caps each section', () => {
    const many = Array.from({ length: MAX_PER_SHAPE + 3 }, (_, i) => ({ text: `idea ${i}`, answers: [] }))
    const out = flattenProposals(
      { strategic_thinking: [{ text: '  ', answers: [] }, { text: 'x'.repeat(MAX_PROPOSAL_CHARS + 1), answers: [] }, ...many] },
      ctx,
    )
    expect(out).toHaveLength(MAX_PER_SHAPE)
  })

  it('survives a malformed answer without throwing', () => {
    expect(flattenProposals('nonsense', ctx)).toEqual([])
    expect(flattenProposals(null, ctx)).toEqual([])
  })
})

describe('renderBrief', () => {
  it('labels each field and skips N/A, which is noise to reason from', () => {
    const out = renderBrief({ objective: 'launch', tone: 'N/A', audience: '  ' }, [
      { key: 'objective', label: 'Objective' },
      { key: 'tone', label: 'Tone' },
      { key: 'audience', label: 'Audience' },
    ])
    expect(out).toBe('Objective: launch')
  })
})

describe('the request path', () => {
  const headers = { 'Access-Control-Allow-Origin': '*' }
  const post = (body: unknown) =>
    new Request('https://x/propose-concepts', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const deps = (over: Partial<Parameters<typeof createProposeConceptsHandler>[0]> = {}) => ({
    authenticate: async () => true,
    hasProjectsManage: async () => true,
    makeCallerClient: () => ({}) as unknown as CallerClient,
    openaiApiKey: 'k',
    model: 'gpt-5.6-luna',
    fetchImpl: vi.fn() as unknown as typeof fetch,
    timeoutMs: 1000,
    ...over,
  })

  it('refuses an anonymous caller BEFORE parsing the body', async () => {
    const parse = vi.fn()
    const res = await createProposeConceptsHandler(deps({ authenticate: async () => false }), headers)(
      new Request('https://x', { method: 'POST', body: '{' }),
    )
    expect(res.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
  })

  it('refuses a caller without projects:manage', async () => {
    const res = await createProposeConceptsHandler(deps({ hasProjectsManage: async () => false }), headers)(
      post({ campaignBriefId: '11111111-1111-4111-8111-111111111111' }),
    )
    expect(res.status).toBe(403)
  })

  it('rejects a body that is not a brief id', async () => {
    const res = await createProposeConceptsHandler(deps(), headers)(post({ campaignBriefId: 'nope' }))
    expect(res.status).toBe(400)
  })

  it('405s anything that is not a POST', async () => {
    const res = await createProposeConceptsHandler(deps(), headers)(new Request('https://x', { method: 'GET' }))
    expect(res.status).toBe(405)
  })
})

/**
 * The write path, end to end with a fake PostgREST and a fake OpenAI.
 *
 * **This test exists because its absence cost a production outage.** The request-path tests above
 * stop at 401/403/400/405, so nothing ever exercised a successful call — and the insert once built
 * its `tenant_id` from an `rpc()` that does not exist in `public`. A single happy-path assertion
 * would have caught it before deploy.
 */
describe('the write path', () => {
  const headers = { 'Access-Control-Allow-Origin': '*' }

  const modelSaid = (answer: unknown) =>
    (async () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [{ content: [{ type: 'output_text', text: JSON.stringify(answer) }] }],
        }),
        { status: 200 },
      )) as unknown as typeof fetch

  /** Records what the insert / update was handed, which is the whole point of the test. */
  function fakeClient(existingConcept: Record<string, unknown> | null = null) {
    const inserted: Record<string, unknown>[] = []
    const updated: Record<string, unknown>[] = []
    const rows: Record<string, unknown> = {
      campaign_briefs: {
        tenant_id: 'tenant-a',
        brief_type: 'creative',
        department_id: 'dept-1',
        values: { objective: 'launch the card' },
      },
      brief_templates: { fields: [{ key: 'objective', en: 'Objective' }] },
      departments: { name: 'Creative' },
      campaign_concepts: existingConcept,
    }
    const client = {
      auth: { getUser: async () => ({ data: { user: {} }, error: null }) },
      rpc: async () => {
        throw new Error('this function must not call rpc()')
      },
      from: (table: string) => {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          order: async () => ({ data: [], error: null }),
          maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
          single: async () => ({ data: { id: 'concept-1', created_at: '2026-09-02T12:00:00Z' }, error: null }),
          insert: (row: Record<string, unknown>) => {
            inserted.push(row)
            return chain
          },
          update: (row: Record<string, unknown>) => {
            updated.push(row)
            return chain
          },
          then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
        }
        return chain
      },
    }
    return { client, inserted, updated }
  }

  const post = () =>
    new Request('https://x/propose-concepts', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ campaignBriefId: '11111111-1111-4111-8111-111111111111' }),
    })

  const handler = (client: unknown, answer: unknown) =>
    createProposeConceptsHandler(
      {
        authenticate: async () => true,
        hasProjectsManage: async () => true,
        makeCallerClient: () => client as CallerClient,
        openaiApiKey: 'k',
        model: 'gpt-5.6-luna',
        fetchImpl: modelSaid(answer),
        timeoutMs: 1000,
      },
      headers,
    )

  it('stores the concept on a first press, taking tenant_id from the BRIEF ROW and never calling rpc()', async () => {
    const { client, inserted, updated } = fakeClient()
    const res = await handler(client, {
      strategic_thinking: [{ text: 'own the moment', answers: ['objective'] }],
      creative_direction: [],
      pillars: [],
    })(post())

    expect(res.status).toBe(200)
    expect(inserted).toHaveLength(1)
    expect(updated).toHaveLength(0)
    expect(inserted[0]!.tenant_id).toBe('tenant-a')
    expect(inserted[0]!.campaign_brief_id).toBe('11111111-1111-4111-8111-111111111111')
    expect(inserted[0]!.model).toBe('gpt-5.6-luna')
    expect(inserted[0]).not.toHaveProperty('requested_by')
    const body = (await res.json()) as { id: string; proposals: { id: string }[]; regenerated: number }
    expect(body.id).toBe('concept-1')
    expect(body.proposals).toHaveLength(1)
    expect(body.proposals[0]!.id).toBeTruthy()
    expect(body.regenerated).toBe(0)
  })

  it('regenerates ONLY the removed items and refines the same row (addendum d.11)', async () => {
    const { client, inserted, updated } = fakeClient({
      id: 'concept-1',
      proposals: [{ id: 'p1', shape: 'pillars', name: 'Warmth', text: 'Family first.', answers: [], kept: true }],
      slots: { creative_direction: 2 },
      regenerations: 1,
    })
    const res = await handler(client, {
      creative_direction: [
        { text: 'warm, handheld', answers: ['objective'] },
        { text: 'quiet mornings', answers: [] },
        { text: 'a third the model was not asked for', answers: [] },
      ],
    })(post())

    expect(res.status).toBe(200)
    expect(inserted).toHaveLength(0)
    expect(updated).toHaveLength(1)
    const row = updated[0] as { proposals: { id: string; shape: string }[]; slots: unknown; regenerations: number }
    // The kept pillar is untouched and first; exactly two directions were added; the slots closed.
    expect(row.proposals.map((p) => p.shape)).toEqual(['pillars', 'creative_direction', 'creative_direction'])
    expect(row.proposals[0]!.id).toBe('p1')
    expect(row.slots).toEqual({})
    expect(row.regenerations).toBe(2)
    const body = (await res.json()) as { regenerated: number }
    expect(body.regenerated).toBe(2)
  })

  it('refuses to regenerate when nothing was removed — there is nothing to fill', async () => {
    const { client, inserted, updated } = fakeClient({ id: 'concept-1', proposals: [], slots: {}, regenerations: 0 })
    const res = await handler(client, { pillars: [{ name: 'x', text: 'y', answers: [] }] })(post())
    expect(res.status).toBe(409)
    expect(inserted).toHaveLength(0)
    expect(updated).toHaveLength(0)
  })

  it('does not store an answer that validated to nothing', async () => {
    const { client, inserted } = fakeClient()
    const res = await handler(client, { strategic_thinking: [], creative_direction: [], pillars: [] })(post())
    expect(res.status).toBe(502)
    expect(inserted).toHaveLength(0)
  })
})
