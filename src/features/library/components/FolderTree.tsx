import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderGlyph } from '../../../components/FolderGlyph'
import { useClientTree } from '../api/library-api'
import { folderName } from '../lib/folder-words'

interface TreeNode { id: string; parentId: string | null; name: string; kind: string; isSystem: boolean; depth: number }

/**
 * One client's folders as an indented, searchable list (Figma LB-09) — the picker behind Move to…, Copy to…
 * and the upload box's Change. Only that client's folders: files never cross clients (ADR-0134 d.10).
 *
 * `blockedKinds` are offered but cannot be picked (the roots always; for an upload, also a brand's or a
 * project's top level, where no loose file belongs — d.15). `hereId` is the folder the thing is in now.
 */
export function FolderTree({
  clientId, clientName, value, onChange, hereId, hereBlocked, blockedKinds, testIdPrefix,
}: {
  clientId: string
  clientName: string
  value: string | null
  /** The folder, its name in the page's words, and its whole path ("Kite / Brand assets / Luma / Logos"). */
  onChange: (id: string, name: string, path: string) => void
  hereId?: string | null
  hereBlocked?: boolean
  blockedKinds: string[]
  testIdPrefix: string
}) {
  const { t } = useTranslation()
  const tree = useClientTree(clientId)
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    const all = tree.data ?? []
    const kids = new Map<string | null, typeof all>()
    for (const n of all) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n])
    const out: TreeNode[] = []
    const walk = (parent: string | null, depth: number) => {
      for (const n of kids.get(parent) ?? []) {
        out.push({ ...n, depth })
        walk(n.id, depth + 1)
      }
    }
    walk(null, 0)
    const needle = q.trim().toLowerCase()
    return needle ? out.filter((n) => n.name.toLowerCase().includes(needle) || folderName(t, n.name, n.isSystem).toLowerCase().includes(needle)) : out
  }, [tree.data, q, t])

  // A brand's folders are violet, a project's green: decided by which top-level branch a row sits under.
  const byId = useMemo(() => new Map((tree.data ?? []).map((x) => [x.id, x])), [tree.data])
  const tone = (n: TreeNode) => {
    let cur: { kind: string; parentId: string | null } | undefined = n
    while (cur) {
      if (cur.kind === 'projects_root' || cur.kind === 'campaign') return 'green'
      if (cur.kind === 'brand_root' || cur.kind === 'brand') return 'violet'
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    return 'violet'
  }

  const pathOf = (id: string) => {
    const parts: string[] = []
    let cur = byId.get(id)
    while (cur) {
      parts.unshift(cur.kind === 'client_root' ? cur.name : folderName(t, cur.name, cur.isSystem))
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    return parts.join(' / ')
  }

  return (
    <>
      <label className="lb-tree-search">
        <span aria-hidden="true">⌕</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('library.searchFoldersIn', { client: clientName })} data-testid={`${testIdPrefix}-search`} />
      </label>
      <div className="lb-tree" role="listbox" aria-label={t('library.pickFolder')}>
        {tree.isLoading && <span className="lb-loading">{t('library.loading')}</span>}
        {rows.map((n) => {
          const here = n.id === hereId
          const label = n.kind === 'client_root' ? n.name : folderName(t, n.name, n.isSystem)
          return (
            <button
              key={n.id}
              type="button"
              role="option"
              aria-selected={n.id === value}
              className={n.id === value ? 'lb-tree-row is-on' : here && hereBlocked ? 'lb-tree-row is-here' : 'lb-tree-row'}
              style={{ paddingInlineStart: 10 + n.depth * 18 }}
              disabled={(here && hereBlocked) || blockedKinds.includes(n.kind)}
              onClick={() => onChange(n.id, label, pathOf(n.id))}
              data-testid={`${testIdPrefix}-target-${n.id}`}
            >
              <span className="lb-tree-caret" aria-hidden="true">{(tree.data ?? []).some((x) => x.parentId === n.id) && n.depth > 0 ? '▾' : ''}</span>
              <FolderGlyph tone={tone(n)} size="sm" />
              <span>{here ? t('library.hereNow', { name: label }) : label}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}
