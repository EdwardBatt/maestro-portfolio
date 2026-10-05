import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import '../../lib/i18n'
import type { ClientOverview, FolderScreen, LibraryFile } from './api/library-api'

const state = vi.hoisted(() => ({
  overview: null as unknown,
  folder: null as unknown,
  rename: vi.fn(),
  search: [] as unknown[],
}))

// Self-contained (the real module reaches lib/env, which throws in CI — traps.md).
vi.mock('./api/library-api', () => {
  const q = (data: unknown) => ({ data, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() })
  const m = () => ({ mutate: vi.fn(), isPending: false, isError: false, reset: vi.fn() })
  return {
    useLibraryClients: () => q([{ id: 'c1', name: 'Kite', fileCount: 95, canChange: true }, { id: 'c2', name: 'Harmony', fileCount: 24, canChange: false }]),
    useClientOverview: () => q(state.overview),
    useLibraryFolder: () => q(state.folder),
    usePieceFolders: () => q({ pieces: [], pieceCount: 0, deliveredCount: 0 }),
    useVersions: () => q([]),
    useUsage: () => q([{ deliverableId: 'd5', campaignName: 'LUMA Season 2', pieceName: 'Post 5' }]),
    useRecentlyDeleted: () => q([]),
    useLibrarySearch: () => q(state.search),
    useLibrarySearchCounts: () => q({ image: 1, document: 0, video: 0, link: 0, proof: 0, other: 0 }),
    useClientTree: () => q([]),
    useRename: () => ({ mutate: state.rename, isPending: false }),
    useMove: m, useMoveFolder: m, useRenameFolder: m, useMakeCurrent: m, useDeleteFile: m, useRestoreFile: m,
    useBringBack: m, useAddLink: m, useAddLinkVersion: m, useCreateLibraryFolder: m, useDeleteLibraryFolder: m, useCopyFile: m,
    fetchVersionDownloadUrl: vi.fn(async () => 'https://example.test/signed'),
    fetchPreviewUrl: vi.fn(async () => 'https://example.test/preview'),
    fetchThumbUrl: vi.fn(async () => null),
  }
})
vi.mock('../../lib/assets/uploads', () => ({ startUploads: vi.fn() }))
vi.mock('../../lib/assets/folders', () => ({
  folderKeys: { all: ['asset-folders'] },
  isDuplicateFolderName: (e: unknown) => (e as { code?: string } | null)?.code === '23505',
}))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ claims: { tenantId: 't1' } }) }))

import { LibraryPage } from './LibraryPage'

const OVERVIEW: ClientOverview = {
  brands: [{ folderId: 'b-luma', name: 'Luma', fileCount: 22, subfolders: ['Logos', 'Key Visuals'] }],
  projects: [
    { folderId: 'p1', campaignId: 'k1', name: 'Borderless card', kind: 'single_job', brandName: 'Issuance', phaseCount: 0, fileCount: 3, deliveredCount: 0, inReview: false, status: 'approved', lookalike: { campaignId: 'k2', name: 'Borderless Card', folderId: 'p2' } },
  ],
  brandRootId: 'br', projectsRootId: 'pr', canChange: true,
}

const file = (over: Partial<LibraryFile>): LibraryFile => ({
  id: 'a1', name: 'LUMA_logo_primary.svg', contentType: 'image/svg+xml', sizeBytes: 48 * 1024, currentVersion: 3,
  uploadedBy: 'u1', uploadedByName: 'Fadia Wael Amin', createdAt: '2026-09-24T08:40:00Z', updatedAt: '2026-09-24T08:40:00Z',
  linkUrl: null, linkExpiresOn: null, thumbObjectKey: null, durationSeconds: null, isSource: false, isProof: false,
  archivedAt: null, canDelete: true, ...over,
})

const LOGOS = (canChange: boolean): FolderScreen => ({
  folder: { id: 'f-logos', name: 'Logos', kind: 'asset_type', isSystem: true, clientId: 'c1', campaignId: null, brandId: 'b1', deliverableId: null, createdBy: null },
  chain: [{ id: 'root', name: 'Kite', kind: 'client_root' }, { id: 'br', name: 'Brand Assets', kind: 'brand_root' }, { id: 'b-luma', name: 'Luma', kind: 'brand' }, { id: 'f-logos', name: 'Logos', kind: 'asset_type' }],
  subfolders: [],
  files: [
    file({}),
    file({ id: 'a2', name: 'Qi_QR_Concept.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', currentVersion: 1, canDelete: false }),
  ],
  canChange, canDeleteFolder: false, campaign: null,
})

function Where() {
  const l = useLocation()
  return <span data-testid="where">{l.search}</span>
}
const renderAt = (url: string) =>
  render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/library" element={<><LibraryPage /><Where /></>} /></Routes></MemoryRouter>)

describe('LibraryPage (ADR-0134, Figma K)', () => {
  beforeEach(() => {
    state.overview = OVERVIEW
    state.folder = LOGOS(true)
    state.search = []
    state.rename.mockReset()
  })

  it('LB-01: lists every client, the brand folders and the projects, and offers no upload at the top', () => {
    renderAt('/library?client=c1')
    expect(screen.getByTestId('library-client-c1')).toHaveTextContent('Kite')
    expect(screen.getByTestId('library-client-c2')).toHaveTextContent('Harmony')
    expect(screen.getByTestId('library-brand-b-luma')).toHaveTextContent('Luma')
    expect(screen.getByTestId('library-brand-b-luma')).toHaveTextContent('Logos, Key visuals')
    expect(screen.queryByTestId('library-upload')).not.toBeInTheDocument()
    expect(screen.queryByTestId('library-new-folder')).not.toBeInTheDocument()
  })

  it('LB-01: a look-alike job is flagged and links to the other job (d.21)', () => {
    renderAt('/library?client=c1')
    expect(screen.getByTestId('library-project-p1')).toHaveTextContent('looks like the same job')
    expect(screen.getByTestId('library-lookalike-p1')).toHaveAttribute('href', '/campaigns/k2')
  })

  it('LB-04: the kind is written in words, never the raw type (d.4)', () => {
    renderAt('/library?client=c1&folder=f-logos')
    const docRow = screen.getByTestId('asset-a2')
    expect(docRow).toHaveTextContent('Word document')
    expect(docRow).not.toHaveTextContent('openxmlformats')
    expect(screen.getByTestId('asset-a1')).toHaveTextContent('SVG image')
  })

  it('LB-04: the file menu offers change actions only with change rights, and Delete only where allowed', () => {
    renderAt('/library?client=c1&folder=f-logos')
    fireEvent.click(screen.getByTestId('asset-menu-a1'))
    for (const id of ['preview', 'download', 'new-version', 'versions', 'rename', 'move', 'copy', 'copy-link', 'delete']) {
      expect(screen.getByTestId(`file-${id}-a1`)).toBeInTheDocument()
    }
    fireEvent.click(screen.getByTestId('asset-menu-a2'))
    expect(screen.queryByTestId('file-delete-a2')).not.toBeInTheDocument()
  })

  it('LB-04: a reader without change rights gets Preview, Download, history and Copy link only', () => {
    state.folder = LOGOS(false)
    renderAt('/library?client=c1&folder=f-logos')
    expect(screen.queryByTestId('library-upload')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('asset-menu-a2'))
    expect(screen.getByTestId('file-preview-a2')).toBeInTheDocument()
    expect(screen.queryByTestId('file-rename-a2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('file-move-a2')).not.toBeInTheDocument()
  })

  it('Rename edits the name only; the ending stays the file’s own (d.8)', () => {
    renderAt('/library?client=c1&folder=f-logos')
    fireEvent.click(screen.getByTestId('asset-menu-a1'))
    fireEvent.click(screen.getByTestId('file-rename-a1'))
    const input = screen.getByTestId('library-rename-input')
    expect(input).toHaveValue('LUMA_logo_primary')
    expect(within(screen.getByTestId('library-rename')).getByText('.svg')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'LUMA_logo_main' } })
    fireEvent.click(screen.getByTestId('library-rename-save'))
    expect(state.rename).toHaveBeenCalledWith({ p_asset: 'a1', p_base: 'LUMA_logo_main' }, expect.anything())
  })

  it('Preview on a file the browser cannot show names it, says its kind and offers Download (d.6)', () => {
    renderAt('/library?client=c1&folder=f-logos')
    fireEvent.click(screen.getByTestId('asset-menu-a2'))
    fireEvent.click(screen.getByTestId('file-preview-a2'))
    const none = screen.getByTestId('library-preview-none')
    expect(none).toHaveTextContent('Qi_QR_Concept.docx')
    expect(none).toHaveTextContent('Word document')
    expect(screen.getByTestId('library-preview-download')).toBeInTheDocument()
  })

  it('Delete warns when work uses the file, and says it can come back for 30 days (d.9–10)', () => {
    renderAt('/library?client=c1&folder=f-logos')
    fireEvent.click(screen.getByTestId('asset-menu-a1'))
    fireEvent.click(screen.getByTestId('file-delete-a1'))
    expect(screen.getByTestId('library-delete-usage')).toHaveTextContent('Post 5')
    expect(screen.getByTestId('library-delete')).toHaveTextContent('30 days')
  })

  it('LB-08: a search result shows where it lives and opens its folder with the file picked out (d.27)', () => {
    state.search = [{ id: 'a9', name: 'IT_Directory_logo_v2.png', folderId: 'f9', clientId: 'c1', clientName: 'Kite', path: 'Kite / Projects / IT Directory - Logo / Final assets', contentType: 'image/png', linkUrl: null, sizeBytes: 310 * 1024, updatedAt: '2026-09-27T08:00:00Z', kindBucket: 'image' }]
    renderAt('/library?mode=search&q=logo')
    expect(screen.getByTestId('search-hit-a9')).toHaveTextContent('Kite / Projects / IT Directory - Logo / Final assets')
    fireEvent.click(screen.getByTestId('search-hit-a9'))
    expect(screen.getByTestId('where')).toHaveTextContent('client=c1&folder=f9&file=a9')
  })

  it('search asks for two letters first', () => {
    renderAt('/library?mode=search')
    expect(screen.getByTestId('library-search-hint')).toBeInTheDocument()
  })
})
