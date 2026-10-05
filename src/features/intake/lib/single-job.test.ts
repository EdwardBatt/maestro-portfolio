import { describe, expect, it } from 'vitest'
import {
  EMPTY_REQUEST,
  briefMissing,
  briefTypeMissing,
  filledCount,
  requiredBriefKeys,
  splitBriefFields,
  elapsedSince,
  fillEmptyFields,
  matchPercent,
  readStoredRequest,
  requestMissing,
  deliverableNameFor,
  requestRecord,
} from './single-job'
import { EMPTY_SPEC, readsLikeACampaign } from './single-job'

describe('requestMissing (ADR-0083) — who and when, since the client and the words moved to screen 1 (22 Sep)', () => {
  it('requires the title, the due date, the department and a language (Q19)', () => {
    expect(requestMissing(EMPTY_REQUEST)).toEqual(['title', 'dueDate', 'departmentId', 'languages'])
  })

  it('a language picked clears it — no default is assumed (ADR-0117 addendum, Q19)', () => {
    expect(requestMissing({ ...EMPTY_REQUEST, languages: ['ar'] })).not.toContain('languages')
  })

  it('screen 1 requires the client, the kind of brief and the words', () => {
    expect(briefTypeMissing(EMPTY_REQUEST)).toEqual(['clientId', 'briefType', 'words'])
    expect(briefTypeMissing({ ...EMPTY_REQUEST, clientId: 'c1', briefType: 'single_execution', words: '  ' })).toEqual(['words'])
    expect(briefTypeMissing({ ...EMPTY_REQUEST, clientId: 'c1', briefType: 'single_execution', words: 'three posts' })).toEqual([])
  })

  // Evidence is optional (ADR-0066 d.10); the type is optional (ADR-0051 d.7).
  it('lets a request through with no proof and no type', () => {
    expect(
      requestMissing({
        ...EMPTY_REQUEST,
        title: 'Ramadan teaser posts',
        clientId: 'c1',
        words: 'we need three teaser posts by Thursday',
        dueDate: '2026-09-17',
        departmentId: 'd1',
        languages: ['ar'],
      }),
    ).toEqual([])
  })

  it('does not accept whitespace as a title', () => {
    expect(requestMissing({ ...EMPTY_REQUEST, title: '   ' })).toContain('title')
  })
})

describe('requestRecord / readStoredRequest', () => {
  it('stores the words verbatim and reads them back', () => {
    const rec = requestRecord({
      ...EMPTY_REQUEST,
      title: ' Teasers ',
      askedBy: ' Ahmed ',
      source: 'whatsapp',
      words: '  three posts, Thursday  ',
      quantity: 3,
      dueDate: '2026-09-17',
      deliverableTypeId: 'dt1',
      briefType: 'single_execution',
    })
    expect(rec.kind).toBe('single_job')
    // Verbatim: NOT trimmed. The client's own words are never edited (d.6).
    expect(readStoredRequest(rec)).toEqual({ askedBy: 'Ahmed', source: 'whatsapp', words: '  three posts, Thursday  ', briefType: 'single_execution', priority: null, reducedScope: false })
    expect(rec.deliverables).toEqual([
      expect.objectContaining({ name: 'Teasers', quantity: 3, dueAt: '2026-09-17', deliverableTypeId: 'dt1' }),
    ])
  })

  it('reads an unrelated brief as a blank request rather than throwing', () => {
    expect(readStoredRequest({ proposition: 'x' })).toEqual({ askedBy: '', source: null, words: '', briefType: null, priority: null, reducedScope: false })
    expect(readStoredRequest(null)).toEqual({ askedBy: '', source: null, words: '', briefType: null, priority: null, reducedScope: false })
    expect(readStoredRequest({ request: { priority: 'high', reducedScope: true } })).toMatchObject({ priority: 'high', reducedScope: true })
    expect(readStoredRequest({ request: { priority: 'urgent' } }).priority).toBeNull()
    expect(readStoredRequest({ request: { source: 'carrier pigeon' } }).source).toBeNull()
  })
})

describe('fillEmptyFields (ADR-0084 d.6)', () => {
  it('fills only empty fields and names what it filled', () => {
    const { next, filled } = fillEmptyFields(
      { task: 'typed by hand', specs: '' },
      { task: 'from the document', specs: '1080x1080', copy: 'headline' },
      ['task', 'specs', 'copy'],
    )
    expect(next).toEqual({ task: 'typed by hand', specs: '1080x1080', copy: 'headline' })
    expect(filled).toEqual(['specs', 'copy'])
  })

  it('ignores keys outside the template', () => {
    const { next, filled } = fillEmptyFields({}, { proposition: 'nope', task: 'yes' }, ['task'])
    expect(next).toEqual({ task: 'yes' })
    expect(filled).toEqual(['task'])
  })
})

describe('briefMissing (ADR-0084 d.6a — per template since SJ-v3-02, 22 Sep)', () => {
  const f = (key: string) => ({ key, en: key, ar: '', guidance: '' })
  const execution = [f('deliverableType'), f('task'), f('specs')]
  const social = [f('objective'), f('audience'), f('tone')]

  it('requires The Task and nothing else on a template that has one', () => {
    expect(briefMissing({}, execution)).toEqual(['task'])
    expect(briefMissing({ task: 'Design three statics' }, execution)).toEqual([])
    expect(requiredBriefKeys(execution)).toEqual(['task'])
  })

  it('requires the FIRST field on a template without a Task', () => {
    expect(requiredBriefKeys(social)).toEqual(['objective'])
    expect(briefMissing({ audience: 'Iraq 18–34' }, social)).toEqual(['objective'])
    expect(briefMissing({ objective: 'Awareness' }, social)).toEqual([])
    expect(requiredBriefKeys([])).toEqual([])
  })

  it('splits a template into the first four essentials and the rest, and counts what is filled', () => {
    const six = [f('a'), f('b'), f('c'), f('d'), f('e'), f('g')]
    const { essentials, rest } = splitBriefFields(six)
    expect(essentials.map((x) => x.key)).toEqual(['a', 'b', 'c', 'd'])
    expect(rest.map((x) => x.key)).toEqual(['e', 'g'])
    expect(filledCount({ a: 'x', b: ' ', e: 'y' }, six)).toBe(2)
    expect(splitBriefFields(social).rest).toEqual([])
  })
})

describe('elapsedSince (ADR-0085 d.5)', () => {
  it('splits into days, hours and minutes', () => {
    const start = Date.UTC(2026, 8, 10, 9, 0)
    const now = Date.UTC(2026, 8, 11, 10, 30)
    expect(elapsedSince(new Date(start).toISOString(), now)).toEqual({
      days: 1, hours: 1, minutes: 30, totalMinutes: 25 * 60 + 30, future: false,
    })
  })
  it('never runs backwards', () => {
    const now = Date.UTC(2026, 8, 10, 9, 0)
    expect(elapsedSince(new Date(now + 60_000).toISOString(), now)?.totalMinutes).toBe(0)
  })
  it('refuses a date it cannot read', () => {
    expect(elapsedSince('not a date')).toBeNull()
  })
})

describe('matchPercent (ADR-0086 d.3)', () => {
  it('turns a similarity into a whole percent, clamped', () => {
    expect(matchPercent(0.923)).toBe(92)
    expect(matchPercent(1.4)).toBe(100)
    expect(matchPercent(-1)).toBe(0)
  })
})

describe('deliverableNameFor (I52.1)', () => {
  it('names the deliverable after what was picked, never with its count (I67.1)', () => {
    expect(deliverableNameFor('Social Advertisement', 'Ramadan teaser')).toBe('Social Advertisement')
    expect(deliverableNameFor('  Static Post ', 'Ramadan teaser')).toBe('Static Post')
  })
  it('falls back to the job title only when no type was chosen', () => {
    expect(deliverableNameFor(null, '  Ramadan teaser ')).toBe('Ramadan teaser')
    expect(deliverableNameFor('  ', 'Ramadan teaser')).toBe('Ramadan teaser')
  })
})

describe('readsLikeACampaign (ADR-0138 d.4)', () => {
  const job = { departmentId: 'creative', dueDate: '2026-10-09' }
  it('is quiet for one department on one day — a piece with nothing of its own shares the job’s', () => {
    expect(readsLikeACampaign({ ...job, more: [{ ...EMPTY_SPEC }] })).toEqual({ departments: false, dates: false })
  })
  it('warns for a piece on another department, and for one due on another day', () => {
    expect(readsLikeACampaign({ ...job, more: [{ ...EMPTY_SPEC, departmentId: 'production' }] })).toEqual({ departments: true, dates: false })
    expect(readsLikeACampaign({ ...job, more: [{ ...EMPTY_SPEC, dueDate: '2026-10-12' }] })).toEqual({ departments: false, dates: true })
  })
})

