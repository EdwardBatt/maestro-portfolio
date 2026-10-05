import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { startUploads } from '../../../lib/assets/uploads'
import { useBringBack, type FolderScreen, type LibraryFile } from '../api/library-api'
import { pathOf } from './files'

export type Open =
  | { kind: 'preview' | 'versions' | 'rename' | 'move' | 'copy' | 'delete' | 'link-version'; file: LibraryFile }
  | { kind: 'add-link' }

export interface FileActions {
  current: Open | null
  open: (o: Open) => void
  close: () => void
  notice: { kind: 'ok' | 'error'; text: string } | null
  fail: (text: string) => void
  done: (text: string) => void
  clearNotice: () => void
  copyLink: (s: FolderScreen, f: LibraryFile) => void
  uploadVersion: (s: FolderScreen, f: LibraryFile) => void
  bringBack: (f: LibraryFile) => void
}

/** The open dialog and the one-line notice, for one folder screen. */
export function useFileActions(): FileActions {
  const { t } = useTranslation()
  const [current, setCurrent] = useState<Open | null>(null)
  const [notice, setNotice] = useState<FileActions['notice']>(null)
  const bring = useBringBack()
  return {
    current,
    open: setCurrent,
    close: () => setCurrent(null),
    notice,
    fail: (text) => setNotice({ kind: 'error', text }),
    done: (text) => setNotice({ kind: 'ok', text }),
    clearNotice: () => setNotice(null),
    // A Maestro address that opens the folder with the file picked out — never a public link (d.11).
    copyLink: (s, f) => {
      const url = `${window.location.origin}/library?client=${s.folder.clientId}&folder=${s.folder.id}&file=${f.id}`
      void navigator.clipboard?.writeText(url).then(
        () => setNotice({ kind: 'ok', text: t('library.linkCopied') }),
        () => setNotice({ kind: 'error', text: t('library.linkCopyFailed', { url }) }),
      )
    },
    uploadVersion: (s, f) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.onchange = () => {
        const file = input.files?.[0]
        if (file) startUploads({ folderId: s.folder.id, folderPath: pathOf(s), clientId: s.folder.clientId, files: [file], versionOf: { assetId: f.id, name: f.name, currentVersion: f.currentVersion } })
      }
      input.click()
    },
    bringBack: (f) => bring.mutate({ p_asset: f.id }, {
      onSuccess: () => setNotice({ kind: 'ok', text: t('library.archive.bringingBack', { name: f.name }) }),
      onError: () => setNotice({ kind: 'error', text: t('library.saveFailed') }),
    }),
  }
}

