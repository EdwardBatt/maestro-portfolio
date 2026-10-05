import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, supabaseUntyped } from '../../../lib/supabase'

/**
 * The ONE working concept proposed against a department's brief (ADR-0065 + its 13 Sep addendum,
 * I34.4 / I48.15).
 *
 * The brief itself is written by `generate-brief`, which is a SORTING job — its prompt forbids it
 * inventing a number, a name, a date or a budget, so a department brief is the campaign brief
 * re-boxed. This is the other half: a call that may PROPOSE an approach, still bound by the same
 * rule about facts.
 *
 * **This file sends an id and nothing else.** The brief text, the template's field keys and the
 * kept items are all read server-side by `propose-concepts` on the caller's own client under RLS
 * (ADR-0054's rule, ADR-0065 d.3/d.4).
 *
 * **One concept, refined in place** (addendum d.10). Each item is kept or deleted through
 * `campaign_concept_mark_item`; a deletion opens a slot in that shape, and the same
 * `propose-concepts` call then REGENERATES only the slots (d.11), with the kept items as fixed
 * context. There is no edit hook — a person keeps or deletes what the model said, never rewrites it.
 */

export const conceptKeys = {
  all: ['concepts'] as const,
  forBrief: (briefId: string) => ['concepts', 'brief', briefId] as const,
}

/** The three shapes of ADR-0065 d.3, minus the content types the addendum (d.9) dropped. */
export type ConceptShape = 'strategic_thinking' | 'creative_direction' | 'pillars'

export interface Proposal {
  /** Addresses the item for keep/delete (addendum d.10). */
  id: string
  shape: ConceptShape
  /** Pillars carry a short name; the other two do not. */
  name?: string
  text: string
  /**
   * Brief field keys this proposal answers (d.4). **Empty is meaningful, not missing**: the model
   * could not tie it to the brief, and d.5 says show it marked rather than hide it.
   */
  answers: string[]
  /** A person confirmed this one (d.10). */
  kept?: boolean
}

/** Items deleted since the last regeneration, per shape — what "Regenerate removed" fills. */
export type ConceptSlots = Partial<Record<ConceptShape, number>>

export interface Concept {
  id: string
  createdAt: string
  model: string
  requestedByName: string | null
  proposals: Proposal[]
  slots: ConceptSlots
  regenerations: number
  regeneratedAt: string | null
  regeneratedByName: string | null
}

export const openSlots = (slots: ConceptSlots): number =>
  Object.values(slots).reduce((sum, n) => sum + (Number.isInteger(n) && n! > 0 ? n! : 0), 0)

/** The working concept for one brief, or null when none has been proposed yet. */
export function useConcept(briefId: string | null) {
  return useQuery({
    queryKey: conceptKeys.forBrief(briefId ?? 'none'),
    enabled: !!briefId,
    queryFn: async (): Promise<Concept | null> => {
      const { data, error } = await supabaseUntyped
        .from('campaign_concepts')
        // Both `user_profiles` embeds are reached by explicitly named FKs: this table now has TWO
        // such columns, and an unnamed embed is the trap that has silently emptied results here
        // before (see docs/memory/traps.md).
        .select(
          'id, created_at, model, proposals, slots, regenerations, regenerated_at, ' +
            'requester:user_profiles!campaign_concepts_requested_by_fkey(display_name), ' +
            'regenerator:user_profiles!campaign_concepts_regenerated_by_fkey(display_name)',
        )
        .eq('campaign_brief_id', briefId!)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const r = data as unknown as {
        id: string
        created_at: string
        model: string
        proposals: Proposal[] | null
        slots: ConceptSlots | null
        regenerations: number | null
        regenerated_at: string | null
        requester: { display_name: string } | { display_name: string }[] | null
        regenerator: { display_name: string } | { display_name: string }[] | null
      }
      const one = (v: { display_name: string } | { display_name: string }[] | null) =>
        (Array.isArray(v) ? v[0] : v)?.display_name ?? null
      return {
        id: r.id,
        createdAt: r.created_at,
        model: r.model,
        requestedByName: one(r.requester),
        proposals: r.proposals ?? [],
        slots: r.slots ?? {},
        regenerations: r.regenerations ?? 0,
        regeneratedAt: r.regenerated_at,
        regeneratedByName: one(r.regenerator),
      }
    },
  })
}

/** Raised when the brief has nothing in it yet — a state to explain, not an error to report. */
export class BriefEmptyError extends Error {
  constructor() {
    super('brief_empty')
    this.name = 'BriefEmptyError'
  }
}

/** Raised when a regeneration was asked for with nothing deleted — nothing to fill. */
export class NothingRemovedError extends Error {
  constructor() {
    super('nothing_removed')
    this.name = 'NothingRemovedError'
  }
}

/**
 * Propose the concept, or — once one exists and items were deleted — regenerate the removed items.
 * One call, one department, one press of the button (d.7). The function writes the row itself, so
 * nothing is persisted here; `requested_by` and the regeneration stamp come from database triggers
 * off `auth.uid()`, which only works if the write happens on the caller's own client.
 */
export function useProposeConcepts(briefId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<{ regenerated: number }> => {
      const { data, error } = await supabase.functions.invoke('propose-concepts', {
        body: { campaignBriefId: briefId },
      })
      if (error) {
        // A refusal (4xx) arrives as a FunctionsHttpError with the Response on `context` and
        // `data` null — the code is in the body, not in `data`. Reading `data.error.code` here
        // made every refusal present as the generic failure (found 14 Sep, N8).
        const ctx = (error as { context?: Response }).context
        const body = ctx ? await ctx.clone().json().catch(() => null) : null
        const code = (body as { error?: { code?: string } } | null)?.error?.code
          ?? (data as { error?: { code?: string } } | null)?.error?.code
        // The two refusals worth their own sentence on screen: nothing is wrong, the brief has not
        // been written yet / nothing has been deleted yet.
        if (code === 'brief_empty') throw new BriefEmptyError()
        if (code === 'nothing_removed') throw new NothingRemovedError()
        throw error
      }
      return { regenerated: (data as { regenerated?: number } | null)?.regenerated ?? 0 }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: conceptKeys.forBrief(briefId) })
    },
  })
}

/** Keep confirms an item; delete removes it and opens a slot in its shape (addendum d.10/d.11). */
export function useMarkConceptItem(briefId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { conceptId: string; itemId: string; action: 'keep' | 'delete' }) => {
      const { error } = await supabaseUntyped.rpc('campaign_concept_mark_item', {
        p_concept: a.conceptId,
        p_item_id: a.itemId,
        p_action: a.action,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: conceptKeys.forBrief(briefId) })
    },
  })
}

/** Discard the whole concept and start again. Delete, never edit. */
export function useDiscardConcept(briefId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (conceptId: string) => {
      const { error } = await supabaseUntyped.from('campaign_concepts').delete().eq('id', conceptId)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: conceptKeys.forBrief(briefId) })
    },
  })
}
