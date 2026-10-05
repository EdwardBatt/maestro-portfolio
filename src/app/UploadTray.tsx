import { useContext, useEffect, useState } from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '../components/Button'
import { folderKeys } from '../lib/assets/folders'
import { isActive, onUploadFinished, openUploadBox, useUploads, type UploadItem } from '../lib/assets/uploads'
import { libraryKeys } from '../features/library/api/library-api'
import { UploadDialog } from '../features/library/components/UploadDialog'

/**
 * Uploads carry on anywhere in Maestro (ADR-0134 d.14). Mounted once by the shell: the LB-05 box when
 * it is open, and otherwise a small card in the bottom inline-end corner listing what is still going —
 * folding to one line, gone when nothing is running, waiting for an answer, or stopped. Opening it
 * brings the box back. When a file lands, the Library's reads are refreshed wherever the person is.
 */
export function UploadTray() {
  const { t } = useTranslation()
  // Read softly: a shell rendered without a query client (a test) still shows the tray.
  const qc = useContext(QueryClientContext)
  const { items, boxOpen } = useUploads()
  const [folded, setFolded] = useState(false)

  useEffect(
    () =>
      onUploadFinished(() => {
        if (!qc) return
        void qc.invalidateQueries({ queryKey: libraryKeys.all })
        void qc.invalidateQueries({ queryKey: folderKeys.all })
      }),
    [qc],
  )

  const shown = items.filter((i) => isActive(i) || i.status === 'clash' || i.status === 'failed')
  const running = shown.filter(isActive)
  const total = running.reduce((s, i) => s + i.size, 0)
  const sent = running.reduce((s, i) => s + Math.min(i.sent, i.size), 0)
  const overall = total > 0 ? Math.floor((sent / total) * 100) : 0
  const asking = shown.filter((i) => i.status === 'clash').length
  const stopped = shown.filter((i) => i.status === 'failed').length

  return (
    <>
      <UploadDialog />
      {!boxOpen && shown.length > 0 && (
        <aside className="upload-tray" aria-label={t('library.upload.trayLabel')} data-testid="upload-tray">
          <div className="upload-tray-head">
            <span className="upload-tray-title" data-testid="upload-tray-title">
              {running.length > 0
                ? t('library.upload.trayRunning', { n: running.length, pct: overall })
                : asking > 0
                  ? t('library.upload.trayAsking', { n: asking })
                  : t('library.upload.trayStopped', { n: stopped })}
            </span>
            <Button variant="link" size="sm" data-testid="upload-tray-open" onClick={openUploadBox}>
              {t('library.upload.trayOpen')}
            </Button>
            <IconButton
              size="sm"
              icon={folded ? 'chevron-up' : 'chevron-down'}
              label={folded ? t('library.upload.trayUnfold') : t('library.upload.trayFold')}
              data-testid="upload-tray-fold"
              aria-expanded={!folded}
              onClick={() => setFolded((f) => !f)}
            />
          </div>
          {!folded && (
            <ul className="upload-tray-list">
              {shown.map((i) => (
                <TrayRow key={i.id} item={i} />
              ))}
            </ul>
          )}
        </aside>
      )}
    </>
  )
}

function TrayRow({ item }: { item: UploadItem }) {
  const { t } = useTranslation()
  const pct = item.size > 0 ? Math.min(100, Math.floor((item.sent / item.size) * 100)) : 0
  const line = item.status === 'clash'
    ? t('library.upload.trayRowAsking')
    : item.status === 'failed'
      ? t('library.upload.trayRowStopped')
      : t('library.upload.trayRowPct', { pct })
  return (
    <li className="upload-tray-row" data-testid={`upload-tray-row-${item.id}`} data-status={item.status}>
      <span className="upload-tray-name" dir="auto">{item.saveAs}</span>
      <span className="upload-tray-line">{line}</span>
      {isActive(item) && (
        <span className="upload-card-bar" aria-hidden="true">
          <span className="upload-card-bar-fill" style={{ inlineSize: `${pct}%` }} />
        </span>
      )}
    </li>
  )
}
