import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './auth-context'

export interface CurrentUser {
  displayName: string
  roleName: string
  /** The role's key, so a built-in role's NAME can follow the interface language (lib/role-text). */
  roleKey: string | null
  email: string | null
  /** The remembered interface language (I53.21); null until the person has chosen one. */
  locale: string | null
}

/** The signed-in user's display name + role name (for the header). Reads own
 *  profile under the tenant-select policy; role name from the roles table. */
export function useCurrentUser() {
  const { session } = useAuth()
  const uid = session?.user.id
  return useQuery({
    queryKey: ['current-user', uid],
    enabled: Boolean(uid),
    queryFn: async (): Promise<CurrentUser> => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('display_name, locale, roles(key, name)')
        .eq('id', uid as string)
        .single()
      if (error) throw error
      const raw = data.roles as { key: string; name: string } | { key: string; name: string }[] | null
      const r = Array.isArray(raw) ? raw[0] : raw
      return {
        displayName: data.display_name ?? '',
        roleName: r?.name ?? '',
        roleKey: r?.key ?? null,
        email: session?.user.email ?? null,
        locale: (data as { locale?: string | null }).locale ?? null,
      }
    },
  })
}
