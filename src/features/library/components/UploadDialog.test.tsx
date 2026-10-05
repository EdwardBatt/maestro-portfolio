import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../../lib/i18n'
import { MAX_FILE_BYTES } from '../../../lib/assets/kind'
import { __resetUploads, __setUploadTransport, getUploadsSnapshot, startUploads } from '../../../lib/assets/uploads'
import { UploadDialog } from './UploadDialog'

function sized(name: string, size: number): File {
  const f = new File(['x'], name)
  Object.defineProperty(f, 'size', { value: size })
  return f
}

const addVersion = vi.fn()

beforeEach(() => {
  addVersion.mockReset()
  __setUploadTransport({
    invoke: async () => ({ uploadUrl: 'https://b2/put', objectKey: 'k/x', provider: 'b2' }),
    rpc: async (fn, args) => {
      if (fn === 'library_find_by_name') return args.p_name === 'LUMA_logo_primary.svg' ? [{ id: 'A', current_version: 3 }] : []
      if (fn === 'library_add_version') addVersion(args)
      return 4
    },
    insertAsset: async () => 'new',
    insertVersion: async () => undefined,
    who: async () => ({ userId: 'me', tenantId: 't' }),
    put: async () => null,
    thumbnail: async () => null,
    duration: async () => null,
  })
})
afterEach(() => {
  act(() => __resetUploads())
  __setUploadTransport(null)
})

describe('UploadDialog (LB-05)', () => {
  it('shows the folder, a name clash with its two answers, a done file and a refused one', async () => {
    render(<UploadDialog />)
    act(() =>
      startUploads({
        folderId: 'f',
        folderPath: 'Kite / Brand assets / Luma / Logos',
        clientId: 'c',
        files: [sized('LUMA_logo_primary.svg', 2000), sized('LUMA_social_avatar.png', 180 * 1024), sized('LUMA_launch_film_master.mov', MAX_FILE_BYTES + 1)],
      }),
    )
    expect(screen.getByText('Kite / Brand assets / Luma / Logos')).toBeInTheDocument()
    // Change is offered while a file has not started; its picker is walked in e2e/local/coverage/library.spec.ts.
    expect(screen.getByTestId('upload-box-change')).toBeInTheDocument()

    const [clash, avatar, film] = getUploadsSnapshot().items
    expect(screen.getByTestId(`upload-row-${film!.id}-line`)).toHaveTextContent('too big. 5 GB is the most one file can be. Share a link instead.')

    await waitFor(() => expect(screen.getByTestId(`upload-row-${clash!.id}-line`)).toHaveTextContent('A file with this name is already here — it is on v3.'))
    expect(screen.getByTestId(`upload-row-${clash!.id}-keep-both`)).toHaveTextContent('Keep both — save as a new file')
    await waitFor(() => expect(screen.getByTestId(`upload-row-${avatar!.id}-done`)).toBeInTheDocument())
    // The size is bidi-isolated (U+2068 … U+2069) so it reads as one unit in Arabic.
    const line = screen.getByTestId(`upload-row-${avatar!.id}-line`).textContent ?? ''
    expect(line.replace(/[⁨⁩]/g, '')).toBe('180 KB · uploaded')
    expect(line.startsWith(String.fromCharCode(0x2068))).toBe(true)

    fireEvent.click(screen.getByTestId(`upload-row-${clash!.id}-make-version`))
    await waitFor(() => expect(addVersion).toHaveBeenCalledWith(expect.objectContaining({ p_asset: 'A' })))

    fireEvent.click(screen.getByTestId(`upload-row-${film!.id}-remove`))
    expect(screen.queryByTestId(`upload-row-${film!.id}`)).toBeNull()

    fireEvent.click(screen.getByTestId('upload-box-done'))
    expect(screen.queryByTestId('upload-box')).toBeNull()
  })
})
