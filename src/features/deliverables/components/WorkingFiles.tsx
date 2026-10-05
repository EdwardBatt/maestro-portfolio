import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { InfoTip } from '../../../components/InfoTip'
import { startUploads } from '../../../lib/assets/uploads'
import { usePieceLibraryFolder } from '../api/working-files-api'

/**
 * "Add working files" (ADR-0134 d.24) — optional, beside sending the work for review. The picked files
 * go through the one upload box into the piece's own Library folder, marked SOURCE. It never gates
 * Send: when the piece has no folder yet, one line says so and nothing else changes.
 */
export function WorkingFiles({ deliverableId, subTaskId }: { deliverableId: string; subTaskId: string }) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const folder = usePieceLibraryFolder(deliverableId)
  const testId = `task-page-working-files-${subTaskId}`

  if (folder.isLoading) return null
  if (!folder.data) {
    return (
      <p className="muted working-files-none" data-testid={`${testId}-none`}>
        {t('library.upload.workingNone')}
      </p>
    )
  }
  const target = folder.data

  return (
    <div className="working-files" data-testid={testId}>
      <Button variant="secondary" size="sm" data-testid={`${testId}-add`} onClick={() => input.current?.click()}>
        {t('library.upload.workingAdd')}
      </Button>
      <InfoTip
        label={t('library.upload.workingTipLabel')}
        lines={[t('library.upload.workingTip')]}
        testId={`${testId}-tip`}
      />
      <input
        ref={input}
        type="file"
        multiple
        hidden
        data-testid={`${testId}-input`}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length === 0) return
          startUploads({ folderId: target.folderId, folderPath: target.path, clientId: target.clientId, files, isSource: true })
        }}
      />
    </div>
  )
}
