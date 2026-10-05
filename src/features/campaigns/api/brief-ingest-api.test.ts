// ADR-0044: a failed model call falls back to the heuristic (and the wizard is told which
// ran); an over-cap document is refused rather than sent; and what the function returns is
// re-validated on arrival, so an unexpected key cannot reach the form.
//
// `lib/supabase` is mocked, which also keeps `lib/env` out of the import graph — it
// Zod-parses `import.meta.env` at import time and throws when the VITE_ vars are absent,
// as they are in CI (traps.md).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/supabase', () => ({
  supabaseUntyped: { functions: { invoke }, from: vi.fn() },
}))
vi.mock('../../../app/auth-context', () => ({
  useAuth: () => ({ claims: { tenantId: 't1' }, session: { user: { id: 'u1' } } }),
}))

import { BriefIngestRefusedError, BriefTooLongError, useIngestBrief } from './brief-ingest-api'
import { MAX_BRIEF_CHARS, MAX_FIELD_CHARS } from '../../../lib/brief/fields'

/** What `functions.invoke` hands back for a non-2xx: one opaque error carrying the Response. */
function httpError(status: number) {
  const error = new Error('Edge Function returned a non-2xx status code')
  ;(error as unknown as { context: { status: number } }).context = { status }
  return error
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return createElement(QueryClientProvider, { client }, children)
}

const HEADED_BRIEF = 'Background\nThe brand has been quiet.\n\nInsight\nEffort, not spend.\n'

describe('useIngestBrief (ADR-0044)', () => {
  beforeEach(() => {
    invoke.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('returns the function’s fields and reports the model as the source', async () => {
    invoke.mockResolvedValue({ data: { fields: { insight: 'From the model.' } }, error: null })
    const { result } = renderHook(() => useIngestBrief(), { wrapper })
    const outcome = await result.current.mutateAsync({ text: HEADED_BRIEF })
    expect(outcome).toEqual({
      source: 'model',
      fields: { insight: 'From the model.' },
      oversized: [],
    })
  })

  it('carries the fields the function had to drop for length, so the user is told', async () => {
    invoke.mockResolvedValue({
      data: { fields: { insight: 'Kept.' }, oversized: ['background', 'not_a_field'] },
      error: null,
    })
    const { result } = renderHook(() => useIngestBrief(), { wrapper })
    const outcome = await result.current.mutateAsync({ text: HEADED_BRIEF })
    // Unknown names are dropped like any other unrecognised key.
    expect(outcome.oversized).toEqual(['background'])
  })

  it('does not re-impose the length limit on arrival and silently lose a field', async () => {
    // The function is the length authority. Re-checking here would discard a field it had
    // already accepted, leaving the user with a count that does not match the form.
    const long = 'x'.repeat(MAX_FIELD_CHARS + 200)
    invoke.mockResolvedValue({ data: { fields: { insight: long } }, error: null })
    const { result } = renderHook(() => useIngestBrief(), { wrapper })
    const outcome = await result.current.mutateAsync({ text: HEADED_BRIEF })
    expect(outcome.fields.insight).toHaveLength(MAX_FIELD_CHARS + 200)
  })

  it('falls back to heading matching when the function errors, and says so', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('model_unavailable') })
    const { result } = renderHook(() => useIngestBrief(), { wrapper })
    const outcome = await result.current.mutateAsync({ text: HEADED_BRIEF })
    expect(outcome.source).toBe('fallback')
    expect(outcome.fields.background).toBe('The brand has been quiet.')
    expect(outcome.fields.insight).toBe('Effort, not spend.')
  })

  it('falls back when the function throws outright (network, timeout, cold start)', async () => {
    invoke.mockRejectedValue(new Error('Failed to fetch'))
    const { result } = renderHook(() => useIngestBrief(), { wrapper })
    const outcome = await result.current.mutateAsync({ text: HEADED_BRIEF })
    expect(outcome.source).toBe('fallback')
    expect(outcome.fields.insight).toBe('Effort, not spend.')
  })

  it('falls back when the answer is not the shape it should be', async () => {
    invoke.mockResolvedValue({ data: { unexpected: true }, error: null })
    const { result } = renderHook(() => useIngestBrief(), { wrapper })
    const outcome = await result.current.mutateAsync({ text: HEADED_BRIEF })
    expect(outcome.source).toBe('fallback')
  })

  it('drops a key the function should never have sent', async () => {
    invoke.mockResolvedValue({
      data: { fields: { insight: 'Kept.', clientId: 'someone-else', task: 7 } },
      error: null,
    })
    const { result } = renderHook(() => useIngestBrief(), { wrapper })
    const outcome = await result.current.mutateAsync({ text: HEADED_BRIEF })
    expect(outcome).toEqual({ source: 'model', fields: { insight: 'Kept.' }, oversized: [] })
  })

  // A refusal the server MEANT is not an outage. Collapsing both into the fallback told a
  // caller who simply lacks the grant that the service was down — false, unactionable, and
  // it buried the honest 403 the function took care to write.
  it.each([
    [401, 'unauthenticated'],
    [403, 'forbidden'],
    [413, 'too_long'],
  ])('surfaces a %i as a refusal instead of falling back', async (status, code) => {
    invoke.mockResolvedValue({ data: null, error: httpError(status) })
    const { result } = renderHook(() => useIngestBrief(), { wrapper })
    await expect(result.current.mutateAsync({ text: HEADED_BRIEF })).rejects.toMatchObject({
      name: 'BriefIngestRefusedError',
      code,
    })
  })

  it.each([[500], [502], [503]])(
    'still falls back on a %i, which really is the service failing',
    async (status) => {
      invoke.mockResolvedValue({ data: null, error: httpError(status) })
      const { result } = renderHook(() => useIngestBrief(), { wrapper })
      const outcome = await result.current.mutateAsync({ text: HEADED_BRIEF })
      expect(outcome.source).toBe('fallback')
      expect(outcome.fields.insight).toBe('Effort, not spend.')
    },
  )

  it('exports the refusal type so the panel can match on it', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(403) })
    const { result } = renderHook(() => useIngestBrief(), { wrapper })
    await expect(result.current.mutateAsync({ text: HEADED_BRIEF })).rejects.toBeInstanceOf(
      BriefIngestRefusedError,
    )
  })

  it('refuses an over-cap document instead of sending or truncating it', async () => {
    const { result } = renderHook(() => useIngestBrief(), { wrapper })
    await expect(
      result.current.mutateAsync({ text: 'x'.repeat(MAX_BRIEF_CHARS + 1) }),
    ).rejects.toBeInstanceOf(BriefTooLongError)
    expect(invoke).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
