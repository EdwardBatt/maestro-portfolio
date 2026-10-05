import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_FILE_BYTES } from './kind'
import { MULTIPART_THRESHOLD, PART_SIZE, resumeKey, writeResume } from './multipart'
import {
  __resetUploads,
  type NewAsset,
  __setUploadTransport,
  changeFolder,
  closeUploadBox,
  getUploadsSnapshot,
  keepBothName,
  nextFreeName,
  resolveClash,
  startUploads,
  type UploadItem,
  type UploadTransport,
} from './uploads'

/** A File that claims any size without holding the bytes. */
function sized(name: string, size: number, type = ''): File {
  const f = new File(['x'], name, { type, lastModified: 7 })
  Object.defineProperty(f, 'size', { value: size })
  Object.defineProperty(f, 'slice', { value: () => new Blob(['x']) })
  return f
}

/** Names already in the folder → their current version. */
let existing: Map<string, number>
let calls: { invoke: Record<string, unknown>[]; rpc: [string, Record<string, unknown>][]; assets: NewAsset[]; puts: string[] }

function fakeTransport(over: Partial<UploadTransport> = {}): Partial<UploadTransport> {
  return {
    invoke: async (body) => {
      calls.invoke.push(body)
      switch (body.op) {
        case 'upload': return { uploadUrl: 'https://b2/put', objectKey: `k/${String(body.fileName)}`, provider: 'b2' }
        case 'multipart_create': return { uploadId: 'UP', objectKey: 'k/big' }
        case 'multipart_sign': return { urls: (body.partNumbers as number[]).map((n) => ({ partNumber: n, url: `https://b2/part/${n}` })) }
        default: return {}
      }
    },
    rpc: async (fn, args) => {
      calls.rpc.push([fn, args])
      if (fn === 'library_find_by_name') {
        const v = existing.get(String(args.p_name))
        return v ? [{ id: `asset-${String(args.p_name)}`, current_version: v }] : []
      }
      return 4
    },
    insertAsset: async (row) => { calls.assets.push(row); return 'new-asset' },
    insertVersion: async () => undefined,
    who: async () => ({ userId: 'me', tenantId: 't1' }),
    put: async (url) => { calls.puts.push(url); return `"etag-${url.split('/').pop()}"` },
    thumbnail: async () => null,
    duration: async () => null,
    ...over,
  }
}

const items = () => getUploadsSnapshot().items
const item = (name: string): UploadItem => items().find((i) => i.file.name === name)!
const until = (fn: () => boolean) => vi.waitFor(() => { if (!fn()) throw new Error('not yet') }, { timeout: 2000, interval: 5 })

const base = { folderId: 'fold-1', folderPath: 'Kite / Brand assets / Luma / Logos', clientId: 'client-1' }

beforeEach(() => {
  existing = new Map()
  calls = { invoke: [], rpc: [], assets: [], puts: [] }
  __setUploadTransport(fakeTransport())
})
afterEach(() => {
  __resetUploads()
  __setUploadTransport(null)
  localStorage.clear()
})

describe('the 5 GB limit (ADR-0134 d.11–12)', () => {
  it('a file over 5 GB is refused in the box and never sent', async () => {
    startUploads({ ...base, files: [sized('LUMA_launch_film_master.mov', MAX_FILE_BYTES + 1)] })
    const it = item('LUMA_launch_film_master.mov')
    expect(it.status).toBe('refused')
    expect(it.error).toBe('tooBig')
    expect(getUploadsSnapshot().boxOpen).toBe(true)
    await new Promise((r) => setTimeout(r, 10))
    expect(calls.invoke).toEqual([])
  })

  it('exactly 5 GB is allowed', () => {
    startUploads({ ...base, files: [sized('edge.mov', MAX_FILE_BYTES)] })
    expect(item('edge.mov').status).not.toBe('refused')
  })
})

describe('a name already in the folder asks each time (d.12)', () => {
  it('no clash → uploads as a new file at v1', async () => {
    startUploads({ ...base, files: [sized('new.png', 100, 'image/png')] })
    await until(() => item('new.png')?.status === 'done')
    expect(calls.assets[0]).toMatchObject({ name: 'new.png', folderId: 'fold-1', tenantId: 't1', uploadedBy: 'me', isSource: false })
    expect(calls.rpc.some(([fn]) => fn === 'library_add_version')).toBe(false)
  })

  it('a clash waits for the answer and sends nothing until then', async () => {
    existing.set('LUMA_logo_primary.svg', 3)
    startUploads({ ...base, files: [sized('LUMA_logo_primary.svg', 100)] })
    await until(() => item('LUMA_logo_primary.svg').status === 'clash')
    expect(item('LUMA_logo_primary.svg').clash).toEqual({ assetId: 'asset-LUMA_logo_primary.svg', currentVersion: 3 })
    expect(calls.invoke).toEqual([])
  })

  it('"Make it v4" sends the bytes, then records the next version of the same file', async () => {
    existing.set('LUMA_logo_primary.svg', 3)
    startUploads({ ...base, files: [sized('LUMA_logo_primary.svg', 100, 'image/svg+xml')] })
    await until(() => item('LUMA_logo_primary.svg').status === 'clash')
    const id = item('LUMA_logo_primary.svg').id
    await resolveClash(id, 'version')
    await until(() => item('LUMA_logo_primary.svg').status === 'done')
    const add = calls.rpc.find(([fn]) => fn === 'library_add_version')
    expect(add?.[1]).toMatchObject({ p_asset: 'asset-LUMA_logo_primary.svg', p_object_key: 'k/LUMA_logo_primary.svg', p_content_type: 'image/svg+xml', p_size: 100 })
    expect(calls.assets).toEqual([])
    expect(item('LUMA_logo_primary.svg').asVersionOf).toEqual({ assetId: 'asset-LUMA_logo_primary.svg', version: 4 })
  })

  it('"Keep both" saves it under the next free number', async () => {
    existing.set('logo.svg', 1)
    existing.set('logo (2).svg', 1)
    startUploads({ ...base, files: [sized('logo.svg', 100)] })
    await until(() => item('logo.svg').status === 'clash')
    await resolveClash(item('logo.svg').id, 'keep')
    await until(() => item('logo.svg').status === 'done')
    expect(calls.assets[0]).toMatchObject({ name: 'logo (3).svg' })
  })
})

describe('keep-both naming', () => {
  it('puts the number before the extension', () => {
    expect(keepBothName('LUMA_logo_primary.svg', 2)).toBe('LUMA_logo_primary (2).svg')
    expect(keepBothName('README', 2)).toBe('README (2)')
    expect(keepBothName('archive.tar.gz', 2)).toBe('archive.tar (2).gz')
    expect(keepBothName('.env', 2)).toBe('.env (2)')
  })

  it('renumbers a name that already carries one rather than stacking', async () => {
    expect(keepBothName('logo (2).svg', 3)).toBe('logo (3).svg')
    expect(await nextFreeName('logo (2).svg', async () => false)).toBe('logo (3).svg')
  })

  it('takes the first free number', async () => {
    const taken = new Set(['a (2).png', 'a (3).png'])
    expect(await nextFreeName('a.png', async (c) => taken.has(c))).toBe('a (4).png')
  })
})

describe('Upload a new version from the file menu (d.7)', () => {
  it('takes one file, asks nothing, keeps the asset name, and records the next version', async () => {
    startUploads({ ...base, files: [sized('other-name.png', 50, 'image/png'), sized('ignored.png', 1)], versionOf: { assetId: 'A1', name: 'Logo.png', currentVersion: 2 } })
    expect(items()).toHaveLength(1)
    await until(() => items()[0]?.status === 'done')
    expect(items()[0]!.saveAs).toBe('Logo.png')
    expect(calls.rpc.some(([fn]) => fn === 'library_find_by_name')).toBe(false)
    expect(calls.rpc.find(([fn]) => fn === 'library_add_version')?.[1]).toMatchObject({ p_asset: 'A1', p_size: 50 })
  })
})

describe('working files (d.24)', () => {
  it('are marked SOURCE', async () => {
    startUploads({ ...base, files: [sized('kv.psd', 100)], isSource: true })
    await until(() => item('kv.psd').status === 'done')
    expect(calls.assets[0]).toMatchObject({ isSource: true })
  })
})

describe('resume (d.13)', () => {
  it('a file picked again within 24 hours carries on from the parts already sent', async () => {
    const size = PART_SIZE * 3 + 5 // 4 parts, over the multipart threshold
    expect(size).toBeGreaterThan(MULTIPART_THRESHOLD)
    const file = sized('master.mov', size, 'video/quicktime')
    writeResume(resumeKey(base.folderId, file), {
      uploadId: 'OLD', objectKey: 'k/old', startedAt: Date.now() - 60_000,
      parts: [{ partNumber: 1, etag: '"e1"' }, { partNumber: 2, etag: '"e2"' }],
    })
    startUploads({ ...base, files: [file] })
    await until(() => item('master.mov')?.status === 'done')
    expect(calls.invoke.some((b) => b.op === 'multipart_create')).toBe(false)
    expect(calls.puts.sort()).toEqual(['https://b2/part/3', 'https://b2/part/4'])
    const complete = calls.invoke.find((b) => b.op === 'multipart_complete')
    expect(complete).toMatchObject({ uploadId: 'OLD', objectKey: 'k/old' })
    expect((complete!.parts as { partNumber: number }[]).map((p) => p.partNumber)).toEqual([1, 2, 3, 4])
    expect(item('master.mov').resumed).toBe(true)
    expect(localStorage.getItem(resumeKey(base.folderId, file))).toBeNull()
  })

  it('a record older than 24 hours is ignored and the upload starts afresh', async () => {
    const file = sized('master.mov', PART_SIZE * 3, 'video/quicktime')
    writeResume(resumeKey(base.folderId, file), {
      uploadId: 'OLD', objectKey: 'k/old', startedAt: Date.now() - 25 * 3600_000, parts: [{ partNumber: 1, etag: '"e1"' }],
    })
    startUploads({ ...base, files: [file] })
    await until(() => item('master.mov')?.status === 'done')
    expect(calls.invoke.some((b) => b.op === 'multipart_create')).toBe(true)
    expect(calls.puts).toHaveLength(3)
  })
})

describe('the box', () => {
  it('closing keeps what is unanswered and drops what is finished', async () => {
    existing.set('b.png', 1)
    startUploads({ ...base, files: [sized('a.png', 10), sized('b.png', 10), sized('c.mov', MAX_FILE_BYTES + 1)] })
    await until(() => item('a.png').status === 'done' && item('b.png').status === 'clash')
    closeUploadBox()
    expect(getUploadsSnapshot().boxOpen).toBe(false)
    expect(items().map((i) => i.file.name)).toEqual(['b.png'])
  })

  it('a failed thumbnail never fails the upload', async () => {
    __setUploadTransport(fakeTransport({ thumbnail: async () => { throw new Error('canvas') } }))
    startUploads({ ...base, files: [sized('p.png', 10, 'image/png')] })
    await until(() => item('p.png').status === 'done')
  })
})

describe('Change — files not yet sending go to another folder (Figma LB-05, ADR-0134 d.12)', () => {
  it('moves a clash and a queued file, asks the clash afresh in the new folder, and leaves a refused file alone', async () => {
    // Hold every send, so nothing has started when Change is pressed.
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    __setUploadTransport(fakeTransport({ put: async (url) => { await held; calls.puts.push(url); return '"e"' } }))
    existing.set('logo.svg', 3)
    startUploads({ ...base, files: [sized('logo.svg', 10), sized('huge.mov', MAX_FILE_BYTES + 1)] })
    await until(() => item('logo.svg').status === 'clash')

    existing.delete('logo.svg') // the new folder has no logo.svg
    changeFolder('fold-2', 'Kite / Brand assets / Luma / Key visuals')
    expect(item('logo.svg').folderId).toBe('fold-2')
    expect(item('huge.mov').folderId).toBe('fold-1') // refused: it was never going anywhere
    expect(getUploadsSnapshot().target?.folderPath).toBe('Kite / Brand assets / Luma / Key visuals')
    // The new folder has no logo.svg: it is no longer a clash, it goes in as a new file.
    await until(() => item('logo.svg').status !== 'checking')
    expect(item('logo.svg').status).not.toBe('clash')
    const asked = calls.rpc.filter(([fn]) => fn === 'library_find_by_name').map(([, a]) => a.p_folder)
    expect(asked).toEqual(['fold-1', 'fold-2'])
    release()
  })

  it('a file already sending stays in the first folder', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    __setUploadTransport(fakeTransport({ put: async (url, _f, _t, onProgress) => { onProgress?.(5); await held; calls.puts.push(url); return '"e"' } }))
    startUploads({ ...base, files: [sized('a.png', 10)] })
    await until(() => item('a.png').sent > 0)
    changeFolder('fold-2', 'Kite / elsewhere')
    expect(item('a.png').folderId).toBe('fold-1')
    release()
  })
})

