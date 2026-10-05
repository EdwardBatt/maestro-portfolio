#!/usr/bin/env node
/**
 * One-time bootstrap: creates the tenant + the first ADMIN user on the REMOTE
 * project. Run by Edward only; requires the service-role (secret) key which
 * must NEVER be committed or put in .env:
 *
 *   $env:SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY = Read-Host "service role / secret key"
 *   node scripts/bootstrap-admin.mjs admin@example.test "Edward" "TENANT NAME" tenant-slug
 *   Remove-Item Env:\SUPABASE_SERVICE_ROLE_KEY
 *
 * Prints a password-reset link for the new admin to set their password.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

// Load .env.local (gitignored, machine-local secrets) for any vars not already
// set in the environment. SUPABASE_URL falls back to the public VITE_ value.
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* no .env.local — env vars must be set explicitly */ }

const [email, displayName = 'Admin', tenantName = 'Meridian', slug = 'meridian'] = process.argv.slice(2)
const url = process.env.SUPABASE_URL ?? 'https://YOUR-PROJECT-REF.supabase.co'
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key || !email) {
  console.error('Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/bootstrap-admin.mjs <email> [name] [tenant] [slug]')
  process.exit(1)
}

const admin = createClient(url, key)

// 1. Tenant (idempotent on slug)
const { data: existing } = await admin.from('tenants').select('id').eq('slug', slug).maybeSingle()
const tenantId = existing?.id ?? (await admin.from('tenants')
  .insert({ name: tenantName, slug })
  .select('id').single()).data?.id
if (!tenantId) { console.error('Tenant creation failed'); process.exit(1) }
console.log('tenant:', tenantId)

// 1b. Seed the tenant's roles (idempotent; ADR-0008) and resolve Power Admin.
const { error: seedErr } = await admin.rpc('seed_tenant_roles', { p_tenant: tenantId })
if (seedErr) { console.error('Role seeding failed:', seedErr.message); process.exit(1) }
const { data: powerAdmin } = await admin.from('roles')
  .select('id').eq('tenant_id', tenantId).eq('key', 'power_admin').single()
if (!powerAdmin) { console.error('power_admin role not found after seeding'); process.exit(1) }
console.log('power_admin role:', powerAdmin.id)

// 2. Admin user with claims + a generated temporary password (no email/link
//    round-trip needed — sign in with it directly, change it once inside).
//    Idempotent: if the user already exists, the password and claims are reset.
const tempPassword = 'Ma!' + crypto.randomUUID().replaceAll('-', '').slice(0, 20)
const attrs = {
  email,
  password: tempPassword,
  email_confirm: true,
  app_metadata: { tenant_id: tenantId, app_role_id: powerAdmin.id },
  user_metadata: { display_name: displayName },
}
let userId
const { data: created, error: userErr } = await admin.auth.admin.createUser(attrs)
if (created?.user) {
  userId = created.user.id
} else if (userErr) {
  // Already exists → find and update in place
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const existingUser = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (!existingUser) { console.error('User creation failed:', userErr.message); process.exit(1) }
  const { error: updErr } = await admin.auth.admin.updateUserById(existingUser.id, attrs)
  if (updErr) { console.error('User update failed:', updErr.message); process.exit(1) }
  userId = existingUser.id
  console.log('(existing user updated)')
}
console.log('user:', userId)

// 3. Profile (upsert — safe on re-run)
const { error: profileErr } = await admin.from('user_profiles').upsert({
  id: userId, tenant_id: tenantId, display_name: displayName, role_id: powerAdmin.id, email,
})
if (profileErr) { console.error('Profile failed:', profileErr.message); process.exit(1) }

console.log('\nSign in with:')
console.log('  email:    ' + email)
console.log('  password: ' + tempPassword)
console.log('\nChange it after first sign-in (Supabase dashboard → Auth → Users, or in-app once account settings exist).')
console.log('Bootstrap complete.')
