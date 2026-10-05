import { supabaseUntyped } from '../supabase'

/**
 * A short-lived download address for one Library asset, from the `asset-url` edge function — the
 * Library's own door (ADR-0022): bytes never pass through the app. One copy for every reader (the
 * Library, the task page's reference files and the receipt's screenshot), I59 Track 6 / AGENTS.md §3.
 */
export async function fetchAssetDownloadUrl(assetId: string): Promise<string> {
  const res = await supabaseUntyped.functions.invoke('asset-url', { body: { op: 'download', assetId } })
  if (res.error) throw res.error
  return (res.data as { downloadUrl: string }).downloadUrl
}
