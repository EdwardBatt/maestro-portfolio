import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../supabase'

/**
 * Client amendments, counted (ADR-0142 d.3, I74.20) — `public.amendment_summary(p_month)`: re-opens of kind
 * `client_amendment` per piece, campaign and client, with their hours, for the month containing `p_month` (Baghdad
 * months) or for all time (null). Shared by the campaign page (the piece's "Amend 2", the campaign's month) and the
 * client page (the client's month) — the one read, so the two can never count differently. The server counts; this
 * only reads and indexes.
 */
export type AmendmentLevel = 'deliverable' | 'campaign' | 'client'

export interface AmendmentCount {
  amendments: number
  hours: number
}

export type AmendmentSummary = ReadonlyMap<string, AmendmentCount>

export const amendmentKeys = {
  summary: (month: string | null) => ['amendments', 'summary', month ?? 'all'] as const,
}

interface Row {
  level: AmendmentLevel
  id: string | null
  amendments: number | string
  hours: number | string | null
}

/** `level:id` → its count and hours. */
export function indexSummary(rows: readonly Row[]): AmendmentSummary {
  const out = new Map<string, AmendmentCount>()
  for (const r of rows) {
    if (!r.id) continue
    out.set(`${r.level}:${r.id}`, { amendments: Number(r.amendments) || 0, hours: Number(r.hours ?? 0) || 0 })
  }
  return out
}

export function amendmentsOf(summary: AmendmentSummary | undefined, level: AmendmentLevel, id: string | null | undefined): AmendmentCount | null {
  if (!summary || !id) return null
  const c = summary.get(`${level}:${id}`)
  return c && c.amendments > 0 ? c : null
}

/** `month`: any day in it, `YYYY-MM-DD`; null for all time. */
export function useAmendmentSummary(month: string | null) {
  return useQuery({
    queryKey: amendmentKeys.summary(month),
    staleTime: 60_000,
    queryFn: async (): Promise<AmendmentSummary> => {
      const { data, error } = await supabaseUntyped.rpc('amendment_summary', { p_month: month })
      if (error) throw error
      return indexSummary((data ?? []) as Row[])
    },
  })
}
