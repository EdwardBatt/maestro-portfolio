import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { FolderGlyph } from '../../../components/FolderGlyph'
import { useClientOverview, useLibraryClients, type ProjectCard } from '../api/library-api'
import { byStandardOrder, folderName } from '../lib/folder-words'
import { countText } from '../lib/count'
import type { LibraryGo } from '../LibraryPage'

/**
 * LB-01 · Library — by client (Figma `1636:500`). The client list on the start side, the chosen client's
 * brand folders and project folders on the end side. No Upload and no New folder at this level: a file
 * always lands inside a brand or a project (ADR-0134 d.15; LB-NOTES item 05).
 */
export function ClientsView({ clientId, go }: { clientId: string | null; go: LibraryGo }) {
  const { t } = useTranslation()
  const clients = useLibraryClients()
  const list = useMemo(() => clients.data ?? [], [clients.data])
  const chosen = clientId ?? list[0]?.id ?? null
  const overview = useClientOverview(chosen)
  const client = list.find((c) => c.id === chosen)

  // Land on the first client rather than an empty pane (the UI never blocks).
  useEffect(() => {
    if (!clientId && list[0]) go({ client: list[0].id })
  }, [clientId, list, go])

  const o = overview.data
  const fileTotal = client?.fileCount ?? 0
  const folderTotal = (o?.brandRootId ? 1 : 0) + (o?.projectsRootId ? 1 : 0)

  return (
    <>
      <header className="lb-head">
        <div>
          <h1>{t('library.title')}</h1>
          <p className="lb-head-sub">{t('library.lead')}</p>
        </div>
        <button type="button" className="lb-search-box" onClick={() => go({ mode: 'search' })} data-testid="library-search-open">
          {t('library.searchPlaceholder')}
        </button>
      </header>

      <div className="lb-clients-layout">
        <nav className="lb-client-list" aria-label={t('library.clients')} data-testid="library-clients">
          <span className="lb-eyebrow">{t('library.clients')}</span>
          {clients.isLoading && <span className="lb-client-foot">{t('library.loading')}</span>}
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              className={c.id === chosen ? 'lb-client is-on' : 'lb-client'}
              aria-current={c.id === chosen ? 'true' : undefined}
              onClick={() => go({ client: c.id })}
              data-testid={`library-client-${c.id}`}
            >
              <span className="lb-client-name">{c.name}</span>
              <span className="lb-client-count">
                {c.id === chosen ? countText(t, 'library.fileCount', c.fileCount) : c.fileCount}
              </span>
            </button>
          ))}
          <span className="lb-client-foot">{t('library.everyClient')}</span>
        </nav>

        <div className="lb-client-main">
          {client && (
            <div className="lb-client-title">
              <h2>{client.name}</h2>
              <span className="lb-pill">{t('library.folderFileCount', { folders: folderTotal, files: fileTotal })}</span>
              <span className="lb-spacer" />
              <button type="button" className="lb-deleted-link" onClick={() => go({ client: client.id, view: 'deleted' })} data-testid="library-deleted-open">
                {t('library.deleted.open')}
              </button>
            </div>
          )}

          {!o ? (
            <p className="lb-loading" data-testid="library-loading">{t('library.loading')}</p>
          ) : (
            <>
              <section className="lb-section" data-testid="library-brands">
                <div className="lb-section-head">
                  <FolderGlyph />
                  <h3>{t('library.std.brandAssets')}</h3>
                  <span className="lb-pill lb-pill-violet">{countText(t, 'library.brandCount', o.brands.length)}</span>
                  <span className="lb-spacer" />
                  <span className="lb-section-hint">{t('library.brandsHint')}</span>
                </div>
                {o.brands.length === 0 ? (
                  <p className="lb-section-hint">{t('library.noBrands')}</p>
                ) : (
                  <div className="lb-brand-grid">
                    {o.brands.map((b) => (
                      <button key={b.folderId} type="button" className="lb-brand-card" onClick={() => go({ client: chosen, folder: b.folderId })} data-testid={`library-brand-${b.folderId}`}>
                        <FolderGlyph />
                        <span className="lb-brand-name">{b.name}</span>
                        <span className="lb-brand-meta">
                          {countText(t, 'library.fileCount', b.fileCount)}
                          {b.subfolders.length > 0 && ` · ${byStandardOrder(b.subfolders, (x) => x).map((s) => folderName(t, s, true)).join(', ')}`}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="lb-section lb-section-projects" data-testid="library-projects">
                <div className="lb-section-head">
                  <FolderGlyph tone="green" />
                  <h3>{t('library.std.projects')}</h3>
                  <span className="lb-pill lb-pill-green">{t('library.everyJob')}</span>
                  <span className="lb-spacer" />
                  <span className="lb-section-hint">{t('library.projectsHint')}</span>
                </div>
                {o.projects.length === 0 && <p className="lb-section-hint">{t('library.noProjects')}</p>}
                {o.projects.map((p) => (
                  <ProjectRow key={p.folderId} p={p} onOpen={() => go({ client: chosen, folder: p.folderId })} />
                ))}
              </section>

              <p className="lb-note">{t('library.noUploadHere')}</p>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function ProjectRow({ p, onOpen }: { p: ProjectCard; onOpen: () => void }) {
  const { t } = useTranslation()
  const kind = p.kind === 'single_job' ? t('library.singleJob') : t('library.campaign')
  const meta = [kind, p.brandName, p.phaseCount > 0 ? countText(t, 'library.phaseCount', p.phaseCount) : null].filter(Boolean).join(' · ')
  const count = p.deliveredCount > 0
    ? t('library.filesDelivered', { n: p.fileCount, d: p.deliveredCount })
    : p.inReview
      ? t('library.filesInReview', { n: p.fileCount })
      : countText(t, 'library.fileCount', p.fileCount)
  return (
    <div className={p.lookalike ? 'lb-project is-lookalike' : 'lb-project'} data-testid={`library-project-${p.folderId}`}>
      <FolderGlyph tone="green" />
      <div className="lb-project-main">
        <span className="lb-project-name">{p.name}</span>
        <span className="lb-project-meta">
          {p.lookalike ? `${meta} · ${t('library.lookalike', { name: p.lookalike.name })}` : meta}
        </span>
      </div>
      <span className="lb-project-count">{count}</span>
      {p.lookalike && (
        <Link className="lb-quiet-btn" to={`/campaigns/${p.lookalike.campaignId}`} data-testid={`library-lookalike-${p.folderId}`}>
          {t('library.openOtherJob')}
        </Link>
      )}
      <button type="button" className="lb-link" onClick={onOpen} data-testid={`library-project-open-${p.folderId}`}>
        {t('library.open')}
      </button>
    </div>
  )
}
