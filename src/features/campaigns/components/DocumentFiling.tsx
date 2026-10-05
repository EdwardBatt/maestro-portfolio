import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InfoTip } from '../../../components/InfoTip'
import { BusyDialog } from '../../../components/Notice'
import { FolderPicker } from '../../../components/FolderPicker'
import { useFileDocuments, type FileOutcome } from '../api/document-filing-api'
import { isDuplicateFolderName, useCreateFolder, useFolderView } from '../../../lib/assets/folders'
import { Button } from '../../../components/Button'

/**
 * File documents into a folder, during the wizard (I35.2 / I35.4).
 *
 * Used twice and identical both times: brand documents on step 1, campaign reference materials on
 * step 2. The only difference is which subtree it is pointed at, which is `rootId` — and that is a
 * fence, so neither can file into the other's folders (see `FolderPicker`).
 *
 * NOTHING IS STAGED. Both subtrees exist by the time this renders: a brand's folders are
 * provisioned when the brand is created, and a campaign's when the draft is (ADR-0067 d.1). That
 * is the whole reason ADR-0067 exists, and it is what lets this be an ordinary upload rather than
 * the promise-then-apologise path ADR-0044 §8 had to write for one file.
 *
 * Presentation only (`AGENTS.md` §4). The uploading itself is `useFileDocuments`, which reports
 * per file rather than per batch — this component's job is to say which ones did not make it.
 */
const NO_FOLDERS: never[] = []

export interface DocumentFilingProps {
  /** Owns the tree these folders belong to; needed to create a folder in it. */
  clientId: string
  /** The subtree boundary — a brand's folder, or a campaign's. */
  rootId: string
  /** Heading and one line of explanation, already translated by the caller. */
  title: string
  /**
   * Standing advice about these files — an (i) beside the title, never a box on the page (Edward,
   * 24 Sep). With no title there is nothing to sit beside, so the caller puts the (i) on its own
   * heading and leaves this out.
   */
  hint?: string | readonly string[]
  /** False when the caller knows the upload will be refused, e.g. no `assets:manage`. */
  canManage: boolean
  testId: string
}

export function DocumentFiling({
  clientId,
  rootId,
  title,
  hint,
  canManage,
  testId,
}: DocumentFilingProps) {
  const { t } = useTranslation()
  const createFolder = useCreateFolder()
  const upload = useFileDocuments()
  const fileInput = useRef<HTMLInputElement>(null)

  const [folderId, setFolderId] = useState(rootId)
  const [folderError, setFolderError] = useState<string | null>(null)
  const [outcomes, setOutcomes] = useState<FileOutcome[]>([])
  // The level we are on, read here rather than handed down as the client's whole tree (I49.77).
  const view = useFolderView(clientId, folderId)

  // The root changes when the wizard switches brand, or when the draft campaign is first created.
  // Staying on the old folder would leave the picker fenced to a subtree that is no longer the
  // one on screen.
  useEffect(() => setFolderId(rootId), [rootId])

  const filed = useMemo(() => outcomes.filter((o) => o.ok), [outcomes])
  const failed = useMemo(() => outcomes.filter((o) => !o.ok), [outcomes])

  function onFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    setOutcomes([])
    upload.mutate({ folderId, clientId, files }, { onSuccess: setOutcomes })
  }

  function onCreateFolder(name: string) {
    setFolderError(null)
    createFolder.mutate(
      { clientId, parentId: folderId, name },
      {
        onError: (err) =>
          setFolderError(
            t(isDuplicateFolderName(err) ? 'library.folderExists' : 'library.saveFailed'),
          ),
      },
    )
  }

  return (
    <section className="document-filing" data-testid={testId}>
      {/* ADR-0092 d.1 / I48.8: an upload to B2 spans seconds and several requests. */}
      {upload.isPending && <BusyDialog text={t('library.uploading')} testId={`${testId}-busy`} />}
      {/* I53.1: inside a Panel the panel's own header names it; an empty title draws nothing. */}
      {title && (
        <h2 className="org-section-heading">
          {title}
          {hint && (
            <InfoTip
              label={title}
              lines={Array.isArray(hint) ? [...hint] : [hint as string]}
              testId={`${testId}-hint`}
            />
          )}
        </h2>
      )}

      <FolderPicker
        folders={view.data?.folders ?? NO_FOLDERS}
        rootId={rootId}
        currentFolderId={folderId}
        onNavigate={setFolderId}
        onCreateFolder={canManage ? onCreateFolder : undefined}
        creating={createFolder.isPending}
        createError={folderError}
        testId={`${testId}-picker`}
      />

      {canManage ? (
        <div className="library-files-bar">
          <Button
            variant="primary"
            disabled={upload.isPending}
            onClick={() => fileInput.current?.click()}
            data-testid={`${testId}-choose`}
          >
            {upload.isPending ? t('library.uploading') : `↑ ${t('campaigns.filing.addDocuments')}`}
          </Button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={onFilesChosen}
            data-testid={`${testId}-input`}
          />
        </div>
      ) : (
        <p className="muted" data-testid={`${testId}-readonly`}>
          {t('campaigns.filing.noPermission')}
        </p>
      )}

      {filed.length > 0 && (
        <p className="muted" data-testid={`${testId}-filed`}>
          {t('campaigns.filing.filed', { count: filed.length })}
        </p>
      )}
      {/* Named, not counted. "One document could not be filed" tells nobody which one to retry. */}
      {failed.length > 0 && (
        <p className="form-error" data-testid={`${testId}-failed`}>
          {t('campaigns.filing.failed', { names: failed.map((f) => f.name).join(', ') })}
        </p>
      )}
    </section>
  )
}
