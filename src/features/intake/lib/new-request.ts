/**
 * How a page asks the shell to open the one door (ADR-0082 d.7).
 *
 * `/campaigns` → New raises this event rather than importing the door's state: one listener in the
 * shell, no context, and a page can offer the door without knowing how it is drawn. Kept apart
 * from the component so that importing the helper never pulls a component in behind it.
 */
export const OPEN_NEW_REQUEST_EVENT = 'maestro:new-request'

/** Ask the shell to open the door. Safe to call from anywhere; a no-op where nothing listens. */
export function openNewRequest(): void {
  window.dispatchEvent(new Event(OPEN_NEW_REQUEST_EVENT))
}

/** Where each choice behind the door leads. */
export const SINGLE_JOB_ROUTE = '/campaigns/new-job'
export const FULL_CAMPAIGN_ROUTE = '/campaigns/new'
