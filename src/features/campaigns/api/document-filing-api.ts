import { useMutation, useQuery } from '@tanstack/react-query'
import { useAuth } from '../../../app/auth-context'
import { uploadAssetToFolder } from '../../../lib/assets/upload-asset'
import { useInvalidateFolders } from '../../../lib/assets/folders'
import { supabaseUntyped } from '../../../lib/supabase'

/**
 * Filing documents during the wizard (I35.2 / I35.4) — brand documents on step 1, campaign
 * reference materials on step 2.
 *
 * NOTHING IS STAGED, which is the whole point of ADR-0067. A brand's folders exist from the
 * moment the brand does, and a campaign's from the moment the DRAFT does, so both of these are
 * ordinary uploads into a folder that is already there. What this replaces is ADR-0044 §8's
 * promise-then-apologise path, which existed only because the campaign did not exist yet — and
 * which was written for exactly one file.
 */

export interface FileOutcome {
  name: string
  ok: boolean
  /** The asset row, when it was filed. The brief receipt points at its screenshot by this. */
  assetId?: string
  /** I48.39: what was thrown when it was NOT filed, so the report can say why. */
  error?: unknown
}

export interface FileDocumentsArgs {
  folderId: string
  /** Only used to invalidate the right tree afterwards. */
  clientId: string
  files: File[]
}

/**
 * Files each document and reports **per file**, never per batch.
 *
 * ONE AT A TIME, DELIBERATELY. Each upload is a presign call, a PUT to B2 and two row writes; six
 * of those in parallel that half-fail leave a message nobody can act on, and B2 is not the
 * bottleneck a person is waiting on here anyway.
 *
 * NEVER REJECTS. A failure is a result, not an exception: uploading needs `assets:manage`, which
 * the wizard itself does not require (ADR-0044 §8), so a partial batch is an ordinary outcome and
 * the caller has to be able to say *which* files did not make it. "One document could not be
 * filed" tells nobody what to try again.
 */
export function useFileDocuments() {
  const { claims, session } = useAuth()
  const invalidateFolders = useInvalidateFolders()
  return useMutation({
    mutationFn: async ({ folderId, files }: FileDocumentsArgs): Promise<FileOutcome[]> => {
      const results: FileOutcome[] = []
      for (const file of files) {
        try {
          const { assetId } = await uploadAssetToFolder({
            folderId,
            file,
            tenantId: claims.tenantId,
            uploadedBy: session?.user.id ?? null,
          })
          results.push({ name: file.name, ok: true, assetId })
        } catch (e) {
          console.warn('document could not be filed', file.name, e)
          results.push({ name: file.name, ok: false, error: e })
        }
      }
      return results
    },
    onSuccess: (_r, v) => void invalidateFolders(v.clientId),
  })
}

/**
 * The campaign's References folder, read STRAIGHT FROM THE DATABASE rather than from the cached
 * folder tree.
 *
 * This is called moments after `start_campaign_draft` created the campaign, and the cached tree
 * was fetched before those folders existed — the exact staleness that made the step 2 filing panel
 * vanish (traps.md). Invalidation fixes the panel, which re-renders when the refetch lands; it
 * does NOT help a function that needs the id *now*. So this asks.
 */
export async function fetchCampaignReferencesFolder(campaignId: string): Promise<string | null> {
  const { data, error } = await supabaseUntyped
    .from('asset_folders')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('kind', 'asset_type')
    .eq('name', 'References')
    .maybeSingle()
  if (error) throw error
  return (data as { id: string } | null)?.id ?? null
}

/** The same folder as a query, for the panel that files into it (keyed by campaign, so never stale). */
export function useCampaignReferencesFolder(campaignId: string | null) {
  return useQuery({
    queryKey: ['campaign-references-folder', campaignId ?? 'none'],
    enabled: Boolean(campaignId),
    queryFn: () => fetchCampaignReferencesFolder(campaignId!),
  })
}

/**
 * What to call the screenshot in the Library (ADR-0066 d.3).
 *
 * A pasted image arrives as `image.png` or with no name at all — the clipboard has no filename to
 * give. Left alone, every campaign's evidence would be called `image.png`, which is precisely the
 * kind of name I35.1 existed to stop the app producing. Named from the receipt instead, so the
 * Library row says what it is and when the brief arrived without opening it.
 *
 * A chosen file keeps its own name: the person picked it deliberately and it may already say
 * something useful.
 */
export function receiptFileName(image: File, receivedDate: string, receivedTime: string): string {
  const pasted = !image.name || image.name === 'image.png'
  if (!pasted) return image.name
  const extension = image.type === 'image/jpeg' ? 'jpg' : image.type === 'image/webp' ? 'webp' : 'png'
  const when = receivedDate && receivedTime ? `${receivedDate} ${receivedTime.replace(':', '-')}` : 'undated'
  return `Brief received ${when}.${extension}`
}

/** The screenshot as a File the Library can take, under the name above. */
export function receiptFile(image: File, receivedDate: string, receivedTime: string): File {
  const name = receiptFileName(image, receivedDate, receivedTime)
  return name === image.name ? image : new File([image], name, { type: image.type })
}
