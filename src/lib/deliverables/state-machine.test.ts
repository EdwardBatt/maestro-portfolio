import { describe, it, expect } from 'vitest'
import {
  DELIVERABLE_TRANSITIONS,
  type DeliverableState,
  nextStates,
  findTransition,
  isAllowed,
  allowedTransitions,
  effectiveRevisionLimit,
  isOverRevisionLimit,
} from './state-machine'

const MANAGE = { manage: true, review: false }
const REVIEW = { manage: false, review: true }
const BOTH = { manage: true, review: true }
const NEITHER = { manage: false, review: false }

// The from→to matrix a person can ask for, mirrored from the DB guard (migration 20260817110100) — less
// the moves only the tasks make (ADR-0118 d.2, d.5): draft → in_progress (a task starts), in_review → approved
// (the last task is approved), in_review → in_progress (a task is sent back).
const EXPECTED: Record<DeliverableState, DeliverableState[]> = {
  draft: ['archived'],
  in_progress: ['in_review', 'blocked', 'archived'],
  blocked: ['in_progress', 'archived'],
  in_review: [],
  approved: ['delivered', 'in_progress', 'archived'],
  delivered: ['archived', 'in_progress'],
  archived: [],
}

describe('deliverable transition graph', () => {
  it('matches the expected from→to matrix exactly', () => {
    for (const from of Object.keys(EXPECTED) as DeliverableState[]) {
      expect(nextStates(from).map((t) => t.to).sort()).toEqual([...EXPECTED[from]].sort())
    }
  })

  it('rejects transitions not in the graph', () => {
    expect(findTransition('draft', 'approved')).toBeUndefined()
    expect(findTransition('in_progress', 'approved')).toBeUndefined()
    expect(findTransition('archived', 'in_progress')).toBeUndefined()
  })
})

describe('authority', () => {
  it('nobody signs a deliverable off by hand — it closes when its last task is (ADR-0118 d.2)', () => {
    expect(findTransition('in_review', 'approved')).toBeUndefined()
    expect(isAllowed('in_review', 'approved', REVIEW)).toBe(false)
    expect(isAllowed('in_review', 'approved', BOTH)).toBe(false)
  })

  it('nobody starts a deliverable or sends one back by hand — its tasks do (ADR-0118 d.5)', () => {
    expect(isAllowed('draft', 'in_progress', MANAGE)).toBe(false)
    expect(isAllowed('in_review', 'in_progress', BOTH)).toBe(false)
    expect(isAllowed('in_progress', 'blocked', NEITHER)).toBe(false)
  })

  it('ordinary transitions need project_tasks:manage', () => {
    expect(isAllowed('draft', 'archived', MANAGE)).toBe(true)
    expect(isAllowed('draft', 'archived', REVIEW)).toBe(false)
    expect(isAllowed('in_progress', 'blocked', MANAGE)).toBe(true)
    expect(isAllowed('in_progress', 'blocked', REVIEW)).toBe(false)
  })

  it('a reviewer-only actor has no deliverable moves at all', () => {
    expect(allowedTransitions('in_review', REVIEW)).toEqual([])
    expect(allowedTransitions('in_progress', REVIEW)).toEqual([])
    expect(allowedTransitions('draft', REVIEW)).toEqual([])
  })
})

describe('revision + events (in lockstep with the DB guard)', () => {
  it('counts a revision only on the rework cycles the DB increments', () => {
    expect(findTransition('approved', 'in_progress')?.countsRevision).toBe(true)
    expect(findTransition('delivered', 'in_progress')?.countsRevision).toBeUndefined()
  })

  it('emits the expected sla_events event_types', () => {
    expect(findTransition('in_progress', 'blocked')?.event).toBe('blocked_flagged')
    expect(findTransition('blocked', 'in_progress')?.event).toBe('block_cleared')
  })
})

describe('revision limit (warn-and-allow)', () => {
  it('per-deliverable override wins over the work-type default', () => {
    expect(effectiveRevisionLimit(2, 5)).toBe(2)
    expect(effectiveRevisionLimit(null, 5)).toBe(5)
    expect(effectiveRevisionLimit(null, null)).toBeNull()
  })

  it('over-limit informs, never for a null limit', () => {
    expect(isOverRevisionLimit(3, 2)).toBe(true)
    expect(isOverRevisionLimit(2, 2)).toBe(false)
    expect(isOverRevisionLimit(9, null)).toBe(false)
  })
})

describe('graph integrity', () => {
  it('archived is terminal', () => {
    expect(DELIVERABLE_TRANSITIONS.archived).toEqual([])
  })
})
