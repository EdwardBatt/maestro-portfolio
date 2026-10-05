/**
 * What a failure MEANS, in plain words, for the administrator who receives the report (I66.12, Edward 29 Sep: "this
 * message is vague… how am I supposed to know what this error was?"). The report carried only the database's code
 * and token — `23514`, `campaign_not_draft` — which say nothing to a person. Read from the same code and cause the
 * report already carries; null when nothing here recognises it, and the raw cause is still sent beside it.
 *
 * Pure and dependency-free: the browser and the `report-error` Edge Function both import it.
 */
const BY_TOKEN: readonly [RegExp, string][] = [
  [/campaign_not_draft/, 'The job or campaign had already been sent for approval, so it could no longer be saved as a draft. Nothing was lost; it is waiting for its approver.'],
  [/JWT expired|invalid JWT|jwt/i, "The person's sign-in had expired. Signing out and in again fixes it."],
  [/Failed to fetch|NetworkError|network|timed out|timeout/i, 'The browser could not reach the server — a connection problem, not a rule.'],
  [/could not find a relationship|PGRST200/, 'The app asked the database for a link between records that does not exist — a defect to fix in the app.'],
  [/filler/i, 'A required field held only placeholder words.'],
]

const BY_CODE: Readonly<Record<string, string>> = {
  '23505': 'Something with the same name or key already exists.',
  '23503': 'The change points at a record that no longer exists, or one that other records still depend on.',
  '23514': 'The database refused the change because one of its rules was not met.',
  '42501': 'The person is not allowed to do this — outside their role, their reach, or both.',
  P0002: 'The record could not be found — it may have been deleted, or the person cannot see it.',
  PGRST116: 'The record could not be found, or the person cannot see it.',
  '401': "The person's sign-in was not accepted.",
  '403': 'The person is not allowed to do this.',
}

export function explainFailure(code: string | null | undefined, cause: string | null | undefined): string | null {
  const text = `${cause ?? ''}`
  for (const [pattern, meaning] of BY_TOKEN) if (pattern.test(text)) return meaning
  if (code && BY_CODE[code]) return BY_CODE[code]!
  return null
}
