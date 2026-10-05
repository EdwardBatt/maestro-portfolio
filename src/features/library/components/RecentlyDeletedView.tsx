import { useTranslation } from 'react-i18next'
import { FileKindBadge } from '../../../components/FileKindBadge'
import { NoticeDialog } from '../../../components/Notice'
import { formatCalendarDay, formatIraqDate } from '../../../lib/time/iraq'
import { useLibraryClients, useRecentlyDeleted, useRestoreFile } from '../api/library-api'
import type { LibraryGo } from '../LibraryPage'
import { usePathWords } from '../lib/files'

/**
 * A client's Recently deleted (ADR-0134 d.9, Edward 1 Oct: one per client, reached from the client's
 * page). It lists only what the viewer may bring back — their own uploads, or everything of the client's
 * for its account manager and a Power Admin. After 30 days a file is removed from storage for good.
 */
export function RecentlyDeletedView({ clientId, go }: { clientId: string; go: LibraryGo }) {
  const { t } = useTranslation()
  const clients = useLibraryClients()
  const rows = useRecentlyDeleted(clientId)
  const restore = useRestoreFile()
  const pathWords = usePathWords()
  const name = clients.data?.find((c) => c.id === clientId)?.name ?? ''
  return (
    <>
      <nav className="lb-crumbs" aria-label={t('library.where')}>
        <button type="button" onClick={() => go({})}>{t('library.title')}</button>
        <span className="lb-crumb-sep">/</span>
        <button type="button" onClick={() => go({ client: clientId })}>{name}</button>
        <span className="lb-crumb-sep">/</span>
        <span className="lb-crumb-here">{t('library.deleted.title')}</span>
      </nav>
      <header className="lb-head">
        <div>
          <h1>{t('library.deleted.title')}</h1>
          <p className="lb-head-sub">{t('library.deleted.lead')}</p>
        </div>
      </header>
      {restore.isError && <NoticeDialog kind="error" message={t('library.saveFailed')} onClose={() => restore.reset()} />}
      {rows.isLoading ? (
        <p className="lb-loading">{t('library.loading')}</p>
      ) : (rows.data ?? []).length === 0 ? (
        <div className="lb-empty-folder" data-testid="library-deleted-empty">{t('library.deleted.none')}</div>
      ) : (
        <table className="lb-table" data-testid="library-deleted">
          <thead>
            <tr>
              <th aria-hidden="true" />
              <th style={{ inlineSize: '40%' }}>{t('library.colNameWhere')}</th>
              <th>{t('library.deleted.by')}</th>
              <th>{t('library.deleted.when')}</th>
              <th>{t('library.deleted.goesOn')}</th>
              <th aria-label={t('library.colActions')} />
            </tr>
          </thead>
          <tbody>
            {(rows.data ?? []).map((r) => (
              <tr key={r.id} data-testid={`deleted-${r.id}`}>
                <td><FileKindBadge name={r.name} contentType={r.contentType} isLink={Boolean(r.linkUrl)} /></td>
                <td>
                  <div className="lb-file-name-cell">
                    <span className="lb-file-name">{r.name}</span>
                    <span className="lb-file-path">{pathWords(r.folderPath)}</span>
                  </div>
                </td>
                <td>{r.deletedByName ?? '—'}</td>
                <td>{formatIraqDate(r.deletedAt)}</td>
                <td>{formatCalendarDay(r.purgeOn)}</td>
                <td>
                  <button
                    type="button"
                    className="lb-quiet-btn"
                    disabled={restore.isPending}
                    onClick={() => restore.mutate({ p_asset: r.id })}
                    data-testid={`deleted-restore-${r.id}`}
                  >
                    {t('library.deleted.bringBack')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
