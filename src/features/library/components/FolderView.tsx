import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button } from '../../../components/Button'
import { FolderGlyph } from '../../../components/FolderGlyph'
import { SegmentedControl } from '../../../components/SegmentedControl'
import { formatIraqDate } from '../../../lib/time/iraq'
import { startUploads } from '../../../lib/assets/uploads'
import { useLibraryFolder, type FolderScreen, type SubfolderCard } from '../api/library-api'
import { byStandardOrder, folderHint, folderName, isDeliverablesFolder, isReferencesFolder } from '../lib/folder-words'
import { countText } from '../lib/count'
import type { LibraryGo } from '../LibraryPage'
import { FileList } from './FileList'
import { pathOf } from '../lib/files'
import { FileActionDialogs } from './FileActions'
import { useFileActions } from '../lib/file-actions'
import { NewFolderCard } from './NewFolderCard'
import { PieceFoldersView } from './PieceFoldersView'
import { FolderMenu } from './FolderMenu'

/**
 * One folder. What it looks like depends on what it is:
 * - a brand (LB-03, `1839:2`): its folders as cards, no loose files at its top;
 * - a campaign or single job (LB-06, `1841:2`): its four folders as cards, the chosen one's files below;
 * - a campaign's Deliverables (LB-02, `1636:697`): one card per piece, every version it was reviewed in;
 * - any other folder (LB-04, `1839:266`): its subfolders, the drop strip, its files as a list or a grid.
 */
export function FolderView({ clientId, folderId, pickedFileId, go }: { clientId: string; folderId: string; pickedFileId: string | null; go: LibraryGo }) {
  const { t } = useTranslation()
  const screen = useLibraryFolder(folderId)

  if (screen.isLoading || !screen.data) {
    return screen.isError
      ? <p className="lb-loading" role="alert">{t('library.folderGone')} <button type="button" className="lb-link" onClick={() => go({ client: clientId })}>{t('library.backToClient')}</button></p>
      : <p className="lb-loading" data-testid="library-loading">{t('library.loading')}</p>
  }
  const s = { ...screen.data, subfolders: byStandardOrder(screen.data.subfolders, (f) => f.name) }
  if (isDeliverablesFolder({ name: s.folder.name, kind: s.folder.kind, campaignId: s.folder.campaignId })) {
    return <PieceFoldersView screen={s} go={go} />
  }
  if (s.folder.kind === 'brand') return <BrandView s={s} go={go} />
  if (s.folder.kind === 'campaign') return <ProjectView s={s} go={go} pickedFileId={pickedFileId} />
  return <FilesView s={s} go={go} pickedFileId={pickedFileId} />
}

/** The trail above the title: Library / Kite / Brand assets / Luma / Logos (LB-03, LB-04). */
export function Crumbs({ s, go }: { s: FolderScreen; go: LibraryGo }) {
  const { t } = useTranslation()
  const chain = s.chain
  return (
    <nav className="lb-crumbs" aria-label={t('library.where')}>
      <button type="button" onClick={() => go({})}>{t('library.title')}</button>
      {chain.map((c, i) => {
        const last = i === chain.length - 1
        const label = c.kind === 'client_root' ? c.name : folderName(t, c.name, c.kind !== 'custom')
        return (
          <span key={c.id} style={{ display: 'contents' }}>
            <span className="lb-crumb-sep">/</span>
            {last ? (
              <span className="lb-crumb-here" aria-current="page">{label}</span>
            ) : (
              <button
                type="button"
                onClick={() => (c.kind === 'client_root' || c.kind === 'brand_root' || c.kind === 'projects_root'
                  ? go({ client: s.folder.clientId })
                  : go({ client: s.folder.clientId, folder: c.id }))}
              >
                {label}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}

function useDropUpload(s: FolderScreen, enabled: boolean) {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let depth = 0
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const onEnter = (e: DragEvent) => { if (hasFiles(e)) { depth += 1; setDragging(true) } }
    const onLeave = () => { depth = Math.max(0, depth - 1); if (depth === 0) setDragging(false) }
    const onOver = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault() }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      // A drop onto a folder card is that card's business (it stops the event); anything else lands here.
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length) startUploads({ folderId: s.folder.id, folderPath: pathOf(s), clientId: s.folder.clientId, files })
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [enabled, s])
  return dragging
}

function pickFiles(onFiles: (files: File[]) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.onchange = () => onFiles(Array.from(input.files ?? []))
  input.click()
}

function FolderCard({
  f, s, go, on, onSelect,
}: { f: SubfolderCard; s: FolderScreen; go: LibraryGo; on?: boolean; onSelect?: () => void }) {
  const { t } = useTranslation()
  const [drop, setDrop] = useState(false)
  const tone = s.folder.kind === 'brand' || s.chain.some((c) => c.kind === 'brand_root') ? 'violet' : 'green'
  const hint = s.folder.kind === 'campaign' ? folderHint(t, f.name) : null
  const meta = [
    countText(t, 'library.fileCount', f.fileCount),
    hint ?? (f.updatedAt && f.fileCount > 0 ? t('library.updatedOn', { date: formatIraqDate(f.updatedAt) }) : null),
  ].filter(Boolean).join(' · ')
  return (
    <div
      role="button"
      tabIndex={0}
      className={`lb-folder-card${on ? ' is-on' : ''}${drop ? ' is-drop' : ''}`}
      onClick={() => (onSelect ? onSelect() : go({ client: s.folder.clientId, folder: f.id }))}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (onSelect) onSelect(); else go({ client: s.folder.clientId, folder: f.id }) } }}
      onDragOver={(e) => { if (s.canChange) { e.preventDefault(); e.stopPropagation(); setDrop(true) } }}
      onDragLeave={() => setDrop(false)}
      onDrop={(e) => {
        if (!s.canChange) return
        e.preventDefault()
        e.stopPropagation()
        setDrop(false)
        const files = Array.from(e.dataTransfer.files)
        if (files.length) startUploads({ folderId: f.id, folderPath: `${pathOf(s)} / ${f.name}`, clientId: s.folder.clientId, files })
      }}
      data-testid={`library-folder-${f.id}`}
    >
      <span className="lb-folder-card-top">
        <FolderGlyph tone={tone} />
        <span className="lb-spacer" />
        {f.isSystem ? <span className="lb-lock" title={t('library.locked')} aria-label={t('library.locked')}>🔒</span> : <FolderMenu folder={f} s={s} />}
      </span>
      <span className="lb-folder-name">{folderName(t, f.name, f.isSystem)}</span>
      <span className="lb-folder-meta">{meta}</span>
    </div>
  )
}

/** LB-03 · A brand, opened. Its four standard folders and any made beside them; nothing loose at the top. */
function BrandView({ s, go }: { s: FolderScreen; go: LibraryGo }) {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  return (
    <>
      <Crumbs s={s} go={go} />
      <header className="lb-head">
        <div>
          <h1>{s.folder.name}</h1>
          <p className="lb-head-sub">{t('library.brandLead', { brand: s.folder.name })}</p>
        </div>
        {s.canChange && (
          <div className="lb-head-tools">
            {/* No Upload here: a brand's top level holds no loose files (ADR-0134 d.15) — the frame's
                button is dropped rather than shown dead. Files go in by opening a folder or dropping on one. */}
            <button type="button" className="lb-link" onClick={() => setAdding(true)} data-testid="library-new-folder">+ {t('library.newFolder')}</button>
          </div>
        )}
      </header>
      <div className="lb-folder-grid">
        {s.subfolders.map((f) => <FolderCard key={f.id} f={f} s={s} go={go} />)}
        {adding && <NewFolderCard clientId={s.folder.clientId} parentId={s.folder.id} tone="violet" onDone={() => setAdding(false)} />}
      </div>
      <p className="lb-note">{t('library.standardFoldersBrand')}</p>
      <div className="lb-empty-brand">
        <strong>{t('library.noLooseTitle')}</strong>
        <span>{t('library.noLooseBody')}</span>
      </div>
    </>
  )
}

/** LB-06 · A campaign or single job, opened. The four folders every job gets; the chosen one's files below. */
function ProjectView({ s, go, pickedFileId }: { s: FolderScreen; go: LibraryGo; pickedFileId: string | null }) {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const refs = s.subfolders.find(isReferencesFolder) ?? s.subfolders[0] ?? null
  const [chosenId, setChosenId] = useState<string | null>(refs?.id ?? null)
  const chosen = s.subfolders.find((f) => f.id === chosenId) ?? null
  const c = s.campaign
  return (
    <>
      <Crumbs s={s} go={go} />
      <header className="lb-head">
        <div>
          <h1>{s.folder.name}</h1>
          {c && (
            <div className="lb-head-meta">
              <span className="lb-pill lb-pill-violet">{c.kind === 'single_job' ? t('library.singleJob') : t('library.campaign')}</span>
              <span>
                {[c.brandName, countText(t, 'library.fileCount', c.fileCount),
                  c.openedAt ? (c.openedByName ? t('library.openedBy', { name: c.openedByName, date: formatIraqDate(c.openedAt) }) : t('library.openedOn', { date: formatIraqDate(c.openedAt) })) : null]
                  .filter(Boolean).join(' · ')}
              </span>
              <Link className="lb-link" style={{ padding: 2 }} to={`/campaigns/${c.id}`} data-testid="library-open-campaign">
                {c.kind === 'single_job' ? t('library.openTheJob') : t('library.openTheCampaign')} →
              </Link>
            </div>
          )}
        </div>
        {s.canChange && (
          <div className="lb-head-tools">
            <button type="button" className="lb-link" onClick={() => setAdding(true)} data-testid="library-new-folder">+ {t('library.newFolder')}</button>
            {chosen && !isDeliverablesFolder({ name: chosen.name, kind: chosen.kind, campaignId: s.folder.campaignId }) && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => pickFiles((files) => startUploads({ folderId: chosen.id, folderPath: `${pathOf(s)} / ${chosen.name}`, clientId: s.folder.clientId, files }))}
                data-testid="library-upload"
              >
                ↑ {t('library.uploadTo', { folder: folderName(t, chosen.name, chosen.isSystem) })}
              </Button>
            )}
          </div>
        )}
      </header>
      <div className="lb-folder-grid is-project">
        {s.subfolders.map((f) => {
          const deliverables = isDeliverablesFolder({ name: f.name, kind: f.kind, campaignId: s.folder.campaignId })
          return (
            <FolderCard
              key={f.id}
              f={f}
              s={s}
              go={go}
              on={f.id === chosenId}
              onSelect={deliverables || !f.isSystem ? undefined : () => setChosenId(f.id)}
            />
          )
        })}
        {adding && <NewFolderCard clientId={s.folder.clientId} parentId={s.folder.id} tone="green" onDone={() => setAdding(false)} />}
      </div>
      <p className="lb-note">{t('library.standardFoldersProject')}</p>
      {chosen && <ChosenFolderFiles folderId={chosen.id} name={folderName(t, chosen.name, chosen.isSystem)} go={go} pickedFileId={pickedFileId} isReferences={isReferencesFolder(chosen)} />}
    </>
  )
}

function ChosenFolderFiles({ folderId, name, go, pickedFileId, isReferences }: { folderId: string; name: string; go: LibraryGo; pickedFileId: string | null; isReferences: boolean }) {
  const { t } = useTranslation()
  const screen = useLibraryFolder(folderId)
  const actions = useFileActions()
  if (!screen.data) return <p className="lb-loading">{t('library.loading')}</p>
  const s = screen.data
  return (
    <>
      <div className="lb-proj-section-head">
        <FolderGlyph tone="green" />
        <h2>{name}</h2>
        <span className="lb-pill">{countText(t, 'library.fileCountCaps', s.files.length)}</span>
        <span className="lb-spacer" />
        {isReferences && <span className="lb-section-hint">{t('library.referencesHint')}</span>}
      </div>
      <FileList s={s} view="list" pickedFileId={pickedFileId} actions={actions} limit={null} />
      {isReferences && <p className="lb-note">{t('library.proofNote')}</p>}
      <FileActionDialogs actions={actions} s={s} go={go} />
    </>
  )
}

/** LB-04 · Inside a folder: files, versions and the file menu. */
function FilesView({ s, go, pickedFileId }: { s: FolderScreen; go: LibraryGo; pickedFileId: string | null }) {
  const { t } = useTranslation()
  const [view, setView] = useState<'list' | 'grid'>(() => {
    try { return (localStorage.getItem('library.view') as 'list' | 'grid') || 'list' } catch { return 'list' }
  })
  const [adding, setAdding] = useState(false)
  const actions = useFileActions()
  const dragging = useDropUpload(s, s.canChange)
  const here = folderName(t, s.folder.name, s.folder.isSystem)
  const choose = (v: 'list' | 'grid') => {
    setView(v)
    try { localStorage.setItem('library.view', v) } catch { /* a private window keeps no preference */ }
  }
  return (
    <div className={dragging ? 'lb-page is-dragging' : 'lb-page'} style={{ maxInlineSize: 'none' }}>
      <Crumbs s={s} go={go} />
      <header className="lb-head">
        <div>
          <h1>{here}</h1>
          <p className="lb-head-sub">{countText(t, 'library.folderLead', s.files.length)}</p>
        </div>
        <div className="lb-head-tools">
          <SegmentedControl
            size="sm"
            label={t('library.viewAs')}
            value={view}
            onChange={choose}
            options={[
              { value: 'list', label: t('library.list'), testId: 'library-view-list' },
              { value: 'grid', label: t('library.grid'), testId: 'library-view-grid' },
            ]}
          />
          {s.canChange && (
            <>
              <button type="button" className="lb-link" onClick={() => setAdding(true)} data-testid="library-new-folder">+ {t('library.newFolder')}</button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => pickFiles((files) => startUploads({ folderId: s.folder.id, folderPath: pathOf(s), clientId: s.folder.clientId, files }))}
                data-testid="library-upload"
              >
                ↑ {t('library.uploadButton')}
              </Button>
              <button type="button" className="lb-link" onClick={() => actions.open({ kind: 'add-link' })} data-testid="library-add-link">
                + {t('library.link.add')}
              </button>
            </>
          )}
          {!s.folder.isSystem && <FolderMenu folder={{ id: s.folder.id, name: s.folder.name, fileCount: s.files.length }} s={s} asPage go={go} />}
        </div>
      </header>

      {(s.subfolders.length > 0 || adding) && (
        <div className="lb-folder-grid" style={{ marginBlockEnd: 16 }}>
          {s.subfolders.map((f) => <FolderCard key={f.id} f={f} s={s} go={go} />)}
          {adding && <NewFolderCard clientId={s.folder.clientId} parentId={s.folder.id} tone={s.chain.some((c) => c.kind === 'brand_root') ? 'violet' : 'green'} onDone={() => setAdding(false)} />}
        </div>
      )}

      {s.canChange && (
        <div className="lb-drop-strip" data-testid="library-drop-strip">
          <b aria-hidden="true">↑</b>
          <span>{t('library.dropHere', { folder: here })}</span>
        </div>
      )}

      <FileList s={s} view={view} pickedFileId={pickedFileId} actions={actions} limit={view === 'list' ? 50 : null} />
      <p className="lb-note">{t('library.kindNote')}</p>
      <FileActionDialogs actions={actions} s={s} go={go} />
    </div>
  )
}
