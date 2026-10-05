import { describe, expect, it } from 'vitest'
import {
  MAX_DELIVERABLE_QUANTITY,
  MAX_NOTE_CHARS,
  MAX_PROPOSED_DELIVERABLES,
  deliverablesJsonSchema,
  deliverablesSystemPrompt,
  deliverablesTypeLegend,
  phasesLegend,
  sanitizeProposedDeliverables,
  sanitizeProposal,
  vocabularyOutcome,
  vocabularyStatus,
  type DeliverableVocabulary,
  type ProposalPhase,
} from './deliverables'

/**
 * A tenant vocabulary small enough to read, carrying the exact ambiguity ADR-0054 exists for:
 * `Reel` is BOTH SOC-004 (social) and VID-008 (video). Under ADR-0097 the model answers with the
 * CODE and the row is named by the catalogue — so the ambiguity is settled by the code, never by a
 * name the model wrote.
 */
const VOCAB: DeliverableVocabulary = {
  types: [
    { code: 'SOC-004', name: 'Reel', categoryCode: 'SOC' },
    { code: 'SOC-005', name: 'Short-form Video', categoryCode: 'SOC' },
    { code: 'VID-008', name: 'Reel', categoryCode: 'VID' },
  ],
  categories: [
    { code: 'SOC', label: 'Social Media' },
    { code: 'VID', label: 'Video & Motion' },
  ],
  channels: [
    { code: 'INSTAGRAM', label: 'Instagram' },
    { code: 'TIKTOK', label: 'TikTok' },
  ],
}

const PHASES: ProposalPhase[] = [
  { number: 1, name: 'Pre-Launch', startsOn: '2026-09-01', endsOn: '2026-09-17' },
  { number: 2, name: 'Week 1', startsOn: '2026-09-18', endsOn: '2026-09-25' },
]

const typed = (rows: unknown, phases: ProposalPhase[] = []) =>
  sanitizeProposedDeliverables({ deliverables: rows }, VOCAB, phases)

const itemSchema = (vocab: DeliverableVocabulary | null, phases: ProposalPhase[] = []) => {
  const schema = deliverablesJsonSchema(vocab, phases) as Record<string, never>
  // ADR-0101: pieces sit inside groups — groups.items.properties.deliverables.items.
  const groups = (schema.properties as Record<string, Record<string, never>>).groups
  const group = (groups.items as unknown as { properties: Record<string, Record<string, never>> })
  return group.properties.deliverables!.items as unknown as {
    properties: Record<string, { enum?: unknown[]; type?: unknown; pattern?: string }>
    required: string[]
    additionalProperties: boolean
  }
}

// ADR-0097 d.2/d.4: the row is named by its catalogue entry; a code outside the catalogue keeps
// the row, flagged, so the person chooses. Everything here is about what the wizard is allowed to
// be handed — a row nobody deletes becomes a stream, a booking and consumed capacity.
describe('sanitizeProposedDeliverables (ADR-0097 d.2, d.4)', () => {
  it('names a row by its catalogue entry, never by the model', () => {
    expect(typed([{ type_code: 'VID-008', quantity: 2, note: null, channel: null }])).toEqual([
      { name: 'Reel', quantity: 2, typeCode: 'VID-008', needsType: false, note: null, channel: null, phaseNumber: null, from: null, group: null },
    ])
  })

  it('ignores a name the model sends anyway on a typed row', () => {
    const [row] = typed([{ type_code: 'SOC-004', quantity: 1, note: null, channel: null, name: 'Launch teaser' }])
    expect(row!.name).toBe('Reel')
  })

  it('keeps a row whose code is outside the catalogue, flagged, named by the note', () => {
    expect(typed([{ type_code: 'XXX-999', quantity: 1, note: 'a 3D hologram in the mall', channel: null }])).toEqual([
      { name: 'a 3D hologram in the mall', quantity: 1, typeCode: null, needsType: true, note: 'a 3D hologram in the mall', channel: null, phaseNumber: null, from: null, group: null },
    ])
  })

  it('treats an INACTIVE or unknown code exactly the same — it is not in the list', () => {
    const [row] = typed([{ type_code: 'SOC-999', quantity: 1, note: null, channel: null }])
    expect(row).toMatchObject({ typeCode: null, needsType: true, name: 'SOC-999' })
  })

  it('drops a row that has neither a code the tenant has nor anything to show', () => {
    expect(typed([{ type_code: '', quantity: 1, note: null, channel: null }])).toEqual([])
    expect(typed([null, 'x', 42])).toEqual([])
  })

  it('treats a missing, fractional or absurd quantity as 1, never as 0', () => {
    const q = (quantity: unknown) => typed([{ type_code: 'SOC-004', quantity, note: null, channel: null }])[0]!.quantity
    expect(q(undefined)).toBe(1)
    expect(q(2.5)).toBe(1)
    expect(q(0)).toBe(1)
    expect(q(MAX_DELIVERABLE_QUANTITY + 1)).toBe(1)
    expect(q(MAX_DELIVERABLE_QUANTITY)).toBe(MAX_DELIVERABLE_QUANTITY)
  })

  it('caps the list, so one runaway answer cannot fill the table', () => {
    const rows = Array.from({ length: MAX_PROPOSED_DELIVERABLES + 5 }, () => ({ type_code: 'SOC-004', quantity: 1, note: null, channel: null }))
    expect(typed(rows)).toHaveLength(MAX_PROPOSED_DELIVERABLES)
  })

  it('returns [] for anything that is not a list — an empty proposal is a valid answer', () => {
    expect(sanitizeProposedDeliverables(null, VOCAB)).toEqual([])
    expect(sanitizeProposedDeliverables({ deliverables: 'no' }, VOCAB)).toEqual([])
  })

  it('collapses runaway whitespace in a note and caps its length', () => {
    const [row] = typed([{ type_code: 'SOC-004', quantity: 1, note: '  twenty   seconds,\n in the reference style ', channel: null }])
    expect(row!.note).toBe('twenty seconds, in the reference style')
    const [long] = typed([{ type_code: 'SOC-004', quantity: 1, note: 'x'.repeat(MAX_NOTE_CHARS + 50), channel: null }])
    expect(long!.note).toHaveLength(MAX_NOTE_CHARS)
  })

  it('keeps a channel the tenant has and drops one it does not', () => {
    expect(typed([{ type_code: 'SOC-004', quantity: 1, note: null, channel: 'INSTAGRAM' }])[0]!.channel).toBe('INSTAGRAM')
    expect(typed([{ type_code: 'SOC-004', quantity: 1, note: null, channel: 'MYSPACE' }])[0]!.channel).toBeNull()
  })

  it('with no catalogue at all, every row is flagged — nothing is named by the model', () => {
    const rows = sanitizeProposedDeliverables({ deliverables: [{ type_code: 'SOC-004', quantity: 1, note: 'a reel' }] }, null)
    expect(rows[0]).toMatchObject({ typeCode: null, needsType: true })
  })
})

describe('phases ride on the same call (ADR-0096 d.8, ADR-0097 d.6)', () => {
  it('keeps a phase number from the list and drops one outside it — the row stays', () => {
    const rows = typed(
      [
        { type_code: 'SOC-004', quantity: 1, note: null, channel: null, phase_number: 2 },
        { type_code: 'SOC-004', quantity: 1, note: null, channel: null, phase_number: 7 },
        { type_code: 'SOC-004', quantity: 1, note: null, channel: null, phase_number: null },
      ],
      PHASES,
    )
    expect(rows.map((r) => r.phaseNumber)).toEqual([2, null, null])
  })

  it('offers phase_number only when phases were given', () => {
    expect(itemSchema(VOCAB).properties.phase_number).toBeUndefined()
    expect(itemSchema(VOCAB, PHASES).properties.phase_number).toMatchObject({ type: ['integer', 'null'] })
    expect(itemSchema(VOCAB, PHASES).required).toContain('phase_number')
  })

  it('lists the phases in the prompt, numbered and dated', () => {
    const prompt = deliverablesSystemPrompt(VOCAB, PHASES)
    expect(prompt).toContain('1. Pre-Launch (2026-09-01 to 2026-09-17)')
    expect(prompt).toContain('phase_number')
    expect(deliverablesSystemPrompt(VOCAB)).not.toContain('phase_number')
    expect(phasesLegend(PHASES)).toContain('2. Week 1')
  })
})

describe('the schema and prompt handed to the model (ADR-0097 d.1, d.3)', () => {
  it('is strict-mode shaped, so it stays portable between providers', () => {
    const item = itemSchema(VOCAB)
    expect(item.additionalProperties).toBe(false)
    expect(item.required).toEqual(Object.keys(item.properties))
  })

  it('has no name field — the model cannot invent one (d.2)', () => {
    expect(itemSchema(VOCAB).properties.name).toBeUndefined()
  })

  // The 29 Aug lesson, kept as a test: the enum on the schema made the empty list the cheapest
  // valid answer. The code is a plain string with a pattern; the catalogue is the prompt's menu.
  it('carries the code as a free string, NEVER as an enum in the schema', () => {
    const code = itemSchema(VOCAB).properties.type_code
    expect(code!.enum).toBeUndefined()
    expect(code!.type).toBe('string')
    expect(code!.pattern).toBeTruthy()
  })

  it('puts the whole catalogue in the prompt as a menu grouped by category', () => {
    const prompt = deliverablesSystemPrompt(VOCAB)
    expect(prompt).toContain('Social Media')
    expect(prompt).toContain('  SOC-004  Reel')
    expect(prompt).toContain('  VID-008  Reel')
    expect(prompt.indexOf('Video & Motion')).toBeGreaterThan(prompt.indexOf('Social Media'))
  })

  it('groups the legend by category - which is what makes the twelve ambiguous names decidable', () => {
    const legend = deliverablesTypeLegend(VOCAB)
    expect(legend.split('\n')).toEqual([
      'Social Media', '  SOC-004  Reel', '  SOC-005  Short-form Video',
      'Video & Motion', '  VID-008  Reel',
    ])
  })

  it('keeps CHANNEL as a schema enum, because the list is short and naming one is extraction', () => {
    expect(itemSchema(VOCAB).properties.channel!.enum).toEqual(['INSTAGRAM', 'TIKTOK', null])
    expect(itemSchema({ ...VOCAB, channels: [] }).properties.channel).toBeUndefined()
  })

  it('tells the model the document is data, and that WHO does the work is not its call', () => {
    const prompt = deliverablesSystemPrompt(VOCAB)
    expect(prompt).toContain('UNTRUSTED DATA')
    expect(prompt).toContain('Never say who should do the work')
    expect(prompt).not.toMatch(/\bdiscipline\b/i)
  })

  it('narrows the empty list to the one case that means it, and forbids invented codes', () => {
    const prompt = deliverablesSystemPrompt(VOCAB)
    expect(prompt).toContain('Return an empty list ONLY if the brief calls for no deliverables at all')
    expect(prompt).toContain('Never invent a code')
  })
})

describe('the vocabulary offered to the model (ADR-0054 d.5 as amended)', () => {
  it('types are offered whenever the tenant has any — the ceiling no longer applies to them', () => {
    const many: DeliverableVocabulary = {
      ...VOCAB,
      types: Array.from({ length: 1_200 }, (_, i) => ({ code: `T-${i}`, name: `Type ${i}`, categoryCode: 'SOC' })),
    }
    expect(vocabularyOutcome(many).types).toBe('offered')
  })

  it('says which it was when the tenant simply has no active types', () => {
    expect(vocabularyOutcome({ ...VOCAB, types: [] }).types).toBe('empty')
  })

  it('degrades to unavailable when the vocabulary could not be read at all', () => {
    expect(vocabularyOutcome(null)).toEqual({ types: 'unavailable', channels: 'unavailable' })
  })

  it('still guards the CHANNEL enum with the API ceiling', () => {
    expect(vocabularyStatus([])).toBe('empty')
    expect(vocabularyStatus(Array.from({ length: 1_001 }, (_, i) => `C${i}`))).toBe('over_ceiling')
    expect(vocabularyStatus(['A', 'B'])).toBe('offered')
  })
})

describe('ADR-0050 d.6 still holds with the catalogue in the prompt', () => {
  it('offers the model no field in which to say who does the work', () => {
    const props = Object.keys(itemSchema(VOCAB, PHASES).properties)
    // ADR-0101 adds `from` (the brief line) — still nothing that names a person or a team.
    expect(props).toEqual(['type_code', 'quantity', 'note', 'channel', 'phase_number', 'from'])
  })
})

// ADR-0101: the proposal arrives in named groups, each with a department the tenant has.
describe('sanitizeProposal — workstreams (ADR-0101)', () => {
  const DEPTS: DeliverableVocabulary = {
    ...VOCAB,
    departments: [
      { code: 'd-creative', label: 'Creative' },
      { code: 'd-content', label: 'Content' },
    ],
  }
  const reel = { type_code: 'SOC-004', quantity: 1, note: null, from: 'three beats' }

  it('keeps each group, maps its department by name to the id, and indexes its rows', () => {
    const out = sanitizeProposal(
      {
        groups: [
          { name: 'Launch key visuals', department: 'creative ', deliverables: [reel] },
          { name: 'Short-form video', department: 'Content', deliverables: [reel, reel] },
        ],
      },
      DEPTS,
    )
    expect(out.groups).toEqual([
      { name: 'Launch key visuals', departmentId: 'd-creative' },
      { name: 'Short-form video', departmentId: 'd-content' },
    ])
    expect(out.rows.map((r) => r.group)).toEqual([0, 1, 1])
    expect(out.rows[0]!.from).toBe('three beats')
  })

  it('drops a department the tenant does not have rather than guessing (d.3)', () => {
    const out = sanitizeProposal({ groups: [{ name: 'Film', department: 'Production', deliverables: [reel] }] }, DEPTS)
    expect(out.groups[0]!.departmentId).toBeNull()
  })

  it('makes names unique within the proposal, and leaves a missing name for the wizard', () => {
    const out = sanitizeProposal(
      {
        groups: [
          { name: 'Launch', department: null, deliverables: [reel] },
          { name: 'launch', department: null, deliverables: [reel] },
          { name: '  ', department: 'Creative', deliverables: [reel] },
        ],
      },
      DEPTS,
    )
    expect(out.groups.map((g) => g.name)).toEqual(['Launch', 'launch 2', null])
  })

  it('drops a group with no usable rows, and keeps row indexes pointing at the groups kept', () => {
    const out = sanitizeProposal(
      {
        groups: [
          { name: 'Empty', department: null, deliverables: [{}] },
          { name: 'Real', department: null, deliverables: [reel] },
        ],
      },
      DEPTS,
    )
    expect(out.groups.map((g) => g.name)).toEqual(['Real'])
    expect(out.rows[0]!.group).toBe(0)
  })

  it('still reads the older flat answer, as rows in no group', () => {
    const out = sanitizeProposal({ deliverables: [reel] }, DEPTS)
    expect(out.groups).toEqual([])
    expect(out.rows[0]!.group).toBeNull()
  })

  it('shows the model department NAMES only, and still forbids naming who does the work', () => {
    const prompt = deliverablesSystemPrompt(DEPTS)
    expect(prompt).toContain('The departments:')
    expect(prompt).toContain('  Creative')
    expect(prompt).not.toContain('d-creative')
    expect(prompt).toContain('Never say who should do the work')
    expect(deliverablesSystemPrompt(VOCAB)).not.toContain('The departments:')
  })
})

// ADR-0101 d.9: workstreams off — the model is asked for one plain list, and shown no departments.
describe('the ungrouped proposal (ADR-0101 d.9)', () => {
  const DEPTS: DeliverableVocabulary = { ...VOCAB, departments: [{ code: 'd-creative', label: 'Creative' }] }

  it('asks for a flat list with no groups', () => {
    const schema = deliverablesJsonSchema(DEPTS, [], false) as { properties: Record<string, unknown> }
    expect(Object.keys(schema.properties)).toEqual(['deliverables'])
  })

  it('shows no departments and no grouping rule in the prompt', () => {
    const prompt = deliverablesSystemPrompt(DEPTS, [], false)
    expect(prompt).not.toContain('The departments:')
    expect(prompt).not.toMatch(/Group the rows into workstreams/)
    expect(prompt).toContain('Do not group them')
  })
})
