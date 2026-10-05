import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../supabase'
import { useAuth } from '../../app/auth-context'
import type { AssetFolder, FolderView } from './folder-tree'

// The tree's SHAPE and the pure walks over it live in `folder-tree.ts`, which imports nothing.
// This file imports `lib/supabase`, and therefore `lib/env`, which throws at import time without
// the VITE_ variables — so anything that only needs the data shape must not come through here.
// `components/FolderPicker.tsx` is exactly that, and its CI failure is what split them.
// Re-exported so callers that want both keep one import.
export {
  brandRoot,
  breadcrumbWithin,
  campaignRoot,
  isDuplicateFolderName,
  viewOf,
  type AssetFolder,
  type FolderView,
} from './folder-tree'

/**
 * The asset folder tree (ADR-0022), read and edited by three surfaces: the Library, the Brief
 * Wizard's brand documents, and its campaign references (I35.2 / I35.4).
 *
 * WHY IT IS HERE AND NOT IN `features/library/api/`. It was there, and it was the only copy, so
 * the wizard would have had to reach into another feature's internals — which `AGENTS.md` §3
 * forbids, and rightly: `library-api` is free to change shape for the Library's own reasons, and
 * two other surfaces silently depending on it is how that stops being true. `uploadAssetToFolder`
 * already sits beside this for exactly the same reason (ADR-0044 §8).
 *
 * The COMPONENT that renders a tree is `src/components/FolderPicker.tsx` and it is deliberately
 * dumb — it fetches nothing (`AGENTS.md` §3: shared components are UI primitives). Each surface
 * calls these hooks itself and hands the result down.
 */

export const folderKeys = {
  all: ['asset-folders'] as const,
  forClient: (clientId: string) => [...folderKeys.all, clientId] as const,
  /** One position in a client's tree. Under `forClient`, so a folder write invalidates it. */
  view: (clientId: string, folderId: string | null) => [...folderKeys.forClient(clientId), 'view', folderId ?? 'root'] as const,
  brandRoot: (brandId: string) => [...folderKeys.all, 'brand-root', brandId] as const,
  campaignRoot: (campaignId: string) => [...folderKeys.all, 'campaign-root', campaignId] as const,
}

const COLUMNS = 'id, client_id, parent_id, name, kind, is_system, brand_id, campaign_id'
/** PostgREST's `max_rows`: the most any single request returns, however many exist. */
const PAGE = 1000

interface FolderRow {
  id: string
  client_id: string
  parent_id: string | null
  name: string
  kind: string
  is_system: boolean
  brand_id: string | null
  campaign_id: string | null
}

function toFolder(f: FolderRow): AssetFolder {
  return {
    id: f.id,
    clientId: f.client_id,
    parentId: f.parent_id,
    name: f.name,
    kind: f.kind,
    isSystem: f.is_system,
    brandId: f.brand_id,
    campaignId: f.campaign_id,
  }
}

async function fetchOne(match: Record<string, string>): Promise<AssetFolder | null> {
  let q = supabaseUntyped.from('asset_folders').select(COLUMNS)
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v)
  const { data, error } = await q.limit(1).maybeSingle()
  if (error) throw error
  return data ? toFolder(data as FolderRow) : null
}

/**
 * A folder's children, every one of them. Paged in case one folder has more direct children than
 * the server returns at once — a client's Projects folder gains one per campaign, so it is the one
 * place that could happen.
 */
async function fetchChildren(parentId: string): Promise<AssetFolder[]> {
  const out: AssetFolder[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseUntyped
      .from('asset_folders')
      .select(COLUMNS)
      .eq('parent_id', parentId)
      .order('name')
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    const page = (data ?? []) as FolderRow[]
    out.push(...page.map(toFolder))
    if (page.length < PAGE) return out
  }
}

/**
 * One position in a client's tree, loaded a level at a time (I49.77): the folder (`null` = the
 * client root), the chain above it, and its children. The whole tree was read here until 15 Sep,
 * and a client past 1,000 folders came back truncated — missing its top levels — and showed an
 * empty Library. A folder id that no longer exists lands at the root rather than nowhere.
 *
 * `keepPreviousData`: stepping into a folder keeps the level you were on in view until the next
 * one arrives, instead of blanking the picker for every click.
 */
export function useFolderView(clientId: string | null, folderId: string | null) {
  return useQuery({
    queryKey: folderKeys.view(clientId ?? 'none', folderId),
    enabled: Boolean(clientId),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<FolderView> => {
      const root = await fetchOne({ client_id: clientId!, kind: 'client_root' })
      if (!root) throw new Error(`client ${clientId} has no root folder`)
      const chain: AssetFolder[] = []
      let cur = folderId ? await fetchOne({ id: folderId, client_id: clientId! }) : root
      if (!cur) cur = root
      // Upwards to the root. Bounded: a tree a hundred deep is a data fault, not a place to hang.
      for (let depth = 0; cur && depth < 100; depth++) {
        chain.unshift(cur)
        if (cur.id === root.id) break
        cur = cur.parentId ? await fetchOne({ id: cur.parentId }) : null
      }
      if (chain[0]?.id !== root.id) chain.unshift(root)
      const here = chain[chain.length - 1]!
      const children = await fetchChildren(here.id)
      return { root, chain, children, folders: [...chain, ...children] }
    },
  })
}

/** A brand's own folder — the fence the wizard files brand documents inside. */
export function useBrandFolderRoot(brandId: string | null) {
  return useQuery({
    queryKey: folderKeys.brandRoot(brandId ?? 'none'),
    enabled: Boolean(brandId),
    queryFn: () => fetchOne({ kind: 'brand', brand_id: brandId! }),
  })
}

/**
 * A campaign's own folder. Keyed by the campaign, so a draft created a moment ago is asked for
 * afresh rather than found missing in a tree cached before it existed (traps.md).
 */
export function useCampaignFolderRoot(campaignId: string | null) {
  return useQuery({
    queryKey: folderKeys.campaignRoot(campaignId ?? 'none'),
    enabled: Boolean(campaignId),
    queryFn: () => fetchOne({ kind: 'campaign', campaign_id: campaignId! }),
  })
}

export function useInvalidateFolders() {
  const qc = useQueryClient()
  return (clientId: string) => qc.invalidateQueries({ queryKey: folderKeys.forClient(clientId) })
}

/**
 * A folder somebody made, as opposed to one `app.provision_*_folders` made. Needs `assets:manage`
 * — the same grant as uploading, so anyone who can put a file somewhere can make somewhere to put
 * it, and no new permission was invented for this (ADR-0055's test: the job is the same job).
 */
export function useCreateFolder() {
  const { claims } = useAuth()
  const invalidate = useInvalidateFolders()
  return useMutation({
    mutationFn: async (args: { clientId: string; parentId: string; name: string }) => {
      const { error } = await supabaseUntyped.from('asset_folders').insert({
        tenant_id: claims.tenantId,
        client_id: args.clientId,
        parent_id: args.parentId,
        name: args.name.trim(),
        kind: 'custom',
        is_system: false,
      })
      if (error) throw error
    },
    onSuccess: (_d, v) => void invalidate(v.clientId),
  })
}

export function useRenameFolder() {
  const invalidate = useInvalidateFolders()
  return useMutation({
    mutationFn: async (args: { id: string; clientId: string; name: string }) => {
      const { error } = await supabaseUntyped
        .from('asset_folders')
        .update({ name: args.name.trim() })
        .eq('id', args.id)
      if (error) throw error
    },
    onSuccess: (_d, v) => void invalidate(v.clientId),
  })
}

export function useDeleteFolder() {
  const invalidate = useInvalidateFolders()
  return useMutation({
    mutationFn: async (args: { id: string; clientId: string }) => {
      const { error } = await supabaseUntyped.from('asset_folders').delete().eq('id', args.id)
      if (error) throw error
    },
    onSuccess: (_d, v) => void invalidate(v.clientId),
  })
}




