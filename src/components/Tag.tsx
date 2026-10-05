import type { ReactNode } from 'react'

/**
 * A micro-label: the small uppercase tag the CS-Flows frames set beside a heading or a field —
 * "REQUIRED", "ONE STEP", "NEW BRAND", "WHAT WE ARE MAKING", "2 STILL EMPTY". It is not a status
 * badge (those are the reserved green/amber/red of `StatusRollupStrip`); it is a quiet caption that
 * names or qualifies the thing it sits next to.
 *
 * Presentation only (AGENTS.md §4): a string and a tone in, nothing decided.
 *
 * Tones map to design tokens, never to raw colour:
 *   - `neutral`  — the default caption (grey), e.g. "WHAT WE ARE MAKING".
 *   - `accent`   — the violet emphasis, e.g. "ONE STEP", "NEW BRAND", "REQUIRED".
 *   - `ok`       — the confirmed-green caption, e.g. "FROM THE ZETA PROFILE" (kept for the campaign
 *                  wizard, which does read a profile; the single-job brief does not — Edward, 10 Sep).
 *   - `warn`     — the amber caption, e.g. "2 STILL EMPTY".
 *   - `breach`   — the red caption, for an alert that is data: "3 AT RISK" on a campaign card (I57.3).
 */
export type TagTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'breach'

export function Tag({ tone = 'neutral', children }: { tone?: TagTone; children: ReactNode }) {
  return <span className={`tag tag-${tone}`}>{children}</span>
}
