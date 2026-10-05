/**
 * Dos and don'ts — the rules a piece of work carries (SJ-v3, 22 Sep).
 *
 * Edward, 22 Sep: *"the client rules are the dos and don'ts set up in the client profile"* — and
 * nowhere else. A client's profile holds a list of DO / DON'T lines; a single job inherits them,
 * locked, and they are snapshotted INTO the job's brief values under `RULES_KEY`, so the
 * department reads exactly what the account manager saw, whatever the profile says later.
 *
 * Shared by the client profile (writes), the intake flow (reads, snapshots) and the deliverable
 * side (reads the snapshot) — in `lib/` so no feature imports another's internals for a shape.
 */
export interface ClientRule {
  kind: 'do' | 'dont'
  text: string
  /** ADR-0123 d.5: the language codes the rule applies in (the tenant's own). Absent or empty: every
   *  language — every rule written before 28 Sep. */
  languages?: string[]
}

/** Where the inherited rules sit inside `campaign_briefs.values`, beside the template's fields. */
export const RULES_KEY = 'inheritedRules'

export function normalizeRules(raw: unknown): ClientRule[] {
  if (!Array.isArray(raw)) return []
  const out: ClientRule[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const text = typeof (r as ClientRule).text === 'string' ? (r as ClientRule).text.trim() : ''
    if (!text) continue
    const langs = (r as ClientRule).languages
    const languages = Array.isArray(langs) ? langs.filter((l): l is string => typeof l === 'string' && !!l) : []
    out.push({ kind: (r as ClientRule).kind === 'dont' ? 'dont' : 'do', text, ...(languages.length ? { languages } : {}) })
  }
  return out
}

/** The snapshot as it is stored — a JSON string, because `values` is read as a string map. */
export function serializeRules(rules: ClientRule[]): string {
  return JSON.stringify(rules)
}

export function parseRules(stored: unknown): ClientRule[] {
  if (typeof stored !== 'string' || !stored.trim()) return []
  try {
    return normalizeRules(JSON.parse(stored))
  } catch {
    return []
  }
}
