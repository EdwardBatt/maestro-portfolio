import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileKindBadge } from '../../../components/FileKindBadge'
import { SegmentedControl } from '../../../components/SegmentedControl'
import { formatSize } from '../../../lib/assets/kind'
import { formatIraqDate } from '../../../lib/time/iraq'
import { fetchVersionDownloadUrl, useLibraryClients, useLibrarySearch, useLibrarySearchCounts, type KindBucket, type SearchHit } from '../api/library-api'
import type { LibraryGo } from '../LibraryPage'
import { useKindWords, usePathWords } from '../lib/files'
import { countText } from '../lib/count'

const BUCKETS: (KindBucket | 'all')[] = ['all', 'image', 'document', 'video', 'link', 'proof']

/**
 * LB-08 · Search every client (Figma `1841:327`). Every client, because the Library is everyone's
 * reference (Edward, 1 Oct). Each result shows where it lives; clicking a row opens that folder with the
 * file picked out (ADR-0134 d.27). ⌘K / Ctrl+K puts the cursor back in the box.
 */
export function SearchView({ initialQuery, go }: { initialQuery: string; go: LibraryGo }) {
  const { t } = useTranslation()
  const kindWords = useKindWords()
  const pathWords = usePathWords()
  const [q, setQ] = useState(initialQuery)
  const [kind, setKind] = useState<KindBucket | 'all'>('all')
  const [client, setClient] = useState<string>('')
  const input = useRef<HTMLInputElement>(null)
  const clients = useLibraryClients()
  const hits = useLibrarySearch(q, kind, client || null)
  const counts = useLibrarySearchCounts(q, client || null)
  const ready = q.trim().length >= 2

  useEffect(() => {
    input.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const total = counts.data ? Object.values(counts.data).reduce((a, b) => a + b, 0) : 0
  const rows = hits.data ?? []
  const clientCount = new Set(rows.map((r) => r.clientId)).size
  const open = (h: SearchHit) => go({ client: h.clientId, folder: h.folderId, file: h.id })

  return (
    <>
      <header className="lb-head" style={{ marginBlockEnd: 14 }}>
        <h1>{t('library.title')}</h1>
        <SegmentedControl
          label={t('library.title')}
          value="search"
          onChange={(v) => { if (v === 'browse') go({}) }}
          options={[
            { value: 'browse', label: t('library.byClient'), testId: 'library-mode-browse' },
            { value: 'search', label: t('library.searchEverything'), testId: 'library-mode-search' },
          ]}
        />
      </header>
      <label className="lb-search-input">
        <span aria-hidden="true">⌕</span>
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('library.searchPlaceholder')} aria-label={t('library.search')} data-testid="library-search-input" />
        <kbd>⌘K</kbd>
      </label>
      <div className="lb-chips">
        {BUCKETS.map((b) => (
          <button key={b} type="button" className={b === kind ? 'lb-chip is-on' : 'lb-chip'} aria-pressed={b === kind} onClick={() => setKind(b)} data-testid={`library-search-kind-${b}`}>
            {t(`library.bucket.${b}`)}{ready && counts.data ? ` · ${b === 'all' ? total : counts.data[b]}` : ''}
          </button>
        ))}
        <select className="lb-chip-select" value={client} onChange={(e) => setClient(e.target.value)} aria-label={t('library.colClient')} data-testid="library-search-client">
          <option value="">{t('library.clientAny')}</option>
          {(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {!ready ? (
        <p className="lb-search-count" data-testid="library-search-hint">{t('library.searchPrompt')}</p>
      ) : (
        <>
          <p className="lb-search-count">{t('library.searchCount', { files: countText(t, 'library.fileCount', rows.length), clients: countText(t, 'library.clientCount', clientCount) })}</p>
          {rows.length === 0 && !hits.isFetching ? (
            <div className="lb-empty-folder">{t('library.noResults')}</div>
          ) : (
            <table className="lb-table" data-testid="library-search-results">
              <thead>
                <tr>
                  <th aria-hidden="true" />
                  <th style={{ inlineSize: '42%' }}>{t('library.colNameWhere')}</th>
                  <th>{t('library.colKind')}</th>
                  <th>{t('library.colClient')}</th>
                  <th>{t('library.colSize')}</th>
                  <th>{t('library.colWhen')}</th>
                  <th aria-label={t('library.colActions')} />
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => (
                  <tr key={h.id} className="is-clickable" onClick={() => open(h)} data-testid={`search-hit-${h.id}`}>
                    <td><FileKindBadge name={h.name} contentType={h.contentType} isLink={Boolean(h.linkUrl)} /></td>
                    <td>
                      <div className="lb-file-name-cell">
                        <span className="lb-file-name">{h.name}</span>
                        <span className="lb-file-path">{pathWords(h.path)}</span>
                      </div>
                    </td>
                    <td>{kindWords({ name: h.name, contentType: h.contentType, linkUrl: h.linkUrl, durationSeconds: null })}</td>
                    <td>{h.clientName}</td>
                    <td><bdi>{h.linkUrl ? '—' : formatSize(h.sizeBytes)}</bdi></td>
                    <td>{formatIraqDate(h.updatedAt)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <SearchRowTool h={h} onOpen={() => open(h)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="lb-note">{t('library.searchNote')}</p>
        </>
      )}
    </>
  )
}

/** ↓ at rest; on the row under the pointer, "Open folder" (LB-08's third row). */
function SearchRowTool({ h, onOpen }: { h: SearchHit; onOpen: () => void }) {
  const { t } = useTranslation()
  return (
    <span className="lb-row-tools lb-search-tools">
      <button
        type="button"
        className="lb-dl"
        aria-label={t('library.menu.download')}
        onClick={() => (h.linkUrl ? window.open(h.linkUrl, '_blank', 'noopener') : void fetchVersionDownloadUrl(h.id).then((u) => window.open(u, '_blank', 'noopener')))}
        data-testid={`search-download-${h.id}`}
      >
        ↓
      </button>
      <button type="button" className="lb-quiet-btn lb-open-folder" onClick={onOpen}>{t('library.openFolder')}</button>
    </span>
  )
}
