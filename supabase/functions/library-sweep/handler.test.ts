// ADR-0134 d.9, d.13, d.18 (I72) — the Library sweep's door and its order of operations.
import { describe, expect, it, vi } from 'vitest'
import { createLibrarySweepHandler, type LibrarySweepDeps } from './handler.ts'

function deps(over: Partial<LibrarySweepDeps> = {}): LibrarySweepDeps {
  return {
    cronSecret: 's3cret',
    linkNotices: vi.fn(async () => ({ data: [{ asset_id: 'a1', user_id: 'u1', name: 'Masters', expires_on: '2026-10-03' }], error: null })),
    purgeDue: vi.fn(async () => ({
      data: [
        { asset_id: 'p1', tenant_id: 't', object_keys: ['k1', 'k1.thumb.webp'] },
        { asset_id: 'p2', tenant_id: 't', object_keys: ['k2'] },
      ],
      error: null,
    })),
    purgeConfirm: vi.fn(async () => true),
    storage: {
      deleteObject: vi.fn(async (key: string) => key !== 'k2'),
      listUploads: vi.fn(async () => [
        { key: 'old', uploadId: 'u-old', initiated: '2026-09-29T00:00:00Z' },
        { key: 'new', uploadId: 'u-new', initiated: '2026-10-01T08:00:00Z' },
      ]),
      abortUpload: vi.fn(async () => true),
    },
    now: () => new Date('2026-10-01T09:00:00Z'),
    ...over,
  }
}
const post = (body: unknown, secret = 's3cret') =>
  new Request('https://f.test', { method: 'POST', headers: { 'x-cron-secret': secret }, body: JSON.stringify(body) })

describe('library-sweep handler', () => {
  it('refuses anything but POST, and a wrong or missing secret, and runs nothing', async () => {
    const d = deps()
    expect((await createLibrarySweepHandler(d)(new Request('https://f.test'))).status).toBe(405)
    expect((await createLibrarySweepHandler(d)(post({}, 'nope'))).status).toBe(401)
    expect((await createLibrarySweepHandler(deps({ cronSecret: undefined }))(post({}))).status).toBe(401)
    expect(d.linkNotices).not.toHaveBeenCalled()
    expect(d.purgeDue).not.toHaveBeenCalled()
  })

  it('refuses a malformed body', async () => {
    expect((await createLibrarySweepHandler(deps())(post({ dryRun: 'yes' }))).status).toBe(400)
  })

  it('a dry run lists and changes nothing', async () => {
    const d = deps()
    const res = await createLibrarySweepHandler(d)(post({ dryRun: true }))
    const body = await res.json()
    expect(d.linkNotices).toHaveBeenCalledWith(true)
    expect(d.storage!.deleteObject).not.toHaveBeenCalled()
    expect(d.purgeConfirm).not.toHaveBeenCalled()
    expect(d.storage!.abortUpload).not.toHaveBeenCalled()
    expect(body.purge.assets).toEqual(['p1', 'p2'])
    expect(body.uploads.stale).toBe(1)
  })

  it('drops a row only once every object it names is gone from storage', async () => {
    const d = deps()
    const body = await (await createLibrarySweepHandler(d)(post({}))).json()
    expect(d.storage!.deleteObject).toHaveBeenCalledWith('k1')
    expect(d.storage!.deleteObject).toHaveBeenCalledWith('k1.thumb.webp')
    expect(d.purgeConfirm).toHaveBeenCalledWith('p1')
    expect(d.purgeConfirm).not.toHaveBeenCalledWith('p2')   // k2 could not be deleted: retried next run
    expect(body.purge).toMatchObject({ due: 2, purged: 1, errors: 1 })
  })

  it('aborts uploads begun more than 24 hours ago, and only those', async () => {
    const d = deps()
    const body = await (await createLibrarySweepHandler(d)(post({}))).json()
    expect(d.storage!.abortUpload).toHaveBeenCalledTimes(1)
    expect(d.storage!.abortUpload).toHaveBeenCalledWith('old', 'u-old')
    expect(body.uploads).toMatchObject({ stale: 1, aborted: 1 })
  })

  it('without storage it removes nothing, says so, and still sends the link notices', async () => {
    const d = deps({ storage: null })
    const body = await (await createLibrarySweepHandler(d)(post({}))).json()
    expect(d.purgeConfirm).not.toHaveBeenCalled()
    expect(body.purge.skipped).toBe('storage_unconfigured')
    expect(body.uploads.skipped).toBe('storage_unconfigured')
    expect(body.linkNotices.sent).toBe(1)
  })
})
