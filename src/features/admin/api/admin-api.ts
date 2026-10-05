import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, supabaseUntyped } from '../../../lib/supabase'

/** Query keys — per-feature factory (AGENTS §4). */
export const adminKeys = {
  all: ['admin'] as const,
  users: () => [...adminKeys.all, 'users'] as const,
  userStatus: () => [...adminKeys.all, 'user-status'] as const,
  roles: () => [...adminKeys.all, 'roles'] as const,
  offices: () => [...adminKeys.all, 'offices'] as const,
  departments: () => [...adminKeys.all, 'departments'] as const,
  teams: () => [...adminKeys.all, 'teams'] as const,
  unlinkedResources: () => [...adminKeys.all, 'unlinked-resources'] as const,
  resources: () => [...adminKeys.all, 'resources'] as const,
}

export interface AdminUser {
  id: string
  displayName: string
  email: string | null
  roleId: string
  roleName: string | null
  /** stable role slug — lets surfaces fence client_portal without hardcoding the display name */
  roleKey: string | null
  locale: string
  isActive: boolean
  officeId: string | null
  officeName: string | null
  departmentId: string | null
  departmentName: string | null
  teamId: string | null
  teamName: string | null
  jobTitle: string | null
}

/** Local row shape — generated types lag one migration behind until
 * `gen types` re-runs after `db push` (same pattern as schedule-api). */
interface ProfileRow {
  id: string
  display_name: string
  email: string | null
  role_id: string
  locale: string
  is_active: boolean
  office_id: string | null
  department_id: string | null
  team_id: string | null
  job_title: string | null
  offices: { name: string } | null
  roles: { name: string; key: string } | null
  departments: { name: string } | null
  teams: { name: string } | null
}

export function useUsers() {
  return useQuery({
    queryKey: adminKeys.users(),
    queryFn: async (): Promise<AdminUser[]> => {
      const { data: raw, error } = await supabaseUntyped
        .from('user_profiles')
        .select('id, display_name, email, role_id, locale, is_active, office_id, department_id, team_id, job_title, offices(name), roles(name, key), departments(name), teams(name)')
        .order('display_name')
      if (error) throw error
      const data = raw as unknown as ProfileRow[]
      return data.map((u) => ({
        id: u.id,
        displayName: u.display_name,
        email: u.email,
        roleId: u.role_id,
        roleName: u.roles?.name ?? null,
        roleKey: u.roles?.key ?? null,
        locale: u.locale,
        isActive: u.is_active,
        officeId: u.office_id,
        officeName: u.offices?.name ?? null,
        departmentId: u.department_id,
        departmentName: u.departments?.name ?? null,
        teamId: u.team_id,
        teamName: u.teams?.name ?? null,
        jobTitle: u.job_title,
      }))
    },
  })
}

/** Activation status per user id (auth.users, via the list-user-status function).
 *  `activated` = has signed in at least once (completed the invite/set-password
 *  flow, ADR-0012). Degrades gracefully: if the function isn't deployed yet the
 *  query errors and the Users screen just shows activation as unknown. */
export interface UserStatus {
  lastSignInAt: string | null
  activated: boolean
}

export function useUserStatus() {
  return useQuery({
    queryKey: adminKeys.userStatus(),
    staleTime: 60_000,
    retry: false, // don't hammer if the function isn't deployed
    queryFn: async (): Promise<Record<string, UserStatus>> => {
      const { data, error } = await supabase.functions.invoke<{ statuses: Record<string, UserStatus> }>('list-user-status', { body: {} })
      if (error) throw error
      return data?.statuses ?? {}
    },
  })
}

export interface OfficeOption {
  id: string
  name: string
}

export interface RoleOption {
  id: string
  key: string
  name: string
  isSystem: boolean
}

/** Assignable roles of the tenant (rows, not code — ADR-0008). client_portal
 * is excluded: portal accounts are provisioned by the portal flow (M10). */
export function useAssignableRoles() {
  return useQuery({
    queryKey: adminKeys.roles(),
    queryFn: async (): Promise<RoleOption[]> => {
      const { data: raw, error } = await supabaseUntyped
        .from('roles')
        .select('id, key, name, is_system')
        .eq('status', 'active')
        .neq('key', 'client_portal')
        .order('name')
      if (error) throw error
      const data = raw as unknown as { id: string; key: string; name: string; is_system: boolean }[]
      return data.map((r) => ({ id: r.id, key: r.key, name: r.name, isSystem: r.is_system }))
    },
  })
}

export function useDepartments() {
  return useQuery({
    queryKey: adminKeys.departments(),
    queryFn: async (): Promise<{ id: string; name: string; isProduction: boolean }[]> => {
      const { data, error } = await supabaseUntyped.from('departments').select('id, name, is_production').order('name')
      if (error) throw error
      return ((data ?? []) as { id: string; name: string; is_production: boolean | null }[])
        .map((d) => ({ id: d.id, name: d.name, isProduction: d.is_production !== false }))
    },
  })
}

/**
 * ADR-0115: the departments that take production work — the list every WORK picker offers (a job's
 * or a piece's department, the Team page). Admin screens keep `useDepartments` and see them all.
 */
export function useWorkDepartments() {
  const all = useDepartments()
  return { ...all, data: all.data?.filter((d) => d.isProduction !== false) }
}

export function useOffices() {
  return useQuery({
    queryKey: adminKeys.offices(),
    queryFn: async (): Promise<OfficeOption[]> => {
      const { data, error } = await supabase.from('offices').select('id, name').order('name')
      if (error) throw error
      return data
    },
  })
}

export interface TeamOption {
  id: string
  name: string
  /** parent department id — used to filter/validate team ↔ department (ADR-0014) */
  departmentId: string | null
  /** parent department, so the picker can disambiguate same-named teams */
  departmentName: string | null
}

/** Teams (ADR-0009) for the Users/Resources team pickers, labelled by department. */
export function useTeams() {
  return useQuery({
    queryKey: adminKeys.teams(),
    queryFn: async (): Promise<TeamOption[]> => {
      const { data: raw, error } = await supabaseUntyped
        .from('teams')
        .select('id, name, department_id, departments(name)')
        .order('name')
      if (error) throw error
      const rows = (raw ?? []) as unknown as { id: string; name: string; department_id: string | null; departments: { name: string } | { name: string }[] | null }[]
      return rows.map((t) => {
        const dep = Array.isArray(t.departments) ? t.departments[0] : t.departments
        return { id: t.id, name: t.name, departmentId: t.department_id, departmentName: dep?.name ?? null }
      })
    },
  })
}

/** Human resources not yet linked to a login — offered at invite time. */
export function useUnlinkedHumanResources() {
  return useQuery({
    queryKey: adminKeys.unlinkedResources(),
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data, error } = await supabase
        .from('resources')
        .select('id, name')
        .eq('kind', 'human')
        .eq('is_active', true)
        .is('user_id', null)
        .order('name')
      if (error) throw error
      return data
    },
  })
}

async function invokeAdmin<T>(fn: 'invite-user' | 'update-user', body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (error) {
    // FunctionsHttpError carries the response — surface the server's envelope
    const ctx = (error as { context?: Response }).context
    if (ctx) {
      const payload = await ctx.json().catch(() => null)
      throw Object.assign(new Error(payload?.error?.message ?? error.message), {
        code: payload?.error?.code,
      })
    }
    throw error
  }
  return data as T
}

export interface InviteUserArgs {
  email: string
  displayName: string
  roleId: string
  locale: 'en' | 'ar'
  officeId?: string | null
  departmentId?: string | null
  teamId?: string | null
  jobTitle?: string | null
  /** ADR-0011: create a bookable resource for this login (default true). */
  asResource?: boolean
  /** ADR-0011: the invitee's chosen handle; server re-rolls on clash. */
  nickname?: string | null
  /** Legacy: link a pre-existing resource instead of auto-creating one. */
  resourceId?: string | null
}

export function useInviteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: InviteUserArgs) => invokeAdmin<{ userId: string }>('invite-user', { ...args }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.users() })
      void qc.invalidateQueries({ queryKey: adminKeys.unlinkedResources() })
      void qc.invalidateQueries({ queryKey: adminKeys.resources() }) // ADR-0011 auto-created resource
      void qc.invalidateQueries({ queryKey: ['schedule'] }) // grid shows the new resource
    },
  })
}

export interface UpdateUserArgs {
  userId: string
  roleId?: string
  displayName?: string
  locale?: 'en' | 'ar'
  officeId?: string | null
  departmentId?: string | null
  teamId?: string | null
  jobTitle?: string | null
  active?: boolean
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: UpdateUserArgs) => invokeAdmin<{ ok: true; resourcesTouched?: number }>('update-user', { ...args }),
    // ADR-0061: deactivating a user switches off their linked resource, which is what takes them
    // off the schedule — but only the users list was refreshed, so the grid kept showing its cached
    // copy through a hard reload of the page. The invite mutation has always invalidated these;
    // the update one never did.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.users() })
      void qc.invalidateQueries({ queryKey: adminKeys.resources() })
      void qc.invalidateQueries({ queryKey: ['schedule'] })
      void qc.invalidateQueries({ queryKey: ['deliverables'] })   // the assignee pickers
    },
  })
}

/** Password reset is a plain auth call — no admin privileges involved, and the
 * response never reveals whether the address exists. ADR-0012: this emails a
 * 6-digit CODE (recovery template uses {{ .Token }}); the recipient enters it on
 * /set-password. No redirect link — nothing for a corporate scanner to consume. */
export function useSendPasswordReset() {
  return useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email)
      if (error) throw error
    },
  })
}
