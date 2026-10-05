import { describe, expect, it } from 'vitest'
import i18n, { applyLocale, dirFor } from './i18n'
import en from '../locales/en.json'
import ar from '../locales/ar.json'

describe('i18n foundation (M2.4)', () => {
  it('direction mapping', () => {
    expect(dirFor('en')).toBe('ltr')
    expect(dirFor('ar')).toBe('rtl')
  })

  it('applyLocale sets document dir + lang together', () => {
    applyLocale('ar')
    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.lang).toBe('ar')
    applyLocale('en')
    expect(document.documentElement.dir).toBe('ltr')
  })

  it('AR locale covers every EN key (no untranslated leaks)', () => {
    const flatten = (obj: Record<string, unknown>, prefix = ''): string[] =>
      Object.entries(obj).flatMap(([k, v]) =>
        typeof v === 'object' && v !== null
          ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
          : [`${prefix}${k}`],
      )
    // Arabic has six plural forms (zero, one, two, few, many, other) where English has two. The
    // extra ones are grammar, not untranslated leaks — and without them a count of 2, 3 or 11 falls
    // back to English on an Arabic screen (found 24 Sep). They are allowed here, never required.
    const ARABIC_ONLY_PLURAL = /_(zero|two|few|many)$/
    expect(flatten(ar).filter((k) => !ARABIC_ONLY_PLURAL.test(k)).sort()).toEqual(flatten(en).sort())
  })

  it('I57.42: every Arabic plural has all six forms — a missing one falls back to ENGLISH', () => {
    // i18next asks Arabic for zero / one / two / few / many / other by the count, and a form the
    // file lacks is looked up in English: a workstream holding two pieces read "2 deliverables",
    // mirrored, on an Arabic screen. A key with `_one` and `_other` is a counted string; it needs
    // the four in between too.
    const flatten = (obj: Record<string, unknown>, prefix = ''): string[] =>
      Object.entries(obj).flatMap(([k, v]) =>
        typeof v === 'object' && v !== null
          ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
          : [`${prefix}${k}`],
      )
    const keys = new Set(flatten(ar))
    const counted = [...keys].filter((k) => k.endsWith('_one')).map((k) => k.slice(0, -4)).filter((b) => keys.has(`${b}_other`))
    const missing = counted.flatMap((b) =>
      ['zero', 'two', 'few', 'many'].filter((f) => !keys.has(`${b}_${f}`)).map((f) => `${b}_${f}`),
    )
    expect(missing).toEqual([])
  })

  it('an Arabic plural key comes with its English base, so nothing Arabic-only is orphaned', () => {
    const flatten = (obj: Record<string, unknown>, prefix = ''): string[] =>
      Object.entries(obj).flatMap(([k, v]) =>
        typeof v === 'object' && v !== null
          ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
          : [`${prefix}${k}`],
      )
    const enKeys = new Set(flatten(en))
    const orphans = flatten(ar)
      .filter((k) => /_(zero|two|few|many)$/.test(k))
      .filter((k) => !enKeys.has(k.replace(/_(zero|two|few|many)$/, '_other')))
    expect(orphans).toEqual([])
  })

  it('language change flips document direction', async () => {
    await i18n.changeLanguage('ar')
    expect(document.documentElement.dir).toBe('rtl')
    await i18n.changeLanguage('en')
    expect(document.documentElement.dir).toBe('ltr')
  })
})
