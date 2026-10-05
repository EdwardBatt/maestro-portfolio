import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../supabase'

/**
 * The people at a client (ADR-0123 d.4), for the screens that ask for one by name: a job's "who asked"
 * offers those who may ask for work, the reduced-scope record's "who answered" those who sign off. They
 * are SUGGESTIONS — a typed name is still accepted (d.4), because the person asking is not always on
 * the client's record yet.
 *
 * In `lib/` because the intake and the deliverables read it; the clients feature owns the writes.
 */
export interface ClientPerson {
  id: string
  name: string
  canRequest: boolean
  signsOff: boolean
}

export function useClientPeople(clientId: string | null) {
  return useQuery({
    queryKey: ['client-people', clientId ?? 'none'] as const,
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<ClientPerson[]> => {
      const { data, error } = await supabaseUntyped
        .from('client_contacts')
        .select('id, name, can_request, signs_off')
        .eq('client_id', clientId!)
        .order('sort_order')
      if (error) throw error
      return ((data ?? []) as { id: string; name: string; can_request: boolean; signs_off: boolean }[]).map((c) => ({
        id: c.id, name: c.name, canRequest: c.can_request, signsOff: c.signs_off,
      }))
    },
  })
}

/** The names to suggest: those with the role first, then everyone else at the client. */
export function suggestedNames(people: readonly ClientPerson[], role: 'canRequest' | 'signsOff'): string[] {
  const first = people.filter((p) => p[role]).map((p) => p.name)
  const rest = people.filter((p) => !p[role]).map((p) => p.name)
  return [...new Set([...first, ...rest])]
}
