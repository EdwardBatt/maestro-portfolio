import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'

/**
 * A piece's own Library folder (ADR-0134 d.22) — where its working files go when the maker sends work
 * for review (d.24). The folder is made by the database with the piece; until that migration is in, or
 * for a piece outside a campaign, there is none, and the control says so without blocking anything.
 */
export const workingFilesKeys = {
  all: ['piece-library-folder'] as const,
  folder: (deliverableId: string) => [...workingFilesKeys.all, deliverableId] as const,
}

export interface PieceLibraryFolder {
  folderId: string
  clientId: string
  /** "Kite / LUMA S2 / Deliverables / KV-01 · Key visual" — for the upload box's "Into" line. */
  path: string
}

export function usePieceLibraryFolder(deliverableId: string | null) {
  return useQuery({
    queryKey: workingFilesKeys.folder(deliverableId ?? 'none'),
    enabled: !!deliverableId,
    queryFn: async (): Promise<PieceLibraryFolder | null> => {
      const { data, error } = await supabaseUntyped
        .from('asset_folders')
        .select('id, name, client_id')
        .eq('deliverable_id', deliverableId!)
        .eq('kind', 'deliverable')
        .maybeSingle()
      // An error here is the column or kind not existing yet: there is no folder to file into.
      if (error || !data) return null
      const row = data as { id: string; name: string; client_id: string }
      let path = row.name
      try {
        const { data: screen } = await supabaseUntyped.rpc('library_folder', { p_folder: row.id })
        const chain = ((screen as { chain?: { name: string }[] } | null)?.chain ?? []).map((c) => c.name)
        if (chain.length > 0) path = chain[chain.length - 1] === row.name ? chain.join(' / ') : [...chain, row.name].join(' / ')
      } catch {
        // the folder's own name is enough
      }
      return { folderId: row.id, clientId: row.client_id, path }
    },
  })
}
