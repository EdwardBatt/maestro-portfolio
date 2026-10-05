import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { env } from './env'
import { isBlockedWrite, PreviewWriteBlockedError } from './preview-guard'
import { withViewAs } from './view-as'

/**
 * Fetch wrapper for the Dev "view as role" preview (removable): when a preview
 * is active it refuses data/edge-function WRITES so nothing mutates under the
 * previewed identity. Reads and auth pass straight through. Not a security
 * boundary — RLS is (this only affects this browser's outgoing writes).
 */
const guardedFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : undefined)
  if (isBlockedWrite(url, method, init?.body)) return Promise.reject(new PreviewWriteBlockedError())
  // ADR-0120: while viewing as a person, database requests carry who (the database checks it).
  return fetch(input, withViewAs(url, init))
}

/**
 * The single Supabase client for the frontend. Feature api/ modules import
 * this — never construct their own client, never touch secret keys.
 * Access control is enforced by RLS server-side; this client only ever
 * carries the public publishable key plus the signed-in user's JWT.
 */
export const supabase = createClient<Database>(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_PUBLISHABLE_KEY,
  { global: { fetch: guardedFetch } },
)

/**
 * The SAME client, untyped. ONLY for tables/columns newer than the generated
 * types (they lag one migration until `gen types` re-runs after `db push`).
 * Every use site declares its own row shape and should migrate back to the
 * typed client once types regenerate. Currently: roles / role_grants /
 * user_profiles.role_id (ADR-0008 cutover).
 */
// oxlint-disable-next-line no-explicit-any -- deliberately untyped bridge
export const supabaseUntyped = supabase as unknown as SupabaseClient<any, 'public', any>
