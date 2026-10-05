import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { folderKeys } from '../../../lib/assets/folders'

/**
 * The Library's reads and writes (ADR-0134). Every screen reads through an RPC that answers the whole
 * screen in one round trip — a client's overview, one folder, a campaign's piece folders — because the
 * counts the frames show (files per brand, delivered per project) are aggregates nobody should compute
 * row by row in the browser. Writes are RPCs too: each one carries a rule the database enforces (the
 * extension is kept on a rename, a version is never overwritten, a move stays inside the client), so the
 * rule lives in one place and the screen only asks.
 *
 * Bytes still never pass through the app: `asset-url` signs, the browser talks to B2 (ADR-0022 d.3).
 */

export const libraryKeys = {
  all: ['library'] as const,
  clients: () => [...libraryKeys.all, 'clients'] as const,
  overview: (clientId: string) => [...libraryKeys.all, 'overview', clientId] as const,
  folder: (folderId: string) => [...libraryKeys.all, 'folder', folderId] as const,
  pieces: (folderId: string) => [...libraryKeys.all, 'pieces', folderId] as const,
  versions: (assetId: string) => [...libraryKeys.all, 'versions', assetId] as const,
  usage: (assetId: string) => [...libraryKeys.all, 'usage', assetId] as const,
  deleted: (clientId: string) => [...libraryKeys.all, 'deleted', clientId] as const,
  search: (q: string, kind: string, clientId: string) => [...libraryKeys.all, 'search', q, kind, clientId] as const,
  searchCounts: (q: string, clientId: string) => [...libraryKeys.all, 'search-counts', q, clientId] as const,
  tree: (clientId: string) => [...libraryKeys.all, 'tree', clientId] as const,
}

// ---- shapes ----------------------------------------------------------------------------------

export interface LibraryClient {
  id: string
  name: string
  fileCount: number
  canChange: boolean
}

export interface BrandCard {
  folderId: string
  name: string
  fileCount: number
  subfolders: string[]
}

export interface ProjectCard {
  folderId: string
  campaignId: string
  name: string
  kind: 'campaign' | 'single_job'
  brandName: string | null
  phaseCount: number
  fileCount: number
  deliveredCount: number
  inReview: boolean
  status: string
  lookalike: { campaignId: string; name: string; folderId: string | null } | null
}

export interface ClientOverview {
  brands: BrandCard[]
  projects: ProjectCard[]
  brandRootId: string | null
  projectsRootId: string | null
  canChange: boolean
}

export interface LibraryFile {
  id: string
  name: string
  contentType: string | null
  sizeBytes: number | null
  currentVersion: number
  uploadedBy: string | null
  uploadedByName: string | null
  createdAt: string
  updatedAt: string
  linkUrl: string | null
  linkExpiresOn: string | null
  thumbObjectKey: string | null
  durationSeconds: number | null
  isSource: boolean
  isProof: boolean
  archivedAt: string | null
  canDelete: boolean
}

export interface FolderRef {
  id: string
  name: string
  kind: string
}

export interface SubfolderCard extends FolderRef {
  isSystem: boolean
  fileCount: number
  updatedAt: string | null
}

export interface FolderScreen {
  folder: {
    id: string
    name: string
    kind: string
    isSystem: boolean
    clientId: string
    campaignId: string | null
    brandId: string | null
    deliverableId: string | null
    createdBy: string | null
  }
  chain: FolderRef[]
  subfolders: SubfolderCard[]
  files: LibraryFile[]
  canChange: boolean
  canDeleteFolder: boolean
  campaign: {
    id: string
    name: string
    kind: 'campaign' | 'single_job'
    brandName: string | null
    fileCount: number
    openedByName: string | null
    openedAt: string | null
  } | null
}

export type ReviewState = 'in_review' | 'changes_requested' | 'approved' | 'superseded' | 'delivered'

export interface PieceVersion {
  id: string
  fileName: string
  version: number
  round: number | null
  contentType: string | null
  sizeBytes: number | null
  reviewState: ReviewState
  createdAt: string
}

export interface PieceFolder {
  deliverableId: string
  code: string | null
  name: string
  workstreamName: string | null
  typeName: string | null
  phaseName: string | null
  folderId: string | null
  versions: PieceVersion[]
  sources: LibraryFile[]
}

export interface PieceFolders {
  pieces: PieceFolder[]
  pieceCount: number
  deliveredCount: number
}

export interface VersionRow {
  version: number
  hasFile: boolean
  linkUrl: string | null
  contentType: string | null
  sizeBytes: number | null
  uploadedByName: string | null
  createdAt: string
  note: string | null
  reviewNote: string | null
}

export interface UsageRow {
  deliverableId: string
  campaignName: string
  pieceName: string
}

export interface DeletedRow {
  id: string
  name: string
  folderPath: string
  deletedAt: string
  deletedByName: string | null
  purgeOn: string
  contentType: string | null
  linkUrl: string | null
}

export type KindBucket = 'image' | 'document' | 'video' | 'link' | 'proof' | 'other'

export interface SearchHit {
  id: string
  name: string
  folderId: string
  clientId: string
  clientName: string
  path: string
  contentType: string | null
  linkUrl: string | null
  sizeBytes: number | null
  updatedAt: string
  kindBucket: KindBucket
}

// ---- mapping (the RPCs answer snake_case) ---------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any -- RPC rows arrive untyped until `gen types` runs */
const num = (v: unknown): number => (v == null ? 0 : Number(v))

export function toFile(f: any): LibraryFile {
  return {
    id: f.id,
    name: f.name,
    contentType: f.content_type ?? null,
    sizeBytes: f.size_bytes == null ? null : Number(f.size_bytes),
    currentVersion: num(f.current_version) || 1,
    uploadedBy: f.uploaded_by ?? null,
    uploadedByName: f.uploaded_by_name ?? null,
    createdAt: f.created_at,
    updatedAt: f.updated_at ?? f.created_at,
    linkUrl: f.link_url ?? null,
    linkExpiresOn: f.link_expires_on ?? null,
    thumbObjectKey: f.thumb_object_key ?? null,
    durationSeconds: f.duration_seconds == null ? null : Number(f.duration_seconds),
    isSource: Boolean(f.is_source),
    isProof: Boolean(f.is_proof),
    archivedAt: f.archived_at ?? null,
    canDelete: Boolean(f.can_delete),
  }
}

function toOverview(d: any): ClientOverview {
  return {
    brands: (d?.brands ?? []).map((b: any) => ({
      folderId: b.folder_id, name: b.name, fileCount: num(b.file_count), subfolders: b.subfolders ?? [],
    })),
    projects: (d?.projects ?? []).map((p: any) => ({
      folderId: p.folder_id,
      campaignId: p.campaign_id,
      name: p.name,
      kind: p.kind === 'single_job' ? 'single_job' : 'campaign',
      brandName: p.brand_name ?? null,
      phaseCount: num(p.phase_count),
      fileCount: num(p.file_count),
      deliveredCount: num(p.delivered_count),
      inReview: Boolean(p.in_review),
      status: p.status ?? '',
      lookalike: p.lookalike
        ? { campaignId: p.lookalike.campaign_id, name: p.lookalike.name, folderId: p.lookalike.folder_id ?? null }
        : null,
    })),
    brandRootId: d?.brand_root_id ?? null,
    projectsRootId: d?.projects_root_id ?? null,
    canChange: Boolean(d?.can_change),
  }
}

function toFolderScreen(d: any): FolderScreen {
  const f = d.folder
  return {
    folder: {
      id: f.id, name: f.name, kind: f.kind, isSystem: Boolean(f.is_system), clientId: f.client_id,
      campaignId: f.campaign_id ?? null, brandId: f.brand_id ?? null, deliverableId: f.deliverable_id ?? null,
      createdBy: f.created_by ?? null,
    },
    chain: (d.chain ?? []).map((c: any) => ({ id: c.id, name: c.name, kind: c.kind })),
    subfolders: (d.subfolders ?? []).map((s: any) => ({
      id: s.id, name: s.name, kind: s.kind, isSystem: Boolean(s.is_system), fileCount: num(s.file_count),
      updatedAt: s.updated_at ?? null,
    })),
    files: (d.files ?? []).map(toFile),
    canChange: Boolean(d.can_change),
    canDeleteFolder: Boolean(d.can_delete_folder),
    campaign: d.campaign
      ? {
          id: d.campaign.id, name: d.campaign.name, kind: d.campaign.kind === 'single_job' ? 'single_job' : 'campaign',
          brandName: d.campaign.brand_name ?? null, fileCount: num(d.campaign.file_count),
          openedByName: d.campaign.opened_by_name ?? null, openedAt: d.campaign.opened_at ?? null,
        }
      : null,
  }
}

function toPieces(d: any): PieceFolders {
  const list = Array.isArray(d) ? d : (d?.pieces ?? [])
  return {
    pieces: list.map((p: any) => ({
      deliverableId: p.deliverable_id,
      code: p.code ?? null,
      name: p.name,
      workstreamName: p.workstream_name ?? null,
      typeName: p.type_name ?? null,
      phaseName: p.phase_name ?? null,
      folderId: p.folder_id ?? null,
      versions: (p.versions ?? []).map((v: any) => ({
        id: v.id, fileName: v.file_name, version: num(v.version), round: v.round == null ? null : Number(v.round),
        contentType: v.content_type ?? null, sizeBytes: v.size_bytes == null ? null : Number(v.size_bytes),
        reviewState: v.review_state as ReviewState, createdAt: v.created_at,
      })),
      sources: (p.sources ?? []).map(toFile),
    })),
    pieceCount: num(d?.piece_count ?? list.length),
    deliveredCount: num(d?.delivered_count),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseUntyped.rpc(name, args)
  if (error) throw error
  return data as T
}

// ---- reads -------------------------------------------------------------------------------------

export function useLibraryClients() {
  return useQuery({
    queryKey: libraryKeys.clients(),
    queryFn: async (): Promise<LibraryClient[]> => {
      const rows = await rpc<{ id: string; name: string; file_count: number; can_change: boolean }[]>('library_clients', {})
      return (rows ?? []).map((r) => ({ id: r.id, name: r.name, fileCount: num(r.file_count), canChange: Boolean(r.can_change) }))
    },
  })
}

export function useClientOverview(clientId: string | null) {
  return useQuery({
    queryKey: libraryKeys.overview(clientId ?? 'none'),
    enabled: Boolean(clientId),
    placeholderData: keepPreviousData,
    queryFn: async () => toOverview(await rpc('library_client_overview', { p_client: clientId })),
  })
}

export function useLibraryFolder(folderId: string | null) {
  return useQuery({
    queryKey: libraryKeys.folder(folderId ?? 'none'),
    enabled: Boolean(folderId),
    queryFn: async () => toFolderScreen(await rpc('library_folder', { p_folder: folderId })),
  })
}

export function usePieceFolders(folderId: string | null) {
  return useQuery({
    queryKey: libraryKeys.pieces(folderId ?? 'none'),
    enabled: Boolean(folderId),
    queryFn: async () => toPieces(await rpc('library_piece_folders', { p_folder: folderId })),
  })
}

export function useVersions(assetId: string | null) {
  return useQuery({
    queryKey: libraryKeys.versions(assetId ?? 'none'),
    enabled: Boolean(assetId),
    queryFn: async (): Promise<VersionRow[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await rpc<any[]>('library_versions', { p_asset: assetId })
      return (rows ?? []).map((v) => ({
        version: num(v.version), hasFile: Boolean(v.has_file), linkUrl: v.link_url ?? null,
        contentType: v.content_type ?? null, sizeBytes: v.size_bytes == null ? null : Number(v.size_bytes),
        uploadedByName: v.uploaded_by_name ?? null, createdAt: v.created_at, note: v.note ?? null,
        reviewNote: v.review_note ?? null,
      }))
    },
  })
}

export function useUsage(assetId: string | null) {
  return useQuery({
    queryKey: libraryKeys.usage(assetId ?? 'none'),
    enabled: Boolean(assetId),
    queryFn: async (): Promise<UsageRow[]> => {
      const rows = await rpc<{ deliverable_id: string; campaign_name: string; piece_name: string }[]>('library_usage', { p_asset: assetId })
      return (rows ?? []).map((r) => ({ deliverableId: r.deliverable_id, campaignName: r.campaign_name, pieceName: r.piece_name }))
    },
  })
}

export function useRecentlyDeleted(clientId: string | null) {
  return useQuery({
    queryKey: libraryKeys.deleted(clientId ?? 'none'),
    enabled: Boolean(clientId),
    queryFn: async (): Promise<DeletedRow[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await rpc<any[]>('library_recently_deleted', { p_client: clientId })
      return (rows ?? []).map((r) => ({
        id: r.id, name: r.name, folderPath: r.folder_path ?? '', deletedAt: r.deleted_at,
        deletedByName: r.deleted_by_name ?? null, purgeOn: r.purge_on,
        contentType: r.content_type ?? null, linkUrl: r.link_url ?? null,
      }))
    },
  })
}

export function useLibrarySearch(query: string, kind: KindBucket | 'all', clientId: string | null) {
  const q = query.trim()
  return useQuery({
    queryKey: libraryKeys.search(q, kind, clientId ?? 'any'),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<SearchHit[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await rpc<any[]>('library_search', { p_query: q, p_kind: kind === 'all' ? null : kind, p_client: clientId })
      return (rows ?? []).map((r) => ({
        id: r.id, name: r.name, folderId: r.folder_id, clientId: r.client_id, clientName: r.client_name, path: r.path ?? '',
        contentType: r.content_type ?? null, linkUrl: r.link_url ?? null,
        sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes), updatedAt: r.updated_at,
        kindBucket: (r.kind_bucket ?? 'other') as KindBucket,
      }))
    },
  })
}

export function useLibrarySearchCounts(query: string, clientId: string | null) {
  const q = query.trim()
  return useQuery({
    queryKey: libraryKeys.searchCounts(q, clientId ?? 'any'),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Record<KindBucket, number>> => {
      const rows = await rpc<{ kind_bucket: KindBucket; n: number }[]>('library_search_counts', { p_query: q, p_client: clientId })
      const out = { image: 0, document: 0, video: 0, link: 0, proof: 0, other: 0 } as Record<KindBucket, number>
      for (const r of rows ?? []) out[r.kind_bucket] = num(r.n)
      return out
    },
  })
}

/** A client's whole folder tree, for Move to… / Copy to… (LB-09). Every page, as the folder picker reads it. */
export function useClientTree(clientId: string | null) {
  return useQuery({
    queryKey: libraryKeys.tree(clientId ?? 'none'),
    enabled: Boolean(clientId),
    queryFn: async () => {
      const out: { id: string; parentId: string | null; name: string; kind: string; isSystem: boolean }[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabaseUntyped
          .from('asset_folders')
          .select('id, parent_id, name, kind, is_system')
          .eq('client_id', clientId!)
          .order('name')
          .order('id')
          .range(from, from + 999)
        if (error) throw error
        const page = (data ?? []) as { id: string; parent_id: string | null; name: string; kind: string; is_system: boolean }[]
        out.push(...page.map((f) => ({ id: f.id, parentId: f.parent_id, name: f.name, kind: f.kind, isSystem: f.is_system })))
        if (page.length < 1000) return out
      }
    },
  })
}

// ---- writes ------------------------------------------------------------------------------------

/** After any write the Library re-reads what it shows; nothing is patched by hand in the cache. */
function useRefresh() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: libraryKeys.all })
    void qc.invalidateQueries({ queryKey: folderKeys.all })
  }
}

function useRpcMutation<A extends Record<string, unknown>, R = unknown>(name: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (args: A) => rpc<R>(name, args),
    onSuccess: refresh,
  })
}

export const useRename = () => useRpcMutation<{ p_asset: string; p_base: string }, string>('library_rename')
export const useMove = () => useRpcMutation<{ p_asset: string; p_folder: string }>('library_move')
export const useMoveFolder = () => useRpcMutation<{ p_folder: string; p_parent: string }>('library_move_folder')
export const useRenameFolder = () => useRpcMutation<{ p_folder: string; p_name: string }>('library_rename_folder')
export const useMakeCurrent = () => useRpcMutation<{ p_asset: string; p_version: number }, number>('library_make_current')
export const useDeleteFile = () => useRpcMutation<{ p_asset: string }>('library_delete')
export const useRestoreFile = () => useRpcMutation<{ p_asset: string }>('library_restore')
export const useBringBack = () => useRpcMutation<{ p_asset: string }>('library_bring_back')
export const useAddLink = () =>
  useRpcMutation<{ p_folder: string; p_name: string; p_url: string; p_expires_on: string | null }, string>('library_add_link')
export const useAddLinkVersion = () =>
  useRpcMutation<{ p_asset: string; p_url: string; p_expires_on: string | null }, number>('library_add_link_version')

/** A made folder, inside the folder on screen. The standard four are never made here (ADR-0134 d.19). */
export function useCreateLibraryFolder() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (args: { tenantId: string | null; clientId: string; parentId: string; name: string }) => {
      const { error } = await supabaseUntyped.from('asset_folders').insert({
        tenant_id: args.tenantId, client_id: args.clientId, parent_id: args.parentId, name: args.name.trim(), kind: 'custom',
      })
      if (error) throw error
    },
    onSuccess: refresh,
  })
}

export function useDeleteLibraryFolder() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (folderId: string) => {
      const { error } = await supabaseUntyped.from('asset_folders').delete().eq('id', folderId)
      if (error) throw error
    },
    onSuccess: refresh,
  })
}

/** Copy to… (ADR-0134 d.10): the bytes are copied in storage by `asset-url`, then recorded at v1. */
export function useCopyFile() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (args: { assetId: string; folderId: string }) => {
      const res = await supabaseUntyped.functions.invoke('asset-url', { body: { op: 'copy', assetId: args.assetId, folderId: args.folderId } })
      if (res.error) throw res.error
      const { objectKey, thumbObjectKey } = res.data as { objectKey: string; thumbObjectKey: string | null }
      return rpc<string>('library_copy_record', {
        p_asset: args.assetId, p_folder: args.folderId, p_object_key: objectKey, p_thumb_object_key: thumbObjectKey ?? null,
      })
    },
    onSuccess: refresh,
  })
}

// ---- addresses (signed by asset-url) ---------------------------------------------------------------

export async function fetchVersionDownloadUrl(assetId: string, version?: number): Promise<string> {
  const res = await supabaseUntyped.functions.invoke('asset-url', { body: { op: 'download', assetId, version } })
  if (res.error) throw res.error
  return (res.data as { downloadUrl: string }).downloadUrl
}

export async function fetchPreviewUrl(assetId: string): Promise<string> {
  const res = await supabaseUntyped.functions.invoke('asset-url', { body: { op: 'preview', assetId } })
  if (res.error) throw res.error
  return (res.data as { url?: string; downloadUrl?: string }).url ?? (res.data as { downloadUrl: string }).downloadUrl
}

export async function fetchThumbUrl(assetId: string): Promise<string | null> {
  const res = await supabaseUntyped.functions.invoke('asset-url', { body: { op: 'thumb_url', assetId } })
  if (res.error) return null
  return (res.data as { url?: string }).url ?? null
}

export { fetchAssetDownloadUrl } from '../../../lib/assets/download-url'

/**
 * The live files of one folder, plain — kept for the single-job review step, which lists the job's
 * References (`JobReviewStep`). The Library itself reads `library_folder`.
 */
export interface AssetRow {
  id: string
  folderId: string
  name: string
  contentType: string | null
  sizeBytes: number | null
  currentVersion: number
  updatedAt: string
}

export function useFolderAssets(folderId: string | null) {
  return useQuery({
    queryKey: [...libraryKeys.all, 'assets', folderId ?? 'none'],
    enabled: Boolean(folderId),
    queryFn: async (): Promise<AssetRow[]> => {
      const { data, error } = await supabaseUntyped
        .from('assets')
        .select('id, folder_id, name, content_type, size_bytes, current_version, updated_at')
        .eq('folder_id', folderId!)
        .eq('retention_state', 'active')
        .is('deleted_at', null)
        .order('name')
        .limit(1000)
      if (error) throw error
      return ((data ?? []) as {
        id: string; folder_id: string; name: string; content_type: string | null
        size_bytes: number | null; current_version: number; updated_at: string
      }[]).map((a) => ({
        id: a.id, folderId: a.folder_id, name: a.name, contentType: a.content_type,
        sizeBytes: a.size_bytes, currentVersion: a.current_version, updatedAt: a.updated_at,
      }))
    },
  })
}
