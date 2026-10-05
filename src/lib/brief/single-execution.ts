/**
 * The single-execution brief's two fixed names, shared by the intake flow that writes it (SJ-03,
 * ADR-0084) and the deliverable detail that reads one line of it back (ADR-0090 d.7). In `lib/`
 * so neither feature imports the other's internals for a string.
 */

/** The template every single job's brief is written from (ADR-0084 d.1). */
export const SINGLE_EXECUTION = 'single_execution'

/**
 * ADR-0084 d.8: "what could stop this" is kept as free text, stored WITH the brief values under
 * this key and shown to the deliverable owner above the task list. It is a reminder, never a
 * dependency — nothing reads it as one, nothing waits on it.
 */
export const RISK_KEY = 'whatCouldStopThis'
