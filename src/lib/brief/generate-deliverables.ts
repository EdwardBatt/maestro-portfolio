/**
 * Moved here from features/campaigns/api on 2 Oct (I73.3, ADR-0138): the single job asks the brief too, and a
 * feature may not reach into another's api (AGENTS.md §3). The campaign path re-exports it unchanged.
 */
import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'
import { supabaseUntyped } from '../supabase'
import { MAX_BRIEF_CHARS } from './fields'
import {
  MAX_DELIVERABLE_NAME_CHARS,
  MAX_DELIVERABLE_QUANTITY,
  MAX_PROPOSED_DELIVERABLES,
  type ProposedDeliverable,
  type ProposedGroup,
  type VocabularyOutcome,
  type VocabularyStatus,
} from './deliverables'

/**
 * Proposing the deliverable list (ADR-0048 d.4, ADR-0050 d.6).
 *
 * **Nothing here fails silently.** An earlier version returned `[]` for every failure that was
 * not a recognised refusal, on the reasoning that "an empty proposal and a broken proposal look
 * the same to the person, who types the list either way". That reasoning is wrong, and it cost
 * an afternoon: the deployed function was a version behind, rejected the request with a 400,
 * and the wizard showed an empty table with no message. The user had no way to tell "the brief
 * implies no deliverables" from "these two programs disagree about the request".
 *
 * So every outcome now says which it is:
 *   - a REFUSAL the server meant (401/403/413/503) → its own message, something to act on
 *   - a MISMATCH (400, or any other status) → says so, because it means a deploy is out of step
 *   - an OUTAGE (network, 5xx) → says the service could not be reached, add them yourself
 *   - a MALFORMED answer → says so rather than looking like an empty result
 *
 * The wizard never blocks on any of them: the table stays exactly as usable as it was before
 * this feature existed. But it always says what happened.
 *
 * There is no heuristic fallback here, deliberately. `ingest-brief` falls back to heading
 * matching because a brief document has structure a heuristic can read. A deliverable list has
 * none — nothing in "make Zeta the network young Iraqis choose" says "one hero film and three
 * cutdowns" except judgement, and a made-up list is indistinguishable from a real reading.
 *
 * The API key is not here and cannot be: it is an Edge Function secret read by
 * `generate-deliverables` from its own environment. Nothing in `src/` reads it, and no
 * `VITE_`-prefixed variable exists for it — the only route into the browser bundle.
 */
/**
 * ADR-0054: rows now carry a type code and a channel. Both are `.optional()` here and NOT merely
 * `.nullable()`, on purpose: `deliverables` is `.catch([])`, so a function deployed a version
 * behind — returning rows without the fields — would fail the array parse and produce an empty
 * list, which is precisely the silent-empty failure the rest of this file exists to prevent. A
 * missing field is read as "this deployment does not classify", not as "the brief implies nothing".
 */
const proposedRowSchema = z.object({
  name: z.string().max(MAX_DELIVERABLE_NAME_CHARS),
  quantity: z.number().int().min(1).max(MAX_DELIVERABLE_QUANTITY),
  typeCode: z.string().nullable().optional(),
  // ADR-0097 d.4: the row came back outside the catalogue; a person chooses before release.
  needsType: z.boolean().optional(),
  note: z.string().nullable().optional(),
  channel: z.string().nullable().optional(),
  // ADR-0096 d.8: the model's suggestion of WHEN, by phase number.
  phaseNumber: z.number().int().nullable().optional(),
  // ADR-0101: the brief line it came from, and which proposed group it sits in.
  from: z.string().nullable().optional(),
  group: z.number().int().nullable().optional(),
})

// ADR-0101: absent from an older deployment — rows then arrive in no group, which is still usable.
const proposedGroupSchema = z.object({
  name: z.string().nullable(),
  departmentId: z.string().nullable(),
})

const vocabularyStatusSchema: z.ZodType<VocabularyStatus> = z.enum([
  'offered',
  'empty',
  'over_ceiling',
  'unavailable',
])

const responseSchema = z.object({
  deliverables: z.array(proposedRowSchema).max(MAX_PROPOSED_DELIVERABLES).catch([]),
  // ADR-0054 d.5: which of the two lists could be offered. Absent from an older deployment, which
  // reads as 'unavailable' — honest, because that deployment offered no vocabulary at all.
  vocabulary: z
    .object({ types: vocabularyStatusSchema, channels: vocabularyStatusSchema })
    .catch({ types: 'unavailable', channels: 'unavailable' }),
  needsType: z.number().int().catch(0),
  groups: z.array(proposedGroupSchema).catch([]),
})

/**
 * What one call produced: the rows, and what happened to the vocabulary behind them.
 *
 * The wizard needs both. Rows that arrived untyped because the tenant has no active types is a
 * different sentence from rows that arrived untyped because the model saw the list and could not
 * classify them — and an empty dropdown must never look like a model that had no opinion.
 */
export interface DeliverableProposal {
  rows: ProposedDeliverable[]
  /** ADR-0101: the proposed workstreams. A row's `group` indexes into this. */
  groups: ProposedGroup[]
  vocabulary: VocabularyOutcome
  /** ADR-0097 d.5: how many rows need a person to choose the deliverable. */
  needsType: number
}

/**
 * A refusal the SERVER made, as opposed to a service that fell over.
 *
 * Same distinction as `BriefIngestRefusedError`, for the same reason: `functions.invoke`
 * reports every non-2xx as one opaque error, so without unpacking it a caller who simply
 * lacks `projects:manage` is told the service is unavailable — false, and it sends them to
 * the wrong person.
 */
export class DeliverablesRefusedError extends Error {
  readonly code:
    | 'unauthenticated'
    | 'forbidden'
    | 'too_long'
    | 'unconfigured'
    /** The server rejected the REQUEST — almost always a deployed function a version behind. */
    | 'mismatch'
    /** Reached the server and it failed, or could not be reached at all. */
    | 'unavailable'
    /** Answered, but not in a shape this version understands. */
    | 'malformed'
  constructor(code: DeliverablesRefusedError['code']) {
    super(code)
    this.name = 'DeliverablesRefusedError'
    this.code = code
  }
}

const REFUSAL_BY_STATUS: Record<number, DeliverablesRefusedError['code']> = {
  400: 'mismatch',
  401: 'unauthenticated',
  403: 'forbidden',
  413: 'too_long',
  503: 'unconfigured',
}

/**
 * Turn whatever `functions.invoke` threw into something the user can be told.
 *
 * `FunctionsHttpError` carries the raw `Response` on `.context`. Anything with no status never
 * reached the server. **Every branch returns an error** — there is no path that quietly means
 * "nothing found".
 */
export function classify(error: unknown): DeliverablesRefusedError {
  const status = (error as { context?: { status?: unknown } } | null)?.context?.status
  if (typeof status !== 'number') return new DeliverablesRefusedError('unavailable')
  return new DeliverablesRefusedError(REFUSAL_BY_STATUS[status] ?? 'unavailable')
}

export interface GenerateDeliverablesInput {
  /** The brief as the wizard holds it — however it got there (ADR-0048 d.3). */
  brief: string
  /** ADR-0096 d.8: the wizard's phases, so the model can suggest which each row belongs to. */
  phases?: { number: number; name: string; startsOn: string; endsOn: string }[]
  /** ADR-0101 d.9: false when the campaign does not use workstreams. */
  grouped?: boolean
}

/**
 * Ask for a proposed deliverable list.
 *
 * Returns `[]` rather than throwing when the service is simply unavailable: an empty
 * proposal and a broken proposal look the same to the person, who types the list either
 * way. A deliberate refusal DOES throw, because "ask an administrator for the grant" is
 * something they can act on and "the service is down" is not.
 */
export function useGenerateDeliverables() {
  return useMutation<DeliverableProposal, Error, GenerateDeliverablesInput>({
    mutationFn: async ({ brief, phases, grouped = true }) => {
      const nothing: DeliverableProposal = {
        rows: [],
        groups: [],
        vocabulary: { types: 'unavailable', channels: 'unavailable' },
        needsType: 0,
      }
      if (!brief.trim()) return nothing
      if (brief.length > MAX_BRIEF_CHARS) throw new DeliverablesRefusedError('too_long')

      let data: unknown
      try {
        const res = await supabaseUntyped.functions.invoke('generate-deliverables', {
          body: {
            brief,
            ...(phases && phases.length > 0 ? { phases } : {}),
            // Sent only when OFF, so a deployment that predates the switch still answers grouped.
            ...(grouped ? {} : { grouped: false }),
          },
        })
        if (res.error) throw res.error
        data = res.data
      } catch (e) {
        // Always throws. Nothing here is allowed to look like "the brief implies nothing".
        throw classify(e)
      }

      return parseProposal(data)
    },
  })
}

/**
 * Turn the function's answer into a proposal, or throw `malformed`.
 *
 * Exported so the guarantee can be asserted directly (`classify-failure.test.ts`): **no input to
 * this function returns an empty list to mean a failure.** The version-skew case is the one worth
 * naming — a `generate-deliverables` deployed before ADR-0054 returns rows with no `typeCode`, and
 * because `deliverables` is `.catch([])` a stricter row schema would turn that whole answer into
 * an empty table with nothing to read. That is the 27 August bug, in a new place.
 */
export function parseProposal(data: unknown): DeliverableProposal {
  const parsed = responseSchema.safeParse(data)
  if (!parsed.success) throw new DeliverablesRefusedError('malformed')
  return {
    // ADR-0054 d.6: nullable end to end. An absent field and an explicit null are the same thing —
    // a legal, untyped row — and neither is an error.
    rows: parsed.data.deliverables.map((r) => ({
      name: r.name,
      quantity: r.quantity,
      typeCode: r.typeCode ?? null,
      needsType: r.needsType ?? r.typeCode == null,
      note: r.note ?? null,
      channel: r.channel ?? null,
      phaseNumber: r.phaseNumber ?? null,
      from: r.from ?? null,
      // A group index the answer does not have is no group at all — never a crash.
      group: r.group != null && r.group >= 0 && r.group < parsed.data.groups.length ? r.group : null,
    })),
    groups: parsed.data.groups,
    vocabulary: parsed.data.vocabulary,
    needsType: parsed.data.needsType,
  }
}
