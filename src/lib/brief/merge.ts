/**
 * Merging an ingest result into the wizard (ADR-0044 §5).
 *
 * The whole rule is here, in one pure function, because it is the rule that matters:
 * **only empty fields are filled, and nothing a person typed is ever overwritten.**
 * The caller gets back the keys that were actually filled, which is what the wizard
 * marks as machine-filled and what it counts in "filled 6 fields from the document".
 *
 * Two things the caller must supply, because this module cannot know them:
 *   • `allowed` — the fields the wizard will actually RENDER. A performance field filled
 *     on a 360 brief is invisible, so it can never be reviewed, marked or corrected, and
 *     counting it makes the count a lie. §5 promises every filled field is visibly marked.
 *   • nothing else. Whether a skipped field was the user's own writing or a previous
 *     ingest's is the caller's business; this returns the keys and lets it decide.
 *
 * SHARED WITH DENO (see `./fields.ts`): explicit `.ts` extensions, no npm imports.
 */
import {
  isWithinFieldLimit,
  tidyFieldValue,
  type BriefFieldKey,
  type BriefFields,
} from './fields.ts'

export interface BriefMergeResult<T> {
  /** The state to apply. Identical to `current` when nothing was filled. */
  next: T
  /** Fields this merge filled — every one of them was empty before. */
  filled: BriefFieldKey[]
  /** Fields the document spoke to but which already held something. */
  skipped: BriefFieldKey[]
  /** Fields dropped for being longer than one brief field may be. Told to the user. */
  oversized: BriefFieldKey[]
}

/** True for a value the user has not supplied: absent, empty, or whitespace only. */
function isEmpty(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === ''
}

/**
 * Fill the empty brief fields of `current` from `suggested`, leaving everything else
 * exactly as it was. Generic over the wizard's state so it can be applied to the whole
 * form object without the caller having to pick the brief fields out first.
 *
 * `allowed` is the set of fields the caller will render; anything outside it is ignored
 * entirely — not filled, not counted, not reported.
 */
export function applyBriefSuggestions<T extends Partial<Record<BriefFieldKey, string>>>(
  current: T,
  suggested: BriefFields,
  allowed: readonly BriefFieldKey[],
): BriefMergeResult<T> {
  const filled: BriefFieldKey[] = []
  const skipped: BriefFieldKey[] = []
  const oversized: BriefFieldKey[] = []
  const patch: Partial<Record<BriefFieldKey, string>> = {}

  for (const key of allowed) {
    const raw = suggested[key]
    if (typeof raw !== 'string') continue
    const value = tidyFieldValue(raw)
    if (value === null) continue
    if (!isEmpty(current[key])) {
      skipped.push(key)
      continue
    }
    if (!isWithinFieldLimit(value)) {
      oversized.push(key)
      continue
    }
    patch[key] = value
    filled.push(key)
  }

  return {
    next: filled.length === 0 ? current : { ...current, ...patch },
    filled,
    skipped,
    oversized,
  }
}
