import { useEffect, useMemo, useRef, useState } from 'react'
import { countText } from '../lib/count'
import { useTranslation } from 'react-i18next'
import { FileKindBadge } from '../../../components/FileKindBadge'
import { Menu, type MenuItem } from '../../../components/Menu'
import { formatSize } from '../../../lib/assets/kind'
import { downloadFile, linkExpired, useKindWords } from '../lib/files'
import { formatIraqDate } from '../../../lib/time/iraq'
import { fetchThumbUrl, type FolderScreen, type LibraryFile } from '../api/library-api'
import type { FileActions } from '../lib/file-actions'

function useFileMenu(s: FolderScreen, actions: FileActions) {
  const { t } = useTranslation()
  return (f: LibraryFile): MenuItem[] => {
    const items: MenuItem[] = [
      { key: 'preview', label: t('library.menu.preview'), onSelect: () => actions.open({ kind: 'preview', file: f }), testId: `file-preview-${f.id}` },
      { key: 'download', label: f.linkUrl ? t('library.menu.openLink') : t('library.menu.download'), onSelect: () => void downloadFile(f).catch(() => actions.fail(t('library.downloadFailed'))), testId: `file-download-${f.id}` },
    ]
    if (s.canChange && !f.archivedAt) {
      items.push(f.linkUrl
        ? { key: 'new-version', label: t('library.menu.newLink'), onSelect: () => actions.open({ kind: 'link-version', file: f }), testId: `file-new-version-${f.id}` }
        : { key: 'new-version', label: t('library.menu.newVersion'), onSelect: () => actions.uploadVersion(s, f), testId: `file-new-version-${f.id}` })
    }
    items.push({ key: 'versions', label: t('library.menu.versions', { n: f.currentVersion }), onSelect: () => actions.open({ kind: 'versions', file: f }), testId: `file-versions-${f.id}` })
    if (s.canChange) {
      items.push(
        { key: 'rename', label: t('library.menu.rename'), onSelect: () => actions.open({ kind: 'rename', file: f }), testId: `file-rename-${f.id}` },
        { key: 'move', label: t('library.menu.move'), onSelect: () => actions.open({ kind: 'move', file: f }), testId: `file-move-${f.id}` },
        { key: 'copy', label: t('library.menu.copy'), onSelect: () => actions.open({ kind: 'copy', file: f }), testId: `file-copy-${f.id}` },
      )
    }
    if (f.archivedAt && s.canChange) {
      items.push({ key: 'bring-back', label: t('library.menu.bringBack'), onSelect: () => actions.bringBack(f), testId: `file-bring-back-${f.id}` })
    }
    items.push({ key: 'copy-link', label: t('library.menu.copyLink'), onSelect: () => actions.copyLink(s, f), testId: `file-copy-link-${f.id}` })
    if (f.canDelete) {
      items.push({ key: 'delete', label: t('library.menu.delete'), danger: true, separated: true, onSelect: () => actions.open({ kind: 'delete', file: f }), testId: `file-delete-${f.id}` })
    }
    return items
  }
}

/**
 * A folder's files as the LB-04 table (Kind in words · size · version · added by · when · ↓ ⋯) or as a
 * grid of pictures (ADR-0134 d.26). A file named in the address (`&file=`) is picked out and scrolled to.
 */
export function FileList({
  s, view, pickedFileId, actions, limit,
}: { s: FolderScreen; view: 'list' | 'grid'; pickedFileId: string | null; actions: FileActions; limit: number | null }) {
  const { t } = useTranslation()
  const kindWords = useKindWords()
  const menu = useFileMenu(s, actions)
  const [showAll, setShowAll] = useState(false)
  const picked = useRef<HTMLElement | null>(null)
  const files = s.files
  const shown = useMemo(() => {
    if (limit == null || showAll || files.length <= limit) return files
    // The picked file is always on screen, wherever it sorts.
    const head = files.slice(0, limit)
    const extra = pickedFileId && !head.some((f) => f.id === pickedFileId) ? files.filter((f) => f.id === pickedFileId) : []
    return [...head, ...extra]
  }, [files, limit, showAll, pickedFileId])

  useEffect(() => { picked.current?.scrollIntoView({ block: 'center' }) }, [pickedFileId, view])

  if (files.length === 0) {
    return <div className="lb-empty-folder" data-testid="library-no-files">{s.canChange ? t('library.emptyFolderCanUpload') : t('library.emptyFolder')}</div>
  }

  const more = files.length - shown.length

  if (view === 'grid') {
    return (
      <>
        <div className="lb-file-grid" data-testid="library-grid">
          {shown.map((f) => (
            <div
              key={f.id}
              className={f.id === pickedFileId ? 'lb-tile is-picked' : 'lb-tile'}
              ref={f.id === pickedFileId ? (el) => { picked.current = el } : undefined}
              data-testid={`asset-${f.id}`}
            >
              <button type="button" className="lb-tile-pic" style={{ border: 0, padding: 0, cursor: 'pointer' }} onClick={() => actions.open({ kind: 'preview', file: f })} aria-label={t('library.menu.preview')}>
                <TilePicture f={f} words={kindWords(f)} />
              </button>
              <div className="lb-tile-foot">
                <FileKindBadge name={f.name} contentType={f.contentType} isLink={Boolean(f.linkUrl)} />
                <span className="lb-file-name" title={f.name}>{f.name}</span>
                <Menu items={menu(f)} label={t('library.moreFor', { name: f.name })} testId={`asset-menu-${f.id}`} />
              </div>
            </div>
          ))}
        </div>
        {more > 0 && <button type="button" className="lb-more-files" onClick={() => setShowAll(true)}>+ {countText(t, 'library.moreFiles', more)}</button>}
      </>
    )
  }

  return (
    <>
      <table className="lb-table" data-testid="library-assets">
        <thead>
          <tr>
            <th aria-hidden="true" />
            <th style={{ inlineSize: '34%' }}>{t('library.colName')}</th>
            <th>{t('library.colKind')}</th>
            <th>{t('library.colSize')}</th>
            <th>{t('library.colVersion')}</th>
            <th>{t('library.colAddedBy')}</th>
            <th>{t('library.colWhen')}</th>
            <th aria-label={t('library.colActions')} />
          </tr>
        </thead>
        <tbody>
          {shown.map((f) => (
            <tr
              key={f.id}
              className={f.id === pickedFileId ? 'is-picked' : undefined}
              ref={f.id === pickedFileId ? (el) => { picked.current = el } : undefined}
              data-testid={`asset-${f.id}`}
            >
              <td><FileKindBadge name={f.name} contentType={f.contentType} isLink={Boolean(f.linkUrl)} /></td>
              <td>
                <div className="lb-file-name-cell">
                  <span className="lb-file-name">{f.name}</span>
                  {f.isProof && <span className="lb-pill lb-pill-amber" style={{ fontSize: 8.5 }}>{t('library.proofTag')}</span>}
                  {f.isSource && <span className="lb-pill lb-pill-violet" style={{ fontSize: 8.5 }}>{t('library.sourceTag')}</span>}
                  {f.linkUrl && linkExpired(f) && <span className="lb-pill lb-pill-red" style={{ fontSize: 8.5 }}>{t('library.link.expired')}</span>}
                  {f.linkUrl && !linkExpired(f) && f.linkExpiresOn && <span className="lb-file-path" style={{ color: 'var(--text-faint)' }}>{t('library.link.expiresOn', { date: formatIraqDate(f.linkExpiresOn) })}</span>}
                  {f.archivedAt && <span className="lb-pill" style={{ fontSize: 8.5 }}>{t('library.archivedTag')}</span>}
                </div>
              </td>
              <td>{kindWords(f)}</td>
              <td><bdi>{f.linkUrl ? '—' : formatSize(f.sizeBytes)}</bdi></td>
              <td><span className={f.id === pickedFileId ? 'lb-version is-newest' : 'lb-version'}>v{f.currentVersion}</span></td>
              <td>{f.uploadedByName ?? '—'}</td>
              <td>{formatIraqDate(f.updatedAt)}</td>
              <td>
                <div className="lb-row-tools">
                  <button type="button" className="lb-dl" aria-label={t('library.menu.download')} title={t('library.menu.download')} onClick={() => void downloadFile(f).catch(() => actions.fail(t('library.downloadFailed')))} data-testid={`asset-download-${f.id}`}>↓</button>
                  <Menu items={menu(f)} label={t('library.moreFor', { name: f.name })} testId={`asset-menu-${f.id}`} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {more > 0 && <button type="button" className="lb-more-files" onClick={() => setShowAll(true)} data-testid="library-more-files">+ {countText(t, 'library.moreFiles', more)}</button>}
    </>
  )
}

function TilePicture({ f, words }: { f: LibraryFile; words: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [broken, setBroken] = useState(false)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let live = true
    if (f.thumbObjectKey) void fetchThumbUrl(f.id).then((u) => { if (live) setSrc(u) })
    return () => { live = false }
  }, [f.id, f.thumbObjectKey])
  // The kind in words until the picture has loaded, and for good if it never does — a tile is never blank.
  return (
    <>
      {(!loaded || broken) && <span className="lb-tile-kind">{words}</span>}
      {src && !broken && <img src={src} alt="" loading="lazy" hidden={!loaded} onLoad={() => setLoaded(true)} onError={() => setBroken(true)} />}
    </>
  )
}
