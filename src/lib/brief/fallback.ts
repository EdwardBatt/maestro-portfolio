/**
 * Heading-matching fallback for brief ingestion (ADR-0044 §7).
 *
 * Not a lesser option — this is the answer when the model call fails (quota, outage,
 * timeout). It is a pure `(text) => BriefFields`, so it runs anywhere, costs nothing
 * and cannot fail in a way the wizard has to handle.
 *
 * SHARED WITH DENO (see `./fields.ts`): explicit `.ts` extensions, no npm imports.
 *
 * The rule it implements is deliberately dumb: a line that *looks like a heading* and
 * whose text matches a known synonym opens a section; everything until the next such
 * line is that field's value. It does not guess, and prose-only briefs with no headings
 * come back empty — which is honest, and exactly why the model path exists.
 */
import { FIELD_HEADINGS, tidyFieldValue, type BriefFieldKey, type BriefFields } from './fields.ts'

/** Lower-case, strip punctuation to spaces, collapse. "Audience — Primary:" → "audience primary". */
function normalizeHeading(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Built once: every recognised heading spelling → the field it opens. */
const HEADING_LOOKUP: ReadonlyMap<string, BriefFieldKey> = (() => {
  const map = new Map<string, BriefFieldKey>()
  for (const key of Object.keys(FIELD_HEADINGS) as BriefFieldKey[]) {
    for (const heading of FIELD_HEADINGS[key]) {
      const normalized = normalizeHeading(heading)
      // First declaration wins, so a later field cannot quietly steal an earlier
      // field's heading — the duplicate is a bug, and a unit test asserts there is none.
      if (!map.has(normalized)) map.set(normalized, key)
    }
  }
  return map
})()

/** How long a line may be and still be considered a heading rather than a sentence. */
const MAX_HEADING_CHARS = 70

interface HeadingHit {
  key: BriefFieldKey
  /** Text that followed the heading on the SAME line, e.g. "Background: Zeta is…". */
  inline: string
}

/**
 * Is this line a heading for a known field? Recognises three shapes:
 *   `## Background`        markdown
 *   `Background: Zeta is…` label with a colon (content may follow on the line)
 *   `BACKGROUND`           a short standalone line
 */
function headingOf(line: string): HeadingHit | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  const markdown = /^#{1,6}\s*(.+?)\s*$/.exec(trimmed)
  if (markdown?.[1]) {
    const key = HEADING_LOOKUP.get(normalizeHeading(markdown[1]))
    if (key) return { key, inline: '' }
  }

  const labelled = /^(?:[-*•]\s*)?(?:\d+[.)]\s*)?([^:\n]{1,70}):\s*(.*)$/.exec(trimmed)
  if (labelled?.[1] !== undefined) {
    const key = HEADING_LOOKUP.get(normalizeHeading(labelled[1]))
    if (key) return { key, inline: (labelled[2] ?? '').trim() }
  }

  if (trimmed.length <= MAX_HEADING_CHARS) {
    const key = HEADING_LOOKUP.get(normalizeHeading(trimmed))
    if (key) return { key, inline: '' }
  }

  return null
}

/**
 * Map a plain-text brief onto the wizard's fields by matching headings to synonyms.
 * Returns only the fields the document actually spoke to. A heading that appears twice
 * continues the same field rather than replacing it — nothing already read is discarded.
 */
export function mapBriefHeadings(text: string): BriefFields {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const collected = new Map<BriefFieldKey, string[]>()
  let current: BriefFieldKey | null = null

  for (const line of lines) {
    const hit = headingOf(line)
    if (hit) {
      current = hit.key
      if (!collected.has(current)) collected.set(current, [])
      if (hit.inline) collected.get(current)!.push(hit.inline)
      continue
    }
    if (current) collected.get(current)!.push(line)
  }

  const fields: BriefFields = {}
  for (const [key, parts] of collected) {
    const value = tidyFieldValue(parts.join('\n'))
    if (value) fields[key] = value
  }
  return fields
}
