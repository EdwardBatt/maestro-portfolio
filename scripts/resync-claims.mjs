#!/usr/bin/env node
/**
 * One-time claim resync for the ADR-0008 cutover: after the RBAC migrations
 * are pushed, every EXISTING auth user still carries the old app_role claim.
 * This walks user_profiles and rewrites each user's app_metadata to
 * { app_role_id: <their profile role_id> } (and clears the old app_role key).
 *
 * Until a user is resynced they can sign in but hold no grants — fail-closed.
 * Users refresh their token (or sign in again) to pick up the new claim.
 *
 * Run by Edward only; needs the service key (from .env.local, never committed):
 *   node scripts/resync-claims.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* no .env.local — env vars must be set explicitly */ }

const url = process.env.SUPABASE_URL ?? 'https://YOUR-PROJECT-REF.supabase.co'
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/resync-claims.mjs')
  process.exit(1)
}

const admin = createClient(url, key)

const { data: profiles, error } = await admin
  .from('user_profiles')
  .select('id, display_name, tenant_id, role_id, roles(key)')
if (error) { console.error('Could not list profiles:', error.message); process.exit(1) }

let ok = 0, failed = 0
for (const p of profiles) {
  const { error: updErr } = await admin.auth.admin.updateUserById(p.id, {
    app_metadata: { tenant_id: p.tenant_id, app_role_id: p.role_id, app_role: null },
  })
  if (updErr) {
    failed++
    console.error(`  FAILED ${p.display_name} (${p.id}): ${updErr.message}`)
  } else {
    ok++
    console.log(`  ${p.display_name} → ${p.roles?.key ?? p.role_id}`)
  }
}
console.log(`\nResynced ${ok} user(s)${failed ? `, ${failed} FAILED` : ''}.`)
console.log('Users pick up the new claim on next token refresh (≤1h) or next sign-in.')
process.exit(failed ? 1 : 0)
