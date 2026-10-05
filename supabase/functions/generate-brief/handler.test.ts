import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NOT_APPLICABLE,
  briefSystemPrompt,
  briefValuesSchema,
  createGenerateBriefHandler,
  sanitizeBriefValues,
  type GenerateBriefDeps,
} from './handler.ts'
import { MAX_BRIEF_CHARS, MAX_FIELD_CHARS } from '../../../src/lib/brief/fields.ts'

const CORS = { 'Access-Control-Allow-Origin': '*' }

const FIELDS = [
  { key: 'background', en: 'Background', guidance: 'Where is the brand today?' },
  { key: 'task', en: 'The Task', guidance: 'One sentence.' },
]

/** A Responses-API success envelope carrying `values` as its output_text (ADR-0049). */
function modelResponse(values: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(values) }] }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

const fetchImpl = vi.fn<typeof fetch>()
const authenticate = vi.fn<GenerateBriefDeps['authenticate']>()
const mayGenerate = vi.fn<GenerateBriefDeps['mayGenerate']>()

function handler(overrides: Partial<GenerateBriefDeps> = {}) {
  return createGenerateBriefHandler(
    {
      authenticate,
      mayGenerate,
      openaiApiKey: 'sk-test',
      model: 'gpt-5.6-luna',
      fetchImpl,
      timeoutMs: 1_000,
      ...overrides,
    },
    CORS,
  )
}

function post(body: unknown) {
  return new Request('https://x/generate-brief', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const REQUEST = {
  // ADR-0072 d.2/d.3: the request carries which campaign and which department, because without
  // them the function cannot be scoped and cannot know whether the campaign is approved.
  campaignId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  departmentId: 'b5f8c2d1-3a4e-4b7c-9d2f-1e6a8c40b913',
  brief: 'Campaign: Ramadan. Proposition: Zeta keeps you in the room.',
  disciplineName: 'Creative',
  deliverables: ['60-second hero film'],
  fields: FIELDS,
}

beforeEach(() => {
  fetchImpl.mockReset()
  authenticate.mockReset().mockResolvedValue(true)
  mayGenerate.mockReset().mockResolvedValue('ok')
})

// ADR-0048 d.5/d.6 — one brief per discipline, and N/A rather than blank for what the master
// brief does not address.
describe('generate-brief handler (ADR-0048 d.5)', () => {
  it('returns a value for every requested field, and tells the model about the deliverables', async () => {
    fetchImpl.mockResolvedValue(
      modelResponse({ background: 'Flat awareness, falling consideration.', task: 'Win under-30s.' }),
    )
    const res = await handler()(post(REQUEST))
    expect(res.status).toBe(200)
    expect((await res.json()).values).toEqual({
      background: 'Flat awareness, falling consideration.',
      task: 'Win under-30s.',
    })

    const sent = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string)
    expect(sent.input[0].content).toContain('Creative brief')
    expect(sent.input[0].content).toContain('60-second hero film')
    // The master brief is DATA, and the prompt says so (ADR-0044 d.4, unchanged here).
    expect(sent.input[0].content).toContain('UNTRUSTED DATA')
    expect(sent.tools).toBeUndefined()
  })

  it('answers N/A — never blank — for a field the brief does not address', async () => {
    // d.6, and the deck's own rule. Blank cannot tell "does not apply" from "nobody filled it
    // in", and only one of those should be chased.
    fetchImpl.mockResolvedValue(modelResponse({ background: 'Something.', task: '   ' }))
    const body = await (await handler()(post(REQUEST))).json()
    expect(body.values.task).toBe(NOT_APPLICABLE)

    // A key the model omitted entirely gets the same treatment, not an absent key.
    fetchImpl.mockResolvedValue(modelResponse({ background: 'Something.' }))
    const body2 = await (await handler()(post(REQUEST))).json()
    expect(body2.values.task).toBe(NOT_APPLICABLE)
    expect(Object.keys(body2.values).sort()).toEqual(['background', 'task'])
  })

  it('tells the model to answer N/A, and not to translate the brief', async () => {
    const prompt = briefSystemPrompt('Paid Media', [])
    expect(prompt).toContain(`answer exactly "${NOT_APPLICABLE}"`)
    expect(prompt).toContain('Never leave a field empty')
    expect(prompt).toContain('Do not translate')
    // Inventing a number is the failure that makes a brief actively dangerous.
    expect(prompt).toContain('Never invent a number')
  })

  it('reports an over-long answer rather than truncating it', async () => {
    fetchImpl.mockResolvedValue(
      modelResponse({ background: 'x'.repeat(MAX_FIELD_CHARS + 1), task: 'Fine.' }),
    )
    const body = await (await handler()(post(REQUEST))).json()
    expect(body.oversized).toEqual(['background'])
    // And it is NOT shown as a finished field — the user is told, not quietly given half of it.
    expect(body.values.background).toBe(NOT_APPLICABLE)
    expect(body.values.task).toBe('Fine.')
  })

  it('builds a strict-mode schema from the template, so it stays portable', async () => {
    const schema = briefValuesSchema(FIELDS) as unknown as {
      required: string[]
      additionalProperties: boolean
      properties: Record<string, { description: string }>
    }
    expect(schema.required).toEqual(['background', 'task'])
    expect(schema.additionalProperties).toBe(false)
    // The template's guidance becomes the field's description — that is what makes editing
    // guidance in Admin change what gets generated (ADR-0048 d.2).
    expect(schema.properties.background.description).toContain('Where is the brand today?')
  })

  it('refuses a caller outside that department BEFORE the billable call', async () => {
    mayGenerate.mockResolvedValue('forbidden')
    const res = await handler()(post(REQUEST))
    expect(res.status).toBe(403)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  /**
   * ADR-0072 d.3, and the reason is kept apart from a refusal on purpose. A department lead who is
   * simply EARLY must not be told they lack permission — that sends them to an administrator for a
   * problem an approval fixes.
   */
  it('says the campaign is not approved yet, rather than calling it a permission problem', async () => {
    mayGenerate.mockResolvedValue('campaign_not_approved')
    const res = await handler()(post(REQUEST))
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('campaign_not_approved')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it(`does not confirm that another tenant's campaign exists`, async () => {
    mayGenerate.mockResolvedValue('not_found')
    const res = await handler()(post(REQUEST))
    expect(res.status).toBe(404)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // The ids are what make scoping possible at all, so a body without them is refused before the
  // model is called — not silently generated for nobody in particular.
  it('refuses a request that names no campaign or department', async () => {
    const { campaignId: _c, departmentId: _d, ...withoutIds } = REQUEST
    const res = await handler()(post(withoutIds))
    expect(res.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('authorizes before parsing, so an anonymous caller learns nothing from the shape', async () => {
    authenticate.mockResolvedValue(false)
    const res = await handler()(post({ ...REQUEST, brief: 'x'.repeat(MAX_BRIEF_CHARS + 1) }))
    expect(res.status).toBe(401)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses an over-long master brief rather than truncating it', async () => {
    const res = await handler()(post({ ...REQUEST, brief: 'x'.repeat(MAX_BRIEF_CHARS + 1) }))
    expect(res.status).toBe(413)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports truncation as truncation, not as an outage', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchImpl.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output: [{ content: [{ type: 'output_text', text: '{"background":"The bra' }] }],
        }),
        { status: 200 },
      ),
    )
    const res = await handler()(post(REQUEST))
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe('model_truncated')
  })

  it('drops a field the template never asked for', async () => {
    // The schema forbids it, but a schema is a request. Only the requested keys come back.
    fetchImpl.mockResolvedValue(
      modelResponse({ background: 'A.', task: 'B.', smuggled: 'should not survive' }),
    )
    const body = await (await handler()(post(REQUEST))).json()
    expect(body.values.smuggled).toBeUndefined()
    expect(Object.keys(body.values).sort()).toEqual(['background', 'task'])
  })
})

describe('sanitizeBriefValues', () => {
  it('uses the same tidy rule as the ingest path, not its own', () => {
    // Shared with fields.ts deliberately: two copies of a whitespace rule drift, and the drift
    // is invisible until two briefs written the same way come out looking different.
    const out = sanitizeBriefValues({ background: '  Flat awareness.  \n\n\n\nFalling. ' }, [
      { key: 'background' },
    ])
    expect(out.values.background).toBe('Flat awareness.\n\nFalling.')
  })
  it('never returns an empty string for any requested key', () => {
    const out = sanitizeBriefValues({}, FIELDS)
    expect(Object.values(out.values).every((v) => v === NOT_APPLICABLE)).toBe(true)
  })
})
