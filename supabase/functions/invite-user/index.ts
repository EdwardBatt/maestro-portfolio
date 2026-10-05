// invite-user — provisioning on grants (M2.1/M2.2 → reworked for ADR-0008).
// Creates an auth user with app_metadata claims (tenant_id, app_role_id) — the
// values every RLS policy reads — plus the matching user_profiles row, and
// optionally links a human resource. Claims live in app_metadata because
// users cannot modify it; only this function and update-user write them.
// Authorization is the users:manage GRANT, never a role-name comparison.
//
// Service-role usage justification (maestro-edge-function skill): creating
// auth users and cross-checking the admin's tenant requires admin API access;
// the caller is independently authenticated and authorized below before the
// privileged client is used.

import { z } from 'npm:zod@4'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { hasPermission } from '../_shared/authz.ts'
import { guarded } from '../_shared/http.ts'

const Input = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(1).max(120),
  roleId: z.string().uuid(),               // a role row of the caller's tenant
  locale: z.enum(['en', 'ar']).default('en'),
  officeId: z.string().uuid().nullish(),
  departmentId: z.string().uuid().nullish(),
  teamId: z.string().uuid().nullish(),
  jobTitle: z.string().trim().max(120).nullish(),
  // ADR-0011: internal users are bookable resources by default. `asResource`
  // (default true) auto-creates a human resource with a fun, unique nickname;
  // `nickname` is the invitee's chosen/edited handle (server re-rolls on clash).
  asResource: z.boolean().default(true),
  nickname: z.string().trim().max(60).nullish(),
  resourceId: z.string().uuid().nullish(), // link an EXISTING resource instead (Resources-admin path)
})

// Fun MENA-flavoured nickname pools (ADR-0011). Canonical, signed-off list:
// docs/nickname-wordlists.md; mirror of src/lib/nickname/generate.ts (Deno
// functions are self-contained, so the pool is duplicated here). Keep in sync.
const NICK_ADJ = [
  'Turbo', 'Cosmic', 'Zen', 'Golden', 'Mighty', 'Sizzling', 'Dapper', 'Sunny',
  'Legendary', 'Radiant', 'Nimble', 'Bold', 'Cheeky', 'Mellow', 'Electric',
  'Swift', 'Stellar', 'Jolly', 'Snazzy', 'Breezy', 'Plucky', 'Dazzling',
  'Peppy', 'Gallant', 'Vivid', 'Lively', 'Groovy', 'Nifty', 'Epic', 'Smooth',
  'Blazing', 'Cool', 'Brave', 'Cosy',
]
const NICK_NOUN = [
  'Koshari', 'Molokhia', 'Basbousa', 'Karkade', 'Feteer', 'Mahshi', 'Guava', 'Mango',
  'Masgouf', 'Dolma', 'Kleicha', 'Kubba', 'Tashreeb', 'Geymar', 'Tamr',
  'Kunafa', 'Baklava', 'Falafel', 'Shawarma', 'Sahlab', 'Qahwa', 'Chai', 'Sugarcane',
  'Falcon', 'Lion', 'Gazelle', 'Palm', 'Nile', 'Cedar', 'Jasmine', 'Phoenix',
  'Comet', 'Oasis', 'Sun', 'Moon', 'Star',
  'Keyframe', 'Reel', 'Lens', 'Render', 'Storyboard', 'Pixel', 'Palette',
  'Canvas', 'Frame', 'Draft', 'Print',
]
const randomNickname = () =>
  `${NICK_ADJ[Math.floor(Math.random() * NICK_ADJ.length)]} ${NICK_NOUN[Math.floor(Math.random() * NICK_NOUN.length)]}`

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

  // 1. Authenticate the caller from their JWT.
  const authHeader = req.headers.get('authorization') ?? ''
  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: callerData, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerData.user) return err(401, 'unauthenticated', 'Sign in required')

  // 2. Authorize by GRANT (users:manage); tenant comes from the CALLER's
  //    claims — never from the request body (a caller can only invite into
  //    their own tenant).
  const meta = (callerData.user.app_metadata ?? {}) as Record<string, unknown>
  const callerTenant = typeof meta.tenant_id === 'string' ? meta.tenant_id : null
  const callerRoleId = typeof meta.app_role_id === 'string' ? meta.app_role_id : null
  if (!callerTenant || !callerRoleId) return err(403, 'forbidden', 'No role claim')

  const admin = createClient(url, serviceKey)
  // ADR-0037: THE primitive, on the CALLER-scoped client — a per-user allow counts and a per-user
  // deny bites, exactly as in RLS. The service-role client (no auth.uid()) is never the one asked.
  if (!(await hasPermission(callerClient, 'users', 'manage'))) {
    return err(403, 'forbidden', 'users:manage grant required')
  }

  // 3. Validate input, and resolve the role: it must be an active, assignable
  //    role of THIS tenant (portal accounts are provisioned by the M10 flow).
  let input: z.infer<typeof Input>
  try {
    input = Input.parse(await req.json())
  } catch {
    return err(400, 'invalid_input', 'Request body failed validation')
  }
  const { data: role } = await admin
    .from('roles')
    .select('id, key, status')
    .eq('id', input.roleId)
    .eq('tenant_id', callerTenant)
    .maybeSingle()
  if (!role || role.status !== 'active') return err(404, 'role_not_found', 'No such role in your tenant')
  if (role.key === 'client_portal') return err(400, 'role_not_assignable', 'Portal accounts are provisioned separately')

  // 4. Create the auth user AND send the invite email (L1.3 flow: the link
  //    lands on /set-password where the user chooses their password).
  //    SITE_URL is a function secret (dev: http://localhost:5173; prod set in
  //    L4); the redirect URL must be in Auth → URL Configuration → Redirect
  //    URLs. If unset, Supabase falls back to the project Site URL.
  const siteUrl = Deno.env.get('SITE_URL')
  const { data: created, error: createErr } = await admin.auth.admin.inviteUserByEmail(
    input.email,
    {
      data: { display_name: input.displayName },
      ...(siteUrl ? { redirectTo: `${siteUrl.replace(/\/$/, '')}/set-password` } : {}),
    },
  )
  if (createErr || !created.user) {
    console.error('invite-user: inviteUserByEmail failed', {
      email: input.email,
      status: (createErr as { status?: number } | null)?.status,
      message: createErr?.message,
    })
    const m = createErr?.message ?? ''
    const alreadyExists =
      (createErr as { status?: number } | null)?.status === 422 ||
      /already.*(registered|exists)|registered|duplicate/i.test(m)
    if (alreadyExists) {
      return err(409, 'email_exists', 'A user with this email address already exists.')
    }
    return err(400, 'create_failed', m || 'Could not create the user.')
  }

  // 4b. Claims are app_metadata — inviteUserByEmail cannot set them, so set
  //     immediately after creation (before the user can possibly sign in;
  //     they have no password yet).
  const { error: claimsErr } = await admin.auth.admin.updateUserById(created.user.id, {
    app_metadata: { tenant_id: callerTenant, app_role_id: input.roleId, department_id: input.departmentId ?? null, team_id: input.teamId ?? null },
  })
  if (claimsErr) {
    console.error('invite-user: setting app_metadata failed', { email: input.email, message: claimsErr.message })
    await admin.auth.admin.deleteUser(created.user.id) // never leave a claimless user
    return err(500, 'claims_failed', 'Could not set access claims; user rolled back')
  }

  // 5. Profile row (kept in sync with the claim at creation; role changes go
  //    through an admin function that updates BOTH — never one side).
  const { error: profileErr } = await admin.from('user_profiles').insert({
    id: created.user.id,
    tenant_id: callerTenant,
    display_name: input.displayName,
    role_id: input.roleId,
    locale: input.locale,
    office_id: input.officeId ?? null,
    department_id: input.departmentId ?? null,
    team_id: input.teamId ?? null,
    job_title: input.jobTitle ?? null,
    email: input.email, // display mirror (migration 20260801090000)
  })
  if (profileErr) {
    console.error('invite-user: user_profiles insert failed', {
      email: input.email,
      code: (profileErr as { code?: string }).code,
      message: profileErr.message,
      details: (profileErr as { details?: string }).details,
    })
    await admin.auth.admin.deleteUser(created.user.id) // no half-provisioned users
    // A unique-violation here means a profile with this email already exists (e.g. an
    // orphaned row whose auth user was removed) — report it as the real cause, not a
    // generic failure, so the admin knows the email is taken rather than retrying blindly.
    if ((profileErr as { code?: string }).code === '23505') {
      return err(409, 'email_exists', 'A user with this email address already exists.')
    }
    return err(500, 'profile_failed', profileErr.message ?? 'Profile creation failed; user rolled back')
  }

  // 6. Resource provisioning (ADR-0011). An internal user IS a bookable
  //    resource by default: auto-create a human resource with a fun, unique
  //    nickname, inheriting the invite's org placement and linked to the login.
  //    `asResource=false` opts out; an explicit `resourceId` links a pre-existing
  //    resource instead (the rare Resources-admin path). A failure here rolls the
  //    whole invite back — we never leave a half-provisioned account.
  const rollback = async () => {
    await admin.from('user_profiles').delete().eq('id', created.user.id)
    await admin.auth.admin.deleteUser(created.user.id)
  }

  if (input.resourceId) {
    const { error: linkErr } = await admin
      .from('resources')
      .update({ user_id: created.user.id })
      .eq('id', input.resourceId)
      .eq('tenant_id', callerTenant)
    if (linkErr) {
      console.error('invite-user: resource link failed', { email: input.email, code: (linkErr as { code?: string }).code, message: linkErr.message })
      await rollback()
      return err(500, 'link_failed', 'Resource link failed; user rolled back')
    }
  } else if (input.asResource) {
    // Race-safe: the unique index (tenant_id, nickname) is the real guard, so we
    // attempt the insert and re-roll on a 23505 clash rather than pre-checking.
    // Start from the invitee's chosen nickname (if any), then random handles,
    // then a numeric suffix as a last resort — de-dup effectively never fails.
    const preferred = (input.nickname ?? '').trim()
    let resourceCreated = false
    for (let attempt = 0; attempt < 25 && !resourceCreated; attempt++) {
      const nickname =
        attempt === 0 && preferred
          ? preferred
          : attempt < 15
            ? randomNickname()
            : `${preferred || randomNickname()} ${attempt}`
      const { error: resErr } = await admin.from('resources').insert({
        tenant_id: callerTenant,
        kind: 'human',
        name: input.displayName,
        nickname,
        capacity_model: 'load_based',
        load_ceiling_pct: 120,
        warn_at_pct: 100,
        department_id: input.departmentId ?? null,
        office_id: input.officeId ?? null,
        team_id: input.teamId ?? null,
        user_id: created.user.id,
        is_active: true,
      })
      if (!resErr) {
        resourceCreated = true
      } else if (resErr.code !== '23505') {
        console.error('invite-user: resource insert failed', { email: input.email, code: resErr.code, message: resErr.message, details: (resErr as { details?: string }).details })
        await rollback()
        return err(500, 'resource_failed', resErr.message ?? 'Resource provisioning failed; user rolled back')
      }
      // 23505 → nickname clash: loop and try another handle.
    }
    if (!resourceCreated) {
      await rollback()
      return err(500, 'resource_failed', 'Could not allocate a unique nickname; user rolled back')
    }
  }

  // 7. Audit trail.
  await admin.from('audit_events').insert({
    tenant_id: callerTenant,
    actor_user_id: callerData.user.id,
    action: 'user_invited',
    entity: 'user_profiles',
    entity_id: created.user.id,
    payload: {
      role_id: input.roleId,
      provisioned_resource: input.resourceId ? 'linked' : input.asResource ? 'created' : 'none',
    },
  })

  return new Response(JSON.stringify({ userId: created.user.id }), {
    status: 201,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  })
}))
