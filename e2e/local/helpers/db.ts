/**
 * Reading the local database from a spec, through PostgREST with the CLI's fixed local
 * service-role key. For ASSERTIONS ONLY — "did the row land, addressed to whom" — never to set up
 * state the product should have created (a test that seeds through the back door proves nothing
 * about the product; docs/memory/traps.md, the fixture that lied).
 *
 * The key is the CLI's public demo key, the same on every local stack. It is not a secret and it
 * reaches nothing but 127.0.0.1.
 */
const API = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY =
  process.env.E2E_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

if (!/127\.0\.0\.1|localhost/.test(API)) throw new Error('e2e/local reads a LOCAL Supabase only')

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' }

/** `GET /rest/v1/<table>?<query>` as the service role. Query is PostgREST syntax. */
export async function rows<T = Record<string, unknown>>(table: string, query: string): Promise<T[]> {
  const res = await fetch(`${API}/rest/v1/${table}?${query}`, { headers })
  if (!res.ok) throw new Error(`db: ${table}?${query} → ${res.status} ${await res.text()}`)
  return (await res.json()) as T[]
}

/** The user id behind a seeded address. */
export async function userIdOf(email: string): Promise<string> {
  const [row] = await rows<{ id: string }>('user_profiles', `select=id&email=eq.${encodeURIComponent(email)}`)
  if (!row) throw new Error(`db: no user_profiles row for ${email}`)
  return row.id
}

/** In-app notifications addressed to a person, newest first. */
export async function notificationsFor(email: string, type?: string) {
  const uid = await userIdOf(email)
  const q = `select=id,type,label,read_at,created_at,entity_type,entity_id&user_id=eq.${uid}&order=created_at.desc` + (type ? `&type=eq.${type}` : '')
  return rows<{ id: string; type: string; label: string | null; read_at: string | null; created_at: string; entity_type: string; entity_id: string | null }>('notifications', q)
}

/**
 * Poll until a notification of `type` exists for `email` — the row is written in-transaction, so
 * this is quick. Pass `entityId` when the same person has had that type before (a long-lived local
 * database accumulates them), so the assertion is about THIS one.
 */
export async function waitForNotification(email: string, type: string, timeoutMs = 8_000, entityId?: string) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const hits = (await notificationsFor(email, type)).filter((n) => !entityId || n.entity_id === entityId)
    if (hits.length) return hits[0]
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`db: no '${type}' notification for ${email}${entityId ? ` on ${entityId}` : ''} within ${timeoutMs}ms`)
}

/** Every `sla_events` row of one type against a deliverable, for the override / extension assertions. */
export async function slaEvents(deliverableId: string, eventType: string) {
  return rows<{ id: string; event_type: string; payload: Record<string, unknown>; actor_user_id: string | null }>(
    'sla_events',
    `select=id,event_type,payload,actor_user_id&deliverable_id=eq.${deliverableId}&event_type=eq.${eventType}&order=created_at.desc`,
  )
}

/**
 * A raw write as the service role, returning the status and body rather than throwing — for
 * asserting that the DATABASE refuses something the screens never offer (a constraint trigger,
 * a check). Bypasses RLS, so use it only to prove a guard that holds regardless of role.
 */
export async function attemptWrite(method: 'PATCH' | 'POST' | 'DELETE', table: string, query: string, body?: unknown) {
  const res = await fetch(`${API}/rest/v1/${table}?${query}`, {
    method,
    headers: { ...headers, Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, text: await res.text() }
}
