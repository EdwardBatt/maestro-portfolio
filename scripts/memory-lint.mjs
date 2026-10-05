// Health check for the shared project memory in docs/memory/.
//
// Memory rots in predictable ways, and every one of them is silent: a capsule points at a file that
// was renamed, a note grows into a second copy of the source it was meant to point at, a `verified:`
// date drifts a season past the code it describes, a session note nobody promoted sits there
// implying it is still relevant. None of that fails a build or shows up in review.
//
// So this is the "lint" operation from the LLM-wiki pattern: not a style checker, a rot detector.
// Zero dependencies, same shape as check-licenses.mjs and check-authz-call-path.mjs.
//
// ERRORS (exit 1) are things that are provably wrong right now — a dead link, a missing header, a
// capsule over the density cap. WARNINGS are judgement calls for a human: staleness and promotion.
//
// Run: node scripts/memory-lint.mjs
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative, sep } from 'node:path'

const ROOT = 'docs/memory'
const CAPSULE_MAX_LINES = 60 // density cap: a capsule points, it does not paste
const ABSTRACT_MAX_CHARS = 140 // the L0 load-or-skip line: long enough to route, too short to weigh
const STALE_DAYS = 30 // a capsule unchecked for longer is a claim about the past
const PROMOTE_DAYS = 14 // a session note this old is either durable or archivable
const TODAY = new Date()

// A sentence break: terminal punctuation, whitespace, then something that starts a new sentence.
// Deliberately NOT a bare /\./ — `router.tsx`, `src/app/` and `v1.5` all carry dots that are not
// sentence ends, and rejecting those would make the rule unusable in a repo full of file paths.
const SENTENCE_BREAK = /[.!?]\s+["'([]?[A-Z]/

const errors = []
const warnings = []

// archive/ is deliberately skipped: those notes are out of circulation, no agent loads them, and
// they are SUPPOSED to be stale. Linting them would generate noise that can never be actioned.
function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'archive') continue
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (entry.endsWith('.md')) out.push(p)
  }
  return out
}

/** Minimal YAML front-matter reader — flat scalars and [a, b] lists only, which is all we use. */
function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!m) return null
  const out = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/)
    if (!kv) continue
    const [, key, raw] = kv
    out[key] =
      raw.startsWith('[') && raw.endsWith(']')
        ? raw.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean)
        : raw.trim()
  }
  out.__length = m[0].split(/\r?\n/).length - 1
  return out
}

const daysSince = (iso) => Math.floor((TODAY - new Date(iso)) / 86_400_000)

/**
 * The abstract (ADR-0064) is the L0 load-or-skip line: what an agent reads INSTEAD of the capsule,
 * to decide whether to open it. Every failure below is provably wrong the moment it is written —
 * which is why these are errors, not warnings.
 *
 * One rule is deliberately absent: that the sentence leads with scope and puts judgement second.
 * No regex can tell those apart, and a guess would reject good abstracts. It is a review rule,
 * documented in docs/memory/README.md.
 *
 * Returns a problem description, or null when the abstract is fine.
 */
function abstractProblem(raw) {
  if (raw === undefined) {
    return "front matter missing 'abstract' — a capsule must say what it is for (ADR-0064)"
  }
  // The reader above turns a leading '[' into a list, which is exactly why abstracts may not use one.
  if (Array.isArray(raw)) return "abstract must not begin with '[' — the front-matter reader takes that for a list"
  const a = String(raw).trim()
  if (!a) return 'abstract is empty'
  if (a.length > ABSTRACT_MAX_CHARS) {
    return `abstract is ${a.length} characters, cap is ${ABSTRACT_MAX_CHARS} — it routes, it does not summarise`
  }
  if (SENTENCE_BREAK.test(a)) {
    return 'abstract spans more than one sentence — one sentence, or it is a summary an agent has to weigh'
  }
  return null
}

if (!existsSync(ROOT)) {
  console.error(`No ${ROOT}/ — nothing to lint.`)
  process.exit(1)
}

const files = walk(ROOT)
const linkedFromMap = new Map() // capsule path -> the abstract MAP.md claims for it
const capsuleAbstracts = new Map() // capsule path -> the abstract the capsule actually declares

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const fm = frontmatter(text)
  const rel = file.replace(/\\/g, '/')

  // ---- 1. every note declares what it is, where it came from, and when it was last checked ----
  if (!fm) {
    errors.push(`${rel}: no YAML front matter`)
    continue
  }
  for (const key of ['type', 'status', 'origin', 'verified']) {
    if (!fm[key]) errors.push(`${rel}: front matter missing '${key}'`)
  }
  if (fm.origin && !['human', 'ai-derived'].includes(fm.origin)) {
    errors.push(`${rel}: origin must be 'human' or 'ai-derived' (got '${fm.origin}')`)
  }
  if (fm.verified && Number.isNaN(Date.parse(fm.verified))) {
    errors.push(`${rel}: verified is not a date (got '${fm.verified}')`)
  }

  const body = text.split(/\r?\n/).slice(fm.__length ?? 0)

  // ---- 2. the density cap, and the abstract that decides whether the capsule is opened at all ----
  if (fm.type === 'capsule') {
    const problem = abstractProblem(fm.abstract)
    if (problem) errors.push(`${rel}: ${problem}`)
    else capsuleAbstracts.set(relative(join(ROOT), file).replace(/\\/g, '/'), String(fm.abstract).trim())

    const lines = body.filter((l) => l.trim() !== '').length
    if (lines > CAPSULE_MAX_LINES) {
      errors.push(
        `${rel}: ${lines} lines of content, cap is ${CAPSULE_MAX_LINES}. ` +
          'Cut, or split — a capsule points at source, it does not reproduce it.',
      )
    }
  }

  // ---- 3. dead links and dead source paths: the commonest rot, and invisible in review ----
  for (const [, target] of text.matchAll(/\]\(([^)#][^)]*)\)/g)) {
    if (/^(https?:|mailto:)/.test(target)) continue
    const path = target.split('#')[0]
    if (!path) continue
    if (!existsSync(resolve(dirname(file), path))) {
      errors.push(`${rel}: link to '${target}' does not exist`)
    }
  }
  for (const src of Array.isArray(fm.sources) ? fm.sources : []) {
    // Sources may be globbed or prose-ish; only check the ones that look like a concrete path.
    if (/[*?]/.test(src) || !src.includes('/')) continue
    if (!existsSync(src)) warnings.push(`${rel}: source '${src}' no longer exists`)
  }

  // ---- 4. staleness — a claim about a date, not a claim about the code ----
  if (fm.verified && !Number.isNaN(Date.parse(fm.verified))) {
    const age = daysSince(fm.verified)
    if (['capsule', 'state', 'trap'].includes(fm.type) && age > STALE_DAYS && fm.status === 'current') {
      warnings.push(`${rel}: verified ${age} days ago — re-check against the code, or set status: needs-check`)
    }
    if (fm.type === 'session' && age > PROMOTE_DAYS && !rel.includes('/archive/')) {
      warnings.push(`${rel}: ${age} days old — promote what is durable, then move it to archive/`)
    }
  }

  if (rel.endsWith('MAP.md')) {
    // Capture the rest of the table cell after the link: MAP.md carries a verbatim copy of each
    // capsule's abstract so the map alone can answer "is this the right capsule?".
    for (const m of text.matchAll(/\]\((capsules\/[^)]+)\)([^|\n]*)/g)) {
      linkedFromMap.set(m[1], m[2].replace(/^\s*—\s*/, '').trim())
    }
  }
}

// ---- 5. MAP.md's copy of an abstract must match the capsule's own, character for character ----
// A copy is only safe when something checks it; unchecked, it is just a second thing to go stale.
for (const [target, mapCopy] of linkedFromMap) {
  const own = capsuleAbstracts.get(target)
  if (own === undefined) continue // no valid abstract to compare against — already reported above
  if (!mapCopy) {
    errors.push(`MAP.md: routes to '${target}' without its abstract — the row cannot be judged from the map`)
  } else if (mapCopy !== own) {
    errors.push(
      `MAP.md: abstract for '${target}' does not match the capsule's own\n` +
        `          map:     ${mapCopy}\n` +
        `          capsule: ${own}`,
    )
  }
}

// ---- 6. traps.md indexes itself, or the index is just another thing to go stale ----
// traps.md is the largest note in the store and grows every time something bites. Reading it whole
// to answer one question costs ~12k tokens; its index costs ~1k, so `/memory-start` reads the index
// and opens only the entries whose SYMPTOM could match. That only works while the index is complete
// — an entry it does not list is one nobody will ever be routed to, and nothing else would notice.
const trapsFile = files.find((f) => f.split(sep).pop() === 'traps.md')
if (trapsFile) {
  const text = readFileSync(trapsFile, 'utf8')
  // Anchored to the index heading, not to the first horizontal rule: the first `---` in the file
  // is the front matter's own delimiter, which would leave the index empty and fail every entry.
  const start = text.indexOf('## Index')
  const rest = start >= 0 ? text.slice(start) : ''
  const end = rest.search(/^---$/m)
  // FAIL LOUD, not open. An earlier cut treated "no closing rule" as "the index is the whole file",
  // so every entry matched and the check silently passed while proving nothing — the same
  // fail-silent shape as an unresolvable PostgREST embed returning empty instead of erroring.
  const index = end > 0 ? rest.slice(0, end) : ''
  for (const [, heading] of text.matchAll(/^### (.+)$/gm)) {
    if (!index.includes(heading.trim())) {
      errors.push(
        `docs/memory/traps.md: '${heading.trim()}' is not in the index — nobody will be routed to it`,
      )
    }
  }
}

// ---- 7. orphans: a capsule the map never routes to will never be read ----
for (const file of files) {
  const rel = file.replace(/\\/g, '/')
  if (!rel.includes('/capsules/')) continue
  const fromMap = relative(join(ROOT), file).replace(/\\/g, '/')
  if (!linkedFromMap.has(fromMap)) {
    warnings.push(`${rel}: not routed to from MAP.md — no agent will ever load it`)
  }
}

for (const w of warnings) console.warn('  warn  ' + w)
for (const e of errors) console.error('  ERROR ' + e)

if (errors.length > 0) {
  console.error(`\nmemory-lint: ${errors.length} error(s), ${warnings.length} warning(s)`)
  process.exit(1)
}
console.log(
  `memory-lint: ${files.length} notes clean` +
    (warnings.length ? `, ${warnings.length} warning(s) for a human to judge` : ''),
)
