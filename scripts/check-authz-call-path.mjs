// ADR-0037 decision 7: no Edge Function may decide authorization by querying the grant tables.
//
// There is one permission primitive (app.has_permission, reached from outside through
// public.has_permission) and one scope primitive (app.in_write_scope). Before L6.8, all eight
// grant-checking Edge Functions hand-rolled their own check against role_grants — so the ADR-0036
// per-user overlay was invisible to every one of them: a user-allow was ignored (403 where RLS
// would permit) and a user-deny was ignored (failed OPEN).
//
// pgTAP cannot execute an Edge Function, so the test suite is structurally incapable of holding
// this boundary. This check holds it instead, at review time rather than in production. L6.11 makes
// it redundant by revoking the read privilege outright — belt and braces, and this one is cheap.
//
// It matches QUERIES (`from('role_grants')`), not prose, so a function may still explain itself in
// a comment. Run: node scripts/check-authz-call-path.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'supabase/functions'
const TABLES = ['role_grants', 'user_grants', 'user_scope_grants']

// PostgREST table access in any quoting style: .from('role_grants'), .from("user_grants"), …
const PATTERN = new RegExp(String.raw`\.from\(\s*['"\`](${TABLES.join('|')})['"\`]`)

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (entry.endsWith('.ts')) out.push(path)
  }
  return out
}

const offenders = []
for (const file of walk(ROOT)) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (PATTERN.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`)
    })
}

if (offenders.length > 0) {
  console.error(
    'ADR-0037: an Edge Function is reading a grant table directly. Authorization is decided in ONE\n' +
      'place — call hasPermission() from supabase/functions/_shared/authz.ts instead, on the\n' +
      'CALLER-scoped client. A second copy of the rule is how the per-user overlay silently stopped\n' +
      'working (L6.8).\n',
  )
  for (const o of offenders) console.error('  ' + o)
  process.exit(1)
}

console.log(`ADR-0037 call path clean — no grant-table reads under ${ROOT}/`)
