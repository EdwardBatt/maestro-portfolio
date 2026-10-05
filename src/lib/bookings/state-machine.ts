import type { AssessmentLevel } from '../capacity/types.ts'

/**
 * Booking lifecycle (M4, §4.2): flexible states in application logic; the DB
 * enforces only the one hard invariant (confirmed+exclusive no-overlap).
 * This module is pure and is the single source of transition truth — the
 * booking-transition Edge Function executes it authoritatively.
 *
 * ADR-0008: authorization is expressed as GRANTS (bookings:create / update /
 * delete / approve), never role names. Callers pass the set of booking grants
 * they hold; 'system' marks the cron/service path (expiry).
 */

export type BookingState = 'soft_hold' | 'tentative' | 'confirmed' | 'cancelled' | 'expired'
export type BookingGrant = 'bookings:create' | 'bookings:update' | 'bookings:delete' | 'bookings:approve'
export type TransitionAction = 'approve' | 'reject' | 'cancel' | 'expire' | 'confirm_hold'

interface TransitionRule {
  from: BookingState[]
  to: BookingState
  /** grant required to perform it; 'system' = cron/service path only */
  requires: BookingGrant | 'system'
}

export const TRANSITIONS: Record<TransitionAction, TransitionRule> = {
  // Approval routing (§9.1): tentative → confirmed by an approve-grant holder.
  approve: { from: ['tentative'], to: 'confirmed', requires: 'bookings:approve' },
  reject: { from: ['tentative'], to: 'cancelled', requires: 'bookings:approve' },
  // Cancelling a confirmed booking frees capacity.
  cancel: { from: ['soft_hold', 'tentative', 'confirmed'], to: 'cancelled', requires: 'bookings:delete' },
  // Soft-holds expire automatically (§4.2) — system only.
  expire: { from: ['soft_hold'], to: 'expired', requires: 'system' },
  // Turning a hold into a real request.
  confirm_hold: { from: ['soft_hold'], to: 'tentative', requires: 'bookings:create' },
}

export interface TransitionCheck {
  ok: boolean
  to?: BookingState
  error?: 'invalid_from_state' | 'permission_denied'
}

export function checkTransition(
  action: TransitionAction,
  from: BookingState,
  /** the caller's booking grants, or 'system' for the cron path */
  held: ReadonlySet<string> | 'system',
): TransitionCheck {
  const rule = TRANSITIONS[action]
  const allowed = rule.requires === 'system'
    ? held === 'system'
    : held !== 'system' && held.has(rule.requires)
  if (!allowed) return { ok: false, error: 'permission_denied' }
  if (!rule.from.includes(from)) return { ok: false, error: 'invalid_from_state' }
  return { ok: true, to: rule.to }
}

export interface InitialStateInput {
  /** what the caller asked for */
  requested: 'soft_hold' | 'tentative' | 'confirmed'
  /** resource flag (§9.1 approval workflow) */
  requiresApproval: boolean
  /** capacity verdict for the candidate */
  assessment: AssessmentLevel
  /** whether the caller holds bookings:approve */
  canApprove: boolean
}

export interface InitialStateResult {
  state: BookingState
  /** true when the request was downgraded to tentative pending approval */
  needsApproval: boolean
  /** set when the request cannot proceed at all (DB would refuse it) */
  refused?: 'exclusive_conflict'
}

/**
 * Initial state derivation (§4.2):
 * - exclusive conflict → refused (the DB exclusion constraint would reject it;
 *   we fail it cleanly with the assessment attached)
 * - requested confirmed on an approval-required resource by a caller WITHOUT
 *   bookings:approve → tentative pending approval
 * - soft_hold stays soft_hold (expiry handled upstream)
 * - warnings NEVER refuse — they ride along for the audit trail
 */
export function deriveInitialState(input: InitialStateInput): InitialStateResult {
  if (input.assessment === 'conflict' && input.requested === 'confirmed') {
    return { state: 'tentative', needsApproval: true, refused: 'exclusive_conflict' }
  }
  if (input.requested === 'soft_hold') return { state: 'soft_hold', needsApproval: false }
  if (input.requested === 'tentative') return { state: 'tentative', needsApproval: input.requiresApproval }

  // requested === 'confirmed'
  if (input.requiresApproval && !input.canApprove) {
    return { state: 'tentative', needsApproval: true }
  }
  return { state: 'confirmed', needsApproval: false }
}
