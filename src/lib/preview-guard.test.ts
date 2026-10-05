import { beforeEach, describe, expect, it } from 'vitest'
import { isBlockedWrite, previewGuard } from './preview-guard'

describe('preview-guard — blocks writes only while previewing', () => {
  beforeEach(() => {
    previewGuard.blocked = false
  })

  it('allows everything when no preview is active', () => {
    expect(isBlockedWrite('https://x.supabase.co/rest/v1/bookings', 'POST')).toBe(false)
    expect(isBlockedWrite('https://x.supabase.co/functions/v1/update-user', 'POST')).toBe(false)
  })

  it('blocks data and edge-function writes while previewing', () => {
    previewGuard.blocked = true
    expect(isBlockedWrite('https://x.supabase.co/rest/v1/bookings', 'POST')).toBe(true)
    expect(isBlockedWrite('https://x.supabase.co/rest/v1/user_profiles?id=eq.1', 'PATCH')).toBe(true)
    expect(isBlockedWrite('https://x.supabase.co/rest/v1/resources?id=eq.1', 'DELETE')).toBe(true)
    expect(isBlockedWrite('https://x.supabase.co/functions/v1/invite-user', 'POST')).toBe(true)
  })

  it('never blocks reads or auth, even while previewing', () => {
    previewGuard.blocked = true
    expect(isBlockedWrite('https://x.supabase.co/rest/v1/bookings?select=*', 'GET')).toBe(false)
    expect(isBlockedWrite('https://x.supabase.co/auth/v1/token?grant_type=refresh_token', 'POST')).toBe(false)
    expect(isBlockedWrite('https://x.supabase.co/auth/v1/logout', 'POST')).toBe(false)
  })
})

describe('preview-guard — POST is classified by what is being called', () => {
  beforeEach(() => {
    previewGuard.blocked = true
  })

  // The bug: PostgREST tunnels rpc() through POST, so blocking on the verb alone also
  // blocked the permission fetch — which left defaultRoute at '/login' and bounced a
  // signed-in Power Admin to the login form the moment they switched previewed roles.
  it('lets the read-only RPCs through so permissions can still load', () => {
    const rpc = (name: string) => `https://x.supabase.co/rest/v1/rpc/${name}`
    expect(isBlockedWrite(rpc('my_permissions'), 'POST')).toBe(false)
    expect(isBlockedWrite(rpc('my_scope_grants'), 'POST')).toBe(false)
    expect(isBlockedWrite(rpc('users_holding_permission'), 'POST')).toBe(false)
    expect(isBlockedWrite(rpc('kpi_rollup'), 'POST')).toBe(false)
    expect(isBlockedWrite(rpc('attendance_deviation'), 'POST')).toBe(false)
    expect(isBlockedWrite(rpc('effective_sla') + '?select=*', 'POST')).toBe(false)
  })

  it('still blocks the RPCs that mutate', () => {
    const rpc = (name: string) => `https://x.supabase.co/rest/v1/rpc/${name}`
    expect(isBlockedWrite(rpc('sub_task_approve'), 'POST')).toBe(true)
    expect(isBlockedWrite(rpc('update_task_assignment'), 'POST')).toBe(true)
    expect(isBlockedWrite(rpc('create_adhoc_deliverable'), 'POST')).toBe(true)
    expect(isBlockedWrite(rpc('attendance_heartbeat'), 'POST')).toBe(true)
  })

  it('blocks an unknown RPC — the list is an allowlist, not a denylist', () => {
    expect(isBlockedWrite('https://x.supabase.co/rest/v1/rpc/something_new', 'POST')).toBe(true)
  })

  it('lets the signing functions mint VIEW urls, so media still renders', () => {
    const sign = (fn: string, op: string) => isBlockedWrite(`https://x.supabase.co/functions/v1/${fn}`, 'POST', JSON.stringify({ op }))
    expect(sign('asset-url', 'download')).toBe(false)
    expect(sign('review-media', 'view')).toBe(false)
    expect(sign('asset-url', 'upload')).toBe(true)
    expect(sign('review-media', 'upload')).toBe(true)
  })

  it('blocks a signing call whose op cannot be read', () => {
    const url = 'https://x.supabase.co/functions/v1/asset-url'
    expect(isBlockedWrite(url, 'POST')).toBe(true)
    expect(isBlockedWrite(url, 'POST', 'not json')).toBe(true)
    expect(isBlockedWrite(url, 'POST', new Blob(['{"op":"download"}']))).toBe(true)
  })
})
