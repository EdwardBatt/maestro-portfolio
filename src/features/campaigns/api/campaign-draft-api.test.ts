// ADR-0067 (I35.4) — the draft campaign's cache contract.
//
// WHY THIS FILE EXISTS, AND IT IS NOT THE RPC ARGUMENTS. Those are proved by pgTAP
// (`080_campaign_draft_lifecycle.sql`) against a real database, which is a better test of them
// than a mock. What pgTAP cannot see is the browser's cache, and that is where this went wrong
// in front of Edward on the first run: **step 2 showed no campaign folder at all.**
//
// The cause: `start_campaign_draft` inserts a campaign, the insert trigger provisions its Working
// Files / Deliverables / Final Assets / References folders, and the wizard had already read the
// client's folder tree when the client was picked — before any of that existed. Nothing
// invalidated it, so `campaignRoot()` searched a stale list, found nothing, and the filing panel
// rendered nothing. No error anywhere: the feature was simply absent.
//
// Registering a brand has exactly the same shape (`app.provision_brand_folders`), so both are
// pinned here. The rule these tests encode: **a mutation that provisions rows invalidates what it
// provisioned, at the mutation — never at the call site, where the next caller will forget.**
//
// `lib/supabase` is mocked, which also keeps `lib/env` out of the import graph — it Zod-parses
// `import.meta.env` at import time and throws when the VITE_ vars are absent (traps.md).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
const insert = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/supabase', () => ({
  supabaseUntyped: {
    rpc,
    from: () => ({
      insert: (row: unknown) => {
        insert(row)
        return { select: () => ({ single: async () => ({ data: { id: 'brand-9' }, error: null }) }) }
      },
    }),
  },
}))
vi.mock('../../../app/auth-context', () => ({
  useAuth: () => ({ claims: { tenantId: 't1' }, session: { user: { id: 'u1' } } }),
}))

import { useStartCampaignDraft } from './campaign-api'
import { folderKeys } from '../../../lib/assets/folders'
import { useCreateBrand } from '../../../lib/brands'

let client: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children)
}

/** Seed the cache the way the wizard does: the client's tree, read before anything provisioned. */
function seedFolderCache(clientId: string) {
  client.setQueryData(folderKeys.forClient(clientId), [])
}

function folderCacheIsStale(clientId: string): boolean {
  return client.getQueryState(folderKeys.forClient(clientId))?.isInvalidated === true
}

describe('useStartCampaignDraft (ADR-0067 d.1)', () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: 'draft-1', error: null })
    client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  })

  it('creates the campaign as a draft through the RPC, with step 1 as its identity', async () => {
    const { result } = renderHook(() => useStartCampaignDraft(), { wrapper })
    await result.current.mutateAsync({
      clientId: 'c1',
      brandId: 'b1',
      name: '  Zeta Ramadan  ',
      accountManagerId: 'u2',
    })
    expect(rpc).toHaveBeenCalledWith('start_campaign_draft', {
      p_client: 'c1',
      p_brand: 'b1',
      p_name: 'Zeta Ramadan',
      p_account_manager: 'u2',
    })
  })

  it('sends no account manager rather than an empty string — approval falls back to the client', async () => {
    const { result } = renderHook(() => useStartCampaignDraft(), { wrapper })
    await result.current.mutateAsync({ clientId: 'c1', brandId: null, name: 'X', accountManagerId: '' })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_account_manager: null })
  })

  // The regression. Without this the campaign folder simply does not appear on step 2.
  it('invalidates the client folder tree it just provisioned', async () => {
    seedFolderCache('c1')
    expect(folderCacheIsStale('c1')).toBe(false)

    const { result } = renderHook(() => useStartCampaignDraft(), { wrapper })
    await result.current.mutateAsync({ clientId: 'c1', brandId: null, name: 'X', accountManagerId: null })

    await waitFor(() => expect(folderCacheIsStale('c1')).toBe(true))
  })

  it('leaves another client\'s tree alone', async () => {
    seedFolderCache('c1')
    seedFolderCache('c2')
    const { result } = renderHook(() => useStartCampaignDraft(), { wrapper })
    await result.current.mutateAsync({ clientId: 'c1', brandId: null, name: 'X', accountManagerId: null })
    await waitFor(() => expect(folderCacheIsStale('c1')).toBe(true))
    expect(folderCacheIsStale('c2')).toBe(false)
  })
})

describe('useCreateBrand (I35.3)', () => {
  beforeEach(() => {
    insert.mockReset()
    client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  })

  it('registers the brand under the caller\'s own tenant and returns its id', async () => {
    const { result } = renderHook(() => useCreateBrand(), { wrapper })
    const id = await result.current.mutateAsync({ clientId: 'c1', name: '  Harmony  ' })
    expect(id).toBe('brand-9')
    // ADR-0123 d.7: a brand has a short name; none given is stored as null.
    expect(insert).toHaveBeenCalledWith({ tenant_id: 't1', client_id: 'c1', name: 'Harmony', short_name: null })
  })

  // Same failure as the draft one above: the brand's Logos / Fonts / Guidelines / Key Visuals
  // are provisioned by the insert, and the wizard shows them immediately.
  it('invalidates the client folder tree its provisioning trigger just changed', async () => {
    seedFolderCache('c1')
    const { result } = renderHook(() => useCreateBrand(), { wrapper })
    await result.current.mutateAsync({ clientId: 'c1', name: 'Harmony' })
    await waitFor(() => expect(folderCacheIsStale('c1')).toBe(true))
  })
})
