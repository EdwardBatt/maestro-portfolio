/// <reference types="node" />
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Every uuid literal in the pgTAP suite is actually a uuid.
 *
 * **Why this exists.** `traps.md` has warned since August that pgTAP fixture ids must be HEX —
 * `'aaaaaaaa-0000-0000-0000-0000000060s1'` is not a uuid, and Postgres rejects it at parse time with
 * `invalid input syntax for type uuid`. It is written down, and it was still hit three times in a
 * single day (`…0061r1` for a role, `…0066s1` for a stream, and once the day before). The mnemonic
 * letter is the trap: `s` for stream, `r` for role, `t` for team — none of them hex.
 *
 * A documented trap that keeps being sprung is not a documentation problem. Each occurrence costs a
 * full migrate-and-test cycle to discover, and the error names the value but not the file, so it is
 * a grep every time. This turns it into a named test failure in under a second.
 *
 * It checks SHAPE only — 8-4-4-4-12 with a bad character — so it cannot object to anything that is
 * genuinely a uuid, and it says nothing about ids that are merely ugly.
 */

/** 8-4-4-4-12 groups of *any* word character: the shape of an id somebody meant to be a uuid. */
const UUID_SHAPED = /'([0-9a-zA-Z]{8}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{12})'/g
const IS_HEX = /^[0-9a-fA-F-]+$/

function sqlFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sqlFiles(`${dir}/${e.name}`) : e.name.endsWith('.sql') ? [`${dir}/${e.name}`] : [],
  )
}

const files = [...sqlFiles('supabase/tests'), ...sqlFiles('supabase/migrations')]

/**
 * Migration filenames are real timestamps.
 *
 * `AGENTS.md` §4 names the format `YYYYMMDDHHMMSS`, and it is easy to run past midnight without
 * noticing: `20260828240000` is hour 24, which does not exist. Postgres does not care — Supabase
 * orders migrations by the string — but `supabase migration list` cannot parse the date, so the
 * column comes back blank and the row looks unapplied when it is merely unreadable. That is a
 * confusing thing to hit while deciding whether to push to production.
 *
 * Two rows from 19 Aug carry the fault and are GRANDFATHERED: they are already applied, and
 * renaming an applied migration breaks the history Supabase keeps by name. They are listed rather
 * than excluded by a pattern, so adding a third is a deliberate act.
 */
const GRANDFATHERED = new Set([
  '20260819240000_sla_manage_power_admin_only.sql',
  '20260819250000_security_advisor_hardening.sql',
])

describe('migration filenames are valid timestamps', () => {
  const names = existsSync('supabase/migrations')
    ? readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql'))
    : []

  it('finds the migrations', () => {
    expect(names.length).toBeGreaterThan(90)
  })

  it('every filename parses as a real date and time', () => {
    const bad = names
      .filter((n) => !GRANDFATHERED.has(n))
      .filter((n) => {
        const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/.exec(n)
        if (!m) return true
        const [, , mo, d, h, mi, sec] = m.map(Number) as unknown as number[]
        return mo! < 1 || mo! > 12 || d! < 1 || d! > 31 || h! > 23 || mi! > 59 || sec! > 59
      })
    expect(bad).toEqual([])
  })
})

describe('uuid literals in SQL are hex', () => {
  it('finds the SQL to check', () => {
    // Guards the guard: if the directories move, this fails rather than passing vacuously.
    expect(files.length).toBeGreaterThan(60)
  })

  it.each(files.map((f) => [f.replace('supabase/', ''), f] as const))(
    '%s uses only hex in uuid literals',
    (_label, file) => {
      const text = readFileSync(file, 'utf8')
      const bad: string[] = []
      for (const m of text.matchAll(UUID_SHAPED)) {
        const value = m[1]!
        if (!IS_HEX.test(value)) {
          const line = text.slice(0, m.index).split(/\r?\n/).length
          bad.push(`${file}:${line}: '${value}' is uuid-shaped but not hex`)
        }
      }
      expect(bad).toEqual([])
    },
  )

  it('rejects the exact shape that has bitten three times', () => {
    // The mutation test for this file. `s` for stream, `r` for role: mnemonic, and not hex.
    const sample = "insert into streams (id) values ('aaaaaaaa-0000-0000-0000-0000000066s1');"
    const found = [...sample.matchAll(UUID_SHAPED)].filter((m) => !IS_HEX.test(m[1]!))
    expect(found).toHaveLength(1)
  })
})
