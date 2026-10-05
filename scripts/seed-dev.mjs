#!/usr/bin/env node
/**
 * Dev seed (0.2.5 partial): Meridian-shaped fixtures on maestro-dev so the schedule
 * surface has something real to show. Idempotent: keyed on names/slug — safe
 * to re-run. Uses .env.local (SUPABASE_SERVICE_ROLE_KEY) like bootstrap-admin.
 *
 *   node scripts/seed-dev.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* env must be set */ }

const url = process.env.SUPABASE_URL ?? 'https://YOUR-PROJECT-REF.supabase.co'
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!key) { console.error('SUPABASE_SERVICE_ROLE_KEY missing (set in .env.local)'); process.exit(1) }
const db = createClient(url, key)

const { data: tenant } = await db.from('tenants').select('id').eq('slug', 'meridian').single()
if (!tenant) { console.error('Tenant meridian not found — run bootstrap-admin first'); process.exit(1) }
const T = tenant.id
console.log('tenant:', T)

async function upsertBy(table, match, row) {
  const { data: found } = await db.from(table).select('id').match(match).maybeSingle()
  if (found) return found.id
  const { data, error } = await db.from(table).insert(row).select('id').single()
  if (error) { console.error(`${table}:`, error.message); process.exit(1) }
  return data.id
}

// Offices (ADR-0005 working weeks)
const baghdad = await upsertBy('offices', { tenant_id: T, name: 'Baghdad' },
  { tenant_id: T, name: 'Baghdad', timezone: 'Asia/Baghdad', working_days: [7, 1, 2, 3, 4] })
const dubai = await upsertBy('offices', { tenant_id: T, name: 'Dubai' },
  { tenant_id: T, name: 'Dubai', timezone: 'Asia/Dubai', working_days: [1, 2, 3, 4, 5] })
const cairo = await upsertBy('offices', { tenant_id: T, name: 'Cairo' },
  { tenant_id: T, name: 'Cairo', timezone: 'Africa/Cairo', working_days: [7, 1, 2, 3, 4] })

// Departments (org chart, §5.1)
const depts = {}
// Meridian org chart departments (project knowledge: the agency org chart)
for (const name of ['Client Services', 'Creative', 'Performance Marketing', 'Production',
                    'Influencers', 'Accounting', 'People & Culture', 'IT']) {
  depts[name] = await upsertBy('departments', { tenant_id: T, name }, { tenant_id: T, name })
}

// Clients
const qicard = await upsertBy('clients', { tenant_id: T, name: 'Kite Card' }, { tenant_id: T, name: 'Kite Card' })
await upsertBy('clients', { tenant_id: T, name: 'Souqly' }, { tenant_id: T, name: 'Souqly' })

// Human resources (load-based) across offices
const humans = [
  ['Sarah Haddad', 'Creative', baghdad, 120, 100],
  ['Ali Kareem', 'Creative', baghdad, 120, 100],
  ['Lama Nassif', 'Creative', cairo, 110, 90],
  ['Omar Farouk', 'Production', baghdad, 130, 110],
  ['Nour Aziz', 'Performance Marketing', dubai, 120, 100],
  ['Rania Saleh', 'Client Services', dubai, 110, 100],
]
const resourceIds = {}
for (const [name, dept, office, ceiling, warn] of humans) {
  resourceIds[name] = await upsertBy('resources', { tenant_id: T, name }, {
    tenant_id: T, kind: 'human', name, department_id: depts[dept], office_id: office,
    capacity_model: 'load_based', load_ceiling_pct: ceiling, warn_at_pct: warn,
    cost_rate: 35, charge_rate: 90,
  })
}

// Equipment
resourceIds['RED Komodo'] = await upsertBy('resources', { tenant_id: T, name: 'RED Komodo' }, {
  tenant_id: T, kind: 'equipment', name: 'RED Komodo', office_id: baghdad,
  capacity_model: 'exclusive', requires_approval: true, department_id: depts['Production'],
})
resourceIds['50mm Lens Pool'] = await upsertBy('resources', { tenant_id: T, name: '50mm Lens Pool' }, {
  tenant_id: T, kind: 'equipment', name: '50mm Lens Pool', office_id: baghdad,
  capacity_model: 'pooled', pool_size: 4, department_id: depts['Production'],
})
resourceIds['Studio A'] = await upsertBy('resources', { tenant_id: T, name: 'Studio A' }, {
  tenant_id: T, kind: 'room', name: 'Studio A', office_id: baghdad, capacity_model: 'exclusive',
})

// Campaign for context
await upsertBy('campaigns', { tenant_id: T, name: 'Ramadan 2027' },
  { tenant_id: T, client_id: qicard, name: 'Ramadan 2027' })

// This week's bookings + one blackout (only if none exist yet — keep re-runs clean)
const { count } = await db.from('bookings').select('id', { count: 'exact', head: true }).eq('tenant_id', T)
if ((count ?? 0) === 0) {
  const monday = (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000) })()
  const at = (day, h) => new Date(monday.getTime() + day * 86400000 + h * 3600000).toISOString()
  const rows = [
    { r: 'Sarah Haddad', d: 0, s: 6, e: 12, state: 'confirmed', load: 60, note: 'Kite Card socials' },
    { r: 'Sarah Haddad', d: 0, s: 9, e: 15, state: 'confirmed', load: 55, note: 'Ramadan key visual' }, // overlap → 115%
    { r: 'Ali Kareem', d: 1, s: 7, e: 13, state: 'confirmed', load: 80, note: 'Brand refresh' },
    { r: 'Lama Nassif', d: 2, s: 8, e: 12, state: 'tentative', load: 50, note: 'Copy sprint' },
    { r: 'Omar Farouk', d: 3, s: 5, e: 14, state: 'confirmed', load: 100, note: 'Shoot day' },
    { r: 'RED Komodo', d: 3, s: 5, e: 14, state: 'confirmed', note: 'Shoot day' },
    { r: 'Nour Aziz', d: 4, s: 6, e: 10, state: 'confirmed', load: 40, note: 'Campaign flight' },
  ]
  for (const b of rows) {
    const { error } = await db.from('bookings').insert({
      tenant_id: T, resource_id: resourceIds[b.r], starts_at: at(b.d, b.s), ends_at: at(b.d, b.e),
      state: b.state, load_pct: b.load ?? null, notes: b.note,
    })
    if (error) console.error('booking:', b.note, error.message)
  }
  await db.from('resource_unavailability').insert({
    tenant_id: T, resource_id: resourceIds['Ali Kareem'], kind: 'leave', reason: 'Annual leave',
    starts_at: at(4, 0), ends_at: at(6, 0),
  })
  console.log('bookings + blackout seeded for this week')
} else {
  console.log(`bookings already present (${count}) — skipped`)
}

console.log('Seed complete.')
