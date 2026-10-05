import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGenerateHandler,
  readCallerVocabulary,
  type CallerClient,
  type CallerTableQuery,
  type GenerateDeps,
  type GenerateResponseBody,
} from './handler.ts'
import type { DeliverableVocabulary } from '../../../src/lib/brief/deliverables.ts'

/**
 * generate-deliverables under ADR-0097: the model proposes FROM THE CATALOGUE ONLY, in one call.
 *
 * Read the caller's active taxonomy on the caller-scoped client, put it in the prompt as a menu,
 * and check what comes back. The things that must never happen: the browser saying what the model
 * may answer; a code outside the catalogue becoming an invented name; a catalogue that could not
 * be read producing prose rows.
 */

const CORS = { 'Access-Control-Allow-Origin': '*' }

const VOCAB: DeliverableVocabulary = {
  types: [
    { code: 'SOC-004', name: 'Reel', categoryCode: 'SOC' },
    { code: 'VID-008', name: 'Reel', categoryCode: 'VID' },
  ],
  categories: [
    { code: 'SOC', label: 'Social Media' },
    { code: 'VID', label: 'Video & Motion' },
  ],
  channels: [{ code: 'INSTAGRAM', label: 'Instagram' }],
}

/** A Responses-API success envelope carrying the proposal as its output_text (ADR-0049). */
function modelResponse(value: unknown): Response {
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

const fetchImpl = vi.fn<typeof fetch>()
const authenticate = vi.fn<GenerateDeps['authenticate']>()
const hasProjectsManage = vi.fn<GenerateDeps['hasProjectsManage']>()
const readVocabulary = vi.fn<GenerateDeps['readVocabulary']>()

function handler(overrides: Partial<GenerateDeps> = {}) {
  return createGenerateHandler(
    {
      authenticate,
      hasProjectsManage,
      readVocabulary,
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
  return new Request('https://x/generate-deliverables', {
    method: 'POST',
    headers: { authorization: 'Bearer caller-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** The request body the model was sent, so the schema and prompt can be read back out of it. */
function sentToModel(): { input: { role: string; content: string }[]; text: { format: Record<string, unknown> } } {
  const init = fetchImpl.mock.calls[0]![1] as RequestInit
  return JSON.parse(init.body as string)
}

beforeEach(() => {
  fetchImpl.mockReset()
  authenticate.mockReset().mockResolvedValue(true)
  hasProjectsManage.mockReset().mockResolvedValue(true)
  readVocabulary.mockReset().mockResolvedValue(VOCAB)
})

describe('generate-deliverables — the vocabulary is the caller\'s own (ADR-0054 d.2)', () => {
  it('reads it server-side with the CALLER\'s token, and never from the request', async () => {
    fetchImpl.mockResolvedValue(modelResponse({ deliverables: [] }))
    await handler()(post({ brief: 'Three Instagram Reels for Ramadan.' }))
    expect(readVocabulary).toHaveBeenCalledWith('Bearer caller-token')
  })

  it('refuses a request that tries to supply one — the schema is still strict', async () => {
    fetchImpl.mockResolvedValue(modelResponse({ deliverables: [] }))
    // The whole defence: a caller who could send the list could tell the model to answer with a
    // vocabulary that is not their tenant's. `.strict()` rejects the body outright.
    const res = await handler()(
      post({ brief: 'A brief.', types: [{ code: 'EVIL-001', name: 'Anything' }] }),
    )
    expect(res.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // ADR-0097 d.3: the catalogue is a MENU in the prompt; the code is a free string in the schema.
  // The 29 Aug failure came from an enum in the schema, never from a list in the prompt.
  it('puts the catalogue in the prompt and NO enum on the code', async () => {
    fetchImpl.mockResolvedValue(modelResponse({ deliverables: [] }))
    await handler()(post({ brief: 'A brief.' }))

    const sent = sentToModel()
    const schema = sent.text.format as { schema: Record<string, never> }
    // ADR-0101: pieces sit inside groups.
    const groups = (schema.schema.properties as Record<string, Record<string, never>>).groups
    const group = groups.items as unknown as { properties: Record<string, Record<string, never>> }
    const item = group.properties.deliverables!.items as unknown as {
      properties: Record<string, { enum?: unknown[]; type?: unknown }>
      required: string[]
    }
    expect(item.properties.type_code).toMatchObject({ type: 'string' })
    expect(item.properties.type_code!.enum).toBeUndefined()
    expect(item.properties.name).toBeUndefined()
    expect(sent.input[0]!.content).toContain('SOC-004  Reel')
    expect(sent.input[0]!.content).toContain('VID-008  Reel')
  })

  it('makes exactly one call (ADR-0097 d.1)', async () => {
    fetchImpl.mockResolvedValue(modelResponse({ deliverables: [{ type_code: 'SOC-004', quantity: 1, note: null, channel: null }] }))
    await handler()(post({ brief: 'A brief.' }))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('generate-deliverables — what comes back (ADR-0097 d.2, d.4, d.5)', () => {
  it('names each row by its catalogue entry and reports the outcome', async () => {
    fetchImpl.mockResolvedValueOnce(
      modelResponse({ deliverables: [{ type_code: 'SOC-004', quantity: 3, note: null, channel: 'INSTAGRAM' }] }),
    )

    const res = await handler()(post({ brief: 'Three Instagram Reels.' }))
    const body = (await res.json()) as GenerateResponseBody

    expect(res.status).toBe(200)
    expect(body.deliverables).toEqual([
      { name: 'Reel', quantity: 3, typeCode: 'SOC-004', needsType: false, note: null, channel: 'INSTAGRAM', phaseNumber: null, from: null, group: null },
    ])
    expect(body.vocabulary).toEqual({ types: 'offered', channels: 'offered' })
    expect(body.needsType).toBe(0)
  })

  it('returns the proposed workstreams, each row pointing at its group (ADR-0101)', async () => {
    fetchImpl.mockResolvedValueOnce(
      modelResponse({
        groups: [
          {
            name: 'Draw night',
            department: null,
            deliverables: [{ type_code: 'SOC-004', quantity: 3, note: null, channel: null, from: 'watch the draw' }],
          },
        ],
      }),
    )
    const res = await handler()(post({ brief: 'Three reels for draw night.' }))
    const body = (await res.json()) as GenerateResponseBody
    expect(body.groups).toEqual([{ name: 'Draw night', departmentId: null }])
    expect(body.deliverables[0]).toMatchObject({ name: 'Reel', group: 0, from: 'watch the draw' })
  })

  // THE property of this design (d.4): a code outside the catalogue never becomes an invented name.
  it('keeps a row outside the catalogue, flagged, and counts it', async () => {
    fetchImpl.mockResolvedValueOnce(
      modelResponse({
        deliverables: [
          { type_code: 'VID-008', quantity: 1, note: '60 seconds, hero', channel: null },
          { type_code: 'HOLO-001', quantity: 1, note: 'a hologram in the mall', channel: null },
        ],
      }),
    )
    const res = await handler()(post({ brief: 'A brief.' }))
    const body = (await res.json()) as GenerateResponseBody
    expect(body.deliverables.map((d) => [d.name, d.typeCode, d.needsType])).toEqual([
      ['Reel', 'VID-008', false],
      ['a hologram in the mall', null, true],
    ])
    expect(body.needsType).toBe(1)
  })

  it('hands the phases to the model and reads the suggestion back (ADR-0096 d.8)', async () => {
    fetchImpl.mockResolvedValueOnce(
      modelResponse({ deliverables: [{ type_code: 'SOC-004', quantity: 1, note: null, channel: null, phase_number: 2 }] }),
    )
    const phases = [
      { number: 1, name: 'Pre-Launch', startsOn: '2026-09-01', endsOn: '2026-09-17' },
      { number: 2, name: 'Week 1', startsOn: '2026-09-18', endsOn: '2026-09-25' },
    ]
    const res = await handler()(post({ brief: 'A teaser, then a reel in week one.', phases }))
    const body = (await res.json()) as GenerateResponseBody
    expect(body.deliverables[0]!.phaseNumber).toBe(2)
    expect(sentToModel().input[0]!.content).toContain('2. Week 1 (2026-09-18 to 2026-09-25)')
  })

  it('refuses a malformed phase list before calling anything', async () => {
    const res = await handler()(post({ brief: 'A brief.', phases: [{ number: 'one', name: 'x' }] }))
    expect(res.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // d.5: no catalogue means no proposals and the reason — never prose rows, never a model call.
  it('proposes nothing, and says why, when the tenant has no active types', async () => {
    readVocabulary.mockResolvedValue({ ...VOCAB, types: [] })
    const res = await handler()(post({ brief: 'A brief.' }))
    const body = (await res.json()) as GenerateResponseBody
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(body.deliverables).toEqual([])
    expect(body.vocabulary).toEqual({ types: 'empty', channels: 'offered' })
  })

  it('proposes nothing, and says so, when the taxonomy read fails', async () => {
    readVocabulary.mockRejectedValue(new Error('permission denied for table deliverable_types'))
    const res = await handler()(post({ brief: 'A hero film.' }))
    const body = (await res.json()) as GenerateResponseBody
    expect(res.status).toBe(200)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(body.deliverables).toEqual([])
    expect(body.vocabulary).toEqual({ types: 'unavailable', channels: 'unavailable' })
  })

  it('authorizes before it reads anything at all', async () => {
    hasProjectsManage.mockResolvedValue(false)
    const res = await handler()(post({ brief: 'A brief.' }))
    expect(res.status).toBe(403)
    expect(readVocabulary).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('readCallerVocabulary', () => {
  /** A PostgREST chain stub: records its filters, resolves what the test staged — and, like
   *  PostgREST, never answers more than 1,000 rows to one request (`range` slices; a bare await
   *  of the chain gets the first 1,000). */
  function client(
    staged: Record<string, { data?: unknown; error?: unknown }>,
    calls: { table: string; filters: [string, unknown][]; ranges: [number, number][] }[] = [],
  ): CallerClient {
    return {
      auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
      rpc: () => Promise.resolve({ data: null, error: null }),
      from: (table: string) => {
        const record = { table, filters: [] as [string, unknown][], ranges: [] as [number, number][] }
        calls.push(record)
        const answer = (from: number, to: number) => {
          const rows = (staged[table]?.data ?? []) as unknown[]
          return Promise.resolve({
            data: rows.slice(from, Math.min(to + 1, from + 1000)),
            error: staged[table]?.error ?? null,
          })
        }
        const chain: CallerTableQuery = {
          select: () => chain,
          eq: (column: string, value: unknown) => {
            record.filters.push([column, value])
            return chain
          },
          order: () => chain,
          range: (from: number, to: number) => {
            record.ranges.push([from, to])
            return answer(from, to)
          },
          then: (resolve, reject) => answer(0, 999).then(resolve, reject),
        }
        return chain
      },
    }
  }

  it('reads EVERY active type, past the 1,000-row cut (I59.39)', async () => {
    const many = Array.from({ length: 1234 }, (_, i) => ({ code: `T-${i}`, name_en: `Type ${i}`, category_code: 'SOC' }))
    const calls: { table: string; filters: [string, unknown][]; ranges: [number, number][] }[] = []
    const vocab = await readCallerVocabulary(client({ deliverable_types: { data: many } }, calls))
    expect(vocab?.types).toHaveLength(1234)
    expect(vocab?.types.at(-1)?.code).toBe('T-1233')
    expect(calls.filter((c) => c.table === 'deliverable_types').flatMap((c) => c.ranges)).toEqual([[0, 999], [1000, 1999]])
  })

  it('maps the three reads onto one vocabulary', async () => {
    const vocab = await readCallerVocabulary(
      client({
        deliverable_types: { data: [{ code: 'SOC-004', name_en: 'Reel', category_code: 'SOC' }] },
        deliverable_categories: { data: [{ code: 'SOC', name_en: 'Social Media' }] },
        deliverable_attribute_values: { data: [{ code: 'INSTAGRAM', label_en: 'Instagram' }] },
        departments: { data: [{ id: 'd-content', name: 'Content' }] },
      }),
    )
    expect(vocab).toEqual({
      types: [{ code: 'SOC-004', name: 'Reel', categoryCode: 'SOC' }],
      categories: [{ code: 'SOC', label: 'Social Media' }],
      channels: [{ code: 'INSTAGRAM', label: 'Instagram' }],
      // ADR-0101 d.2: department names, keyed by id — read as the caller, never sent by the browser.
      departments: [{ code: 'd-content', label: 'Content' }],
    })
  })

  it('costs only the departments when the department read fails (ADR-0101 d.3)', async () => {
    const vocab = await readCallerVocabulary(
      client({
        deliverable_types: { data: [{ code: 'SOC-004', name_en: 'Reel', category_code: 'SOC' }] },
        departments: { error: { message: 'permission denied' } },
      }),
    )
    expect(vocab?.types).toHaveLength(1)
    expect(vocab?.departments).toEqual([])
  })

  it('asks for ACTIVE rows only, and writes no tenant filter of its own', async () => {
    const calls: { table: string; filters: [string, unknown][]; ranges: [number, number][] }[] = []
    await readCallerVocabulary(client({}, calls))
    const types = calls.find((c) => c.table === 'deliverable_types')!
    expect(types.filters).toContainEqual(['is_active', true])
    // AGENTS.md §6: tenant isolation is STRUCTURAL. RLS supplies the tenant from the JWT; a
    // tenant_id written here would be a fence made of code the caller's token already decides.
    expect(types.filters.map(([column]) => column)).not.toContain('tenant_id')
  })

  it('returns null on a failed read rather than a half-built vocabulary', async () => {
    const vocab = await readCallerVocabulary(
      client({
        deliverable_types: { data: [{ code: 'SOC-004', name_en: 'Reel', category_code: 'SOC' }] },
        deliverable_categories: { error: { message: 'permission denied' } },
      }),
    )
    // Half a vocabulary is worse than none: the enum would offer codes whose legend headings are
    // missing, and the model would be choosing from a list it cannot read.
    expect(vocab).toBeNull()
  })
})
