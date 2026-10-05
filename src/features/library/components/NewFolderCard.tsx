import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { FolderGlyph } from '../../../components/FolderGlyph'
import { useAuth } from '../../../app/auth-context'
import { isDuplicateFolderName } from '../../../lib/assets/folders'
import { useCreateLibraryFolder } from '../api/library-api'

/** LB-03's last card: a folder being added, named in place (`1839:251`). */
export function NewFolderCard({ clientId, parentId, tone, onDone }: { clientId: string; parentId: string; tone: 'violet' | 'green'; onDone: () => void }) {
  const { t } = useTranslation()
  const { claims } = useAuth()
  const create = useCreateLibraryFolder()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const add = () => {
    if (!name.trim()) return
    setError(null)
    create.mutate({ tenantId: claims.tenantId, clientId, parentId, name }, {
      onSuccess: onDone,
      onError: (e) => setError(t(isDuplicateFolderName(e) ? 'library.folderExists' : 'library.saveFailed')),
    })
  }
  return (
    <div className="lb-new-folder" data-testid="library-new-folder-card">
      <FolderGlyph tone={tone} />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') add(); if (e.key === 'Escape') onDone() }}
        aria-label={t('library.newFolderName')}
        placeholder={t('library.newFolderName')}
        autoFocus
        data-testid="library-new-folder-name"
      />
      {error && <span className="lb-field-error" role="alert">{error}</span>}
      <div className="lb-new-folder-actions">
        <Button variant="primary" size="sm" onClick={add} disabled={!name.trim()} busy={create.isPending} data-testid="library-new-folder-add">{t('library.add')}</Button>
        <Button variant="link" size="sm" onClick={onDone}>{t('common.cancel')}</Button>
      </div>
    </div>
  )
}
