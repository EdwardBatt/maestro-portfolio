import { supabaseUntyped } from '../supabase'
import { inChunks } from '../query/in-chunks'

/**
 * Display names for a handful of user ids (I51.1).
 *
 * `created_by` / `updated_by` carry NO foreign key to user_profiles — on purpose. A foreign key is
 * what a PostgREST embed rides on, and two more from every table to user_profiles would make every
 * existing unnamed `user_profiles(...)` embed ambiguous (traps.md). So the names are read by id,
 * here, in one flat query the detail readers call after their own. Tenant-wide RLS on user_profiles
 * lets any signed-in colleague resolve a colleague's name.
 */
export async function fetchUserNames(ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = ids.filter((x): x is string => typeof x === 'string' && x.length > 0)
  if (wanted.length === 0) return new Map()
  const rows = await inChunks<{ id: string; display_name: string | null }>(wanted, (chunk) =>
    supabaseUntyped.from('user_profiles').select('id, display_name').in('id', chunk),
  )
  return new Map(rows.map((r) => [r.id, r.display_name ?? '']))
}
