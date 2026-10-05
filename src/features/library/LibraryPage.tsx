import { useCallback } from 'react'
import { useSearchParams } from 'react-router'
import { ClientsView } from './components/ClientsView'
import { FolderView } from './components/FolderView'
import { SearchView } from './components/SearchView'
import { RecentlyDeletedView } from './components/RecentlyDeletedView'

/**
 * The Library (ADR-0022, redesigned by ADR-0134 to Figma section K). Where you are lives in the
 * address — `?client=` (LB-01), `&folder=` (a brand LB-03, a project LB-06, a folder LB-04, a campaign's
 * Deliverables LB-02), `&file=` (a file picked out: a search result, a copied link), `?mode=search&q=`
 * (LB-08) and `&view=deleted` — so Back works, a link can be copied, and the task card's "Library folder"
 * chip (I59.10) still lands in the folder it names.
 *
 * Everyone inside the company reads every client (Edward, 1 Oct); what a person may change is answered by
 * the database per client and comes back on each screen as `canChange`.
 */
export function LibraryPage() {
  const [params, setParams] = useSearchParams()
  const clientId = params.get('client')
  const folderId = params.get('folder')
  const fileId = params.get('file')
  const mode = params.get('mode') === 'search' ? 'search' : 'browse'
  const view = params.get('view')

  const go = useCallback(
    (next: { client?: string | null; folder?: string | null; file?: string | null; mode?: 'search' | null; q?: string | null; view?: string | null }) => {
      const p = new URLSearchParams()
      if (next.mode === 'search') {
        p.set('mode', 'search')
        if (next.q) p.set('q', next.q)
      } else {
        if (next.client) p.set('client', next.client)
        if (next.folder) p.set('folder', next.folder)
        if (next.file) p.set('file', next.file)
        if (next.view) p.set('view', next.view)
      }
      setParams(p)
    },
    [setParams],
  )

  return (
    <section className="lb-page" data-testid="surface-library">
      {mode === 'search' ? (
        <SearchView initialQuery={params.get('q') ?? ''} go={go} />
      ) : view === 'deleted' && clientId ? (
        <RecentlyDeletedView clientId={clientId} go={go} />
      ) : folderId && clientId ? (
        <FolderView key={folderId} clientId={clientId} folderId={folderId} pickedFileId={fileId} go={go} />
      ) : (
        <ClientsView clientId={clientId} go={go} />
      )}
    </section>
  )
}

export type LibraryGo = (next: {
  client?: string | null
  folder?: string | null
  file?: string | null
  mode?: 'search' | null
  q?: string | null
  view?: string | null
}) => void
