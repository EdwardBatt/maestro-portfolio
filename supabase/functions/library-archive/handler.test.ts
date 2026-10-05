// @vitest-environment node
// ADR-0136 (I72) — the office archive job: switched off until it exists; nothing removed online unconfirmed.
import { describe, expect, it, vi } from 'vitest'
import { createLibraryArchiveHandler, sendConfirmed, type LibraryArchiveDeps } from './handler.ts'
import { createOfficeTransport, officeConfigured, officeRef, type OfficeTransport } from './transport.ts'

const stream = (s: string) => new Blob([s]).stream() as ReadableStream<Uint8Array>
const ITEM = {
  item_type: 'asset_version' as const, item_id: 'v1', asset_id: 'a1', version: 1,
  object_key: 't1/c/f/k1', size_bytes: 5, campaign_id: 'c1',
}

function transport(over: Partial<OfficeTransport> = {}): OfficeTransport {
  return {
    put: vi.fn(async (_r: string, body: ReadableStream<Uint8Array>) => { await new Response(body).arrayBuffer() }),
    stat: vi.fn(async () => ({ size: 5, sha256: 'abc' })),
    get: vi.fn(async () => ({ body: stream('hello'), size: 5 })),
    ...over,
  }
}

function deps(over: Partial<LibraryArchiveDeps> = {}): LibraryArchiveDeps {
  return {
    cronSecret: 's3cret',
    configured: true,
    transport: transport(),
    tenants: vi.fn(async () => ['t1']),
    dueItems: vi.fn(async () => ({ data: [ITEM], error: null })),
    mark: vi.fn(async () => ({ removeOnline: true })),
    pending: vi.fn(async () => ({ data: [], error: null })),
    bringBackDone: vi.fn(async () => {}),
    expired: vi.fn(async () => ({ data: [], error: null })),
    clearBroughtBack: vi.fn(async () => {}),
    storage: {
      get: vi.fn(async () => ({ body: stream('hello'), size: 5 })),
      put: vi.fn(async () => true),
      remove: vi.fn(async () => true),
    },
    sha256: vi.fn(async (body: ReadableStream<Uint8Array>) => { await new Response(body).arrayBuffer(); return 'abc' }),
    ...over,
  }
}
const post = (body: unknown, secret = 's3cret') =>
  new Request('https://f.test', { method: 'POST', headers: { 'x-cron-secret': secret }, body: JSON.stringify(body) })

describe('library-archive — switched off (d.7)', () => {
  it('is off without the office address and credential, and touches nothing', async () => {
    const d = deps({ configured: false })
    const body = await (await createLibraryArchiveHandler(d)(post({}))).json()
    expect(body).toEqual({ disabled: true, reason: 'office_server_not_configured' })
    expect(d.tenants).not.toHaveBeenCalled()
    expect(d.storage!.remove).not.toHaveBeenCalled()
  })

  it('is off with the secrets but no adapter for the service — which is today', async () => {
    const office = { url: 'https://office.test', user: 'maestro', secret: 'x', kind: 'webdav' }
    expect(officeConfigured(office)).toBe(true)
    expect(createOfficeTransport(office)).toBeNull()
    const body = await (await createLibraryArchiveHandler(deps({ transport: null }))(post({}))).json()
    expect(body).toEqual({ disabled: true, reason: 'no_transport_adapter' })
  })

  it('a dry run lists what is due even while off, and changes nothing', async () => {
    const d = deps({ configured: false })
    const body = await (await createLibraryArchiveHandler(d)(post({ dryRun: true }))).json()
    expect(body).toMatchObject({ dryRun: true, disabled: true, due: { t1: 1 } })
    expect(d.mark).not.toHaveBeenCalled()
  })

  it('refuses a wrong secret', async () => {
    expect((await createLibraryArchiveHandler(deps())(post({}, 'nope'))).status).toBe(401)
  })
})

describe('library-archive — nothing online is removed until the office confirms (d.3)', () => {
  it('confirms by the size and checksum the server reads back', async () => {
    expect(await sendConfirmed(deps(), 't1', ITEM)).toBe(officeRef('t1', ITEM.object_key))
    expect(await sendConfirmed(deps({ transport: transport({ stat: vi.fn(async () => ({ size: 5, sha256: 'other' })) }) }), 't1', ITEM)).toBeNull()
    expect(await sendConfirmed(deps({ transport: transport({ stat: vi.fn(async () => ({ size: 4, sha256: 'abc' })) }) }), 't1', ITEM)).toBeNull()
    expect(await sendConfirmed(deps({ transport: transport({ stat: vi.fn(async () => null) }) }), 't1', ITEM)).toBeNull()
  })

  it('an unconfirmed copy is neither marked nor removed', async () => {
    const d = deps({ transport: transport({ stat: vi.fn(async () => ({ size: 5, sha256: 'other' })) }) })
    const body = await (await createLibraryArchiveHandler(d)(post({}))).json()
    expect(d.mark).not.toHaveBeenCalled()
    expect(d.storage!.remove).not.toHaveBeenCalled()
    expect(body.sent).toMatchObject({ archived: 0, unconfirmed: 1 })
  })

  it('a confirmed copy is marked, and removed online only when the database says no kept row names it', async () => {
    const d = deps({ mark: vi.fn(async () => ({ removeOnline: false })) })
    await createLibraryArchiveHandler(d)(post({}))
    expect(d.mark).toHaveBeenCalledWith('asset_version', 'v1', 'maestro/t1/c/f/k1')
    expect(d.storage!.remove).not.toHaveBeenCalled()

    const d2 = deps()
    const body = await (await createLibraryArchiveHandler(d2)(post({}))).json()
    expect(d2.storage!.remove).toHaveBeenCalledWith('t1/c/f/k1')
    expect(body.sent).toMatchObject({ archived: 1, removedOnline: 1 })
  })
})

describe('library-archive — bring back (d.4)', () => {
  it('copies each archived version back and reports the request done; a failure is retried', async () => {
    const d = deps({
      dueItems: vi.fn(async () => ({ data: [], error: null })),
      pending: vi.fn(async () => ({
        data: [
          { request_id: 'r1', tenant_id: 't1', asset_id: 'a1', items: [{ object_key: 'k1', archive_ref: 'maestro/k1' }] },
          { request_id: 'r2', tenant_id: 't1', asset_id: 'a2', items: [{ object_key: 'k2', archive_ref: null }] },
        ],
        error: null,
      })),
    })
    const body = await (await createLibraryArchiveHandler(d)(post({}))).json()
    expect(d.storage!.put).toHaveBeenCalledWith('k1', expect.anything(), 5)
    expect(d.bringBackDone).toHaveBeenCalledWith('r1', true, undefined)
    expect(d.bringBackDone).toHaveBeenCalledWith('r2', false, expect.any(String))
    expect(body.broughtBack).toEqual({ restored: 1, failed: 1 })
  })

  it('after 30 days the online copy goes again, without sending anything', async () => {
    const d = deps({
      dueItems: vi.fn(async () => ({ data: [], error: null })),
      expired: vi.fn(async () => ({ data: [{ asset_id: 'a1', object_keys: ['k1'] }], error: null })),
    })
    await createLibraryArchiveHandler(d)(post({}))
    expect(d.storage!.remove).toHaveBeenCalledWith('k1')
    expect(d.clearBroughtBack).toHaveBeenCalledWith('a1')
    expect(d.transport!.put).not.toHaveBeenCalled()
  })
})
