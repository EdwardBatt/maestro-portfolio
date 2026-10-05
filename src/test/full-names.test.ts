/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A person is named by their full name, everywhere (Edward, 29 Sep, I66.1). The nickname (ADR-0011)
 * appears only as the small tag BESIDE the name — the Schedule rows, the Directory, the Resources admin.
 *
 * Why this file exists: I59.55/I59.58 put full names on the Team page on 27 Sep, but each screen
 * picked its own label, so the booking dialog, the Schedule's move dialog, the "who has room" list and
 * the new dashboards (28 Sep) kept writing `x.nickname ?? x.name` — and nothing failed. This scan
 * refuses that fallback anywhere in `src/`, named by file and line.
 */
const NICKNAME_FOR_NAME = /\bnickname\s*(\?\?|\|\|)\s*[\w.?!]*\bname\b/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && e.name !== 'database.ts' ? [path] : []
  })
}

/**
 * The same rule's second shape (test script steps 18 and 20, 4 Oct): the I74 screens cut a name to its first word —
 * `name.split(' ')[0]` — so every ask card, Who chip and toast read "Dev". The nickname scan above never looked for
 * it. Any first-word cut is refused; the rare one that is not a person's name (a weekday out of a date) or is the
 * page greeting its own reader says so on the line above with `full-names:`.
 */
const FIRST_WORD = /\.split\(\s*(' '|" "|\/\\s\+?\/)\s*\)(\[0\]|\.at\(0\)|\.shift\(\))/

describe('full names, not nicknames', () => {
  it('no screen shows a nickname in place of the name', () => {
    const offences = sourceFiles('src').flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) => (NICKNAME_FOR_NAME.test(line) ? [`${file}:${i + 1}  ${line.trim()}`] : [])),
    )
    expect(offences).toEqual([])
  })

  it('no screen cuts a person’s name to its first word', () => {
    const offences = sourceFiles('src').flatMap((file) => {
      const lines = readFileSync(file, 'utf8').split('\n')
      return lines.flatMap((line, i) =>
        FIRST_WORD.test(line) && !/full-names:/.test(lines[i - 1] ?? '') ? [`${file}:${i + 1}  ${line.trim()}`] : [],
      )
    })
    expect(offences).toEqual([])
  })

  it('the first-word scan catches the shapes the I74 screens used', () => {
    expect(FIRST_WORD.test("const first = ask.requesterName?.split(' ')[0] ?? ''")).toBe(true)
    expect(FIRST_WORD.test('const name = me.displayName?.split(/\\s+/)[0]')).toBe(true)
    expect(FIRST_WORD.test("x.name.split(' ').at(0)")).toBe(true)
    expect(FIRST_WORD.test("iso.split('T')[0]")).toBe(false)
  })

  it('the scan catches the pattern it exists for', () => {
    expect(NICKNAME_FOR_NAME.test('name: p.nickname ?? p.name,')).toBe(true)
    expect(NICKNAME_FOR_NAME.test('{resource.nickname || resource.name}')).toBe(true)
    expect(NICKNAME_FOR_NAME.test("<td>{p.nickname ?? '—'}</td>")).toBe(false)
  })
})
