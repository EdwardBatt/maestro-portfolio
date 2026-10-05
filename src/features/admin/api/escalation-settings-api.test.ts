import { describe, expect, it, vi } from 'vitest'

// The module reaches lib/supabase → lib/env, which throws in CI; only the pure helpers are tested.
vi.mock('../../../lib/supabase', () => ({ supabaseUntyped: {} }))
vi.mock('../../../app/auth-context', () => ({ useAuth: () => ({ claims: { tenantId: 't1' } }) }))

import { changedRules, parseReachingNobody, sortRules, type EscalationRule } from './escalation-settings-api'

const r = (o: Partial<EscalationRule> & { id: string; kind: string }): EscalationRule => ({
  hours: 24, roleIds: [], relative: [], ...o,
})

describe('escalation settings helpers (ADR-0108)', () => {
  it('orders the rows as the ADR lists them, campaign_brief after task_list, unknown kinds last', () => {
    const sorted = sortRules([
      r({ id: '1', kind: 'review_escalate' }),
      r({ id: '2', kind: 'zeta_new' }),
      r({ id: '3', kind: 'campaign_brief' }),
      r({ id: '4', kind: 'unassigned' }),
      r({ id: '5', kind: 'task_list' }),
    ])
    expect(sorted.map((x) => x.kind)).toEqual(['unassigned', 'task_list', 'campaign_brief', 'review_escalate', 'zeta_new'])
  })

  it('changedRules returns only what differs; the order of roles and people does not count as a change', () => {
    const before = [
      r({ id: 'a', kind: 'unassigned', roleIds: ['x', 'y'], relative: ['owner', 'reviewers'] }),
      r({ id: 'b', kind: 'blocked', hours: 24 }),
    ]
    const after = [
      r({ id: 'a', kind: 'unassigned', roleIds: ['y', 'x'], relative: ['reviewers', 'owner'] }),
      r({ id: 'b', kind: 'blocked', hours: 12 }),
    ]
    expect(changedRules(before, after).map((x) => x.id)).toEqual(['b'])
  })

  it('parseReachingNobody reads a list of kinds or rows with a kind, and nothing else', () => {
    expect(parseReachingNobody(['blocked'])).toEqual(['blocked'])
    expect(parseReachingNobody([{ kind: 'extension_am', rule_id: 'x' }, { other: 1 }])).toEqual(['extension_am'])
    expect(parseReachingNobody(null)).toEqual([])
    expect(parseReachingNobody({ kind: 'x' })).toEqual([])
  })
})
