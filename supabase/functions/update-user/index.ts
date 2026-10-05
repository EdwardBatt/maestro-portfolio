// update-user — user administration on grants (L1.2 → reworked for ADR-0008).
//
// The ONLY writer for role changes and deactivation. A role lives in two
// places — the JWT claim (app_metadata.app_role_id, what RLS reads) and the
// user_profiles row (what the UI shows) — and this function updates BOTH or
// NEITHER. Deactivation = auth-level ban + `start_deactivation` (ADR-0133: the Leaving stage; is_active goes false
// in the database when the hand-over list is empty). Authorization is
// a grant check (users:manage), never a role-name comparison (ADR-0008).
//
// Service-role usage justification (maestro-edge-function skill): mutating
// auth users requires the admin API; the caller is independently
// authenticated and their users:manage grant verified below before the
// privileged client does anything.

import { z } from 'npm:zod@4'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { hasPermission } from '../_shared/authz.ts'
import { guarded } from '../_shared/http.ts'

const Input = z
  .object({
    userId: z.string().uuid(),
    roleId: z.string().uuid().optional(),
    displayName: z.string().trim().min(1).max(120).optional(),
    locale: z.enum(['en', 'ar']).optional(),
    officeId: z.string().uuid().nullable().optional(),
    departmentId: z.string().uuid().nullable().optional(),
    teamId: z.string().uuid().nullable().optional(),
    jobTitle: z.string().trim().max(120).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.roleId !== undefined || v.displayName !== undefined || v.locale !== undefined ||
      v.officeId !== undefined || v.departmentId !== undefined || v.teamId !== undefined || v.jobTitle !== undefined ||
      v.active !== undefined,
    { message: 'no fields to update' },
  )

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

const BAN_FOREVER = '87600h' // 10 years; reactivation clears it
const BAN_NONE = 'none'

Deno.serve(guarded(corsHeaders, async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return err(405, 'method_not_allowed', 'POST only')

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // 1. Authenticate the caller.
  const authHeader = req.headers.get('authorization') ?? ''
  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: callerData, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerData.user) return err(401, 'unauthenticated', 'Sign in required')

  // 2. Authorize by GRANT (users:manage); tenant comes from the CALLER's claims.
  const meta = (callerData.user.app_metadata ?? {}) as Record<string, unknown>
  const callerTenant = typeof meta.tenant_id === 'string' ? meta.tenant_id : null
  const callerRoleId = typeof meta.app_role_id === 'string' ? meta.app_role_id : null
  if (!callerTenant || !callerRoleId) return err(403, 'forbidden', 'No role claim')

  const admin = createClient(url, serviceKey)
  // ADR-0037: THE primitive, on the CALLER-scoped client. The old check queried the grant table
  // directly on the service-role client, so the ADR-0036 overlay could never reach it.
  if (!(await hasPermission(callerClient, 'users', 'manage'))) {
    return err(403, 'forbidden', 'users:manage grant required')
  }

  // 3. Validate input.
  let input: z.infer<typeof Input>
  try {
    input = Input.parse(await req.json())
  } catch {
    return err(400, 'invalid_input', 'Request body failed validation')
  }

  // 4. Self-lockout guard: you cannot change your own role or deactivate
  //    yourself — another users:manage holder must do it.
  if (input.userId === callerData.user.id && (input.roleId !== undefined || input.active === false)) {
    return err(400, 'cannot_lockout_self', 'You cannot change your own role or deactivate your own account')
  }

  // 5. Target must exist in the caller's tenant.
  const { data: target, error: targetErr } = await admin
    .from('user_profiles')
    .select('id, tenant_id, role_id, is_active, department_id, team_id, leaving_since')
    .eq('id', input.userId)
    .eq('tenant_id', callerTenant)
    .maybeSingle()
  if (targetErr) return err(500, 'lookup_failed', 'Could not load the target user')
  if (!target) return err(404, 'target_not_found', 'No such user in your tenant')
  // ADR-0133: a person is Leaving (access gone, work being handed over) between "deactivate" and the hand-over's end.
  const wasLeaving = target.is_active && target.leaving_since != null

  // 6. Role change: the new role must be an active, assignable role of THIS
  //    tenant (client_portal accounts are provisioned by the portal flow, M10).
  if (input.roleId !== undefined) {
    const { data: role } = await admin
      .from('roles')
      .select('id, key, status')
      .eq('id', input.roleId)
      .eq('tenant_id', callerTenant)
      .maybeSingle()
    if (!role || role.status !== 'active') return err(404, 'role_not_found', 'No such role in your tenant')
    if (role.key === 'client_portal') return err(400, 'role_not_assignable', 'Portal accounts are provisioned separately')
  }

  const roleChanged = input.roleId !== undefined && input.roleId !== target.role_id
  // ADR-0133 d.1: "deactivate" starts the Leaving stage — sign-in banned now, `is_active` and the calendar row left as
  // they are until the hand-over completes (d.4, in the database). "Reactivate" also stops a hand-over (d.7).
  const deactivating = input.active === false && target.is_active && !wasLeaving
  const reactivating = input.active === true && (!target.is_active || wasLeaving)
  const activeChanged = deactivating || reactivating
  // Banned before this call: a Deactivated or a Leaving person.
  const wasBanned = !target.is_active || wasLeaving
  const departmentChanged = input.departmentId !== undefined && input.departmentId !== target.department_id
  const teamChanged = input.teamId !== undefined && input.teamId !== target.team_id
  const claimsChanged = roleChanged || departmentChanged || teamChanged

  // 7. Auth side first (claim + ban), remembering previous values for rollback.
  if (claimsChanged || activeChanged) {
    const authUpdate: Record<string, unknown> = {}
      if (claimsChanged) {
        const claim: Record<string, unknown> = {}
        if (roleChanged) claim.app_role_id = input.roleId
        if (departmentChanged) claim.department_id = input.departmentId
        if (teamChanged) claim.team_id = input.teamId
        authUpdate.app_metadata = claim // merges into existing app_metadata
      }
    if (activeChanged) authUpdate.ban_duration = reactivating ? BAN_NONE : BAN_FOREVER
    const { error: authErr } = await admin.auth.admin.updateUserById(input.userId, authUpdate)
    if (authErr) return err(500, 'auth_update_failed', 'Could not update the auth record')
  }

  // 8. Profile side. On failure, revert the auth changes — both sides or neither.
  const profileUpdate: Record<string, unknown> = {}
  if (input.roleId !== undefined) profileUpdate.role_id = input.roleId
  if (input.displayName !== undefined) profileUpdate.display_name = input.displayName
  if (input.locale !== undefined) profileUpdate.locale = input.locale
  if (input.officeId !== undefined) profileUpdate.office_id = input.officeId
  if (input.departmentId !== undefined) profileUpdate.department_id = input.departmentId
  if (input.teamId !== undefined) profileUpdate.team_id = input.teamId
  if (input.jobTitle !== undefined) profileUpdate.job_title = input.jobTitle
  // Deactivating does NOT write is_active here (ADR-0133 d.1): `start_deactivation`, below, begins the Leaving stage.
  // Reactivating — a Leaving or a Deactivated person — clears the hand-over (d.7); nothing already handed on moves back.
  if (reactivating) {
    profileUpdate.is_active = true
    profileUpdate.leaving_since = null
    profileUpdate.leaving_started_by = null
  }

  const revertAuth = async () => {
    if (claimsChanged || activeChanged) {
      await admin.auth.admin.updateUserById(input.userId, {
        app_metadata: { app_role_id: target.role_id, department_id: target.department_id, team_id: target.team_id },
        ban_duration: wasBanned ? BAN_FOREVER : BAN_NONE,
      })
    }
  }

  if (Object.keys(profileUpdate).length > 0) {
    const { error: profileErr } = await admin
      .from('user_profiles')
      .update(profileUpdate)
      .eq('id', input.userId)
      .eq('tenant_id', callerTenant)
    if (profileErr) {
      await revertAuth()
      return err(500, 'profile_update_failed', 'Profile update failed; auth changes rolled back')
    }
  }

  // ADR-0133 d.1–d.2: the Leaving stage, AS THE CALLER (so the database checks their users:manage and records them as
  // the starter). The person's department lead — or the Traffic Manager and the Power Admins — gets the hand-over
  // list; a person who holds nothing is Deactivated at once. On refusal the ban is lifted again.
  let handover: Record<string, unknown> | null = null
  if (deactivating) {
    const { data: started, error: startErr } = await callerClient.rpc('start_deactivation', { p_user: input.userId })
    if (startErr) {
      await revertAuth()
      return err(500, 'deactivation_failed', 'Could not start the deactivation; their access was restored')
    }
    handover = (started ?? null) as Record<string, unknown> | null
  }

  // NOTE: a ban blocks sign-in and token REFRESH; an already-issued access
  // token stays valid until expiry (default 1h). Acceptable for launch.

  // 8b. ADR-0011: an internal user IS a bookable resource. The grid shades
  // non-working days, groups and filters off the RESOURCE's office/department/
  // team — NOT the profile's — so keep the linked resource in sync when org
  // placement changes. Service role bypasses RLS; matches 0 rows (no-op) for a
  // user with no linked resource. Runs after the profile write so the profile
  // stays the source of truth if this partial step fails.
  const resourceUpdate: Record<string, unknown> = {}
  if (input.officeId !== undefined) resourceUpdate.office_id = input.officeId
  if (input.departmentId !== undefined) resourceUpdate.department_id = input.departmentId
  if (input.teamId !== undefined) resourceUpdate.team_id = input.teamId
  // ADR-0014 (decision 3), as amended by ADR-0133 d.4: the calendar row leaves the bookable pool when the deactivation
  // COMPLETES (the hand-over list empty — done in the database), not when it starts, so a Leaving person's booked work
  // stays visible while it is handed on. Reactivating puts it back.
  if (reactivating) resourceUpdate.is_active = true
  // ADR-0061 d.7: report how many resources this reached. Edward deactivated a user, hard-reloaded,
  // and they were still on /schedule — because their resource had `user_id` null, so this update
  // matched ZERO rows and said nothing. The operation reported success while doing part of what it
  // said, which is the whole subject of that ADR.
  //
  // Reported, never refused: a user with no resource is perfectly legitimate — an account manager
  // who books nobody's time is not a bookable resource, and failing their profile edit over it
  // would be worse than the silence.
  let resourcesTouched = 0
  if (Object.keys(resourceUpdate).length > 0) {
    const { data: touched, error: resErr } = await admin
      .from('resources')
      .update(resourceUpdate)
      .eq('user_id', input.userId)
      .eq('tenant_id', callerTenant)
      .select('id')
    if (resErr) return err(500, 'resource_sync_failed', 'Profile saved, but the linked resource could not be updated')
    resourcesTouched = (touched ?? []).length
  }

  // 9. Intent audit event (the row-change triggers log the WHAT; this is the WHY).
  await admin.from('audit_events').insert({
    tenant_id: callerTenant,
    actor_user_id: callerData.user.id,
    action: 'user_updated',
    entity: 'user_profiles',
    entity_id: input.userId,
    payload: {
      ...(roleChanged ? { role_id: { from: target.role_id, to: input.roleId } } : {}),
      ...(activeChanged ? { active: { from: wasBanned ? (wasLeaving ? 'leaving' : false) : true, to: reactivating ? true : 'leaving' } } : {}),
      ...(input.displayName !== undefined ? { display_name: true } : {}),
      ...(input.locale !== undefined ? { locale: true } : {}),
      ...(input.officeId !== undefined ? { office: true } : {}),
      ...(input.departmentId !== undefined ? { department: true } : {}),
      ...(input.teamId !== undefined ? { team: true } : {}),
      ...(input.jobTitle !== undefined ? { job_title: true } : {}),
    },
  })

  // `resourcesTouched` travels to the caller so the screen can say "their calendar row was not
  // switched off, because no resource is linked to them" — the sentence that was missing.
  // ADR-0133: `handover` is `start_deactivation`'s answer — {leaving, completed, items, total, recipients_told} — so the
  // screen can say "Leaving — 14 items sent to Inas Mohamed Azmi to hand over", or "Deactivated — nothing to hand over".
  return new Response(JSON.stringify({ ok: true, resourcesTouched, handover }), {
    status: 200,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  })
}))
