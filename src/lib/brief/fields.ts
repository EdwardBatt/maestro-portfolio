/**
 * The brief fields a model — or the heading-matching fallback — may fill (ADR-0044).
 *
 * SHARED WITH DENO. This module is imported by `supabase/functions/ingest-brief/`,
 * so it follows the same rules as `src/lib/capacity/engine.ts` and
 * `src/lib/bookings/state-machine.ts`, which Edge Functions already import:
 * explicit `.ts` extensions on every relative import, and **no npm imports at all**.
 * Keeping the field list in one place is the point — the model's structured-output
 * schema, the Zod validation of its answer, the fallback mapper and the wizard's
 * "filled from the brief" markers all read it from here, so they cannot drift apart.
 *
 * What is NOT here, deliberately: client, brand, deliverables and dates. The model
 * has no data access (ADR-0044 §4), so it cannot know a client id or a discipline
 * id, and a hallucinated one would be worse than a blank. It fills prose only.
 */

/**
 * Hard input cap (ADR-0044 §2). Roughly twenty pages — far more than any real brief.
 * Over the cap the request is REFUSED, never truncated: a brief silently cut in half
 * fills fields from the half that survived and looks complete.
 */
export const MAX_BRIEF_CHARS = 50_000

/** Per-field cap. A brief field is a paragraph, not a chapter; anything longer is a runaway answer. */
export const MAX_FIELD_CHARS = 4_000

/**
 * The nine strategy fields (ADR-0020, frame 21.2) plus the five performance fields
 * (ADR-0021, `paid_media` only). Keys match `WizardState` exactly, so the wizard can
 * merge a result without a translation table.
 */
export const BRIEF_FIELD_KEYS = [
  'background',
  'task',
  'beautifulProblem',
  'audiencePrimary',
  'audienceSecondary',
  'brandFunctionalBenefit',
  'brandEmotionalBenefit',
  'insight',
  'proposition',
  'perfObjective',
  'perfBudget',
  'perfAudience',
  'perfGeography',
  'perfPlatforms',
] as const

export type BriefFieldKey = (typeof BRIEF_FIELD_KEYS)[number]

/**
 * The five performance-flight fields, which are a SEPARATE brief in the agency's own deck
 * (the agency performance-marketing brief template (client-supplied, not included)) and read as one on screen.
 *
 * Lived in `BriefWizard` as a private constant until I34.7 needed the same split to lay the brief
 * out. One list, imported twice — the alternative is two lists that agree until somebody adds a
 * sixth field to one of them.
 */
export const PERFORMANCE_FIELD_KEYS = [
  'perfObjective',
  'perfBudget',
  'perfAudience',
  'perfGeography',
  'perfPlatforms',
] as const satisfies readonly BriefFieldKey[]

export function isPerformanceField(key: string): boolean {
  return (PERFORMANCE_FIELD_KEYS as readonly string[]).includes(key)
}

/** A partial answer: only the fields the source document actually spoke to. */
export type BriefFields = Partial<Record<BriefFieldKey, string>>

export function isBriefFieldKey(key: string): key is BriefFieldKey {
  return (BRIEF_FIELD_KEYS as readonly string[]).includes(key)
}

/**
 * What each field means, in the model's words. These become the `description` of each
 * property in the structured-output schema, so the wording is functional, not decorative —
 * it is the only instruction the model gets about what belongs in a field.
 */
export const FIELD_DESCRIPTIONS: Record<BriefFieldKey, string> = {
  background: 'Context and situation: the brand, the market, what has happened so far.',
  task: 'What the agency is being asked to do — the job itself, in one or two sentences.',
  beautifulProblem: 'The central tension or creative problem worth solving.',
  audiencePrimary: 'The primary audience: who they are and what matters to them.',
  audienceSecondary: 'The secondary audience, if the brief names one.',
  brandFunctionalBenefit: 'What the product or service actually does for the audience.',
  brandEmotionalBenefit: 'How the product or service makes the audience feel.',
  insight: 'The human truth the work should hang on.',
  proposition: 'The single-minded proposition — what the work must say.',
  perfObjective: 'The objective of this specific advertising flight (performance briefs).',
  perfBudget: 'The advertising budget or range for this flight, exactly as stated.',
  perfAudience: 'Targeting for this flight: audience definition, interests, segments.',
  perfGeography: 'Geography and language targeting for this flight.',
  perfPlatforms: 'Platform preferences and exclusions for this flight.',
}

/**
 * Headings the fallback mapper recognises, per field (ADR-0044 §7). Matched case- and
 * punctuation-insensitively against a line that looks like a heading. Order matters
 * within a field only for readability; across fields the LONGEST match wins, so
 * "audience — secondary" is not swallowed by "audience".
 */
export const FIELD_HEADINGS: Record<BriefFieldKey, readonly string[]> = {
  background: ['background', 'context', 'situation', 'where we are', 'about the brand', 'overview'],
  task: ['task', 'the task', 'objective', 'what we need', 'the ask', 'assignment', 'scope of work'],
  beautifulProblem: [
    'beautiful problem',
    'the beautiful problem',
    'problem',
    'the problem',
    'challenge',
    'the challenge',
    'tension',
  ],
  audiencePrimary: [
    'audience',
    'target audience',
    'primary audience',
    'audience primary',
    'who are we talking to',
    'target market',
  ],
  audienceSecondary: ['secondary audience', 'audience secondary', 'secondary target'],
  brandFunctionalBenefit: [
    'functional benefit',
    'brand functional benefit',
    'rational benefit',
    'product benefit',
  ],
  brandEmotionalBenefit: ['emotional benefit', 'brand emotional benefit', 'how it feels'],
  insight: ['insight', 'consumer insight', 'human truth', 'the insight'],
  proposition: [
    'proposition',
    'the proposition',
    'single minded proposition',
    'smp',
    'key message',
    'message',
  ],
  perfObjective: [
    'campaign objective',
    'performance objective',
    'advertising objective',
    'what should this advertising achieve',
  ],
  perfBudget: ['budget', 'advertising budget', 'media budget', 'spend', 'budget range'],
  perfAudience: ['performance audience', 'paid audience', 'targeting', 'audience targeting'],
  perfGeography: ['geography', 'geo', 'location', 'markets', 'geography and language', 'language'],
  perfPlatforms: ['platforms', 'channels', 'platform preferences', 'media channels', 'exclusions'],
}

/**
 * One field the model may fill: its key in the answer, and the sentence that tells the model
 * what belongs in it. ADR-0084 d.6 makes ingestion TEMPLATE-DRIVEN — the list comes from a brief
 * template's own `fields` (`key` + `guidance`) rather than from a hand-written constant — so this
 * is the shape both sources reduce to.
 */
export interface BriefFieldSpec {
  key: string
  description: string
}

/**
 * The campaign wizard's fourteen strategy fields, as specs. What `ingest-brief` used when
 * `BRIEF_FIELD_KEYS` was the only list, and what it still uses when no `briefType` is sent.
 */
export const CAMPAIGN_BRIEF_FIELD_SPECS: readonly BriefFieldSpec[] = BRIEF_FIELD_KEYS.map((key) => ({
  key,
  description: FIELD_DESCRIPTIONS[key],
}))

/**
 * A key the model can be asked for and the strict schema can name. Template keys are typed by
 * an administrator, so the rule is stated rather than assumed: a JavaScript-identifier-shaped
 * word, at most 64 characters. Anything else is skipped, not sanitised — a renamed key would
 * come back under a name the template does not know.
 */
const FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/

/**
 * Read a brief template's `fields` (the `brief_templates.fields` jsonb — an array of objects
 * with at least `key`, usually `guidance`, `en`, `ar`) into the specs the model needs.
 *
 * Tolerant of shape, strict about keys. A malformed entry is skipped; a duplicate key keeps its
 * first occurrence; the description is the field's `guidance`, else its English label, else the
 * key itself — the model always gets SOME sentence per field, because the description is the
 * only instruction it receives about what belongs there. Returns an empty list for anything that
 * is not an array, which the caller treats as "no usable template".
 */
export function templateFieldSpecs(fields: unknown): BriefFieldSpec[] {
  if (!Array.isArray(fields)) return []
  const out: BriefFieldSpec[] = []
  const seen = new Set<string>()
  for (const entry of fields) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const key = record.key
    if (typeof key !== 'string' || !FIELD_KEY_PATTERN.test(key) || seen.has(key)) continue
    const guidance = typeof record.guidance === 'string' ? record.guidance.trim() : ''
    const label = typeof record.en === 'string' ? record.en.trim() : ''
    seen.add(key)
    out.push({ key, description: guidance || label || key })
  }
  return out
}

/**
 * The structured-output schema handed to the model (ADR-0044 §3), for any list of fields.
 * Every field is `required` with `additionalProperties: false` — the API's strict JSON-schema
 * mode wants a closed object, so "the brief does not say" is expressed as an empty string
 * rather than an absent key. Empty strings are dropped on the way back out.
 */
export function briefOutputJsonSchemaFor(specs: readonly BriefFieldSpec[]): {
  type: 'object'
  properties: Record<string, { type: 'string'; description: string }>
  required: string[]
  additionalProperties: false
} {
  const properties: Record<string, { type: 'string'; description: string }> = {}
  for (const { key, description } of specs) {
    properties[key] = { type: 'string', description }
  }
  return {
    type: 'object',
    properties,
    required: specs.map((s) => s.key),
    additionalProperties: false,
  }
}

/** The campaign wizard's schema — `briefOutputJsonSchemaFor` over the fourteen strategy fields. */
export function briefOutputJsonSchema(): ReturnType<typeof briefOutputJsonSchemaFor> {
  return briefOutputJsonSchemaFor(CAMPAIGN_BRIEF_FIELD_SPECS)
}

/**
 * Trim and collapse runaway whitespace. Returns null when nothing is left.
 *
 * It deliberately does NOT truncate. It used to, and that was the same mistake ADR-0044 §2
 * argues against one level up: a Background cut off mid-sentence and then marked "from the
 * uploaded brief" reads as complete, and nobody re-reads a field that looks finished. An
 * over-long value is REFUSED by `isWithinFieldLimit` and the user is told a section was too
 * long to use — an empty field they can see is better than a truncated one they cannot.
 */
export function tidyFieldValue(value: string): string | null {
  const trimmed = value.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return trimmed || null
}

/**
 * Is this value short enough to use? Both paths apply it — the Edge Function through its Zod
 * `.max(MAX_FIELD_CHARS)`, the heading fallback through `applyBriefSuggestions` — so a field
 * that is too long is dropped, never silently shortened, whichever produced it.
 */
export function isWithinFieldLimit(value: string): boolean {
  return value.length <= MAX_FIELD_CHARS
}
