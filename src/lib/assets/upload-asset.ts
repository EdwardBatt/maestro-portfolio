import { supabaseUntyped } from '../supabase'

/**
 * Upload one file into an asset folder (ADR-0022), shared by the Library surface and the
 * Brief Wizard's reference filing (ADR-0044 §8). It lives in `lib/` rather than in either
 * feature because both need it and a feature never reaches into another's internals
 * (AGENTS.md §3).
 *
 * The shape is fixed by ADR-0022: the `asset-url` Edge Function holds the bucket
 * credentials and only ever SIGNS; the browser PUTs the bytes straight to B2; the asset
 * row is then written here under RLS (`assets:manage`), so the database stays the audited
 * source of truth and no file bytes pass through the app.
 */
export interface UploadAssetArgs {
  folderId: string
  file: File
  /** From the caller's JWT claims, which are nullable until the session resolves. */
  tenantId: string | null
  uploadedBy: string | null
}

export interface UploadedAsset {
  assetId: string
  objectKey: string
}

export async function uploadAssetToFolder(args: UploadAssetArgs): Promise<UploadedAsset> {
  const { folderId, file, tenantId, uploadedBy } = args
  const contentType = file.type || 'application/octet-stream'

  // 1. Mint a presigned PUT URL (grant-gated, tenant-verified server-side).
  const signed = await supabaseUntyped.functions.invoke('asset-url', {
    body: { op: 'upload', folderId, fileName: file.name, contentType, size: file.size },
  })
  if (signed.error) throw signed.error
  const { uploadUrl, objectKey, provider } = signed.data as {
    uploadUrl: string
    objectKey: string
    provider: string
  }

  // 2. Send the bytes straight to B2.
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'content-type': contentType },
  })
  if (!put.ok) throw new Error(`upload_failed_${put.status}`)

  // 3. Record the asset row (RLS: assets:manage) + its first version.
  const { data: inserted, error: insErr } = await supabaseUntyped
    .from('assets')
    .insert({
      tenant_id: tenantId,
      folder_id: folderId,
      name: file.name,
      provider,
      object_key: objectKey,
      content_type: contentType,
      size_bytes: file.size,
      current_version: 1,
      uploaded_by: uploadedBy,
    })
    .select('id')
    .single()
  if (insErr) throw insErr
  const assetId = (inserted as { id: string }).id

  const { error: verErr } = await supabaseUntyped.from('asset_versions').insert({
    tenant_id: tenantId,
    asset_id: assetId,
    version: 1,
    object_key: objectKey,
    content_type: contentType,
    size_bytes: file.size,
    uploaded_by: uploadedBy,
  })
  if (verErr) throw verErr

  return { assetId, objectKey }
}
