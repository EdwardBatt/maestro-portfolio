import i18n from 'i18next'
import { useTranslation } from 'react-i18next'
import { fileKind, formatDuration, linkService } from '../../../lib/assets/kind'
import { folderName } from './folder-words'
import { fetchVersionDownloadUrl, type FolderScreen, type LibraryFile } from '../api/library-api'

/** "SVG image", "Word document", "Video · 0:06", "Link · Google Drive" (ADR-0134 d.4). */
export function useKindWords() {
  const { t } = useTranslation()
  return (f: Pick<LibraryFile, 'name' | 'contentType' | 'linkUrl' | 'durationSeconds'>) => {
    if (f.linkUrl) {
      const svc = linkService(f.linkUrl)
      return svc ? `${t('library.kind.link')} · ${svc}` : t('library.kind.link')
    }
    const k = fileKind(f.name, f.contentType)
    const ext = k.badge
    const words = k.wordsKey === 'generic' ? t('library.kind.generic', { ext }) : t(`library.kind.${k.wordsKey}`, { ext })
    return f.durationSeconds != null && (k.previewable === 'video' || k.previewable === 'audio')
      ? `${words} · ${formatDuration(f.durationSeconds)}`
      : words
  }
}

export async function downloadFile(f: LibraryFile, version?: number) {
  if (f.linkUrl) { window.open(f.linkUrl, '_blank', 'noopener'); return }
  const url = await fetchVersionDownloadUrl(f.id, version)
  window.open(url, '_blank', 'noopener')
}

export function linkExpired(f: LibraryFile, today = new Date()): boolean {
  return Boolean(f.linkExpiresOn) && f.linkExpiresOn! < today.toISOString().slice(0, 10)
}

/** A stored path ("Kite / Brand Assets / Luma / Key Visuals") with its standard folders in the page's words. */
export function usePathWords() {
  const { t } = useTranslation()
  return (path: string) => path.split(' / ').map((seg, i) => (i === 0 ? seg : folderName(t, seg, true))).join(' / ')
}

/** `Kite / Brand assets / Luma / Logos` — where a file lives, in words (the upload box, the panels). */
export function pathOf(s: FolderScreen): string {
  // The standard folders in the page's words ("Brand assets", not the stored "Brand Assets").
  return s.chain.map((c, i) => (i === 0 ? c.name : folderName(i18n.t, c.name, c.kind !== 'custom'))).join(' / ')
}

