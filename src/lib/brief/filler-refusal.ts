import type { TFunction } from 'i18next'

/**
 * ADR-0111 d.2 (I59.27) — the database's filler refusal, said as a sentence.
 *
 * `app.approve_campaign` (the release of a single job AND the approval of a campaign) refuses a brief
 * field that holds only placeholder text with errcode 22023, hint `brief_filler`, and the field in
 * DETAIL as JSON: `{"field": "task", "label": "The task", "text": "XYZ 123"}`. The label in DETAIL is
 * the template's English one, so the screen passes `labelFor` to put the field's name in the reader's
 * language where it knows it; the database's label is the fallback.
 *
 * Returns null for anything that is not this refusal, so a caller tries it first and falls through
 * to its own handling.
 */
export interface FillerRefusal {
  field: string
  label: string
  text: string
}

export function readFillerRefusal(err: unknown): FillerRefusal | null {
  if (!err || typeof err !== 'object') return null
  const e = err as { code?: unknown; hint?: unknown; details?: unknown }
  if (e.code !== '22023' || e.hint !== 'brief_filler') return null
  let detail: unknown = null
  try {
    detail = typeof e.details === 'string' ? JSON.parse(e.details) : null
  } catch {
    detail = null
  }
  const d = (detail && typeof detail === 'object' ? detail : {}) as Record<string, unknown>
  const field = typeof d.field === 'string' ? d.field : ''
  const label = typeof d.label === 'string' ? d.label : field
  const text = typeof d.text === 'string' ? d.text : ''
  return { field, label, text }
}

/** "The task still says 'XYZ 123' — write the real task." — or null when `err` is not the refusal. */
export function fillerRefusalMessage(
  t: TFunction,
  err: unknown,
  labelFor?: (fieldKey: string) => string | null | undefined,
): string | null {
  const r = readFillerRefusal(err)
  if (!r) return null
  const label = (r.field && labelFor?.(r.field)) || r.label || r.field
  // The lower-case name for the end of the sentence, as the database words it: "The task" → "task".
  const field = label.replace(/^the\s+/i, '').toLowerCase()
  const capital = label.charAt(0).toUpperCase() + label.slice(1)
  return t('escalations.filler.refused', { label: capital, text: r.text, field })
}
