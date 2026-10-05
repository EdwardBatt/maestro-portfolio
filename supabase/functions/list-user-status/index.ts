// list-user-status — returns each tenant user's ACTIVATION state (have they
// signed in / responded to their invite yet) from auth.users, which the browser
// cannot read. Read-only; gated on the caller's `admin.users:view` grant and
// scoped to the CALLER's tenant. Used by the Users screen to show Invited vs
// Activated during the pilot. Deploy: `supabase functions deploy list-user-status`.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { hasPermission } from '../_shared/authz.ts'
import { guarded } from '../_shared/http.ts'
import { allRowsResult } from '../_shared/all-pages.ts'

type ErrorBody = { error: { code: string; message: string } }
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const err = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message } } satisfies ErrorBody), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  })

Deno.serve(guarded(corsHeaders, async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return err(405, 'method_not_allowed', 'POST only')

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // 1. Authenticate the caller.
  const authHeader = req.headers.get('authorization') ?? ''
  const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: callerData, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerData.user) return err(401, 'unauthenticated', 'Sign in required')

  // 2. Authorize by GRANT (admin.users:view — same gate as the Users screen);
  //    tenant comes from the caller's claims, never the request.
  const meta = (callerData.user.app_metadata ?? {}) as Record<string, unknown>
  const callerTenant = typeof meta.tenant_id === 'string' ? meta.tenant_id : null
  const callerRoleId = typeof meta.app_role_id === 'string' ? meta.app_role_id : null
  if (!callerTenant || !callerRoleId) return err(403, 'forbidden', 'No role claim')

  const admin = createClient(url, serviceKey)
  // ADR-0037: THE primitive, on the CALLER-scoped client (never the service-role one).
  if (!(await hasPermission(callerClient, 'admin.users', 'view'))) {
    return err(403, 'forbidden', 'admin.users:view grant required')
  }

  // 3. The caller's tenant users (service role) — the only ids we expose.
  //    I59.39: paged — past 1,000 people PostgREST cuts the list silently, and everyone after the
  //    cut would show as never activated.
  const { data: profiles, error: profErr } = await allRowsResult<{ id: string }>((from, to) => admin
    .from('user_profiles')
    .select('id')
    .eq('tenant_id', callerTenant)
    .order('id')
    .range(from, to))
  if (profErr) return err(500, 'query_failed', 'Could not read tenant users')
  const tenantIds = new Set((profiles ?? []).map((p: { id: string }) => p.id))

  // 4. Read auth activation state and keep only this tenant's users.
  //    activated = has signed in at least once (completed the invite/set-password
  //    flow, ADR-0012). last_sign_in_at doubles as a "last active" signal.
  const statuses: Record<string, { lastSignInAt: string | null; activated: boolean }> = {}
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) return err(500, 'list_failed', 'Could not read activation status')
    for (const u of data.users) {
      if (!tenantIds.has(u.id)) continue
      const last = u.last_sign_in_at ?? null
      statuses[u.id] = { lastSignInAt: last, activated: last != null }
    }
    if (data.users.length < 1000) break
  }

  return new Response(JSON.stringify({ statuses }), {
    status: 200,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  })
}))
