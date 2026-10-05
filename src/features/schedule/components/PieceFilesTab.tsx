import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { startUploads } from '../../../lib/assets/uploads'
import { fetchAssetDownloadUrl } from '../../../lib/assets/download-url'
import { formatSize, linkService } from '../../../lib/assets/kind'
import { FileKindBadge } from '../../../components/FileKindBadge'
import { iraqDay } from '../../../lib/time/iraq'
import { useAddPieceLink, usePieceFiles } from '../api/book-api'
import { dayLong } from '../lib/day-words.ts'

/**
 * The Files tab of the booking window (SC-08 / SC-09): the piece's own Library folder (ADR-0134
 * d.22) — what the team has added — with "Upload a file" and "Add a link" filing straight into it.
 * Uploads go through the app's one upload box, so progress and a failed file are reported where every
 * other upload is. A piece with no folder (outside a campaign) says so and offers nothing.
 */
export function PieceFilesTab({ deliverableId, pieceName }: { deliverableId: string; pieceName: string }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const files = usePieceFiles(deliverableId)
  const addLink = useAddPieceLink(deliverableId)
  const input = useRef<HTMLInputElement>(null)
  const [linking, setLinking] = useState(false)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (files.isLoading) return <p className="muted" data-testid="book-files-loading">…</p>
  const folder = files.data
  if (!folder) return <p className="muted" data-testid="book-files-none">{t('schedule.sc.files.noFolder')}</p>

  const service = url.trim() ? linkService(url.trim()) : null
  const validUrl = /^https?:\/\/\S+\.\S+/.test(url.trim())

  const open = async (id: string, linkUrl: string | null) => {
    try {
      const href = linkUrl ?? (await fetchAssetDownloadUrl(id))
      window.open(href, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="sc-files" data-testid="book-files">
      <p className="sc-files-head">
        {t('schedule.sc.files.added')} <span className="muted">{t('schedule.sc.files.addedSub', { piece: pieceName })}</span>
      </p>
      {folder.files.length === 0 && <p className="sc-pop-empty" data-testid="book-files-empty">{t('schedule.sc.files.empty')}</p>}
      <ul className="sc-file-list">
        {folder.files.map((f) => {
          const sub = f.linkUrl
            ? [linkService(f.linkUrl), t('library.kind.link')].filter(Boolean).join(' · ')
            : [formatSize(f.sizeBytes), f.createdAt ? dayLong(iraqDay(f.createdAt), lang) : null].filter(Boolean).join(' · ')
          return (
            <li key={f.id} className={`sc-file${f.linkUrl ? ' is-link' : ''}`} data-testid={`book-file-${f.id}`}>
              <FileKindBadge name={f.name} contentType={f.contentType} isLink={f.linkUrl != null} />
              <span className="sc-file-text">
                <span className="sc-file-name">{f.name}</span>
                <span className="sc-file-sub">{sub}</span>
              </span>
              {f.uploadedByName && <span className="sc-file-by">{f.uploadedByName}</span>}
              <Button variant="link" size="sm" onClick={() => void open(f.id, f.linkUrl)} data-testid={`book-file-open-${f.id}`}>
                {f.linkUrl ? t('schedule.sc.files.open') : t('schedule.sc.files.download')}
              </Button>
            </li>
          )
        })}
      </ul>

      {linking && (
        <form
          className="sc-link-form"
          data-testid="book-files-link-form"
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setError(null)
            if (!validUrl || !name.trim()) return
            addLink.mutate(
              { folderId: folder.folderId, name: name.trim(), url: url.trim() },
              { onSuccess: () => { setLinking(false); setUrl(''); setName('') }, onError: (err) => setError((err as Error).message) },
            )
          }}
        >
          <p className="sc-pop-title">{t('schedule.sc.files.addLinkTitle')}</p>
          <div className="sc-link-fields">
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" aria-label={t('schedule.sc.files.url')} data-testid="book-files-link-url" />
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('schedule.sc.files.namePlaceholder')} aria-label={t('schedule.sc.files.name')} maxLength={200} data-testid="book-files-link-name" />
          </div>
          {validUrl && (
            <p className="sc-link-ok" data-testid="book-files-link-hint">✓ {t('schedule.sc.files.linkHint', { service: service ?? '', piece: pieceName })}</p>
          )}
          <div className="sc-link-actions">
            <Button variant="primary" size="sm" type="submit" busy={addLink.isPending} disabled={!validUrl || !name.trim()} data-testid="book-files-link-add">
              {t('schedule.sc.files.addLink')}
            </Button>
            <Button variant="link" size="sm" onClick={() => { setLinking(false); setError(null) }} data-testid="book-files-link-cancel">
              {t('schedule.cancel')}
            </Button>
          </div>
        </form>
      )}
      {error && <p className="form-error" role="alert" data-testid="book-files-error">{error}</p>}

      <div className="sc-files-actions">
        <Button variant="secondary" size="sm" icon="arrow-up" onClick={() => input.current?.click()} data-testid="book-files-upload">
          {t('schedule.sc.files.upload')}
        </Button>
        <Button variant="secondary" size="sm" icon="external" className={linking ? 'is-active' : ''} onClick={() => setLinking(true)} data-testid="book-files-add-link">
          {t('schedule.sc.files.addLink')}
        </Button>
        <span className="sc-foot-note">{t('schedule.sc.files.where', { piece: pieceName })}</span>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          data-testid="book-files-input"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (picked.length) startUploads({ folderId: folder.folderId, folderPath: folder.path, clientId: folder.clientId, files: picked, isSource: true })
          }}
        />
      </div>
    </div>
  )
}
