import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, supabaseUntyped } from '../../../lib/supabase'
import { useAuth } from '../../../app/auth-context'
import { adminKeys } from './admin-api'
import { permissionKeys, type RoleScope } from '../../../app/permissions'

/**
 * Roles & permissions administration (L1.11, ADR-0008). All writes are DIRECT
 * PostgREST writes governed by RLS (roles:manage grant) — no Edge Function
 * needed because nothing here touches auth users or claims. The database
 * fences what no admin may do (system roles, Power Admin coverage) and the
 * audit triggers log every change.
 */

export const rolesKeys = {
  all: [...adminKeys.all, 'roles-admin'] as const,
  list: () => [...rolesKeys.all, 'list'] as const,
  catalog: () => [...rolesKeys.all, 'catalog'] as const,
  grants: (roleId: string) => [...rolesKeys.all, 'grants', roleId] as const,
  holders: () => [...rolesKeys.all, 'holders'] as const,
  audit: (f: AuditFilters) => [...adminKeys.all, 'audit', f.entity ?? 'all', f.from ?? '', f.to ?? ''] as const,
  auditEntities: () => [...adminKeys.all, 'audit-entities'] as const,
}

export interface RoleRow {
  id: string
  key: string
  name: string
  description: string | null
  isSystem: boolean
  defaultRoute: string
  status: 'active' | 'archived'
  /** ADR-0041: how far this role's permissions reach. Relative to the holder — see lib/role-scope. */
  scope: RoleScope
}

export interface CatalogEntry {
  resource: string
  action: string
  description: string
}

import { keyFromName } from '../lib/role-key'
export { keyFromName }

export function useRolesAdmin() {
  return useQuery({
    queryKey: rolesKeys.list(),
    queryFn: async (): Promise<RoleRow[]> => {
      const { data: raw, error } = await supabaseUntyped
        .from('roles')
        .select('id, key, name, description, is_system, default_route, status, scope')
        .order('is_system', { ascending: false })
        .order('name')
      if (error) throw error
      const rows = (raw ?? []) as {
        id: string; key: string; name: string; description: string | null
        is_system: boolean; default_route: string; status: 'active' | 'archived'; scope: RoleScope
      }[]
      return rows.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
        isSystem: r.is_system,
        defaultRoute: r.default_route,
        status: r.status,
        scope: r.scope,
      }))
    },
  })
}

/**
 * How many people hold each role — the number the reach confirmation quotes (ADR-0041 d.3).
 * Changing a role's reach changes what every one of them can touch the moment it saves, so the
 * count is the difference between an informed change and a blind one. `user_profiles` is
 * tenant-readable, so this is exact for anyone who can reach the Roles screen. Active people only:
 * a deactivated account cannot exercise reach.
 */
export function useRoleHolderCounts() {
  return useQuery({
    queryKey: rolesKeys.holders(),
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabaseUntyped
        .from('user_profiles')
        .select('role_id')
        .eq('is_active', true)
      if (error) throw error
      const counts = new Map<string, number>()
      for (const row of (data ?? []) as { role_id: string | null }[]) {
        if (!row.role_id) continue
        counts.set(row.role_id, (counts.get(row.role_id) ?? 0) + 1)
      }
      return counts
    },
  })
}

export function usePermissionCatalog() {
  return useQuery({
    queryKey: rolesKeys.catalog(),
    staleTime: 60 * 60_000, // migration-defined vocabulary — effectively static
    queryFn: async (): Promise<CatalogEntry[]> => {
      const { data: raw, error } = await supabaseUntyped
        .from('permission_catalog')
        .select('resource, action, description')
        .order('resource')
        .order('action')
      if (error) throw error
      return (raw ?? []) as CatalogEntry[]
    },
  })
}

export function useRoleGrants(roleId: string | null) {
  return useQuery({
    queryKey: rolesKeys.grants(roleId ?? 'none'),
    enabled: roleId != null,
    queryFn: async (): Promise<Set<string>> => {
      const { data: raw, error } = await supabaseUntyped
        .from('role_grants')
        .select('resource, action')
        .eq('role_id', roleId!)
      if (error) throw error
      const rows = (raw ?? []) as { resource: string; action: string }[]
      return new Set(rows.map((g) => `${g.resource}:${g.action}`))
    },
  })
}

function useInvalidateRoles() {
  const qc = useQueryClient()
  return (roleId?: string) => {
    void qc.invalidateQueries({ queryKey: rolesKeys.list() })
    void qc.invalidateQueries({ queryKey: adminKeys.roles() }) // assignable dropdowns
    if (roleId) void qc.invalidateQueries({ queryKey: rolesKeys.grants(roleId) })
    // the editing admin may have changed their OWN role's abilities
    void qc.invalidateQueries({ queryKey: permissionKeys.all })
  }
}

export interface CreateRoleArgs {
  name: string
  description?: string
  defaultRoute: string
  /** ADR-0041 d.1/d.2: reach is named at creation, never inherited from a column default. */
  scope: RoleScope
  /** copy this role's grants as the starting point (role-of-one pattern) */
  copyFromRoleId?: string | null
}

export function useCreateRole() {
  const { claims } = useAuth()
  const invalidate = useInvalidateRoles()
  return useMutation({
    mutationFn: async (args: CreateRoleArgs): Promise<string> => {
      const { data: created, error } = await supabaseUntyped
        .from('roles')
        .insert({
          tenant_id: claims.tenantId,
          key: keyFromName(args.name),
          name: args.name.trim(),
          description: args.description?.trim() || null,
          default_route: args.defaultRoute,
          // Sent explicitly even when it equals the column default: the reach a role was created
          // with should be a decision on the record, not an absence (ADR-0041).
          scope: args.scope,
        })
        .select('id')
        .single()
      if (error) throw error
      const roleId = (created as { id: string }).id

      if (args.copyFromRoleId) {
        const { data: src, error: srcErr } = await supabaseUntyped
          .from('role_grants')
          .select('resource, action')
          .eq('role_id', args.copyFromRoleId)
        if (srcErr) throw srcErr
        const rows = (src ?? []) as { resource: string; action: string }[]
        if (rows.length) {
          const { error: grantErr } = await supabaseUntyped.from('role_grants').insert(
            rows.map((g) => ({
              tenant_id: claims.tenantId,
              role_id: roleId,
              resource: g.resource,
              action: g.action,
            })),
          )
          if (grantErr) throw grantErr
        }
      }
      return roleId
    },
    onSuccess: (roleId) => invalidate(roleId),
  })
}

export interface UpdateRoleArgs {
  roleId: string
  name?: string
  description?: string | null
  defaultRoute?: string
  status?: 'active' | 'archived'
  /** ADR-0041 d.3: changing this changes what every holder can touch, immediately. */
  scope?: RoleScope
}

export function useUpdateRole() {
  const invalidate = useInvalidateRoles()
  return useMutation({
    mutationFn: async (args: UpdateRoleArgs) => {
      const patch: Record<string, unknown> = {}
      if (args.name !== undefined) patch.name = args.name.trim()
      if (args.description !== undefined) patch.description = args.description
      if (args.defaultRoute !== undefined) patch.default_route = args.defaultRoute
      if (args.status !== undefined) patch.status = args.status
      if (args.scope !== undefined) patch.scope = args.scope
      const { error } = await supabaseUntyped.from('roles').update(patch).eq('id', args.roleId)
      if (error) throw error
    },
    onSuccess: (_d, args) => invalidate(args.roleId),
  })
}

export interface ToggleGrantArgs {
  roleId: string
  resource: string
  action: string
  granted: boolean
}

export function useToggleGrant() {
  const { claims } = useAuth()
  const invalidate = useInvalidateRoles()
  return useMutation({
    mutationFn: async (args: ToggleGrantArgs) => {
      if (args.granted) {
        const { error } = await supabaseUntyped.from('role_grants').insert({
          tenant_id: claims.tenantId,
          role_id: args.roleId,
          resource: args.resource,
          action: args.action,
        })
        if (error) throw error
      } else {
        const { error } = await supabaseUntyped
          .from('role_grants')
          .delete()
          .eq('role_id', args.roleId)
          .eq('resource', args.resource)
          .eq('action', args.action)
        if (error) throw error
      }
    },
    onSuccess: (_d, args) => invalidate(args.roleId),
  })
}

// ----------------------------------------------------------------- audit ---

export interface AuditRow {
  id: string
  createdAt: string
  actorName: string | null
  action: string
  entity: string
  entityId: string | null
  payload: Record<string, unknown>
}

/** id → display name maps for the entities the audit log references, so UUIDs in
 *  actions and payloads can be shown as names (audit-format.ts). Reads are
 *  tenant-wide (RLS); audit:view holders are tenant users, so all resolve. */
export interface AuditLookups {
  users: Map<string, string>
  roles: Map<string, string>
  resources: Map<string, string>
  offices: Map<string, string>
  departments: Map<string, string>
  teams: Map<string, string>
}

export function useAuditLookups() {
  return useQuery({
    queryKey: [...rolesKeys.all, 'audit-lookups'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AuditLookups> => {
      const [u, r, res, o, d, tm] = await Promise.all([
        supabaseUntyped.from('user_profiles').select('id, display_name'),
        supabaseUntyped.from('roles').select('id, name'),
        supabaseUntyped.from('resources').select('id, name'),
        supabaseUntyped.from('offices').select('id, name'),
        supabaseUntyped.from('departments').select('id, name'),
        supabaseUntyped.from('teams').select('id, name'),
      ])
      const toMap = (rows: { data: unknown }, nameKey: string) =>
        new Map(((rows.data ?? []) as Record<string, string>[]).map((x) => [x.id, x[nameKey]]))
      return {
        users: toMap(u, 'display_name'),
        roles: toMap(r, 'name'),
        resources: toMap(res, 'name'),
        offices: toMap(o, 'name'),
        departments: toMap(d, 'name'),
        teams: toMap(tm, 'name'),
      }
    },
  })
}

/** What the audit screen is asking for. All three narrow; none is required. */
export interface AuditFilters {
  entity: string | null
  /** Inclusive, as a date — `2026-09-01`. Widened to the whole day server-side. */
  from: string | null
  to: string | null
}

/** How many rows a page holds. Was the whole log's ceiling; is now a page size. */
export const AUDIT_PAGE = 200

/**
 * The audit log, a page at a time.
 *
 * Edward, 6 Sep: *"the audit log only shows me the last 200 entries, I need a means to filter to
 * different ranges or to scroll through the entries not listed."* It was a bare `.limit(200)` with
 * no way past it — so anything older than the last 200 events existed and could not be reached from
 * the product at all. On a log gaining thousands of rows a month that is most of it.
 *
 * **Keyset paging, not offset.** The next page is "older than the last row I have" rather than
 * "skip 400", so a page cannot shift under the reader while events keep arriving — and it stays the
 * same cost at page fifty as at page one. The log is append-only and ordered by time, which is the
 * case keyset paging is for.
 *
 * **A date range narrows; paging walks what is left.** Either alone leaves a hole: a range still
 * truncates on a busy day, and paging alone means clicking through weeks to reach last Tuesday.
 */
export function useAuditEvents(filters: AuditFilters) {
  return useInfiniteQuery({
    queryKey: rolesKeys.audit(filters),
    initialPageParam: null as AuditCursor | null,
    queryFn: async ({ pageParam }): Promise<AuditRow[]> => {
      let q = supabase
        .from('audit_events')
        .select('id, created_at, action, entity, entity_id, payload, user_profiles(display_name)')
        .order('created_at', { ascending: false })
        // The id breaks the tie (I59.38): one transaction stamps every row it writes with the SAME
        // `created_at` — a campaign's approval writes dozens, a provisioning run thousands — so a
        // cursor on the time alone skipped every row sharing the last row's instant. On a freshly
        // seeded database that was the whole seed: page two came back empty with 2,000 rows unread.
        .order('id', { ascending: false })
        .limit(AUDIT_PAGE)
      if (filters.entity) q = q.eq('entity', filters.entity)
      // The whole of the chosen days, in both directions: a `to` of 2026-09-06 that stopped at
      // midnight would silently drop everything that happened on the day the reader asked about.
      if (filters.from) q = q.gte('created_at', `${filters.from}T00:00:00`)
      if (filters.to) q = q.lte('created_at', `${filters.to}T23:59:59.999`)
      // Strictly after the last row in (created_at desc, id desc) order: older, or the same instant
      // and a lower id. Values quoted — a timestamp carries `:` and `+`, which the filter grammar reads.
      if (pageParam) {
        q = q.or(
          `created_at.lt."${pageParam.createdAt}",` +
            `and(created_at.eq."${pageParam.createdAt}",id.lt.${pageParam.id})`,
        )
      }
      const { data, error } = await q
      if (error) throw error
      return data.map((e) => ({
        id: e.id,
        createdAt: e.created_at,
        actorName: e.user_profiles?.display_name ?? null,
        action: e.action,
        entity: e.entity,
        entityId: e.entity_id,
        payload: (e.payload ?? {}) as Record<string, unknown>,
      }))
    },
    // A short page is the end of the log. A full one MIGHT be, and asking once more is cheaper than
    // telling somebody there is nothing older when there is.
    getNextPageParam: (last): AuditCursor | undefined => {
      const tail = last[last.length - 1]
      return last.length < AUDIT_PAGE || !tail ? undefined : { createdAt: tail.createdAt, id: tail.id }
    },
  })
}

/** Where the next audit page starts: the last row read, by time and then by id (I59.38). */
export interface AuditCursor {
  createdAt: string
  id: string
}

export interface AuditEntityOption {
  entity: string
  eventCount: number
}

/**
 * Which entities are actually IN the log (`audit_event_entities`).
 *
 * The filter used to be a hard-coded array of fourteen table names. Seventeen business tables have
 * been created since it was written — briefs, brief templates, concepts, deliverable types,
 * workflow templates, the asset tables — and none could be filtered to. The screen looked complete,
 * so the absence read as "nothing happened to briefs" rather than "this list has not heard of
 * briefs".
 */
export function useAuditEntities() {
  return useQuery({
    queryKey: rolesKeys.auditEntities(),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AuditEntityOption[]> => {
      const { data, error } = await supabaseUntyped
        .from('audit_event_entities')
        .select('entity, event_count')
        .order('entity')
      if (error) throw error
      return ((data ?? []) as { entity: string; event_count: number }[]).map((r) => ({
        entity: r.entity,
        eventCount: r.event_count,
      }))
    },
  })
}
