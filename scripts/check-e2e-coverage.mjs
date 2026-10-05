#!/usr/bin/env node
/**
 * Every control on every screen has a browser test that uses it — or this says which do not.
 *
 * Edward, 15 Sep: a user pressed "Add sub-task" on a deliverable and it failed; no test had ever
 * pressed it. The retest plan listed what screens SHOW and skipped a control sitting in the guide.
 * This script makes that impossible to skip silently.
 *
 * How: every interactive element in `src/` carries a `data-testid` (the e2e convention). This lists
 * them, lists every testid any spec under `e2e/` presses or fills, and prints the difference. A
 * template id (`subtask-remove-${s.id}`) is matched by its shape (`subtask-remove-*`).
 *
 * Modes:
 *   node scripts/check-e2e-coverage.mjs            report — every uncovered control, by file
 *   node scripts/check-e2e-coverage.mjs --gate     fail if any control is uncovered that is NOT in
 *                                                  e2e/coverage-baseline.json (the known backlog)
 *   node scripts/check-e2e-coverage.mjs --write-baseline   snapshot today's gaps as the backlog
 *
 * "Interactive" = a button/input/select/textarea/anchor/form, the project's Button family, or any
 * element whose opening tag carries onClick/onChange/onSubmit. Display-only testids (a row, a
 * label, a status) are counted but not required.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { readdirSync, statSync } from 'node:fs'

const ROOT = process.cwd()
const args = new Set(process.argv.slice(2))
const BASELINE = join(ROOT, 'e2e', 'coverage-baseline.json')

function walk(dir, keep, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.auth' || name === 'test-results') continue
      walk(p, keep, out)
    } else if (keep(p)) out.push(p)
  }
  return out
}

const rel = (p) => relative(ROOT, p).split(sep).join('/')
const shape = (raw) => raw.replace(/\$\{[^}]*\}/g, '*').replace(/\*+/g, '*')

// ---------------------------------------------------------------- 1) controls in src/
const INTERACTIVE_TAGS = new Set([
  'button', 'input', 'select', 'textarea', 'a', 'form', 'label', 'summary', 'option',
  'Button', 'IconButton', 'DeleteButton', 'Link', 'NavLink', 'PillSelect', 'ChoiceCard',
])
const HANDLER = /\bon(Click|Change|Submit|KeyDown|Input|Check|Select|Toggle)\b/

const srcFiles = walk(join(ROOT, 'src'), (p) => /\.tsx$/.test(p) && !/\.test\.tsx$/.test(p))
/** @type {Map<string, {file:string, tag:string, interactive:boolean, raw:string}>} */
const controls = new Map()
const attrRe = /data-testid=(?:"([^"]+)"|\{`([^`]+)`\}|\{'([^']+)'\})/g
for (const f of srcFiles) {
  const text = readFileSync(f, 'utf8')
  let m
  while ((m = attrRe.exec(text))) {
    const raw = m[1] ?? m[2] ?? m[3]
    // A doc-comment example (`data-testid="…"` in a usage note) is not a control.
    if (!/[A-Za-z0-9]/.test(raw)) continue
    // The opening tag this attribute sits in: walk back to the nearest unmatched '<'.
    const before = text.slice(0, m.index)
    const open = before.lastIndexOf('<')
    const tagText = before.slice(open)
    const tag = /^<([A-Za-z][\w.]*)/.exec(tagText)?.[1] ?? '?'
    // The whole opening tag, to look for a handler on it.
    const close = text.indexOf('>', m.index)
    const openingTag = text.slice(open, close === -1 ? m.index + 200 : close + 1)
    const interactive = INTERACTIVE_TAGS.has(tag) || HANDLER.test(openingTag)
    const key = shape(raw)
    if (!controls.has(key)) controls.set(key, { file: rel(f), tag, interactive, raw })
    else if (interactive) controls.get(key).interactive = true
  }
}

// ---------------------------------------------------------------- 2) testids pressed in e2e/
const e2eFiles = walk(join(ROOT, 'e2e'), (p) => /\.ts$/.test(p))
const used = new Set()
const useRe = /getByTestId\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)\s*\)/g
for (const f of e2eFiles) {
  const text = readFileSync(f, 'utf8')
  let m
  while ((m = useRe.exec(text))) used.add(shape(m[1] ?? m[2] ?? m[3]))
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const toRe = (pattern) => new RegExp('^' + pattern.split('*').map(esc).join('.*') + '$')
const controlKeys = [...controls.keys()]
// A spec pattern with a LEADING wildcard (`${prefix}-save`) is a helper over some prefix the
// script cannot resolve. Counted only when it is specific — matches at most three controls in the
// app. `*-dialog` or `*-save` would otherwise "cover" every dialog and save button there is.
const vague = new Set()
const usedRes = [...used]
  .map((u) => {
    const re = toRe(u)
    if (u.startsWith('*') && controlKeys.filter((k) => re.test(k)).length > 3) {
      vague.add(u)
      return null
    }
    return { u, re }
  })
  .filter(Boolean)

function covered(key) {
  if (used.has(key)) return true
  // A spec may press a narrower literal (`cell-abc-2026-09-15`) of a template control
  // (`cell-*-*`), or a template of a template: compare by wildcard, both ways.
  const re = toRe(key)
  for (const { u, re: ure } of usedRes) {
    if (re.test(u) || ure.test(key)) return true
  }
  return false
}

// ---------------------------------------------------------------- 3) the difference
const interactive = [...controls.entries()].filter(([, c]) => c.interactive)
const display = controls.size - interactive.length
const gaps = interactive.filter(([k]) => !covered(k)).map(([k, c]) => ({ id: k, file: c.file, tag: c.tag }))
gaps.sort((a, b) => a.file.localeCompare(b.file) || a.id.localeCompare(b.id))

if (args.has('--write-baseline')) {
  // `why` is kept from the previous baseline: the reason each remaining gap is still open, by
  // file, written by hand (the script cannot know why a control is unreachable).
  let why = {}
  try { why = JSON.parse(readFileSync(BASELINE, 'utf8')).why ?? {} } catch { /* first write */ }
  writeFileSync(BASELINE, JSON.stringify({ written: new Date().toISOString().slice(0, 10), why, gaps: gaps.map((g) => g.id) }, null, 2) + '\n')
  console.log(`baseline written: ${gaps.length} known gaps → ${rel(BASELINE)}`)
  process.exit(0)
}

const byFile = new Map()
for (const g of gaps) (byFile.get(g.file) ?? byFile.set(g.file, []).get(g.file)).push(g)

console.log(`e2e coverage of controls — ${interactive.length} interactive controls in src/ (${display} display-only testids not required), ${used.size} testids pressed by ${e2eFiles.length} spec files`)
console.log(`UNCOVERED: ${gaps.length} controls in ${byFile.size} files`)
if (vague.size) console.log(`(${vague.size} spec patterns too vague to count — a prefix variable over many controls: ${[...vague].join(', ')})`)
console.log('')
for (const [file, list] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${file}  (${list.length})`)
  for (const g of list) console.log(`  - ${g.id}  <${g.tag}>`)
}

if (args.has('--gate')) {
  const known = new Set(existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).gaps : [])
  const fresh = gaps.filter((g) => !known.has(g.id))
  const cleared = [...known].filter((k) => !gaps.some((g) => g.id === k))
  console.log(`\nGATE: baseline ${known.size} known · ${fresh.length} NEW uncovered · ${cleared.length} cleared since baseline`)
  if (cleared.length) console.log('  cleared (remove them from the baseline): ' + cleared.join(', '))
  if (fresh.length) {
    console.log('  NEW controls with no test:')
    for (const g of fresh) console.log(`    - ${g.id}  (${g.file})`)
    process.exit(1)
  }
}
