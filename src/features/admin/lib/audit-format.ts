import type { TFunction } from 'i18next'
import type { AuditLookups } from '../api/roles-api'

/**
 * Human-readable audit rendering (L1.11): the raw log stores machine actions,
 * table names, and payloads full of UUIDs. These helpers turn those into plain
 * language — friendly action/entity/field labels and UUIDs resolved to names via
 * the lookup maps (useAuditLookups). Anything without an explicit label falls
 * back to a humanised version of the code, so new events never render blank.
 */

/** payload field / entity → which lookup map resolves its UUID to a name. */
const FK_LOOKUP: Record<string, keyof AuditLookups> = {
  role_id: 'roles',
  department_id: 'departments',
  team_id: 'teams',
  office_id: 'offices',
  user_id: 'users',
  assignee_id: 'users',
  resource_id: 'resources',
  // I51.1/I51.2: the actor columns and the other people a row names, as names.
  created_by: 'users',
  updated_by: 'users',
  approved_by: 'users',
  owner_user_id: 'users',
  account_manager_id: 'users',
  reviewer_id: 'users',
  tasks_approved_by: 'users',
}
const ENTITY_LOOKUP: Record<string, keyof AuditLookups> = {
  user_profiles: 'users',
  roles: 'roles',
  resources: 'resources',
  offices: 'offices',
  departments: 'departments',
  teams: 'teams',
}

/** internal columns that are noise in the details view. */
const HIDDEN_FIELDS = new Set(['id', 'tenant_id', 'created_at', 'updated_at', 'host_tenant_id'])

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(s)

export function humanize(code: string): string {
  return code.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/** Badge colour bucket (reuses the existing insert/update/delete styles). */
export function actionVariant(action: string): 'insert' | 'update' | 'delete' {
  if (action === 'delete' || /_(deleted|cancelled|removed|deactivated)$/.test(action)) return 'delete'
  if (action === 'insert' || /_(created|invited|added)$/.test(action)) return 'insert'
  return 'update'
}

export const actionLabel = (action: string, t: TFunction): string =>
  t(`admin.audit.actions.${action}`, { defaultValue: humanize(action) })
export const entityLabel = (entity: string, t: TFunction): string =>
  t(`admin.audit.entities.${entity}`, { defaultValue: humanize(entity) })
export const fieldLabel = (key: string, t: TFunction): string =>
  t(`admin.audit.fields.${key}`, { defaultValue: humanize(key) })

/** The record's own human name (e.g. the invited user's name), if resolvable. */
export function resolveEntityName(entity: string, id: string | null, lookups?: AuditLookups): string | null {
  if (!id || !lookups) return null
  const table = ENTITY_LOOKUP[entity]
  return table ? (lookups[table].get(id) ?? null) : null
}

function formatValue(key: string, value: unknown, lookups: AuditLookups | undefined, t: TFunction): string {
  if (value == null) return '—'
  if (typeof value === 'boolean') return value ? t('admin.audit.yes') : t('admin.audit.no')
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    const table = FK_LOOKUP[key]
    if (table && lookups && isUuid(value)) return lookups[table].get(value) ?? value.slice(0, 8)
    // ISO datetime → "2026-08-15 16:21"
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value.slice(0, 16).replace('T', ' ')
    if (isUuid(value)) return value.slice(0, 8)
    return value
  }
  return JSON.stringify(value)
}

export interface PayloadPair {
  label: string
  value: string
}

/** The changed fields as human-readable "Label: value" pairs (noise removed). */
export function formatPayload(payload: Record<string, unknown>, lookups: AuditLookups | undefined, t: TFunction): PayloadPair[] {
  return Object.entries(payload)
    .filter(([k]) => !HIDDEN_FIELDS.has(k))
    .map(([k, v]) => ({ label: fieldLabel(k, t), value: formatValue(k, v, lookups, t) }))
}
