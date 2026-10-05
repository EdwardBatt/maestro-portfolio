import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { FolderGlyph } from '../../../components/FolderGlyph'
import { Menu, type MenuItem } from '../../../components/Menu'
import { Modal, ModalFooter, ModalHeader } from '../../../components/Modal'
import { isDuplicateFolderName } from '../../../lib/assets/folders'
import { useClientTree, useDeleteLibraryFolder, useMoveFolder, useRenameFolder, type FolderScreen, type SubfolderCard } from '../api/library-api'
import { folderName } from '../lib/folder-words'
import { countText } from '../lib/count'
import type { LibraryGo } from '../LibraryPage'

/**
 * A made folder's ⋯ (ADR-0134 d.20): Rename and Move by the reach rule; Delete only when empty, by
 * its maker, the account manager or a Power Admin — the database answers both, this only offers.
 * The four standard folders never get this menu; they carry the lock instead.
 */
export function FolderMenu({
  folder, s, asPage = false, go,
}: { folder: Pick<SubfolderCard, 'id' | 'name' | 'fileCount'> & { isSystem?: boolean }; s: FolderScreen; asPage?: boolean; go?: LibraryGo }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<'rename' | 'move' | 'delete' | null>(null)
  const items: MenuItem[] = []
  if (s.canChange) {
    items.push(
      { key: 'rename', label: t('library.menu.rename'), onSelect: () => setOpen('rename'), testId: `folder-rename-${folder.id}` },
      { key: 'move', label: t('library.menu.move'), onSelect: () => setOpen('move'), testId: `folder-move-${folder.id}` },
    )
  }
  // On a folder's own page the screen says whether you may delete it; on a card, the database decides.
  if (!asPage || s.canDeleteFolder) {
    items.push({ key: 'delete', label: t('library.deleteFolder'), danger: true, separated: items.length > 0, onSelect: () => setOpen('delete'), testId: `folder-delete-${folder.id}` })
  }
  if (items.length === 0) return null
  return (
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
      <Menu items={items} label={t('library.moreFor', { name: folder.name })} testId={`folder-menu-${folder.id}`} />
      {open === 'rename' && <RenameFolder folder={folder} onClose={() => setOpen(null)} />}
      {open === 'move' && <MoveFolder folder={folder} s={s} onClose={() => setOpen(null)} />}
      {open === 'delete' && <DeleteFolder folder={folder} s={s} onClose={() => setOpen(null)} onGone={() => asPage && go?.({ client: s.folder.clientId, folder: s.chain[s.chain.length - 2]?.id ?? null })} />}
    </span>
  )
}

function RenameFolder({ folder, onClose }: { folder: { id: string; name: string }; onClose: () => void }) {
  const { t } = useTranslation()
  const rename = useRenameFolder()
  const [name, setName] = useState(folder.name)
  const [error, setError] = useState<string | null>(null)
  const save = () => rename.mutate({ p_folder: folder.id, p_name: name.trim() }, {
    onSuccess: onClose,
    onError: (e) => setError(t(isDuplicateFolderName(e) ? 'library.folderExists' : 'library.saveFailed')),
  })
  return (
    <Modal onClose={onClose} labelledById="lb-frename-title" testId="library-folder-rename">
      <ModalHeader id="lb-frename-title" title={t('library.renameTitle', { name: folder.name })} />
      <div className="modal-body lb-dialog lb-dialog-narrow">
        <label className="lb-rename-field">
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save() }} autoFocus aria-label={t('library.newName')} data-testid="library-folder-rename-input" />
        </label>
        {error && <span className="lb-field-error" role="alert">{error}</span>}
      </div>
      <ModalFooter>
        <Button variant="primary" onClick={save} disabled={!name.trim() || name.trim() === folder.name} busy={rename.isPending}>{t('library.rename')}</Button>
        <Button variant="link" onClick={onClose}>{t('common.cancel')}</Button>
      </ModalFooter>
    </Modal>
  )
}

function MoveFolder({ folder, s, onClose }: { folder: { id: string; name: string }; s: FolderScreen; onClose: () => void }) {
  const { t } = useTranslation()
  const tree = useClientTree(s.folder.clientId)
  const move = useMoveFolder()
  const [target, setTarget] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rows = useMemo(() => {
    const all = tree.data ?? []
    const kids = new Map<string | null, typeof all>()
    for (const n of all) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n])
    const out: ((typeof all)[number] & { depth: number })[] = []
    const walk = (parent: string | null, depth: number) => {
      for (const n of kids.get(parent) ?? []) {
        if (n.id === folder.id) continue // never into itself or its own subtree
        out.push({ ...n, depth })
        walk(n.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [tree.data, folder.id])
  const chosen = rows.find((r) => r.id === target)
  return (
    <Modal onClose={onClose} labelledById="lb-fmove-title" testId="library-folder-move">
      <ModalHeader id="lb-fmove-title" title={t('library.moveTitle', { name: folder.name })} subtitle={t('library.moveSub', { client: s.chain[0]?.name ?? '' })} />
      <div className="modal-body lb-dialog">
        <div className="lb-tree" role="listbox" aria-label={t('library.pickFolder')}>
          {rows.map((n) => (
            <button
              key={n.id}
              type="button"
              role="option"
              aria-selected={n.id === target}
              className={n.id === target ? 'lb-tree-row is-on' : 'lb-tree-row'}
              style={{ paddingInlineStart: 10 + n.depth * 18 }}
              disabled={n.kind === 'client_root' || n.kind === 'brand_root' || n.kind === 'projects_root'}
              onClick={() => setTarget(n.id)}
            >
              <FolderGlyph size="sm" />
              <span>{n.kind === 'client_root' ? n.name : folderName(t, n.name, n.isSystem)}</span>
            </button>
          ))}
        </div>
        {error && <span className="lb-field-error" role="alert">{error}</span>}
      </div>
      <ModalFooter>
        <Button
          variant="primary"
          disabled={!target}
          busy={move.isPending}
          onClick={() => target && move.mutate({ p_folder: folder.id, p_parent: target }, { onSuccess: onClose, onError: () => setError(t('library.saveFailed')) })}
        >
          {chosen ? t('library.moveTo', { folder: folderName(t, chosen.name, chosen.isSystem) }) : t('library.menu.move')}
        </Button>
        <Button variant="link" onClick={onClose}>{t('common.cancel')}</Button>
      </ModalFooter>
    </Modal>
  )
}

function DeleteFolder({ folder, s, onClose, onGone }: { folder: { id: string; name: string; fileCount: number }; s: FolderScreen; onClose: () => void; onGone: () => void }) {
  const { t } = useTranslation()
  const del = useDeleteLibraryFolder()
  const [error, setError] = useState<string | null>(null)
  const notEmpty = folder.fileCount > 0
  return (
    <Modal onClose={onClose} labelledById="lb-fdel-title" testId="library-folder-delete">
      <ModalHeader id="lb-fdel-title" title={t('library.deleteTitle', { name: folder.name })} subtitle={s.chain.map((c) => c.name).join(' / ')} />
      <div className="modal-body lb-dialog lb-dialog-narrow">
        {notEmpty
          ? <div className="lb-warn-card"><strong>{countText(t, 'library.folderNotEmpty', folder.fileCount)}</strong></div>
          : <p className="lb-dialog-text">{t('library.deleteFolderBody')}</p>}
        {error && <span className="lb-field-error" role="alert">{error}</span>}
      </div>
      <ModalFooter>
        {!notEmpty && (
          <Button
            variant="danger"
            className="lb-btn-danger"
            busy={del.isPending}
            onClick={() => del.mutate(folder.id, {
              onSuccess: () => { onClose(); onGone() },
              onError: (e) => setError(/not empty/i.test((e as { message?: string }).message ?? '') ? t('library.folderNotEmptyShort') : t('library.deleteFailedNotYours')),
            })}
            data-testid="library-folder-delete-confirm"
          >
            {t('library.deleteFolder')}
          </Button>
        )}
        <Button variant={notEmpty ? 'primary' : 'link'} onClick={onClose}>{notEmpty ? t('common.gotIt') : t('library.keepIt')}</Button>
      </ModalFooter>
    </Modal>
  )
}
