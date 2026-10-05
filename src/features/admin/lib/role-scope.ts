import type { RoleScope } from '../../../app/permissions'

/**
 * A role's REACH (`roles.scope`, ADR-0009 d.3) — how far the permissions it holds actually go.
 *
 * ADR-0041: this used to be invisible. The column defaulted to `tenant` and the Roles screen never
 * asked, so a role created through the UI silently got the widest reach in the system — which is
 * how the `cco` role came to span the whole organisation without anyone deciding it. Reach is now
 * chosen, and a new role starts at `self`.
 *
 * Reach is **relative to the holder**: `department` means *their* department, which is why one
 * Department Lead role serves every department. Reach to a *named* department or team is a per-user
 * grant (`user_scope_grants`, ADR-0036) and never a property of a role — that is the line that
 * keeps the role count small.
 *
 * `all_accounts` is the one reach that is not relative (ADR-0074): every client account rather than
 * the ones the holder is named on. It exists because the Account Director's extra reach used to be
 * its NAME written into `app.in_write_scope`, which meant the Roles screen showed it the Account
 * Manager's sentence — the opposite of what it does — and a second oversight role would have needed
 * a migration rather than a setting.
 *
 * Ordered widest → narrowest so the list reads as a ladder; `self` is last and is the default.
 */
export const ROLE_SCOPES: readonly RoleScope[] = [
  'tenant',
  'all_accounts',
  'department',
  'team',
  'account',
  'self',
]

/** What a brand-new role starts with — the narrowest, so reach can only ever be widened on purpose. */
export const DEFAULT_ROLE_SCOPE: RoleScope = 'self'

/** i18n keys for a reach: `.label` names it, `.hint` explains it in the picker. */
export function scopeLabelKey(scope: RoleScope): string {
  return `admin.roles.scopes.${scope}.label`
}

export function scopeHintKey(scope: RoleScope): string {
  return `admin.roles.scopes.${scope}.hint`
}

/** Widening reach hands existing holders authority they did not have — worth a louder confirmation. */
export function isWidening(from: RoleScope, to: RoleScope): boolean {
  return ROLE_SCOPES.indexOf(to) < ROLE_SCOPES.indexOf(from)
}
