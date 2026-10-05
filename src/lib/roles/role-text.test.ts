import { describe, expect, it } from 'vitest'
import en from '../../locales/en.json'
import ar from '../../locales/ar.json'
import {
  BUILT_IN_ROLE_KEYS,
  isBuiltInRole,
  roleDescription,
  roleDescriptionKey,
  roleName,
  roleNameKey,
} from './role-text'

/** The real `t` is not needed here — the rule under test is "look the key up, else fall back". */
function tFor(dict: Record<string, unknown>) {
  return ((key: string) =>
    key.split('.').reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      dict,
    ) ?? key) as unknown as Parameters<typeof roleName>[0]
}

const t = tFor(en as unknown as Record<string, unknown>)
const tAr = tFor(ar as unknown as Record<string, unknown>)

describe('built-in role words', () => {
  // Edward, 6 Sep: the Arabic screen was printing the English seed. A key with no Arabic behind it
  // is that bug again, so this is the assertion that has to fail rather than the screen.
  it('every built-in role has a name and a description in both languages', () => {
    for (const key of BUILT_IN_ROLE_KEYS) {
      for (const [lang, dict] of [
        ['en', en],
        ['ar', ar],
      ] as [string, Record<string, unknown>][]) {
        for (const path of [roleNameKey(key), roleDescriptionKey(key)]) {
          const value = path
            .split('.')
            .reduce<unknown>(
              (node, part) => (node as Record<string, unknown> | undefined)?.[part],
              dict,
            )
          expect(typeof value, `${lang}: ${path} missing`).toBe('string')
          expect((value as string).trim().length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('the two languages actually differ — a copied English string is the bug, not a translation', () => {
    for (const key of BUILT_IN_ROLE_KEYS) {
      const enDesc = roleDescription(t, { key, description: null })
      const arDesc = roleDescription(tAr, { key, description: null })
      expect(arDesc, `${key} has the English description in Arabic`).not.toBe(enDesc)
    }
  })

  it('names a built-in role from the app, ignoring whatever the row says', () => {
    // The seed calls this role "Scheduler" in the database; the product calls it Traffic Manager.
    expect(roleName(t, { key: 'scheduler', name: 'Scheduler' })).toBe('Traffic Manager')
    expect(roleName(tAr, { key: 'scheduler', name: 'Scheduler' })).toBe('مدير الحركة')
  })

  // A role the tenant created is theirs, in the language they typed it. Translating it would be
  // inventing words for a thing the app has never heard of.
  it('prints a tenant-created role exactly as stored', () => {
    expect(roleName(t, { key: 'senior_planner', name: 'Senior Planner' })).toBe('Senior Planner')
    expect(roleDescription(t, { key: 'senior_planner', description: 'Ours' })).toBe('Ours')
    expect(roleDescription(t, { key: 'senior_planner', description: null })).toBeNull()
  })

  it('knows which keys are built in', () => {
    expect(isBuiltInRole('account_director')).toBe(true)
    expect(isBuiltInRole('senior_planner')).toBe(false)
    expect(isBuiltInRole(null)).toBe(false)
  })
})
