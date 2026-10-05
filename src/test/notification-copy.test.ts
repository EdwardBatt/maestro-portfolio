/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs'

// Working-tree files can be CRLF on Windows (traps.md); the regexes below assume LF. Normalise on read.
const CR = String.fromCharCode(13)
const readText = (p: string) => readFileSync(p, 'utf8').split(CR).join('')
import { describe, expect, it } from 'vitest'
import en from '../locales/en.json'
import ar from '../locales/ar.json'

/**
 * A notification type is only real when THREE things agree, and this is the test that makes them.
 *
 * **Why this file exists.** `notifications_type_check` in Postgres is the list. `notify-email`
 * keeps its own `NotifType` union and a `COPY` map beside it, and the inbox keeps
 * `notifications.type.*` in both locales. Nothing tied the three together, so the list drifted:
 * measured on 6 Sep, seven of sixteen types had **no email copy at all** — `cancelled` (raised from
 * 28 places), `resource_clash`, `resource_required`, `campaign_approved`,
 * `deliverable_reassigned`, `rescheduled` and `task_reinstated`. Each reached `notify-email`, found
 * nothing, and returned `200 {skipped:'no_copy'}`: no error, no log line anybody reads, no email.
 * The notification appeared in the bell and the email never came.
 *
 * **The type system looked like it covered this and did not.** `COPY` is
 * `Record<Locale, Record<Exclude<NotifType, 'due_soon'>, …>>`, which is complete — against
 * `NotifType`, a hand-written union in the same file that was itself seven values behind the
 * database. The compiler was checking the second home against itself. That is why the check has to
 * read the CONSTRAINT.
 *
 * **`due_soon` is the one deliberate exclusion** (ADR-0028: it is a digest concern, and the sweep
 * that would raise it is not built). It is named here rather than skipped silently, so removing the
 * exclusion is a decision somebody makes on purpose.
 */

const EMAIL_EXEMPT = new Set(['due_soon'])

/** The list, read from the LAST migration that redefines it — which is the one Postgres ends on. */
function typesFromConstraint(): string[] {
  const dir = 'supabase/migrations'
  const file = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .reverse()
    // Both spellings Postgres takes: `check (type in (…))` and `check (type = any (array[…]))` (ADR-0133's migration).
    .find((f) => readFileSync(`${dir}/${f}`, 'utf8').includes('notifications_type_check add') ||
      /add constraint notifications_type_check[\s\S]{0,400}?check \(type (in \(|= any \(array\[)/.test(readFileSync(`${dir}/${f}`, 'utf8')))
  expect(file, 'no migration defines notifications_type_check').toBeTruthy()
  const sql = readFileSync(`${dir}/${file}`, 'utf8')
  const m = /add constraint notifications_type_check\s*\n?\s*check \(type (?:in \(([\s\S]*?)\)\)|= any \(array\[([\s\S]*?)\]\)\))/.exec(sql)
  expect(m, `could not parse the type list out of ${file}`).toBeTruthy()
  return [...(m![1] ?? m![2])!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!)
}

/** The keys the email map actually carries, per locale. */
function copyKeys(): { en: Set<string>; ar: Set<string> } {
  const src = readText('supabase/functions/notify-email/index.ts')
  const map = /const COPY[\s\S]*?\n\}\n/.exec(src)
  expect(map, 'could not find the COPY map').toBeTruthy()
  const body = map![0]
  const enStart = body.indexOf('\n  en: {')
  const arStart = body.indexOf('\n  ar: {')
  expect(enStart, 'COPY has no en block').toBeGreaterThan(-1)
  expect(arStart, 'COPY has no ar block').toBeGreaterThan(-1)
  const keys = (chunk: string) => new Set([...chunk.matchAll(/^\s{4}([a-z_]+):/gm)].map((m) => m[1]))
  return { en: keys(body.slice(enStart, arStart)), ar: keys(body.slice(arStart)) }
}

function inboxCopy(dict: unknown, type: string): unknown {
  return (dict as { notifications?: { type?: Record<string, unknown> } }).notifications?.type?.[type]
}

describe('every notification type is deliverable end to end', () => {
  const types = typesFromConstraint()

  it('reads a non-trivial list out of the constraint', () => {
    // A regex that silently matched nothing would make every assertion below vacuously true.
    expect(types.length).toBeGreaterThanOrEqual(10)
    expect(types).toContain('assigned')
    expect(types).toContain('cancelled')
  })

  it('has email copy in BOTH languages for every type the database permits', () => {
    const copy = copyKeys()
    for (const type of types) {
      if (EMAIL_EXEMPT.has(type)) continue
      expect(copy.en, `notify-email has no English copy for "${type}" — it will send nothing`).toContain(type)
      expect(copy.ar, `notify-email has no Arabic copy for "${type}" — it will send nothing`).toContain(type)
    }
  })

  // The map having a key the database cannot store is the same drift facing the other way: dead
  // copy that reads as coverage.
  it('carries no email copy for a type the database cannot store', () => {
    const allowed = new Set(types)
    for (const key of copyKeys().en) {
      expect(allowed, `notify-email has copy for "${key}", which notifications_type_check forbids`).toContain(key)
    }
  })

  // The fourth home (I47.3): the frontend's own `NotificationType` union. It had drifted four
  // values behind by 11 Sep and nothing noticed, because it is a type — a value outside it is not
  // a compile error anywhere, just a row the inbox handles by accident. Read as text, like COPY.
  it('names every type in the frontend NotificationType union, and nothing the database forbids', () => {
    const src = readText('src/features/notifications/api/notifications-api.ts')
    const m = /export type NotificationType =([\s\S]*?)\n\n/.exec(src)
    expect(m, 'could not find the NotificationType union').toBeTruthy()
    const union = new Set([...m![1].matchAll(/\|\s*'([a-z_]+)'/g)].map((x) => x[1]))
    for (const type of types) {
      expect(union, `NotificationType in notifications-api.ts lacks "${type}"`).toContain(type)
    }
    for (const key of union) {
      expect(new Set(types), `NotificationType carries "${key}", which notifications_type_check forbids`).toContain(key)
    }
  })

  // The inbox is the channel that always fires, so a missing key here renders the raw string at a
  // person. It has happened: `notifications.type.cancelled` was missing for two days in August.
  it('has inbox copy in BOTH languages for every type, including the email-exempt one', () => {
    for (const type of types) {
      expect(typeof inboxCopy(en, type), `en.json has no notifications.type.${type}`).toBe('string')
      expect(typeof inboxCopy(ar, type), `ar.json has no notifications.type.${type}`).toBe('string')
    }
  })
})
