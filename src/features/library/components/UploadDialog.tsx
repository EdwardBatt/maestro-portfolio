import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { FileKindBadge } from '../../../components/FileKindBadge'
import { FolderGlyph } from '../../../components/FolderGlyph'
import { Modal, ModalFooter, ModalHeader } from '../../../components/Modal'
import { formatSize } from '../../../lib/assets/kind'
import {
  cancelRemaining,
  changeFolder,
  movableUploads,
  closeUploadBox,
  isActive,
  removeUpload,
  resolveClash,
  retryUpload,
  useUploads,
  type UploadItem,
} from '../../../lib/assets/uploads'
import { FolderTree } from './FolderTree'
import { NO_LOOSE_UPLOAD_KINDS } from '../lib/folder-words'

/**
 * The upload box (Figma K · LB-05, node `1840:181`; ADR-0134 d.12–14).
 *
 * One card per file, in the state it is in: a name clash asks "Make it v{n}" or "Keep both"; an upload
 * shows its bar; a finished one says DONE; a refused one says why and offers Remove. Done closes the
 * box — uploads carry on in the corner (`app/UploadTray.tsx`), which also mounts this box, so no page
 * renders it. Presentation only: every act is a call into `lib/assets/uploads`.
 */
export function UploadDialog() {
  const { t } = useTranslation()
  const { items, boxOpen, target } = useUploads()
  const [picking, setPicking] = useState(false)
  const [dest, setDest] = useState<{ id: string; name: string; path: string } | null>(null)
  if (!boxOpen) return null
  const movable = movableUploads(items)
  const first = movable[0] ?? items[0]

  if (picking && first) {
    const clientName = first.folderPath.split(' / ')[0] ?? ''
    const close = () => { setPicking(false); setDest(null) }
    return (
      <Modal onClose={close} labelledById="upload-box-pick-title" testId="upload-box-pick">
        <ModalHeader id="upload-box-pick-title" title={t('library.upload.changeTitle', { n: movable.length })} subtitle={t('library.moveSub', { client: clientName })} />
        <div className="modal-body lb-dialog">
          <FolderTree
            clientId={first.clientId}
            clientName={clientName}
            value={dest?.id ?? null}
            onChange={(id, name, path) => setDest({ id, name, path })}
            hereId={first.folderId}
            hereBlocked
            blockedKinds={NO_LOOSE_UPLOAD_KINDS}
            testIdPrefix="upload-box"
          />
        </div>
        <ModalFooter>
          <Button
            variant="primary"
            disabled={!dest}
            data-testid="upload-box-change-confirm"
            onClick={() => {
              if (!dest) return
              changeFolder(dest.id, dest.path)
              close()
            }}
          >
            {dest ? t('library.upload.uploadInto', { folder: dest.name }) : t('library.upload.pickFolder')}
          </Button>
          <Button variant="link" onClick={close}>{t('common.cancel')}</Button>
        </ModalFooter>
      </Modal>
    )
  }

  const unfinished = items.some((i) => isActive(i) || i.status === 'clash' || i.status === 'failed')

  return (
    <Modal onClose={closeUploadBox} labelledById="upload-box-title" testId="upload-box">
      <div className="upload-box">
        <ModalHeader
          id="upload-box-title"
          title={t('library.upload.title', { n: items.length })}
          subtitle={
            target ? (
              <span className="upload-box-into" data-testid="upload-box-into">
                <span>{t('library.upload.into')}</span>
                <FolderGlyph size="sm" />
                <b dir="auto">{target.folderPath}</b>
                {movable.length > 0 && (
                  <button type="button" className="upload-box-change" data-testid="upload-box-change" onClick={() => setPicking(true)}>
                    {t('library.upload.change')}
                  </button>
                )}
              </span>
            ) : undefined
          }
        />
        <ul className="upload-box-list" data-testid="upload-box-list">
          {items.map((item) => (
            <UploadCard key={item.id} item={item} />
          ))}
        </ul>
        <ModalFooter note={t('library.upload.carryOn')}>
          <Button variant="primary" data-testid="upload-box-done" onClick={closeUploadBox}>
            {t('library.upload.done')}
          </Button>
          {unfinished && (
            <Button variant="link" className="upload-box-quiet" data-testid="upload-box-cancel-rest" onClick={cancelRemaining}>
              {t('library.upload.cancelRest')}
            </Button>
          )}
        </ModalFooter>
      </div>
    </Modal>
  )
}

/** First-strong isolate and its pop (U+2068, U+2069). */
const FSI = String.fromCharCode(0x2068)
const PDI = String.fromCharCode(0x2069)

function pct(item: UploadItem): number {
  return item.size > 0 ? Math.min(100, Math.floor((item.sent / item.size) * 100)) : 0
}

function UploadCard({ item }: { item: UploadItem }) {
  const { t } = useTranslation()
  // Isolated (FSI … PDI) so "51 KB" stays one unit inside an Arabic sentence instead of reading "KB … 51".
  const size = FSI + formatSize(item.size) + PDI
  const tone = item.status === 'clash' ? 'is-clash' : item.status === 'refused' || item.status === 'failed' ? 'is-refused' : ''
  const testId = `upload-row-${item.id}`

  let line: string
  switch (item.status) {
    case 'clash':
      line = t('library.upload.clashLine', { n: item.clash?.currentVersion ?? 1 })
      break
    case 'checking':
    case 'queued':
      line = t('library.upload.waiting', { size })
      break
    case 'uploading':
      line = item.resumed ? t('library.upload.resuming', { size, pct: pct(item) }) : t('library.upload.progress', { size, pct: pct(item) })
      break
    case 'saving':
      line = t('library.upload.saving', { size })
      break
    case 'done':
      line = item.asVersionOf
        ? t('library.upload.uploadedVersion', { size, n: item.asVersionOf.version })
        : t('library.upload.uploaded', { size })
      break
    case 'refused':
      line = t('library.upload.tooBig', { size })
      break
    case 'failed':
      line = item.error === 'notAllowed'
        ? t('library.upload.notAllowed')
        : item.error === 'stopped'
          ? t('library.upload.stopped', { pct: pct(item) })
          : t('library.upload.failed')
      break
  }

  const showBar = item.status === 'uploading' || item.status === 'saving'

  return (
    <li className={`upload-card ${tone}`} data-testid={testId} data-status={item.status}>
      <div className="upload-card-row">
        <FileKindBadge name={item.saveAs} contentType={item.file.type} />
        <div className="upload-card-text">
          <span className="upload-card-name" dir="auto">
            {item.saveAs}
            {item.asVersionOf && <span className="upload-card-version"> {t('library.upload.toVersion', { n: item.asVersionOf.version })}</span>}
          </span>
          <span className="upload-card-line" data-testid={`${testId}-line`}>{line}</span>
        </div>
        {item.status === 'done' && (
          <span className="upload-card-done" data-testid={`${testId}-done`}>
            <span aria-hidden="true">✓ </span>
            {t('library.upload.donePill')}
          </span>
        )}
        {(item.status === 'refused' || item.status === 'failed') && (
          <span className="upload-card-actions">
            {item.status === 'failed' && item.error !== 'notAllowed' && (
              <button type="button" className="upload-card-link" data-testid={`${testId}-retry`} onClick={() => retryUpload(item.id)}>
                {t('library.upload.retry')}
              </button>
            )}
            <button type="button" className="upload-card-link" data-testid={`${testId}-remove`} onClick={() => removeUpload(item.id)}>
              {t('library.upload.remove')}
            </button>
          </span>
        )}
      </div>
      {item.status === 'clash' && item.clash && (
        <div className="upload-card-choices">
          <Button variant="primary" size="sm" data-testid={`${testId}-make-version`} onClick={() => void resolveClash(item.id, 'version')}>
            {t('library.upload.makeVersion', { n: item.clash.currentVersion + 1 })}
          </Button>
          <Button variant="secondary" size="sm" className="upload-card-keep" data-testid={`${testId}-keep-both`} onClick={() => void resolveClash(item.id, 'keep')}>
            {t('library.upload.keepBoth')}
          </Button>
        </div>
      )}
      {showBar && (
        <div
          className="upload-card-bar"
          role="progressbar"
          aria-label={item.saveAs}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct(item)}
        >
          <span className="upload-card-bar-fill" style={{ inlineSize: `${pct(item)}%` }} />
        </div>
      )}
    </li>
  )
}
