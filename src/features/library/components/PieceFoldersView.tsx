import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { fileKind, formatSize } from '../../../lib/assets/kind'
import { supabaseUntyped } from '../../../lib/supabase'
import { usePieceFolders, type FolderScreen, type PieceFolder, type PieceVersion } from '../api/library-api'
import type { LibraryGo } from '../LibraryPage'
import { countText } from '../lib/count'
import { downloadFile, useKindWords } from '../lib/files'

type Group = 'piece' | 'workstream' | 'type' | 'latest'

/**
 * LB-02 · Deliverables — one folder per deliverable (Figma `1636:697`). Every version a maker sent for
 * review, marked with how its review went, and the working files beside them (ADR-0134 d.22–24). The
 * versions stay review records (`media_records`, ADR-0023) — this page shows them, nothing is copied.
 */
export function PieceFoldersView({ screen, go }: { screen: FolderScreen; go: LibraryGo }) {
  const { t } = useTranslation()
  const pieces = usePieceFolders(screen.folder.id)
  const [group, setGroup] = useState<Group>('piece')
  const data = pieces.data
  const chain = screen.chain
  const campaign = chain[chain.length - 2]

  const groups = useMemo(() => {
    const list = data?.pieces ?? []
    if (group === 'piece') return [{ key: 'all', title: null as string | null, pieces: list }]
    if (group === 'latest') {
      const newest = (p: PieceFolder) => Math.max(0, ...p.versions.map((v) => Date.parse(v.createdAt)), ...p.sources.map((s) => Date.parse(s.createdAt)))
      return [{ key: 'all', title: null, pieces: [...list].sort((a, b) => newest(b) - newest(a)) }]
    }
    const by = new Map<string, PieceFolder[]>()
    for (const p of list) {
      const k = (group === 'workstream' ? p.workstreamName : p.typeName) ?? t('library.pieces.ungrouped')
      by.set(k, [...(by.get(k) ?? []), p])
    }
    return Array.from(by, ([k, ps]) => ({ key: k, title: k, pieces: ps }))
  }, [data, group, t])

  return (
    <>
      <div className="lb-piece-crumbs">
        <button type="button" onClick={() => go({ client: screen.folder.clientId })}>{chain[0]?.name}</button>
        <span className="lb-crumb-sep">›</span>
        <button type="button" onClick={() => go({ client: screen.folder.clientId })}>{t('library.std.projects')}</button>
        <span className="lb-crumb-sep">›</span>
        {campaign && <button type="button" onClick={() => go({ client: screen.folder.clientId, folder: campaign.id })}>{campaign.name}</button>}
        <span className="lb-crumb-sep">›</span>
        <h1>{t('library.std.deliverables')}</h1>
      </div>
      <p className="lb-piece-sub">
        {data ? countText(t, 'library.pieces.lead', data.pieceCount, { d: data.deliveredCount }) : t('library.loading')}
      </p>
      <div className="tv-tabs" role="tablist" aria-label={t('library.pieces.groupBy')} style={{ alignSelf: 'flex-start' }}>
        {(['piece', 'workstream', 'type', 'latest'] as Group[]).map((g) => (
          <button
            key={g}
            type="button"
            role="tab"
            aria-selected={g === group}
            className={g === group ? 'btn tv-tab tv-tab-on' : 'btn tv-tab'}
            onClick={() => setGroup(g)}
            data-testid={`library-pieces-${g}`}
          >
            {t(`library.pieces.by.${g}`)}
          </button>
        ))}
      </div>
      {data && data.pieces.length === 0 && <div className="lb-empty-folder" style={{ marginBlockStart: 12 }}>{t('library.pieces.none')}</div>}
      {groups.map((gr) => (
        <div key={gr.key}>
          {gr.title && <h2 className="lb-proj-section-head" style={{ fontSize: 13 }}>{gr.title}</h2>}
          <div className="lb-piece-list">
            {gr.pieces.map((p) => <PieceCard key={p.deliverableId} p={p} campaignId={screen.folder.campaignId} />)}
          </div>
        </div>
      ))}
      <p className="lb-note">{t('library.pieces.note')}</p>
    </>
  )
}

function PieceCard({ p, campaignId }: { p: PieceFolder; campaignId: string | null }) {
  const { t } = useTranslation()
  const kindWords = useKindWords()
  const latest = p.versions[0]?.id
  return (
    <section className="lb-piece" data-testid={`library-piece-${p.deliverableId}`}>
      <div className="lb-piece-head">
        {p.code && <span className="lb-piece-code">{p.code}</span>}
        <span className="lb-piece-name">{p.name}</span>
        <span className="lb-spacer" />
        {campaignId && <Link className="lb-piece-open" to={`/campaigns/${campaignId}?piece=${p.deliverableId}`}>{t('library.pieces.open')}</Link>}
      </div>
      {p.versions.length === 0 && p.sources.length === 0 && <span className="lb-piece-file-meta">{t('library.pieces.nothingYet')}</span>}
      {p.versions.map((v) => <VersionRow key={v.id} v={v} isLatest={v.id === latest} />)}
      {p.sources.map((f) => (
        <div key={f.id} className="lb-piece-file">
          <span className="lb-piece-thumb is-source" aria-hidden="true" />
          <div className="lb-piece-file-main">
            <span className="lb-piece-file-name">{f.name}</span>
            <span className="lb-piece-file-meta">{kindWords(f)}</span>
          </div>
          <span className="lb-review lb-review-source">{t('library.sourceTag')}</span>
          <button type="button" className="lb-piece-dl" onClick={() => void downloadFile(f)}>{t('library.menu.download')}</button>
        </div>
      ))}
    </section>
  )
}

function VersionRow({ v, isLatest }: { v: PieceVersion; isLatest: boolean }) {
  const { t } = useTranslation()
  const k = fileKind(v.fileName, v.contentType)
  const meta = [v.round != null ? t('library.pieces.round', { n: v.round }) : null, v.sizeBytes != null ? formatSize(v.sizeBytes) : null].filter(Boolean).join(' · ')
  // A review version is downloaded through the review door (`review-media`), which checks the reader may see it.
  const download = async () => {
    const res = await supabaseUntyped.functions.invoke('review-media', { body: { op: 'view', mediaRecordId: v.id } })
    const url = (res.data as { downloadUrl?: string; url?: string } | null)
    if (url?.downloadUrl ?? url?.url) window.open((url.downloadUrl ?? url.url)!, '_blank', 'noopener')
  }
  return (
    <div className="lb-piece-file" data-testid={`library-piece-version-${v.id}`}>
      <span className={k.previewable === 'video' ? 'lb-piece-thumb is-media' : 'lb-piece-thumb'} aria-hidden="true" />
      <div className="lb-piece-file-main">
        <span className="lb-piece-file-name">{v.fileName}</span>
        {meta && <span className="lb-piece-file-meta">{meta}</span>}
      </div>
      <span className={`lb-review lb-review-${v.reviewState}${isLatest ? ' is-latest' : ''}`}>
        V{v.version} · {t(`library.pieces.state.${v.reviewState}`)}
      </span>
      <button type="button" className="lb-piece-dl" onClick={() => void download()}>{t('library.menu.download')}</button>
    </div>
  )
}
