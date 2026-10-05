import { describe, expect, it } from 'vitest'
import { TRANSITIONS, checkTransition, deriveInitialState } from './state-machine.ts'
import type { BookingState, TransitionAction } from './state-machine.ts'

const STATES: BookingState[] = ['soft_hold', 'tentative', 'confirmed', 'cancelled', 'expired']
const ACTIONS = Object.keys(TRANSITIONS) as TransitionAction[]

/** grant sets mirroring the seeded roles (ADR-0008) */
const SCHEDULER = new Set(['bookings:create', 'bookings:update', 'bookings:delete', 'bookings:export'])
const APPROVER = new Set([...SCHEDULER, 'bookings:approve'])
const VIEWER = new Set<string>() // team member: no booking grants

describe('transition matrix (M4.1 — table-driven, every from→to pair)', () => {
  it('terminal states accept no transitions at all', () => {
    for (const from of ['cancelled', 'expired'] as const) {
      for (const action of ACTIONS) {
        const r = checkTransition(action, from, APPROVER)
        expect(r.ok, `${action} from ${from}`).toBe(false)
      }
    }
  })

  it('approve/reject act only on tentative, only for bookings:approve holders', () => {
    expect(checkTransition('approve', 'tentative', APPROVER)).toEqual({ ok: true, to: 'confirmed' })
    expect(checkTransition('reject', 'tentative', APPROVER)).toEqual({ ok: true, to: 'cancelled' })
    expect(checkTransition('approve', 'tentative', SCHEDULER).error).toBe('permission_denied')
    expect(checkTransition('approve', 'confirmed', APPROVER).error).toBe('invalid_from_state')
  })

  it('expire is system-only and only from soft_hold', () => {
    expect(checkTransition('expire', 'soft_hold', 'system')).toEqual({ ok: true, to: 'expired' })
    for (const held of [SCHEDULER, APPROVER]) {
      expect(checkTransition('expire', 'soft_hold', held).error).toBe('permission_denied')
    }
  })

  it('cancel works from every live state for bookings:delete holders — and no one else', () => {
    for (const from of ['soft_hold', 'tentative', 'confirmed'] as const) {
      expect(checkTransition('cancel', from, SCHEDULER).ok).toBe(true)
      expect(checkTransition('cancel', from, VIEWER).error).toBe('permission_denied')
    }
  })

  it('exhaustive sanity: no rule targets a terminal-from', () => {
    for (const action of ACTIONS) {
      for (const from of TRANSITIONS[action].from) {
        expect(STATES).toContain(from)
        expect(['cancelled', 'expired']).not.toContain(from)
      }
    }
  })
})

describe('initial state derivation (§4.2 + §9.1 approval routing)', () => {
  it('non-approver requesting confirmed on an approval-required resource → tentative', () => {
    const r = deriveInitialState({ requested: 'confirmed', requiresApproval: true, assessment: 'ok', canApprove: false })
    expect(r).toEqual({ state: 'tentative', needsApproval: true })
  })

  it('an approve-grant holder requesting confirmed on an approval-required resource confirms directly', () => {
    const r = deriveInitialState({ requested: 'confirmed', requiresApproval: true, assessment: 'ok', canApprove: true })
    expect(r).toEqual({ state: 'confirmed', needsApproval: false })
  })

  it('warnings ride along but never downgrade or refuse (warn-and-allow)', () => {
    const r = deriveInitialState({ requested: 'confirmed', requiresApproval: false, assessment: 'over_ceiling', canApprove: false })
    expect(r).toEqual({ state: 'confirmed', needsApproval: false })
  })

  it('exclusive conflict on a confirm request is refused with tentative fallback', () => {
    const r = deriveInitialState({ requested: 'confirmed', requiresApproval: false, assessment: 'conflict', canApprove: true })
    expect(r.refused).toBe('exclusive_conflict')
    expect(r.state).toBe('tentative')
  })

  it('soft_hold passes through untouched', () => {
    const r = deriveInitialState({ requested: 'soft_hold', requiresApproval: true, assessment: 'warn', canApprove: false })
    expect(r).toEqual({ state: 'soft_hold', needsApproval: false })
  })
})
