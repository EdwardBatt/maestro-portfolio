import type { TFunction } from 'i18next'

/**
 * The name and description of a BUILT-IN role are product copy, so they follow the interface
 * language.
 *
 * Edward, 6 Sep: *"arabic is still displaying: Oversees every account — campaigns, clients and
 * briefs across all of them. No administration."* Every role's name and description lived only in
 * `roles.name` / `roles.description`, seeded in English, and every screen printed the stored string
 * — so an Arabic user read English on the Roles screen, in the header, in the directory and on the
 * users list. Nothing was broken; there was simply nowhere for the Arabic to live.
 *
 * The thirteen roles Maestro seeds are the same thirteen in every tenant, and what they mean does
 * not vary by agency — that makes their words copy, and copy belongs in `src/locales`. A role an
 * administrator creates is the opposite: its words are theirs, in whichever language they typed
 * them, and are printed exactly as stored.
 *
 * **The consequence, stated plainly:** a built-in role can no longer be renamed or re-described on
 * the Roles screen, because a stored rename and a translation cannot both be right and the stored
 * one would show in one language only. Reach, landing route and grants stay editable — those are
 * the fields that decide what a role can actually do. A tenant that wants its own wording makes its
 * own role, which is what the New role button is for.
 */
export const BUILT_IN_ROLE_KEYS = [
  'power_admin',
  'scheduler',
  'account_director',
  'account_manager',
  'department_lead',
  'team_lead',
  'deputy_team_lead',
  'team_member',
  'client_portal',
  'ceo',
  'coo',
  'cfo',
  'cco',
] as const

export type BuiltInRoleKey = (typeof BUILT_IN_ROLE_KEYS)[number]

export function isBuiltInRole(key: string | null | undefined): key is BuiltInRoleKey {
  return key != null && (BUILT_IN_ROLE_KEYS as readonly string[]).includes(key)
}

/** i18n keys, exported so a test can assert every built-in role has words in both languages. */
export function roleNameKey(key: BuiltInRoleKey): string {
  return `admin.roles.catalog.${key}.name`
}

export function roleDescriptionKey(key: BuiltInRoleKey): string {
  return `admin.roles.catalog.${key}.description`
}

/**
 * What to print for a role's name. Falls back to the stored value for a role the tenant created —
 * and for a built-in key that somehow has no translation, which is the one case where showing
 * English beats showing a raw i18n key.
 */
export function roleName(t: TFunction, role: { key: string | null; name: string | null }): string {
  if (isBuiltInRole(role.key)) {
    const translated = t(roleNameKey(role.key))
    if (translated !== roleNameKey(role.key)) return translated
  }
  return role.name ?? ''
}

/** Same rule for the description. Null stays null — a role without one shows nothing, not a blank. */
export function roleDescription(
  t: TFunction,
  role: { key: string | null; description: string | null },
): string | null {
  if (isBuiltInRole(role.key)) {
    const translated = t(roleDescriptionKey(role.key))
    if (translated !== roleDescriptionKey(role.key)) return translated
  }
  return role.description
}
