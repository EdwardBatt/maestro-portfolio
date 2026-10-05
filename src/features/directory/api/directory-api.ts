import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'

/**
 * Company directory (L1.20, ADR-0017). A read-only listing of every registered
 * employee grouped by department: full name, nickname, email. Gated by the
 * `directory:view` grant (held by all internal roles, not client_portal).
 *
 * All data already reads tenant-wide under existing policies — no new table or
 * read policy: `user_profiles` (display_name, email, department) via
 * `user_profiles_tenant_select`, and the linked resource's `nickname`
 * (ADR-0011) via `resources_tenant_select`. Untyped client because `nickname`
 * and the profile org columns lag the generated types until `gen types`
 * re-runs after db push (same pattern as admin-api / leave-api).
 */

export const directoryKeys = {
  all: ['directory'] as const,
  people: () => [...directoryKeys.all, 'people'] as const,
}

export interface DirectoryPerson {
  id: string
  fullName: string
  jobTitle: string | null
  roleName: string | null
  /** Built-in roles are named by the app, not by the row — see lib/roles/role-text. */
  roleKey: string | null
  officeName: string | null
  nickname: string | null
  email: string | null
  departmentId: string | null
  departmentName: string | null
}

/** People grouped under their department, departments sorted, then people by name.
 *  Those with no department fall into a trailing "Unassigned" bucket. */
export interface DirectoryGroup {
  departmentId: string | null
  departmentName: string | null
  people: DirectoryPerson[]
}

interface DirectoryRow {
  id: string
  display_name: string
  job_title: string | null
  email: string | null
  is_active: boolean
  department_id: string | null
  departments: { name: string } | { name: string }[] | null
  roles: { key: string; name: string } | { key: string; name: string }[] | null
  offices: { name: string } | { name: string }[] | null
  /** reverse embed: the human resource linked to this login (ADR-0011). */
  resources: { nickname: string | null }[] | null
}

const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

export function useDirectory() {
  return useQuery({
    queryKey: directoryKeys.people(),
    queryFn: async (): Promise<DirectoryGroup[]> => {
      const { data: raw, error } = await supabaseUntyped
        .from('user_profiles')
        .select(
          'id, display_name, job_title, email, is_active, department_id, departments(name), roles(key, name), offices(name), resources(nickname)',
        )
        .eq('is_active', true)
        .order('display_name')
      if (error) throw error

      const rows = (raw ?? []) as unknown as DirectoryRow[]
      const people: DirectoryPerson[] = rows
        // Employees only — external client-portal accounts are not staff.
        .filter((r) => one(r.roles)?.key !== 'client_portal')
        .map((r) => {
          const linked = (r.resources ?? []).find((x) => x.nickname != null)
          return {
            id: r.id,
            fullName: r.display_name,
            jobTitle: r.job_title,
            roleName: one(r.roles)?.name ?? null,
            roleKey: one(r.roles)?.key ?? null,
            officeName: one(r.offices)?.name ?? null,
            nickname: linked?.nickname ?? null,
            email: r.email,
            departmentId: r.department_id,
            departmentName: one(r.departments)?.name ?? null,
          }
        })

      // Group by department; named departments first (alpha), "unassigned" last.
      const byDept = new Map<string, DirectoryGroup>()
      for (const p of people) {
        const key = p.departmentId ?? '__none__'
        if (!byDept.has(key)) {
          byDept.set(key, {
            departmentId: p.departmentId,
            departmentName: p.departmentName,
            people: [],
          })
        }
        byDept.get(key)!.people.push(p)
      }
      return [...byDept.values()].sort((a, b) => {
        if (a.departmentName == null) return 1
        if (b.departmentName == null) return -1
        return a.departmentName.localeCompare(b.departmentName)
      })
    },
  })
}
