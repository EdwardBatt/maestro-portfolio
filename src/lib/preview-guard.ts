/**
 * Dev "View as role" preview guard (Power-Admin-only, removable — see DevPanel).
 *
 * While a Power Admin previews another role, we BLOCK data writes at the single
 * HTTP chokepoint (the Supabase client's fetch) so nothing is mutated under the
 * previewed identity. Reads and auth calls (token refresh / sign-out) pass
 * through untouched. This is a safety convenience for a dev tool, NOT a security
 * boundary — RLS on the real JWT is, and it is unaffected by any of this.
 *
 * WHY THE HTTP VERB IS NOT ENOUGH. PostgREST tunnels every `rpc()` through POST,
 * and Edge Functions are POST-only, so "POST means write" also caught the app's
 * READS. The worst of them was public.my_permissions / public.my_scope_grants:
 * permissions.tsx calls my_scope_grants on every permission load, preview or not,
 * so switching between previewed roles (guard already on) failed the grant fetch,
 * which left defaultRoute at its '/login' fallback — and the guards then sent a
 * signed-in Power Admin to the login form. Reported as "selecting Account Manager
 * logs me out"; nothing role-specific about it, the first preview only survived
 * because the guard is armed by an effect a beat after the fetch goes out.
 *
 * So POST is classified by WHAT is being called:
 *   /rest/v1/rpc/<name>   — allowed only if <name> is a known read-only function
 *   /rest/v1/...          — a table write; blocked
 *   /functions/v1/<name>  — allowed only for the read `op`s named below
 * Anything unrecognised is BLOCKED. A read that gets refused is a visible, fixable
 * annoyance; a write that slips through is the thing this file exists to prevent.
 */
export const previewGuard = {
  blocked: false,
  /**
   * ADR-0120: viewing as a PERSON. The database runs every request read-only then, so any `rpc()`
   * may go through: a write is refused there, and the reads (Needs you, My Work) are the point.
   * Table writes and Edge Function writes stay blocked here, as for a role preview.
   */
  person: false,
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * `public.` functions that only READ. Each is `stable` (or plain `select`) in its
 * migration — that volatility is the rule to apply when adding to this list, and
 * it is worth re-checking rather than assuming from the name. Deliberately absent:
 * everything that mutates (sub_task_*, update_task_assignment, create_*,
 * attendance_heartbeat), which is what the guard is for.
 */
const READ_ONLY_RPCS = new Set([
  'my_permissions',
  'my_scope_grants',
  // ADR-0120: starting a person view. It records the view in the audit log and changes nothing else;
  // it is allowed while a role preview is on so one can go straight from one to the other.
  'view_as_start',
  'users_holding_permission',
  'effective_sla',
  'kpi_rollup',
  'attendance_deviation',
])

/**
 * Edge functions that read or write depending on the `op` in their body. Both of
 * these mint a presigned B2 URL: the download/view op only signs a GET, so a
 * previewed role can still SEE library assets and review media — blocking them
 * wholesale left images broken behind the preview.
 */
const READ_ONLY_FUNCTION_OPS: Record<string, readonly string[]> = {
  'asset-url': ['download'],
  'review-media': ['view'],
}

/** The path segment after `prefix`, e.g. '/rest/v1/rpc/my_permissions?x=1' → 'my_permissions'. */
function segmentAfter(url: string, prefix: string): string | null {
  const at = url.indexOf(prefix)
  if (at === -1) return null
  return url.slice(at + prefix.length).split(/[/?#]/)[0] ?? null
}

/** The `op` field of a JSON request body, when it is readable and is a string. */
function bodyOp(body?: BodyInit | null): string | null {
  if (typeof body !== 'string') return null // Blob/FormData/stream: unreadable here, treat as a write
  try {
    const parsed: unknown = JSON.parse(body)
    const op = (parsed as { op?: unknown } | null)?.op
    return typeof op === 'string' ? op : null
  } catch {
    return null
  }
}

/** True when a request should be refused because a preview is active. */
export function isBlockedWrite(url: string, method?: string, body?: BodyInit | null): boolean {
  if (!previewGuard.blocked) return false
  if (!WRITE_METHODS.has((method ?? 'GET').toUpperCase())) return false
  if (url.includes('/auth/v1/')) return false

  const rpc = segmentAfter(url, '/rest/v1/rpc/')
  if (rpc) return !previewGuard.person && !READ_ONLY_RPCS.has(rpc)
  if (url.includes('/rest/v1/')) return true

  const fn = segmentAfter(url, '/functions/v1/')
  if (fn) {
    const readOps = READ_ONLY_FUNCTION_OPS[fn]
    const op = bodyOp(body)
    return !(readOps != null && op != null && readOps.includes(op))
  }

  return false
}

export class PreviewWriteBlockedError extends Error {
  code = 'preview_blocked'
  constructor() {
    super('Writes are disabled while previewing another role. Exit preview to make changes.')
    this.name = 'PreviewWriteBlockedError'
  }
}
