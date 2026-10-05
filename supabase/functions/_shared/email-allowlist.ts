/**
 * The local-only recipient fence (ADR-0081 d.3a).
 *
 * Unreleased work runs against a local stack with email **live**, because an unsent email proves
 * nothing about copy, timing or who was told — and its seeded accounts are plus-addresses on one
 * real mailbox, so every notification reaches one person. That is safe exactly as long as no REAL
 * address ever enters the local database, and the only way one gets there is somebody copying a
 * production row to reproduce a bug. That is a habit, not a rule.
 *
 * This makes it a rule. `EMAIL_ALLOWLIST` is **unset in production**, where every recipient is
 * allowed and the fence does not exist; set locally, anything not matching is refused before it is
 * sent.
 *
 * Pure and separate from `notify-email/index.ts` so it can be unit-tested — the `_shared` +
 * colocated-test shape `download-name.ts` already established, and the reason traps.md says an Edge
 * Function's logic belongs somewhere a test can reach. **The first cut of this file matched by plain
 * substring and its own tests refused it**: `maestro.dev+fadia@example.test` does not CONTAIN
 * `maestro.dev@example.test`, because the tag sits between the local part and the `@`. Plus-addressing
 * is the entire point of the fence, so the comparison has to understand it.
 */

/**
 * An address with its plus-tag removed: `a+b@c` → `a@c`. Lower-cased, since neither Gmail nor any
 * mailbox this project sends to treats an address as case-sensitive.
 *
 * `lastIndexOf('@')` rather than `split`, because a quoted local part may legally contain one.
 */
function baseAddress(email: string): string {
  const at = email.trim().toLowerCase().lastIndexOf('@')
  const lowered = email.trim().toLowerCase()
  if (at < 1) return lowered // no domain, or nothing before the @ — not an address we can reason about
  const local = lowered.slice(0, at)
  const domain = lowered.slice(at) // keeps the '@'
  const plus = local.indexOf('+')
  return (plus < 0 ? local : local.slice(0, plus)) + domain
}

/**
 * Is this recipient allowed, given the raw `EMAIL_ALLOWLIST` value?
 *
 * @param email    the recipient address
 * @param rawList  the env var verbatim — absent, empty, or a comma-separated list of entries
 *
 * Two kinds of entry, and the shape of the entry says which:
 * - **an address** (`edward@example.com`) matches that mailbox and every plus-address on it, so one
 *   entry covers every seeded user without listing them;
 * - **a domain** (`@maestro.test`) matches anything at it, for a catch-all test domain.
 */
export function isAllowedRecipient(email: string, rawList: string | undefined | null): boolean {
  const raw = (rawList ?? '').trim()

  // OFF is the production state, and the ONLY state that lets everything through. An early return
  // rather than a branch folded into the match, so "the variable is absent" and "the variable
  // matches nothing" can never collapse into the same answer — see the next block.
  if (raw === '') return true

  const entries = raw
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p !== '')

  // FAIL CLOSED on a misconfigured list. `EMAIL_ALLOWLIST=","` yields no usable entries, and the
  // tempting reading — nothing to match against, so allow — is backwards: the variable being SET is
  // somebody saying "fence this". A typo must not quietly reopen it, because the failure is
  // outward-facing and arrives in a client's inbox.
  if (entries.length === 0) return false

  const target = email.trim().toLowerCase()
  if (target === '' || !target.includes('@')) return false
  const base = baseAddress(target)

  return entries.some((entry) =>
    entry.startsWith('@') ? target.endsWith(entry) : baseAddress(entry) === base,
  )
}
