import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../lib/i18n'
import { FolderPicker } from './FolderPicker'
import type { AssetFolder } from '../lib/assets/folder-tree'

/**
 * I35.8. The interesting property is the FENCE, not the browsing.
 *
 * The Brief Wizard hands this component one campaign's folder as `rootId`. If navigation could
 * walk above it, somebody filing a reference document could click the breadcrumb up into the
 * client root and file it under another campaign — silently, since every folder up there looks
 * exactly like a folder. So the tests below care most about what is NOT reachable.
 */

const f = (
  id: string,
  parentId: string | null,
  name: string,
  extra: Partial<AssetFolder> = {},
): AssetFolder => ({
  id,
  clientId: 'c1',
  parentId,
  name,
  kind: 'custom',
  isSystem: false,
  brandId: null,
  campaignId: null,
  ...extra,
})

const TREE: AssetFolder[] = [
  f('root', null, 'Zeta', { kind: 'client_root', isSystem: true }),
  f('projects', 'root', 'Projects', { kind: 'projects_root', isSystem: true }),
  f('camp', 'projects', 'Ramadan 2027', { kind: 'campaign', isSystem: true, campaignId: 'e1' }),
  f('refs', 'camp', 'References', { kind: 'asset_type', isSystem: true, campaignId: 'e1' }),
  f('working', 'camp', 'Working Files', { kind: 'asset_type', isSystem: true, campaignId: 'e1' }),
  f('other', 'projects', 'Eid 2027', { kind: 'campaign', isSystem: true, campaignId: 'e2' }),
]

describe('FolderPicker (I35.8)', () => {
  it('shows the children of where you are', () => {
    render(
      <FolderPicker folders={TREE} rootId="camp" currentFolderId="camp" onNavigate={vi.fn()} />,
    )
    expect(screen.getByTestId('folder-picker-open-refs')).toHaveTextContent('References')
    expect(screen.getByTestId('folder-picker-open-working')).toHaveTextContent('Working Files')
  })

  it('the breadcrumb stops at the root — a sibling campaign is not reachable by clicking up', () => {
    render(
      <FolderPicker folders={TREE} rootId="camp" currentFolderId="refs" onNavigate={vi.fn()} />,
    )
    // Inside the fence: the campaign and the folder you are in.
    expect(screen.getByTestId('folder-picker-crumb-camp')).toBeInTheDocument()
    expect(screen.getByTestId('folder-picker-crumb-refs')).toBeInTheDocument()
    // Above it: absent, so there is no route to Eid 2027 or the client root.
    expect(screen.queryByTestId('folder-picker-crumb-projects')).not.toBeInTheDocument()
    expect(screen.queryByTestId('folder-picker-crumb-root')).not.toBeInTheDocument()
    expect(screen.queryByTestId('folder-picker-open-other')).not.toBeInTheDocument()
  })

  it('a position outside the fence falls back to the root rather than rendering someone else', () => {
    // `other` is a real folder in the same client and a plausible stale id. Rendering its
    // contents because it was passed in would be the exact leak the fence exists to stop.
    render(
      <FolderPicker folders={TREE} rootId="camp" currentFolderId="other" onNavigate={vi.fn()} />,
    )
    expect(screen.getByTestId('folder-picker-crumb-camp')).toBeInTheDocument()
    expect(screen.getByTestId('folder-picker-open-refs')).toBeInTheDocument()
  })

  it('navigating reports the folder, and does not move on its own', () => {
    const onNavigate = vi.fn()
    render(<FolderPicker folders={TREE} rootId="camp" currentFolderId="camp" onNavigate={onNavigate} />)
    fireEvent.click(screen.getByTestId('folder-picker-open-refs'))
    expect(onNavigate).toHaveBeenCalledWith('refs')
    // Still showing the root's children: the parent owns the position (`AGENTS.md` §3 — this
    // component fetches nothing and decides nothing).
    expect(screen.getByTestId('folder-picker-open-working')).toBeInTheDocument()
  })

  it('offers no way to make a folder when no handler is given — that is what view-only looks like', () => {
    render(<FolderPicker folders={TREE} rootId="camp" currentFolderId="camp" onNavigate={vi.fn()} />)
    expect(screen.queryByTestId('folder-picker-add')).not.toBeInTheDocument()
  })

  it('creates a folder by name and clears the box', () => {
    const onCreateFolder = vi.fn()
    render(
      <FolderPicker
        folders={TREE}
        rootId="camp"
        currentFolderId="camp"
        onNavigate={vi.fn()}
        onCreateFolder={onCreateFolder}
      />,
    )
    fireEvent.click(screen.getByTestId('folder-picker-add'))
    fireEvent.change(screen.getByTestId('folder-picker-add-name'), { target: { value: '  Scripts  ' } })
    fireEvent.submit(screen.getByTestId('folder-picker-add-form'))
    expect(onCreateFolder).toHaveBeenCalledWith('Scripts')
    expect(screen.getByTestId('folder-picker-add-name')).toHaveValue('')
  })

  it('says why a folder could not be made', () => {
    render(
      <FolderPicker
        folders={TREE}
        rootId="camp"
        currentFolderId="camp"
        onNavigate={vi.fn()}
        onCreateFolder={vi.fn()}
        createError="A folder with that name is already here."
      />,
    )
    expect(screen.getByTestId('folder-picker-add-error')).toHaveTextContent('already here')
  })

  it('renders whatever extra controls the caller wants on a folder, and nothing otherwise', () => {
    const { rerender } = render(
      <FolderPicker
        folders={TREE}
        rootId="camp"
        currentFolderId="camp"
        onNavigate={vi.fn()}
        folderActions={(folder) => <button type="button" data-testid={`x-${folder.id}`}>x</button>}
      />,
    )
    expect(screen.getByTestId('x-refs')).toBeInTheDocument()

    rerender(<FolderPicker folders={TREE} rootId="camp" currentFolderId="camp" onNavigate={vi.fn()} />)
    expect(screen.queryByTestId('x-refs')).not.toBeInTheDocument()
  })

  it('says so when a folder has nothing under it', () => {
    render(<FolderPicker folders={TREE} rootId="camp" currentFolderId="refs" onNavigate={vi.fn()} />)
    expect(screen.getByTestId('folder-picker-folders')).toHaveTextContent('No subfolders')
  })
})
