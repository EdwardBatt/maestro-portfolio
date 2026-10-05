import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { DateField } from '../../../components/DateField'
import { FolderGlyph } from '../../../components/FolderGlyph'
import { Modal, ModalFooter, ModalHeader } from '../../../components/Modal'
import { NoticeDialog } from '../../../components/Notice'
import { SidePanel } from '../../../components/SidePanel'
import { baseOf, extensionOf, fileKind } from '../../../lib/assets/kind'
import { formatIraqDate, formatIraqDateTime } from '../../../lib/time/iraq'
import {
  fetchPreviewUrl,
  useAddLink,
  useAddLinkVersion,
  useCopyFile,
  useDeleteFile,
  useMakeCurrent,
  useMove,
  useRename,
  useUsage,
  useVersions,
  type FolderScreen,
  type LibraryFile,
} from '../api/library-api'
import { folderName } from '../lib/folder-words'
import { countText } from '../lib/count'
import type { LibraryGo } from '../LibraryPage'
import type { FileActions } from '../lib/file-actions'
import { downloadFile, pathOf, useKindWords } from '../lib/files'
import { FolderTree } from './FolderTree'
import { ROOT_KINDS } from '../lib/folder-words'

export function FileActionDialogs({ actions, s }: { actions: FileActions; s: FolderScreen; go?: LibraryGo }) {
  const c = actions.current
  return (
    <>
      {actions.notice && (
        <NoticeDialog kind={actions.notice.kind === 'error' ? 'error' : 'success'} message={actions.notice.text} testId="library-banner" onClose={actions.clearNotice} />
      )}
      {c?.kind === 'preview' && <PreviewDialog f={c.file} onClose={actions.close} />}
      {c?.kind === 'versions' && <VersionPanel f={c.file} s={s} actions={actions} />}
      {c?.kind === 'rename' && <RenameDialog f={c.file} actions={actions} />}
      {(c?.kind === 'move' || c?.kind === 'copy') && <MoveCopyDialog mode={c.kind} f={c.file} s={s} actions={actions} />}
      {c?.kind === 'delete' && <DeleteDialog f={c.file} s={s} actions={actions} />}
      {c?.kind === 'add-link' && <LinkDialog s={s} actions={actions} />}
      {c?.kind === 'link-version' && <LinkDialog s={s} actions={actions} versionOf={c.file} />}
    </>
  )
}

// ---- Preview (d.6) -----------------------------------------------------------------------------

function PreviewDialog({ f, onClose }: { f: LibraryFile; onClose: () => void }) {
  const { t } = useTranslation()
  const words = useKindWords()(f)
  const k = fileKind(f.name, f.contentType, Boolean(f.linkUrl))
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!k.previewable) return
    let live = true
    fetchPreviewUrl(f.id).then((u) => { if (live) setUrl(u) }, () => { if (live) setFailed(true) })
    return () => { live = false }
  }, [f.id, k.previewable])
  const shown = k.previewable && !failed
  return (
    <Modal onClose={onClose} labelledById="lb-preview-title" testId="library-preview">
      <ModalHeader id="lb-preview-title" title={f.name} subtitle={words} />
      <div className={shown ? 'modal-body lb-dialog lb-preview-wide' : 'modal-body lb-dialog'}>
        {shown ? (
          <div className="lb-preview">
            {!url ? <span className="lb-loading">{t('library.loading')}</span>
              : k.previewable === 'image' ? <img src={url} alt={f.name} />
              : k.previewable === 'video' ? <video src={url} controls />
              : k.previewable === 'audio' ? <audio src={url} controls />
              : <iframe src={url} title={f.name} />}
          </div>
        ) : (
          <div className="lb-preview-none" data-testid="library-preview-none">
            <FolderGlyph />
            <strong>{f.name}</strong>
            <span>{t('library.previewNone', { kind: words })}</span>
          </div>
        )}
      </div>
      <ModalFooter>
        <Button variant="primary" onClick={() => void downloadFile(f)} data-testid="library-preview-download">
          {f.linkUrl ? t('library.menu.openLink') : `↓ ${t('library.menu.download')}`}
        </Button>
        <Button variant="secondary" onClick={onClose}>{t('library.close')}</Button>
      </ModalFooter>
    </Modal>
  )
}

// ---- Version history (LB-07, d.7) ----------------------------------------------------------------

function VersionPanel({ f, s, actions }: { f: LibraryFile; s: FolderScreen; actions: FileActions }) {
  const { t } = useTranslation()
  const versions = useVersions(f.id)
  const makeCurrent = useMakeCurrent()
  const rows = versions.data ?? []
  const top = rows[0]?.version ?? f.currentVersion
  return (
    <SidePanel
      onClose={actions.close}
      labelledById="lb-versions-title"
      testId="library-versions"
      footer={
        <>
          {s.canChange && !f.linkUrl && (
            <Button variant="primary" onClick={() => { actions.close(); actions.uploadVersion(s, f) }} data-testid="library-versions-upload">
              ↑ {t('library.menu.newVersion')}
            </Button>
          )}
          <Button variant="link" onClick={actions.close}>{t('library.close')}</Button>
        </>
      }
    >
      <div className="lb-versions-head">
        <div className="lb-versions-top">
          <span className="lb-pill lb-pill-violet">{countText(t, 'library.versionCount', rows.length || f.currentVersion)}</span>
          <span className="lb-spacer" />
          <button type="button" className="lb-versions-close" aria-label={t('library.close')} onClick={actions.close}>✕</button>
        </div>
        <h2 id="lb-versions-title">{f.name}</h2>
        <span className="lb-versions-path">{pathOf(s)}</span>
      </div>
      <div className="lb-versions">
        {versions.isLoading && <p className="lb-loading">{t('library.loading')}</p>}
        {rows.map((v) => {
          const current = v.version === top
          const asked = /change/i.test(v.reviewNote ?? '')
          return (
            <div key={v.version} className={current ? 'lb-version-card is-current' : 'lb-version-card'} data-testid={`library-version-${v.version}`}>
              <div className="lb-version-card-top">
                <span className={current ? 'lb-version is-newest' : asked ? 'lb-version is-older-review' : 'lb-version'}>v{v.version}</span>
                {current && <span className="lb-pill lb-pill-green">{t('library.current')}</span>}
                <span className="lb-spacer" />
                <button
                  type="button"
                  className="lb-version-dl"
                  onClick={() => (v.linkUrl ? window.open(v.linkUrl, '_blank', 'noopener') : void downloadFile(f, v.version).catch(() => actions.fail(t('library.downloadFailed'))))}
                >
                  {v.linkUrl ? t('library.menu.openLink') : `↓ ${t('library.menu.download')}`}
                </button>
              </div>
              <span className="lb-version-who">{[v.uploadedByName, formatIraqDateTime(v.createdAt)].filter(Boolean).join(' · ')}</span>
              <span className="lb-version-what">
                {v.reviewNote ?? (v.note ? t('library.madeCurrentFrom', { note: v.note }) : v.version === 1 ? t('library.firstUpload') : t('library.newVersionUploaded'))}
              </span>
              {!current && s.canChange && (
                <button
                  type="button"
                  className="lb-quiet-btn"
                  disabled={makeCurrent.isPending}
                  onClick={() => makeCurrent.mutate({ p_asset: f.id, p_version: v.version }, {
                    onSuccess: () => void versions.refetch(),
                    onError: () => actions.fail(t('library.saveFailed')),
                  })}
                  data-testid={`library-make-current-${v.version}`}
                >
                  {t('library.makeCurrent')}
                </button>
              )}
            </div>
          )
        })}
        <p className="lb-versions-note">{t('library.versionsNote', { next: top + 1 })}</p>
      </div>
    </SidePanel>
  )
}

// ---- Rename (d.8): the name only; the ending is the file's own ----------------------------------

function RenameDialog({ f, actions }: { f: LibraryFile; actions: FileActions }) {
  const { t } = useTranslation()
  const ext = f.linkUrl ? '' : extensionOf(f.name)
  const [base, setBase] = useState(f.linkUrl ? f.name : baseOf(f.name))
  const [error, setError] = useState<string | null>(null)
  const rename = useRename()
  const clean = base.trim()
  const unchanged = clean === (f.linkUrl ? f.name : baseOf(f.name))
  const save = () => {
    if (!clean || unchanged) return
    setError(null)
    rename.mutate({ p_asset: f.id, p_base: clean }, {
      onSuccess: () => { actions.close(); actions.done(t('library.renamed')) },
      onError: (e) => setError((e as { code?: string }).code === '23505' ? t('library.nameTaken') : t('library.saveFailed')),
    })
  }
  return (
    <Modal onClose={actions.close} labelledById="lb-rename-title" testId="library-rename">
      <ModalHeader id="lb-rename-title" title={t('library.renameTitle', { name: f.name })} subtitle={t('library.renameSub')} />
      <div className="modal-body lb-dialog lb-dialog-narrow">
        <label className="lb-rename-field">
          <input value={base} onChange={(e) => setBase(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save() }} aria-label={t('library.newName')} autoFocus data-testid="library-rename-input" />
          {ext && <span aria-hidden="true">.{ext}</span>}
        </label>
        {error && <span className="lb-field-error" role="alert">{error}</span>}
      </div>
      <ModalFooter>
        <Button variant="primary" onClick={save} disabled={!clean || unchanged} busy={rename.isPending} data-testid="library-rename-save">{t('library.rename')}</Button>
        <Button variant="link" onClick={actions.close}>{t('common.cancel')}</Button>
      </ModalFooter>
    </Modal>
  )
}

// ---- Move to… / Copy to… (LB-09, d.10): only inside the same client --------------------------------

function MoveCopyDialog({ mode, f, s, actions }: { mode: 'move' | 'copy'; f: LibraryFile; s: FolderScreen; actions: FileActions }) {
  const { t } = useTranslation()
  const move = useMove()
  const copy = useCopyFile()
  const [target, setTarget] = useState<string | null>(null)
  const [chosenName, setChosenName] = useState('')
  const clientName = s.chain[0]?.name ?? ''
  const busy = move.isPending || copy.isPending

  const submit = () => {
    if (!target) return
    const after = () => {
      actions.close()
      actions.done(mode === 'move' ? t('library.moved', { folder: chosenName }) : t('library.copied', { folder: chosenName }))
    }
    if (mode === 'move') move.mutate({ p_asset: f.id, p_folder: target }, { onSuccess: after, onError: () => actions.fail(t('library.saveFailed')) })
    else copy.mutate({ assetId: f.id, folderId: target }, { onSuccess: after, onError: () => actions.fail(t('library.saveFailed')) })
  }

  return (
    <Modal onClose={actions.close} labelledById="lb-move-title" testId={`library-${mode}`}>
      <ModalHeader
        id="lb-move-title"
        title={t(mode === 'move' ? 'library.moveTitle' : 'library.copyTitle', { name: f.name })}
        subtitle={t('library.moveSub', { client: clientName })}
      />
      <div className="modal-body lb-dialog">
        <FolderTree
          clientId={s.folder.clientId}
          clientName={clientName}
          value={target}
          onChange={(id, name) => { setTarget(id); setChosenName(name) }}
          hereId={s.folder.id}
          hereBlocked={mode === 'move'}
          blockedKinds={ROOT_KINDS}
          testIdPrefix="library-move"
        />
      </div>
      <ModalFooter>
        <Button variant="primary" onClick={submit} disabled={!target} busy={busy} data-testid={`library-${mode}-confirm`}>
          {target ? t(mode === 'move' ? 'library.moveTo' : 'library.copyTo', { folder: chosenName }) : t(mode === 'move' ? 'library.menu.move' : 'library.menu.copy')}
        </Button>
        <Button variant="link" onClick={actions.close}>{t('common.cancel')}</Button>
      </ModalFooter>
    </Modal>
  )
}

// ---- Delete (LB-10, d.9) ---------------------------------------------------------------------------

function DeleteDialog({ f, s, actions }: { f: LibraryFile; s: FolderScreen; actions: FileActions }) {
  const { t } = useTranslation()
  const usage = useUsage(f.id)
  const del = useDeleteFile()
  const uses = usage.data ?? []
  const pieces = uses.map((u) => u.pieceName)
  const where = uses[0]?.campaignName
  return (
    <Modal onClose={actions.close} labelledById="lb-delete-title" testId="library-delete">
      <ModalHeader
        id="lb-delete-title"
        title={t('library.deleteTitle', { name: f.name })}
        subtitle={[pathOf(s), countText(t, 'library.versionCount', f.currentVersion).toLowerCase(), f.uploadedByName ? t('library.addedBy', { name: f.uploadedByName }) : null].filter(Boolean).join(' · ')}
      />
      <div className="modal-body lb-dialog lb-dialog-narrow">
        {uses.length > 0 && (
          <div className="lb-warn-card" data-testid="library-delete-usage">
            <strong>{countText(t, 'library.usedBy', uses.length)}</strong>
            <span>{t('library.usedByBody', { pieces: pieces.join(t('library.listJoin')), campaign: where ?? '' })}</span>
          </div>
        )}
        <p className="lb-dialog-text">{t('library.deleteBody')}</p>
      </div>
      <ModalFooter>
        <Button
          variant="danger"
          className="lb-btn-danger"
          busy={del.isPending}
          onClick={() => del.mutate({ p_asset: f.id }, {
            onSuccess: () => { actions.close(); actions.done(t('library.deleted.done', { name: f.name })) },
            onError: () => actions.fail(t('library.saveFailed')),
          })}
          data-testid="library-delete-confirm"
        >
          {t('library.deleteConfirm')}
        </Button>
        <Button variant="link" onClick={actions.close}>{t('library.keepIt')}</Button>
      </ModalFooter>
    </Modal>
  )
}

// ---- Links (d.16–18) ------------------------------------------------------------------------------

function LinkDialog({ s, actions, versionOf }: { s: FolderScreen; actions: FileActions; versionOf?: LibraryFile }) {
  const { t } = useTranslation()
  const add = useAddLink()
  const addVersion = useAddLinkVersion()
  const [name, setName] = useState(versionOf?.name ?? '')
  const [url, setUrl] = useState('')
  const [expires, setExpires] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const valid = /^https?:\/\/\S+$/i.test(url.trim()) && (Boolean(versionOf) || name.trim().length > 0)
  const busy = add.isPending || addVersion.isPending
  const save = () => {
    if (!valid) { setError(t('library.link.bad')); return }
    const onError = () => setError(t('library.saveFailed'))
    const onSuccess = () => { actions.close(); actions.done(versionOf ? t('library.link.versionAdded') : t('library.link.added')) }
    if (versionOf) addVersion.mutate({ p_asset: versionOf.id, p_url: url.trim(), p_expires_on: expires }, { onSuccess, onError })
    else add.mutate({ p_folder: s.folder.id, p_name: name.trim(), p_url: url.trim(), p_expires_on: expires }, { onSuccess, onError })
  }
  return (
    <Modal onClose={actions.close} labelledById="lb-link-title" testId="library-link">
      <ModalHeader
        id="lb-link-title"
        title={versionOf ? t('library.link.newVersionTitle', { name: versionOf.name }) : t('library.link.addTitle')}
        subtitle={versionOf ? t('library.link.newVersionSub') : t('library.link.addSub', { folder: folderName(t, s.folder.name, s.folder.isSystem) })}
      />
      <div className="modal-body lb-dialog">
        {!versionOf && (
          <label className="field">
            <span>{t('library.link.name')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('library.link.namePlaceholder')} data-testid="library-link-name" />
          </label>
        )}
        <label className="field">
          <span>{t('library.link.url')}</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" inputMode="url" data-testid="library-link-url" />
        </label>
        <label className="field">
          <span>{t('library.link.expires')}</span>
          <DateField value={expires ?? ''} onChange={(v) => setExpires(v || null)} data-testid="library-link-expires" />
          <small className="lb-dialog-text">{expires ? t('library.link.expiresHint', { date: formatIraqDate(expires) }) : t('library.link.expiresNone')}</small>
        </label>
        {error && <span className="lb-field-error" role="alert">{error}</span>}
      </div>
      <ModalFooter>
        <Button variant="primary" onClick={save} disabled={!valid} busy={busy} data-testid="library-link-save">
          {versionOf ? t('library.link.saveVersion') : t('library.link.save')}
        </Button>
        <Button variant="link" onClick={actions.close}>{t('common.cancel')}</Button>
      </ModalFooter>
    </Modal>
  )
}
