import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
// `folder-tree`, NOT `folders`: the latter imports the Supabase client, and a dumb
// presentational component has no business dragging the database into its module graph.
import { breadcrumbWithin, type AssetFolder } from '../lib/assets/folder-tree'
import { Button } from './Button'

/**
 * Browse a subtree of the asset folder tree and land on one folder (I35.8).
 *
 * Used three times: the Library browses a whole client, the Brief Wizard browses one brand's
 * folders on step 1, and one campaign's on step 2. Every one of those is "show me where I am,
 * show me what is under here, let me go into it or make a new one" — so it is one component.
 *
 * DUMB BY CONSTRUCTION (`AGENTS.md` §3: shared components are UI primitives with no data
 * fetching). It receives the folders, the current position and the callbacks; it owns only the
 * new-folder text box, which is throwaway state nobody outside cares about. The hooks live in
 * `lib/assets/folders.ts` and each surface calls them itself.
 *
 * `rootId` is a FENCE, not a starting point. Navigation cannot leave it — the breadcrumb stops
 * there and the wizard therefore cannot file a campaign's reference material into another
 * campaign's folder, or into the client root, by clicking upwards. The Library passes the client
 * root and gets the whole tree; the wizard passes a narrower one and gets exactly its own.
 */
export interface FolderPickerProps {
  folders: readonly AssetFolder[]
  /** The subtree boundary. Navigation never goes above this. */
  rootId: string
  /** Where the user is now. Must be inside `rootId`, or the picker resets to it. */
  currentFolderId: string
  onNavigate: (folderId: string) => void
  /** Omit to render a read-only browser — that is what "no assets:manage" looks like. */
  onCreateFolder?: (name: string) => void
  creating?: boolean
  /** Shown against the new-folder box. A duplicate sibling name is the usual cause. */
  createError?: string | null
  /**
   * Extra controls on a folder card. A render prop rather than an `onDelete` callback, so this
   * component knows nothing about deleting, arming a confirmation, or who may do either — the
   * Library needs all three and the wizard needs none, and baking the Library's needs in here is
   * how a shared primitive stops being one.
   */
  folderActions?: (folder: AssetFolder) => React.ReactNode
  testId?: string
}

export function FolderPicker({
  folders,
  rootId,
  currentFolderId,
  onNavigate,
  onCreateFolder,
  creating = false,
  createError = null,
  folderActions,
  testId = 'folder-picker',
}: FolderPickerProps) {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const trail = useMemo(
    () => breadcrumbWithin(folders, rootId, currentFolderId),
    [folders, rootId, currentFolderId],
  )
  // Outside the fence (a stale id, or a root that moved) — behave as if at the root rather than
  // rendering an empty breadcrumb over somebody else's folders.
  const here = trail.length > 0 ? currentFolderId : rootId

  const children = useMemo(
    () =>
      folders
        .filter((f) => f.parentId === here)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [folders, here],
  )

  function submitNewFolder(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || !onCreateFolder) return
    onCreateFolder(trimmed)
    setName('')
  }

  return (
    <div className="folder-picker" data-testid={testId}>
      <nav className="library-breadcrumb" data-testid={`${testId}-breadcrumb`}>
        {(trail.length > 0 ? trail : folders.filter((f) => f.id === rootId)).map((f, i) => (
          <span key={f.id}>
            {i > 0 && <span className="crumb-sep"> / </span>}
            <Button
              variant="link"
              onClick={() => onNavigate(f.id)}
              data-testid={`${testId}-crumb-${f.id}`}
            >
              {f.name}
            </Button>
          </span>
        ))}
      </nav>

      <div className="library-folder-grid" data-testid={`${testId}-folders`}>
        {children.map((f) => (
          <div key={f.id} className="library-folder-card">
            <button
              type="button"
              className="folder-open"
              onClick={() => onNavigate(f.id)}
              data-testid={`${testId}-open-${f.id}`}
            >
              <span className="folder-ico" aria-hidden>
                📁
              </span>
              <span className="folder-name">{f.name}</span>
            </button>
            {folderActions && <div className="folder-actions">{folderActions(f)}</div>}
          </div>
        ))}
        {children.length === 0 && <p className="muted">{t('library.noSubfolders')}</p>}
      </div>

      {onCreateFolder &&
        (adding ? (
          <form className="org-add-form" onSubmit={submitNewFolder} data-testid={`${testId}-add-form`}>
            <input
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              placeholder={t('library.newFolder')}
              data-testid={`${testId}-add-name`}
            />
            <Button variant="primary" type="submit" disabled={creating || !name.trim()} data-testid={`${testId}-add-submit`}>
              {t('library.add')}
            </Button>
            <Button
              variant="secondary" size="sm"
              onClick={() => {
                setAdding(false)
                setName('')
              }}
            >
              {t('schedule.cancel')}
            </Button>
          </form>
        ) : (
          <Button variant="link" icon="plus"
            onClick={() => setAdding(true)}
            data-testid={`${testId}-add`}
          >{t('library.newFolder')}</Button>
        ))}

      {createError && (
        <p className="form-error" data-testid={`${testId}-add-error`}>
          {createError}
        </p>
      )}
    </div>
  )
}
