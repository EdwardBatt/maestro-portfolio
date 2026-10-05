/**
 * Send a failure the user hit to the tenant's Power Admin(s) — the "Report to your administrator"
 * action on an error dialog (ADR-0092 d.3 / I48.11). The server (report-error) finds the recipients
 * and sends via Resend; the client passes only what the user saw.
 *
 * A plain async function, not a hook: the button that calls it owns its own small state, so it needs
 * no QueryClient and renders inside any dialog.
 */
export interface ErrorReport {
  /** The error message shown to the user. */
  message: string
  /** What they were doing, if the caller can say (free text). */
  context?: string
  /** A short machine code, where one is known. */
  code?: string
  /** Where in the app it happened (a surface name), if known. */
  where?: string
  /** I48.39: the underlying failure, technical, as `describeCause` renders it. ADR-0092 d.3
   *  promised the administrator "any error code"; the friendly sentence alone told them nothing. */
  cause?: string
  /** I66.12: the page it happened on — the full address, so the administrator can open the very record. Filled in
   *  by `reportError` from the browser when the caller does not give one. */
  page?: string
}

/**
 * What the administrator needs to see about a failure, from whatever was thrown: the Postgres /
 * PostgREST code, the server's message, its DETAIL and HINT; an Edge Function's status; or a plain
 * Error's message. Never throws, never empty when something was thrown — an unknown shape is
 * rendered as JSON so the report still carries it.
 */
export function describeCause(err: unknown): { code?: string; cause: string } {
  if (err == null) return { cause: '' }
  const e = err as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown; status?: unknown; name?: unknown }
  const code = typeof e.code === 'string' && e.code ? e.code : undefined
  const parts: string[] = []
  if (typeof e.name === 'string' && e.name && e.name !== 'Error') parts.push(e.name)
  if (typeof e.status === 'number') parts.push(`HTTP ${e.status}`)
  if (typeof e.message === 'string' && e.message) parts.push(e.message)
  if (typeof e.details === 'string' && e.details) parts.push(`detail: ${e.details}`)
  if (typeof e.hint === 'string' && e.hint) parts.push(`hint: ${e.hint}`)
  if (parts.length === 0) {
    try { parts.push(typeof err === 'string' ? err : JSON.stringify(err)) } catch { parts.push(String(err)) }
  }
  return { code, cause: parts.join(' · ').slice(0, 2000) }
}

export interface ErrorReportResult {
  sent: number
  skipped?: string
}

export async function reportError(report: ErrorReport): Promise<ErrorReportResult> {
  // Imported at call time, not module load: `lib/supabase` pulls `lib/env`, which throws where no
  // VITE_* is set (CI, and any test that renders an error dialog). Deferring it keeps the static
  // import graph — NoticeDialog → ReportErrorButton → here — free of that throw (traps.md).
  const { supabaseUntyped } = await import('../supabase')
  const page = report.page ?? (typeof window !== 'undefined' ? window.location.href : '')
  const { data, error } = await supabaseUntyped.functions.invoke('report-error', { body: { ...report, page } })
  if (error) throw error
  return data as ErrorReportResult
}
