#!/usr/bin/env node
/**
 * License allowlist gate (ADR-0002 / ADR-0003 / ADR-0047). Zero dependencies — uses npm's
 * native SBOM. Fails (exit 1) if any installed package declares a license
 * outside the allowlist. MPL-2.0 is allowed ONLY under ADR-0003's constraint
 * (unmodified build-time tooling) — reviewers enforce that half manually.
 */
import { execSync } from 'node:child_process'

const ALLOWED = new Set([
  'MIT',
  'Apache-2.0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'MIT-0',
  'CC0-1.0',
  'BlueOak-1.0.0',
  'MPL-2.0', // ADR-0003: unmodified build tooling only
  'Zlib', // ADR-0047: OSI-approved, non-copyleft, attribution-only
  'Unlicense',
  'OFL-1.1', // ADR-0114: FONT packages only (Inter); a non-font package under OFL still needs review
])

// Pinned single-package exceptions (ADR-0047). Each is one package at one version whose LICENSE
// text is permissive but whose declared string is not an SPDX id the allowlist can match, or is an
// elective expression the project has resolved. Never widen an entry to a bare name or a range:
// the version pin is what stops a future release changing licence without anyone noticing.
const PINNED = new Map([
  // Declares the pre-SPDX string 'BSD'; LICENSE text is verbatim BSD-2-Clause. Same author as
  // mammoth. 'BSD' is NOT allowlisted generally — it has also meant the 4-clause variant.
  ['duck@0.1.12', 'BSD'],
  // Dual-licensed 'MIT OR GPL-3.0-or-later'. The project ELECTS MIT and declines GPLv3 (ADR-0047 d.2).
  ['jszip@3.10.1', '(MIT OR GPL-3.0-or-later)'],
  // 'MIT AND Zlib' — both now allowed, but the compound is pinned so the pairing is visible here.
  ['pako@1.0.11', '(MIT AND Zlib)'],
])

// A compound SPDX expression passes only if every referenced license is allowed
// (conservative: treats AND/OR alike — an OR with one allowed side still needs review).
const passes = (expr) =>
  expr
    .split(/\s+(?:AND|OR|WITH)\s+|[()]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .every((id) => ALLOWED.has(id))

const sbom = JSON.parse(
  execSync('npm sbom --sbom-format spdx', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
)

const violations = []
for (const pkg of sbom.packages ?? []) {
  if (pkg.name === sbom.name || pkg.SPDXID === 'SPDXRef-DOCUMENT') continue
  const lic = pkg.licenseDeclared || pkg.licenseConcluded || 'NOASSERTION'
  const self = `${pkg.name}@${pkg.versionInfo}`
  if (self.startsWith('maestro@')) continue // the root package itself (proprietary)
  if (PINNED.get(self) === lic) continue // ADR-0047, exact package@version + exact declared string
  if (lic === 'NOASSERTION' || !passes(lic)) violations.push(`${self}  ->  ${lic}`)
}

if (violations.length) {
  console.error('License allowlist violations (ADR-0002). Add an ADR or replace the package:\n')
  for (const v of violations) console.error('  ' + v)
  process.exit(1)
}
console.log(`License check passed: ${((sbom.packages?.length ?? 1) - 1)} packages, all within the ADR-0002/0003/0047 allowlist.`)
