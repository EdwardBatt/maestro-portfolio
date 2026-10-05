import { describe, expect, it } from 'vitest'
import { DEFAULT_ROLE_SCOPE, ROLE_SCOPES, isWidening, scopeHintKey, scopeLabelKey } from './role-scope.ts'
import en from '../../../locales/en.json'
import ar from '../../../locales/ar.json'

describe('role reach (ADR-0041)', () => {
  it('offers exactly the six values the database permits — no more, no fewer', () => {
    // roles_scope_check (20260812110000, widened by 20260906110000 for ADR-0074's `all_accounts`).
    // Adding an option here without adding it there would produce a picker whose choice the
    // database rejects.
    expect([...ROLE_SCOPES].sort()).toEqual([
      'account',
      'all_accounts',
      'department',
      'self',
      'team',
      'tenant',
    ])
  })

  // ADR-0074: wider than "their own accounts", narrower than "the whole organisation". The ladder
  // is what `isWidening` reads, so getting this wrong would under-warn on a real widening.
  it('places every-account reach between the organisation and a department', () => {
    expect(isWidening('account', 'all_accounts')).toBe(true)
    expect(isWidening('department', 'all_accounts')).toBe(true)
    expect(isWidening('all_accounts', 'tenant')).toBe(true)
    expect(isWidening('tenant', 'all_accounts')).toBe(false)
  })

  it('defaults to the narrowest reach', () => {
    expect(DEFAULT_ROLE_SCOPE).toBe('self')
    expect(ROLE_SCOPES[ROLE_SCOPES.length - 1]).toBe('self')
  })

  it('orders widest to narrowest', () => {
    expect(ROLE_SCOPES[0]).toBe('tenant')
  })

  describe('isWidening', () => {
    it('is true when reach grows — holders gain authority they did not have', () => {
      expect(isWidening('self', 'tenant')).toBe(true)
      expect(isWidening('team', 'department')).toBe(true)
    })

    it('is false when reach shrinks or stays put', () => {
      expect(isWidening('tenant', 'self')).toBe(false)
      expect(isWidening('department', 'team')).toBe(false)
      expect(isWidening('team', 'team')).toBe(false)
    })
  })

  // A reach with no words attached is the invisible setting this ADR exists to abolish.
  it('every reach has a label and an explanation in both languages', () => {
    for (const scope of ROLE_SCOPES) {
      for (const dict of [en, ar] as unknown as Record<string, unknown>[]) {
        for (const key of [scopeLabelKey(scope), scopeHintKey(scope)]) {
          const value = key.split('.').reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part],
            dict,
          )
          expect(typeof value, `${key} missing`).toBe('string')
          expect((value as string).length).toBeGreaterThan(0)
        }
      }
    }
  })
})

// i18next needs `_one` / `_other`, not a bare key plus `_other` — a bare `holders` would render the
// singular for every count. Same shape as dashboard.orgOverSummary.
describe('the holder-count line pluralises', () => {
  it('has both plural forms in both languages', () => {
    for (const dict of [en, ar] as unknown as Record<string, any>[]) {
      const rc = dict.admin.roles.reachConfirm
      expect(typeof rc.holders_one).toBe('string')
      expect(typeof rc.holders_other).toBe('string')
      expect(rc.holders).toBeUndefined()
    }
  })
})
