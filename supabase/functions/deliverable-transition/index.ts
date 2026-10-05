// deliverable-transition — the internal deliverable lifecycle API (ADR-0024, Phase I).
//
// The DB guard `app.tg_deliverable_transition_guard` is AUTHORITATIVE: it enforces the legal
// transition graph, gates sign-off on reviews:moderate, stamps revision_round, and emits the
// append-only sla_events. This function runs as the CALLER (user-scoped client) so RLS + the
// guard enforce tenant/role end to end; it exists to give the UI one validated endpoint with a
// clean envelope and the caller's next legal moves. Audit rows come from the universal audit
// trigger (L1.9) and workflow events from the guard, so this function duplicates neither.
//
// Unlike booking-transition there is no server-side capacity math here — the state machine is
// in the DB. The pure lib (../../../src/lib/deliverables/state-machine.ts) is the shared twin
// used both here (pre-check) and by the UI.
//
// Deploy: `supabase functions deploy deliverable-transition`
import { z } from 'npm:zod@4'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { hasPermission } from '../_shared/authz.ts'
import {
  isAllowed,
  findTransition,
  allowedTransitions,
} from '../../../src/lib/deliverables/state-machine.ts'
import { guarded } from '../_shared/http.ts'

const STATES = ['draft', 'in_progress', 'in_review', 'approved', 'delivered', 'archived', 'blocked'] as const

const Input = z.object({
  deliverableId: z.string().uuid(),
  to: z.enum(STATES),
  /** optimistic concurrency: the state the caller believes the deliverable is in */
  expectedState: z.enum(STATES),
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...corsHeaders } })
const err = (status: number, code: string, message: string) => json(status, { error: { code, message } })

Deno.serve(guarded(corsHeaders, async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return err(405, 'method_not_allowed', 'POST only')

  let input: z.infer<typeof Input>
  try {
    input = Input.parse(await req.json())
  } catch {
    return err(400, 'invalid_input', 'Request body failed validation')
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  // Authenticate + resolve the caller's tenant/role (claims are server-set).
  const authHeader = req.headers.get('authorization') ?? ''
  const db = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userErr } = await db.auth.getUser()
  if (userErr || !userData.user) return err(401, 'unauthenticated', 'Sign in required')
  const meta = (userData.user.app_metadata ?? {}) as Record<string, unknown>
  const roleId = typeof meta.app_role_id === 'string' ? meta.app_role_id : null
  if (!roleId) return err(403, 'forbidden', 'No role claim')

  // The caller's lifecycle grants, through THE primitive (ADR-0037) — so a per-user allow counts
  // and a per-user deny bites, exactly as they do in RLS.
  const grants = {
    manage: await hasPermission(db, 'project_tasks', 'manage'),
    review: await hasPermission(db, 'reviews', 'moderate'),
  }
  if (!grants.manage && !grants.review) return err(403, 'forbidden', 'No deliverable lifecycle grants')

  // Load the current state (RLS fences to the caller's tenant).
  const { data: deliverable } = await db
    .from('deliverables')
    .select('id, state')
    .eq('id', input.deliverableId)
    .maybeSingle()
  if (!deliverable) return err(404, 'not_found', 'Deliverable not found')
  if (deliverable.state !== input.expectedState) {
    return err(409, 'state_changed', `Deliverable is ${deliverable.state}, not ${input.expectedState}`)
  }

  // Pre-check against the shared state machine for a clean envelope (the guard re-checks).
  if (!isAllowed(input.expectedState, input.to, grants)) {
    return findTransition(input.expectedState, input.to)
      ? err(403, 'permission_denied', `You lack the grant for ${input.expectedState} → ${input.to}`)
      : err(409, 'illegal_transition', `${input.expectedState} → ${input.to} is not a legal transition`)
  }

  // Drive the transition as the caller. The guard stamps revision_round + emits sla_events;
  // the optimistic .eq(state) guards against a concurrent change.
  const { data: updated, error: updErr } = await db
    .from('deliverables')
    .update({ state: input.to })
    .eq('id', input.deliverableId)
    .eq('state', input.expectedState)
    .select('id, state, revision_round')
  if (updErr) {
    const code = String(updErr.code)
    if (code === '22023') return err(409, 'illegal_transition', 'That transition is not legal from the current state')
    if (code === '42501') return err(403, 'permission_denied', 'You are not permitted to make that transition')
    return err(500, 'transition_failed', 'Could not update the deliverable')
  }
  if (!updated?.length) return err(409, 'state_changed', 'Deliverable changed concurrently; re-check and retry')

  const now = updated[0]!.state as (typeof STATES)[number]
  return json(200, {
    deliverable: updated[0],
    allowed: allowedTransitions(now, grants).map((t) => ({ to: t.to, authority: t.authority, event: t.event ?? null })),
  })
}))
