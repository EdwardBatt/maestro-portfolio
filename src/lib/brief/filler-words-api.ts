import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../supabase'
import { useAuth } from '../../app/auth-context'

/**
 * ADR-0111 d.3 (I59.27) — the tenant's own filler words (`tenant_filler_words`), on top of the
 * built-ins in `filler.ts`, which cannot be removed.
 *
 * Read by everyone in the tenant (the brief screens warn before the press); written behind
 * `organization:manage` (Admin → Organization, the escalation settings). In `lib/` because three
 * features read it: intake, campaigns and admin.
 */
export interface FillerWord {
  id: string
  word: string
}

export const fillerWordKeys = {
  all: ['filler-words'] as const,
}

/** Stored lower-case and trimmed — the table's own CHECK. */
export function normalizeFillerWord(raw: string): string {
  return raw.trim().toLowerCase()
}

export function useFillerWords() {
  return useQuery({
    queryKey: fillerWordKeys.all,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<FillerWord[]> => {
      const { data, error } = await supabaseUntyped.from('tenant_filler_words').select('id, word').order('word')
      if (error) throw error
      return (data ?? []) as FillerWord[]
    },
  })
}

/** Just the words, for `isFiller(text, words)`. Empty while loading or if the read fails — the
 *  built-ins still warn, and the database is the gate either way. */
export function useFillerWordList(): readonly string[] {
  const q = useFillerWords()
  return (q.data ?? []).map((w) => w.word)
}

export function useAddFillerWord() {
  const qc = useQueryClient()
  const { claims } = useAuth()
  return useMutation({
    mutationFn: async (raw: string) => {
      const word = normalizeFillerWord(raw)
      if (!word) return
      const { error } = await supabaseUntyped
        .from('tenant_filler_words')
        .insert({ tenant_id: claims.tenantId, word })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: fillerWordKeys.all }),
  })
}

export function useRemoveFillerWord() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabaseUntyped.from('tenant_filler_words').delete().eq('id', id).select('id')
      if (error) throw error
      // RLS hides the row from somebody without organization:manage and the DELETE touches nothing —
      // no error. Zero rows back IS the refusal (traps.md), said as one.
      if (!data || (data as unknown[]).length === 0) {
        throw Object.assign(new Error('removing a filler word requires organization:manage'), { code: '42501' })
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: fillerWordKeys.all }),
  })
}
