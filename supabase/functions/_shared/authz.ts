// THE permission check for Edge Functions (ADR-0037).
//
// Every function used to hand-roll its own `role_grants` lookup keyed on the JWT app_role_id. That
// predated the ADR-0036 per-user overlay and never learned about it, so a per-user ALLOW was invisible
// (403 where RLS would permit) and a per-user DENY was invisible (fails OPEN). Eight copies of one
// rule, none of which moved when the rule did.
//
// There is now exactly one rule, in the database: app.has_permission = (role grant OR user-allow)
// AND NOT user-deny. `app` is not exposed over PostgREST, so public.has_permission (migration
// 20260824100000) is the doorway. This module is the only place an Edge Function walks through it.
//
// AGENTS.md §2: no Edge Function may decide authorization by querying role_grants / user_grants.
// A CI check greps for exactly that, so re-implementing it fails at review, not in production.

/** Structural, so this module depends on neither import specifier the functions use. */
interface RpcCapable {
  rpc(fn: string, params: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>
}

/**
 * Does the CALLER hold `resource:action`?
 *
 * @param caller MUST be the caller-scoped client (anon key + the request's Authorization header).
 *   A service-role client has no `auth.uid()`, so the primitive would resolve every grant to false —
 *   passing one here is a silent lockout, not a bypass, but it is still wrong.
 *
 * Fail-closed by construction: any error — the migration not yet applied, a network blip, a policy
 * refusal — is a DENIAL, never a pass. This is what makes "migration first, functions second" safe
 * to get wrong: deploy the function early and it refuses everyone until the migration lands.
 */
export async function hasPermission(
  caller: RpcCapable,
  resource: string,
  action: string,
): Promise<boolean> {
  const { data, error } = await caller.rpc('has_permission', {
    p_resource: resource,
    p_action: action,
  })
  if (error) return false
  return data === true
}
