/// <reference types="node" />
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Every PostgREST query in `src/` and in `supabase/functions/` is checked, column by column,
 * against the generated schema in `src/types/database.ts` — the columns a `select(…)` READS and
 * the keys an `insert`/`update`/`upsert` payload WRITES.
 *
 * **Why this file exists.** A select string is just a string. TypeScript never looks inside it, so
 * `supabaseUntyped.from('streams').select('brief')` compiles perfectly and fails only at runtime —
 * where PostgREST answers 42703 and rejects the WHOLE query, not the one bad column. On 27 Aug
 * `campaign-detail-api.ts` asked for `streams.brief` and `work_types.brief_type`, neither of which
 * has ever existed (ADR-0048 d.5 proposed them; ADR-0050 replaced them with `campaign_briefs`
 * before they were built). `useCampaignDetail` threw for every campaign, `CampaignPage` fell
 * through to its "not found" branch, and the ADR-0048 approval gate had no reachable UI for a day.
 * The same day, `BriefTemplatesPage` was reading `work_types.brief_type` twice more.
 *
 * The suite stayed green throughout, and that is the part worth fixing: the component tests mock
 * the API hooks, so the only code that knew the truth was the code no test ever executed.
 *
 * **Writes are checked too, and for the same reason.** One of the two 27 Aug bugs was a write —
 * `.from('work_types').update({ brief_type: … })` — and a payload key is exactly as untyped as a
 * select string: `supabaseUntyped` erases the Insert/Update types, so the key is checked by
 * nothing until PostgREST rejects it.
 *
 * **Edge Functions are in scope.** They are the least-covered code in the repo — Deno, no
 * `tsc -b`, no vitest — and they write the most (`booking-transition` alone inserts into five
 * tables). The scan is plain text, so Deno's `npm:`/URL imports make no difference to it.
 *
 * The check is made against the *generated* types rather than a hand-written list, because
 * `database.ts` is regenerated from the live database — so this fails the moment `supabase gen
 * types` runs, which is the first moment anybody could have known.
 *
 * It is data-driven, not a snapshot. Nothing here records what the queries *are*: a new query file
 * is picked up with no edit, a column that exists needs no blessing, and a column that stops
 * existing fails at the site that still asks for it, named by file and line.
 *
 * **What it cannot resolve, it SAYS it cannot resolve.** A query built at runtime (a payload
 * assembled key by key, a helper that returns a row) cannot be read statically. Those are named
 * and counted by `names every query it could not read` below, because a site that is silently
 * unscanned is precisely the failure this file exists to prevent — a green suite proving nothing.
 *
 * What it still cannot see at all: RLS (a column that exists but is invisible to the caller),
 * filter and order arguments (`.eq('dead_column', …)` is not checked), ambiguity PostgREST only
 * resolves at runtime, and anything reached through `rpc()`. Those still need the database.
 */

// ---------------------------------------------------------------------------------------------
// The schema, read out of the generated types
// ---------------------------------------------------------------------------------------------

interface Relation {
  /** Column names on the relation's `Row`. */
  columns: Set<string>
  /** Relations this one holds a foreign key TO; the other direction is checked from that side. */
  references: Set<string>
}

/**
 * Parse `src/types/database.ts` into relation → columns.
 *
 * Text, not types: `Database` is a type, erased at runtime, so there is nothing to import. The
 * generated file is machine-written with fixed indentation and every table block looks the same:
 *
 * ```
 *       campaign_briefs: {          // 6 spaces
 *         Row: {                    // 8
 *           brief_type: string      // 10
 * ```
 *
 * A `Functions` entry sits at the same indent but opens with `Args:`, which is how the two are told
 * apart. If this parser ever stops finding tables, `finds the generated schema` below fails rather
 * than every other test passing vacuously.
 */
function readSchema(): { relations: Map<string, Relation>; foreignKeys: Set<string> } {
  // Split on /\r?\n/, never on '\n'. `core.autocrlf` is true here, so `database.ts` is CRLF in the
  // working tree; splitting on '\n' leaves a trailing '\r' on every line and the anchored patterns
  // below then match nothing at all. This bit once, and it is worth naming: the parser returning
  // zero relations is the LOUD failure (every column looks missing). Written the other way round —
  // a parser that silently returned a partial schema — every dead column would have looked fine.
  const lines = readFileSync('src/types/database.ts', 'utf8').split(/\r?\n/)
  const relations = new Map<string, Relation>()
  const foreignKeys = new Set<string>()

  for (let i = 0; i < lines.length; i++) {
    const head = /^ {6}([a-z_0-9]+): \{$/.exec(lines[i]!)
    if (!head || !/^ {8}Row: \{$/.test(lines[i + 1] ?? '')) continue

    const columns = new Set<string>()
    let j = i + 2
    for (; j < lines.length && !/^ {8}\}$/.test(lines[j]!); j++) {
      const column = /^ {10}([a-z_0-9]+)\??:/.exec(lines[j]!)
      if (column) columns.add(column[1]!)
    }

    const references = new Set<string>()
    for (let k = j; k < lines.length && !/^ {6}\}$/.test(lines[k]!); k++) {
      const referenced = /referencedRelation: "([a-z_0-9]+)"/.exec(lines[k]!)
      if (referenced) references.add(referenced[1]!)
      const key = /foreignKeyName: "([a-z_0-9]+)"/.exec(lines[k]!)
      if (key) foreignKeys.add(key[1]!)
    }

    relations.set(head[1]!, { columns, references })
  }
  return { relations, foreignKeys }
}

const { relations, foreignKeys } = readSchema()

/**
 * Every table any migration creates.
 *
 * `src/types/database.ts` is generated and **lags the migrations** until Edward runs
 * `supabase gen types` against the linked project — the gap `supabaseUntyped` exists to bridge
 * (CLAUDE.md, "Database"). So a query against a table this file has never heard of is one of two
 * very different things:
 *
 *   * a table a migration on this branch created, awaiting type regen — normal, and skipped
 *     below with its name reported;
 *   * a typo, or a table that never existed — which is exactly what this suite catches.
 *
 * Without the distinction the whole suite fails on every branch that adds a table, and the usual
 * response to that is to weaken the guard. Columns are never given this latitude: a KNOWN table
 * with an unknown column stays a hard failure, because that is the `work_types.brief_type` bug.
 */
function schemaFromMigrations(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  const dir = 'supabase/migrations'
  if (!existsSync(dir)) return found
  const columnsOf = (table: string) => {
    const existing = found.get(table)
    if (existing) return existing
    const fresh = new Set<string>()
    found.set(table, fresh)
    return fresh
  }

  const CREATE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_0-9]+)\s*\(([\s\S]*?)\)\s*;/gi
  const ALTER = /alter\s+table\s+(?:only\s+)?(?:public\.)?([a-z_0-9]+)([\s\S]*?);/gi
  const ADD_COLUMN = /add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_0-9]+)/gi
  const COLUMN_LINE = /^\s{2,}([a-z_0-9]+)\s+[a-z]/i
  const VIEW = /create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?([a-z_0-9]+)([\s\S]*?);/gi
  const AS_ALIAS = /as\s+([a-z_0-9]+)/gi
  // A PostgREST COMPUTED COLUMN: a public function whose single argument is a table's composite
  // type is selectable as a virtual column of that table (select=...,can_approve_tasks). Matches
  // create [or replace] function public.<name>(<arg> [public.]<table>) -- one argument only, so a
  // closing paren must follow it. <name> becomes a column of <table>. Added 12 Sep with the first
  // such column (ADR-0090, can_approve_tasks). Over-collecting is safe for the reason this scanner
  // already relies on (pgTAP replays the real SQL); a function taking a non-table arg such as uuid
  // merely registers a column on a relation no query selects.
  const COMPUTED_COLUMN =
    /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_0-9]+)\s*\(\s*[a-z_0-9]+\s+(?:public\.)?([a-z_0-9]+)\s*\)/gi
  const NEWLINE = /\r?\n/

  for (const file of readdirSync(dir).filter((n) => n.endsWith('.sql'))) {
    const sql = readFileSync(`${dir}/${file}`, 'utf8')

    // `create table x ( … )` — the first identifier of each line inside the parens.
    //
    // Crude on purpose. Over-collecting (a constraint name read as a column) only makes this guard
    // more PERMISSIVE about a column that does not exist, and pgTAP already replays every
    // migration against a real Postgres, so the database catches that. Under-collecting would fail
    // the branch that legitimately added the column — which is the failure being fixed here.
    for (const m of sql.matchAll(CREATE)) {
      const cols = columnsOf(m[1]!.toLowerCase())
      for (const line of m[2]!.split(NEWLINE)) {
        const c = COLUMN_LINE.exec(line)
        if (c) cols.add(c[1]!.toLowerCase())
      }
    }

    // `alter table x add column y`, with or without `if not exists`, one or many per statement.
    for (const m of sql.matchAll(ALTER)) {
      const cols = columnsOf(m[1]!.toLowerCase())
      for (const a of m[2]!.matchAll(ADD_COLUMN)) cols.add(a[1]!.toLowerCase())
    }

    // `create view x ... as select a as one, b as two ...` — the ALIASES of the select list.
    //
    // Added 5 Sep with the first view the frontend reads (`unassigned_work_by_campaign`,
    // ADR-0071 d.13). Without this the guard sees a relation that exists in no migration it can
    // parse and reports the query as broken, which is the opposite of what it is for: a view a
    // migration on this branch created is exactly the "awaiting type regen" case the file already
    // handles for tables.
    //
    // Aliases only, and crude for the same stated reason as `create table` above: over-collecting
    // makes the guard more PERMISSIVE, and pgTAP replays every migration against a real Postgres,
    // so a column that does not exist is caught there. `as` is skipped where it introduces the
    // body itself (`... with (security_invoker = true) as select`) rather than naming a column.
    for (const m of sql.matchAll(VIEW)) {
      const cols = columnsOf(m[1]!.toLowerCase())
      for (const a of m[2]!.matchAll(AS_ALIAS)) {
        const name = a[1]!.toLowerCase()
        if (name !== 'select') cols.add(name)
      }
    }

    // A computed column adds a selectable name to its argument's table (PostgREST). Registered
    // like any other column so `select=...,can_approve_tasks` is not read as a missing column.
    for (const m of sql.matchAll(COMPUTED_COLUMN)) {
      columnsOf(m[2]!.toLowerCase()).add(m[1]!.toLowerCase())
    }
  }
  return found
}

const migrationSchema = schemaFromMigrations()

/**
 * Foreign-key CONSTRAINT NAMES declared in a migration but not yet in the generated types.
 *
 * The same latitude `schemaFromMigrations` gives a new table, for the same reason: `database.ts`
 * lags until `supabase gen types` runs, and a branch that adds a relationship should not fail on
 * that gap. A name that exists in NO migration is still a hard failure — that is the typo this
 * guard is for.
 */
function foreignKeysFromMigrations(): { names: Set<string>; pairs: Set<string> } {
  const names = new Set<string>()
  const pairs = new Set<string>()
  const dir = 'supabase/migrations'
  if (!existsSync(dir)) return { names, pairs }
  // `alter table X add constraint N foreign key (…) references Y (…)`. Composite keys included —
  // the generated types describe them, but only after `gen types` has run.
  //
  // `[^;]` between the two halves, NOT `[\s\S]`: a statement terminator ends the match. Without it
  // the gap runs across statements and the constraint gets attributed to whichever table an EARLIER
  // `alter table` named — which is exactly what it did on the first attempt, reading
  // `fk_departments_brief_template` as a key on `brief_templates`.
  const NAMED =
    /alter\s+table\s+(?:only\s+)?(?:public\.)?([a-z_0-9]+)[^;]{0,400}?add\s+constraint\s+([a-z_0-9]+)\s+foreign\s+key\s*\([^)]*\)\s*references\s+(?:public\.)?([a-z_0-9]+)/gi
  for (const file of readdirSync(dir).filter((n) => n.endsWith('.sql'))) {
    const sql = readFileSync(`${dir}/${file}`, 'utf8')
    for (const m of sql.matchAll(NAMED)) {
      names.add(m[2]!.toLowerCase())
      // Recorded in BOTH directions: an embed is legal from either end of the key.
      pairs.add(`${m[1]!.toLowerCase()}>${m[3]!.toLowerCase()}`)
      pairs.add(`${m[3]!.toLowerCase()}>${m[1]!.toLowerCase()}`)
    }
  }
  return { names, pairs }
}

const migrationForeignKeys = foreignKeysFromMigrations()

/** True when a migration declares a key joining these two, even if the types have not caught up. */
const joinAwaitingRegen = (a: string, b: string) =>
  migrationForeignKeys.pairs.has(`${a.toLowerCase()}>${b.toLowerCase()}`)

/** True when a relation exists in a migration but not yet in the generated types. */
const relationAwaitingRegen = (table: string) =>
  !relations.has(table) && migrationSchema.has(table)

/** True when a column exists in a migration but not yet in the generated types. */
const columnAwaitingRegen = (table: string, column: string) =>
  !relations.get(table)?.columns.has(column) && (migrationSchema.get(table)?.has(column) ?? false)

// ---------------------------------------------------------------------------------------------
// The queries, read out of the source
// ---------------------------------------------------------------------------------------------

/** A query whose columns could be resolved and therefore checked. */
interface QuerySite {
  file: string
  line: number
  table: string
  /** `select` reads columns; the rest write payload keys. */
  kind: 'select' | 'insert' | 'update' | 'upsert'
  /** The resolved select expression, or the resolved payload keys. */
  select?: string
  keys?: string[]
}

/** A query this file could NOT resolve. Counted and listed — never dropped in silence. */
interface SkippedSite {
  file: string
  line: number
  kind: string
  detail: string
}

const skipped: SkippedSite[] = []

/**
 * Every file that could hold a query: the app, and the Edge Functions.
 *
 * Tests are skipped — their selects are fixtures, deliberately including broken ones. `src/types`
 * is skipped because it IS the schema.
 */
function sourceFiles(dir: string, found: string[] = []): string[] {
  if (!existsSync(dir)) return found
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      if (path !== 'src/types') sourceFiles(path, found)
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(path)
    }
  }
  return found
}

/**
 * Blank out comments, keeping offsets and line breaks.
 *
 * Prose is full of apostrophes — "the reviewer's panel" — and a scanner that does not know a
 * comment from code reads one as the start of a string literal and swallows the query after it.
 */
function withoutComments(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        out += ' '
        i++
      }
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i] === '\n' ? '\n' : ' '
        i++
      }
      out += '  '
      i += 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      out += ch
      i++
      while (i < text.length) {
        if (text[i] === '\\') {
          out += text[i]! + (text[i + 1] ?? '')
          i += 2
          continue
        }
        out += text[i]
        if (text[i] === ch) {
          i++
          break
        }
        i++
      }
      continue
    }
    out += ch
    i++
  }
  return out
}

/** Read the argument list of a call whose `(` is at `open`, stopping at the top-level comma that
 *  begins an options object (`{ count: 'exact' }`, `{ onConflict: … }`) — that is not columns. */
function firstArgument(text: string, open: number): string {
  let depth = 1
  let quote: string | null = null
  let arg = ''
  for (let i = open + 1; i < text.length && depth > 0; i++) {
    const ch = text[i]!
    if (quote) {
      if (ch === '\\') {
        arg += ch + (text[++i] ?? '')
        continue
      }
      if (ch === quote) quote = null
      arg += ch
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      arg += ch
      continue
    }
    if (ch === '(' || ch === '{' || ch === '[') depth++
    if (ch === '}' || ch === ']') depth--
    if (ch === ')' && --depth === 0) break
    if (ch === ',' && depth === 1) break
    arg += ch
  }
  return arg
}

/**
 * Read a `const X = …` initializer expression from just after the `=`.
 *
 * It ends at a `;`, or at a newline that no operator carries over — so a select string broken
 * across lines with `+`, an object spanning many lines, and a ternary whose branches start on the
 * next line all read as one expression, while the next statement does not get swallowed.
 */
function readInitializer(text: string, from: number): string {
  let depth = 0
  let quote: string | null = null
  let out = ''
  for (let i = from; i < text.length; i++) {
    const ch = text[i]!
    if (quote) {
      out += ch
      if (ch === '\\') out += text[++i] ?? ''
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      out += ch
      continue
    }
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') depth--
    else if (ch === ';' && depth === 0) break
    else if (ch === '\n' && depth === 0 && out.trim()) {
      const before = out.trimEnd().slice(-2)
      const after = text.slice(i + 1).match(/^\s*(\S{1,2})/)?.[1] ?? ''
      const carries = /[+,(=?:&|[]$/.test(before) || /^([+.?:)\]}]|&&|\|\||\?\?)/.test(after)
      if (!carries) break
    }
    out += ch
  }
  return out
}

/** `const NAME = …` in one file, name → initializer expression. A name declared twice is dropped:
 *  a guess about which one reached the query would be worse than an honest skip. */
function constants(text: string): Map<string, string | null> {
  const found = new Map<string, string | null>()
  const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;]+?)?=\s*(?!=)/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const name = m[1]!
    if (found.has(name)) found.set(name, null) // declared more than once — ambiguous
    else found.set(name, readInitializer(text, m.index + m[0].length))
  }
  return found
}

/** Keys given to `X` by later assignment — the `const patch: Record<string, unknown> = {}` then
 *  `patch.status = …` shape, which is how every conditional update in this repo is built. */
function assignedKeys(text: string, name: string): string[] {
  const re = new RegExp(`\\b${name}\\.([A-Za-z_$][\\w$]*)\\s*=(?!=)`, 'g')
  return [...text.matchAll(re)].map((m) => m[1]!)
}

/** Resolve a select argument to the string PostgREST will receive: string literals, `+`
 *  concatenation, and ONE level of `const` reference. Null when it cannot be known statically. */
function resolveString(expr: string, consts: Map<string, string | null>, depth = 0): string | null {
  let out = ''
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]!
    if (/\s|[+()]/.test(ch)) {
      i++
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let value = ''
      i++
      while (i < expr.length && expr[i] !== ch) {
        if (expr[i] === '\\') {
          value += expr[i + 1] ?? ''
          i += 2
          continue
        }
        value += expr[i]
        i++
      }
      i++
      if (ch === '`' && value.includes('${')) return null // interpolated — unknowable
      out += value
      continue
    }
    const id = /^[A-Za-z_$][\w$]*/.exec(expr.slice(i))
    if (id) {
      if (depth > 0) return null // one level of indirection, deliberately
      const init = consts.get(id[0])
      if (!init) return null
      const nested = resolveString(init, consts, depth + 1)
      if (nested === null) return null
      out += nested
      i += id[0].length
      continue
    }
    return null
  }
  return out
}

/** Split on top-level commas, aware of strings and every kind of bracket. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quote) {
      current += ch
      if (ch === '\\') current += text[++i] ?? ''
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      current += ch
      continue
    }
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts.map((s) => s.trim()).filter(Boolean)
}

/** The bodies of the object literals at the top level of an expression — an object, an array of
 *  them, or the one a `.map(…)` callback returns, whether it returns it directly (`=> ({…})`) or
 *  out of a block (`=> { const span = …; return {…} }`, which is how `subtask-schedule` builds a
 *  booking). Nested objects are values, not payloads. */
function objectBodies(expr: string): string[] {
  const bodies: string[] = []
  let quote: string | null = null
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]!
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      continue
    }
    if (ch !== '{') continue
    let depth = 0
    let j = i
    for (; j < expr.length; j++) {
      const c = expr[j]!
      if (quote) {
        if (c === '\\') j++
        else if (c === quote) quote = null
        continue
      }
      if (c === "'" || c === '"' || c === '`') {
        quote = c
        continue
      }
      if (c === '{') depth++
      else if (c === '}' && --depth === 0) break
    }
    const body = expr.slice(i + 1, j)
    const isBlock = /=>\s*$/.test(expr.slice(0, i)) && /\breturn\b/.test(body)
    if (isBlock) bodies.push(...objectBodies(body.slice(body.search(/\breturn\b/) + 6)))
    else bodies.push(body)
    i = j
  }
  return bodies
}

interface PayloadKeys {
  keys: string[]
  /** Why part (or all) of the payload could not be read. Empty means fully resolved. */
  unresolved: string[]
}

/** The column names a write payload sets. One level of `const` indirection, like the selects. */
function payloadKeys(
  expr: string,
  consts: Map<string, string | null>,
  text: string,
  depth = 0,
): PayloadKeys {
  const trimmed = expr.trim()
  if (!trimmed) return { keys: [], unresolved: ['empty payload'] }

  const bodies = objectBodies(trimmed)
  if (bodies.length === 0) {
    const id = /^[A-Za-z_$][\w$]*$/.test(trimmed) ? trimmed : null
    if (!id || depth > 0) {
      return { keys: [], unresolved: [`payload is computed: ${oneLine(trimmed)}`] }
    }
    const init = consts.get(id)
    // `const patch: Record<string, unknown> = {}` then `patch.x = …` — resolvable, and common.
    const assigned = assignedKeys(text, id)
    if (init === undefined) return { keys: [], unresolved: [`payload "${id}" is not a local const`] }
    if (init === null) return { keys: [], unresolved: [`payload "${id}" is declared twice`] }
    const inner = payloadKeys(init, consts, text, depth + 1)
    const keys = [...new Set([...inner.keys, ...assigned])]
    if (keys.length === 0) {
      return { keys: [], unresolved: [`payload "${id}" has no readable keys`] }
    }
    return { keys, unresolved: inner.keys.length === 0 ? [] : inner.unresolved }
  }

  const keys: string[] = []
  const unresolved: string[] = []
  for (const body of bodies) {
    for (const part of splitTopLevel(body)) {
      if (part.startsWith('...')) {
        const spread = part.slice(3).trim()
        const init = /^[A-Za-z_$][\w$]*$/.test(spread) ? consts.get(spread) : undefined
        if (depth === 0 && init) {
          const inner = payloadKeys(init, consts, text, depth + 1)
          keys.push(...inner.keys)
          unresolved.push(...inner.unresolved)
        } else {
          unresolved.push(`spread of ${oneLine(spread)}`)
        }
        continue
      }
      if (part.startsWith('[')) {
        unresolved.push(`computed key ${oneLine(part)}`)
        continue
      }
      const colon = splitOnFirstColon(part)
      const raw = (colon ?? part).trim()
      const name = /^(['"])(.*)\1$/.exec(raw)?.[2] ?? raw
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
        unresolved.push(`unreadable key ${oneLine(part)}`)
        continue
      }
      keys.push(name)
    }
  }
  return { keys: [...new Set(keys)], unresolved }
}

/** The text before a property's `:`, or null for shorthand (`{ fields }`). Bracket-aware, so a
 *  ternary in a VALUE cannot be mistaken for the separator. */
function splitOnFirstColon(part: string): string | null {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < part.length; i++) {
    const ch = part[i]!
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') depth--
    else if (ch === ':' && depth === 0) return part.slice(0, i)
  }
  return null
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 60)

/** JS builtins whose `.from(` is not a table. */
const NOT_A_TABLE = /(?:Array|Object|String|Number|Buffer|Uint8Array|Set|Map|Promise|Date)$/

/**
 * Pull every query out of one source file.
 *
 * A `.from('x')` owns the chain up to the next `.from(`, and within it a `.select(…)` is read as
 * columns and an `.insert`/`.update`/`.upsert(…)` as a payload — an insert that returns rows has
 * both, and both are on the same table. The select argument is read to its matching close paren
 * rather than the first one, because embeds put parens inside the string (`departments(name)`).
 * Backticks count as quotes: `` .from(`bookings`) `` is the same query as `.from('bookings')`.
 */
function querySites(file: string): QuerySite[] {
  const text = withoutComments(readFileSync(file, 'utf8'))
  const consts = constants(text)
  const sites: QuerySite[] = []
  const lineOf = (index: number) => text.slice(0, index).split('\n').length

  const fromPositions: number[] = []
  for (let at = text.indexOf('.from('); at >= 0; at = text.indexOf('.from(', at + 1)) {
    if (NOT_A_TABLE.test(text.slice(Math.max(0, at - 12), at))) continue
    fromPositions.push(at)
  }

  for (let n = 0; n < fromPositions.length; n++) {
    const at = fromPositions[n]!
    const line = lineOf(at)
    const table = /^\.from\(\s*(['"`])([a-z_0-9]+)\1\s*\)/.exec(text.slice(at))?.[2]
    if (!table) {
      skipped.push({
        file,
        line,
        kind: 'from',
        detail: `table is not a literal: ${oneLine(text.slice(at, at + 60))}`,
      })
      continue
    }
    const segment = text.slice(at, fromPositions[n + 1] ?? text.length)

    const select = segment.indexOf('.select(')
    if (select >= 0) {
      const arg = firstArgument(segment, select + '.select('.length - 1)
      if (arg.trim() === '') {
        // `.select()` — every column, nothing to get wrong.
      } else {
        const resolved = resolveString(arg, consts)
        if (resolved === null) {
          skipped.push({ file, line, kind: 'select', detail: `computed: ${oneLine(arg)}` })
        } else {
          sites.push({ file, line: lineOf(at + select), table, kind: 'select', select: resolved })
        }
      }
    }

    for (const verb of ['insert', 'update', 'upsert'] as const) {
      const call = segment.indexOf(`.${verb}(`)
      if (call < 0) continue
      const arg = firstArgument(segment, call + `.${verb}(`.length - 1)
      const { keys, unresolved } = payloadKeys(arg, consts, text)
      if (keys.length > 0) {
        sites.push({ file, line: lineOf(at + call), table, kind: verb, keys })
      }
      for (const detail of unresolved) {
        skipped.push({ file, line: lineOf(at + call), kind: verb, detail })
      }
    }
  }
  return sites
}

/** Split a select expression on its top-level commas — `a, b(c, d), e` → three items. */
function topLevelItems(expr: string): string[] {
  const items: string[] = []
  let depth = 0
  let current = ''
  for (const ch of expr) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      items.push(current)
      current = ''
      continue
    }
    current += ch
  }
  items.push(current)
  return items.map((s) => s.trim()).filter(Boolean)
}

/**
 * Walk one select expression against `table`, collecting every complaint rather than throwing on
 * the first — a query with three dead columns should say so once.
 *
 * Grammar handled: `alias:name`, `name!inner`, `name!some_fkey` and `name!some_column` (the
 * disambiguating hints an embed must carry when two tables are joined by more than one key — the
 * six-FK `sub_tasks → user_profiles` case), `name(children…)`, `*`, `count`, and a `->` or `::cast`
 * suffix on a JSON column.
 */
function problemsIn(table: string, expr: string, path: string): string[] {
  const problems: string[] = []
  const relation = relations.get(table)
  if (!relation) {
    if (relationAwaitingRegen(table)) return []
    return [`${path}: relation "${table}" is not in the generated schema, and no migration creates it`]
  }

  for (const item of topLevelItems(expr)) {
    const open = item.indexOf('(')
    const head = (open < 0 ? item : item.slice(0, open)).trim()
    const children = open < 0 ? null : item.slice(open + 1, item.lastIndexOf(')'))
    const afterAlias = head.includes(':') ? head.slice(head.indexOf(':') + 1) : head
    const [name = '', ...hints] = afterAlias.split('!').map((s) => s.trim())

    if (children === null) {
      if (name === '*' || name === 'count') continue
      const column = name.split('->')[0]!.split('::')[0]!.trim()
      if (!relation.columns.has(column) && !columnAwaitingRegen(table, column)) {
        problems.push(`${path}: ${table}.${column} does not exist`)
      }
      continue
    }

    const embedded = relations.get(name)
    if (!embedded) {
      // A relation a migration on this branch creates is the type-regen gap, not a typo — the same
      // latitude the top-level table gets, and for the same reason.
      if (!relationAwaitingRegen(name)) {
        problems.push(`${path}: embedded relation "${name}" does not exist, and no migration creates it`)
      }
      continue
    }
    for (const hint of hints) {
      const known =
        hint === 'inner' ||
        hint === 'left' ||
        foreignKeys.has(hint) ||
        migrationForeignKeys.names.has(hint.toLowerCase()) ||
        relation.columns.has(hint) ||
        embedded.columns.has(hint)
      if (!known) problems.push(`${path}: "${hint}" is neither a foreign key nor a column`)
    }
    // The key may be declared on either side — a campaign embeds its campaign_briefs, but the key
    // lives on the child. An embed with no key at all is a query PostgREST refuses outright.
    if (
      !relation.references.has(name) &&
      !embedded.references.has(table) &&
      !joinAwaitingRegen(table, name)
    ) {
      problems.push(`${path}: no foreign key joins ${table} to ${name}`)
    }
    problems.push(...problemsIn(name, children, `${path} > ${name}`))
  }
  return problems
}

/** The write half: every key in a payload has to be a column on the table it is written to. */
function problemsWriting(table: string, keys: string[], path: string): string[] {
  const relation = relations.get(table)
  if (!relation) {
    if (relationAwaitingRegen(table)) return []
    return [`${path}: relation "${table}" is not in the generated schema, and no migration creates it`]
  }
  return keys
    .filter((key) => !relation.columns.has(key) && !columnAwaitingRegen(table, key))
    .map((key) => `${path}: ${table}.${key} does not exist`)
}

// ---------------------------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------------------------

const sites = [...sourceFiles('src'), ...sourceFiles('supabase/functions')].flatMap(querySites)
const reads = sites.filter((s) => s.kind === 'select')
const writes = sites.filter((s) => s.kind !== 'select')

/**
 * Floors, pinned just under the real numbers on 28 Aug: 51 relations, 167 foreign keys, 150
 * resolved selects and 69 resolved write payloads.
 *
 * They exist to catch the scanner silently going blind — a regex that stops matching, a directory
 * that stops being walked — which otherwise shows up only as a suite that passes faster. Raise
 * them as the app grows; never lower one to make a run green.
 */
const AT_LEAST = { relations: 50, foreignKeys: 165, reads: 145, writes: 66 }

/**
 * The queries this file cannot read statically, exactly as counted today: two, both in
 * `resources-api.ts`, where the payload is whatever `toRow(args)` returns.
 *
 * They are listed rather than hidden — an unscanned site that nobody knows is unscanned is the
 * state that let the 27 Aug bug ship. The fix for either of them is in the source, not here:
 * inline the row and it gets checked like everything else.
 */
const EXPECTED_SKIPS = 2

/** Files whose queries broke in the way this guard exists to catch. They must stay covered. */
const MUST_BE_COVERED = [
  'src/features/campaigns/api/campaign-detail-api.ts',
  'src/features/deliverables/api/deliverables-api.ts',
  'src/features/admin/api/brief-templates-api.ts',
  'supabase/functions/booking-transition/index.ts',
]

describe('PostgREST queries match the generated schema', () => {
  it('finds the generated schema', () => {
    // Guard the guard: a parser that silently matched nothing would make everything below pass.
    expect(relations.size).toBeGreaterThanOrEqual(AT_LEAST.relations)
    expect(relations.get('campaign_briefs')?.columns).toContain('department_id')
    expect(foreignKeys.size).toBeGreaterThanOrEqual(AT_LEAST.foreignKeys)
  })

  it('finds the queries, reads and writes alike', () => {
    expect(reads.length).toBeGreaterThanOrEqual(AT_LEAST.reads)
    expect(writes.length).toBeGreaterThanOrEqual(AT_LEAST.writes)
    for (const file of MUST_BE_COVERED) {
      expect(sites.filter((s) => s.file === file).length).toBeGreaterThan(0)
    }
    // The 27 Aug bugs in the two shapes they took: a read here, a write there.
    expect(reads.some((s) => s.file.includes('campaign-detail-api'))).toBe(true)
    expect(writes.some((s) => s.file.includes('brief-templates-api'))).toBe(true)
    // And the Edge Function the compiler and the suite both leave alone. I21 (ADR-0056 d.13)
    // removed `work_type_id` from its insert, so the tripwire moves to a column that is still
    // there — the point is that this scanner reaches inside a Deno file nothing else typechecks,
    // not which column it happens to find.
    expect(
      writes.some((s) => s.file.includes('booking-transition') && s.keys?.includes('resource_id')),
    ).toBe(true)
    // And that the retired column is gone from it, which is the thing that would have broken
    // every booking creation in production.
    expect(
      writes.some((s) => s.file.includes('booking-transition') && s.keys?.includes('work_type_id')),
    ).toBe(false)
  })

  it('names every query it could not read, and counts them', () => {
    // If this number moves, a query became unreadable (or readable). Look at the list before
    // changing it: a silently unscanned site is the failure mode this whole file exists to fix.
    const inventory = skipped.map((s) => `${s.file}:${s.line} ${s.kind} — ${s.detail}`).sort()
    expect({ count: inventory.length, inventory }).toEqual({
      count: EXPECTED_SKIPS,
      inventory,
    })
  })

  it.each(reads.map((s) => [`${s.file}:${s.line} from('${s.table}')`, s] as const))(
    '%s selects only columns that exist',
    (_label, site) => {
      expect(problemsIn(site.table, site.select!, `${site.file}:${site.line}`)).toEqual([])
    },
  )

  it.each(writes.map((s) => [`${s.file}:${s.line} ${s.kind} into '${s.table}'`, s] as const))(
    '%s writes only columns that exist',
    (_label, site) => {
      expect(problemsWriting(site.table, site.keys!, `${site.file}:${site.line}`)).toEqual([])
    },
  )

  it('rejects a column the schema does not have', () => {
    // The 27 Aug bug in miniature — a dead column at the top level and a dead column inside an
    // embed. Without this the checker could be neutered by a refactor and nothing would notice.
    // (`streams.brief` is the real one; the embed uses a table no ADR proposes to retire.)
    expect(problemsIn('streams', 'id, name, brief, deliverables(brief_type)', 'x')).toEqual([
      'x: streams.brief does not exist',
      'x > deliverables: deliverables.brief_type does not exist',
    ])
    expect(problemsIn('campaigns', 'id, campaign_briefs(id, department_id)', 'x')).toEqual([])
  })

  it('rejects a payload key the schema does not have', () => {
    // The other half of the same day: `.from('work_types').update({ brief_type: … })`. That table
    // was retired by I21, so the guarantee is re-pinned to a live one rather than deleted — the
    // point is that an unknown payload key is caught, not which table it was caught on.
    expect(problemsWriting('deliverable_types', ['name_en', 'brief_type'], 'x')).toEqual([
      'x: deliverable_types.brief_type does not exist',
    ])
    expect(problemsWriting('campaign_briefs', ['department_id', 'brief_type'], 'x')).toEqual([])
  })

  it('reads a select string that was hoisted into a const', () => {
    // The obvious refactor for three near-identical selects is to name them once. That must not
    // take them out of the scan, so a single level of const reference is resolved.
    const consts = constants(
      withoutComments("const COLS = 'id, name, ' +\n  'department_id'\nconst OTHER = `id`\n"),
    )
    expect(resolveString('COLS', consts)).toBe('id, name, department_id')
    expect(resolveString('OTHER', consts)).toBe('id')
    expect(resolveString('`${table}_id`', consts)).toBeNull() // unknowable, and says so
    expect(resolveString('buildSelect()', consts)).toBeNull()
  })

  it('reads payload keys out of the shapes this repo actually writes', () => {
    const text = withoutComments(
      'const row = { tenant_id: t, load_pct: 5 }\n' +
        'const rows = items.map((i) => ({ resource_id: i.id, hours: i.h }))\n' +
        'const patch: Record<string, unknown> = {}\n' +
        'patch.display_name = x\n' +
        'patch.is_active = y\n',
    )
    const consts = constants(text)
    const keys = (expr: string) => payloadKeys(expr, consts, text).keys.sort()
    expect(keys('{ brief_type: x, fields }')).toEqual(['brief_type', 'fields'])
    expect(keys('row')).toEqual(['load_pct', 'tenant_id'])
    expect(keys('{ ...row, state: "tentative" }')).toEqual(['load_pct', 'state', 'tenant_id'])
    expect(keys('rows')).toEqual(['hours', 'resource_id'])
    expect(keys('patch')).toEqual(['display_name', 'is_active'])
    // A value with a ternary must not be mistaken for the key separator.
    expect(keys("{ state: ok ? 'confirmed' : 'tentative' }")).toEqual(['state'])
    // And what it genuinely cannot read, it reports rather than passing.
    expect(payloadKeys('toRow(args)', consts, text).unresolved).toHaveLength(1)
  })
})
