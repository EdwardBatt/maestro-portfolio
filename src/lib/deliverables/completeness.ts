import type { DeliverableState } from './state-machine'

/**
 * Is this deliverable finished?
 *
 * Approved means signed off; archived means tidied away. Everything else — draft, in_progress,
 * in_review, blocked, delivered — is still someone's problem today.
 *
 * `delivered` counts as LIVE on purpose: it is out with the client and a revision can still come
 * back. Filing it under "completed" would hide exactly the work most likely to return.
 *
 * Pure and dependency-free so the surfaces that split live from finished work share one rule, and
 * so a test can use the real thing rather than restating it in a mock.
 */
export function isDeliverableComplete(state: DeliverableState): boolean {
  return state === 'approved' || state === 'archived'
}
