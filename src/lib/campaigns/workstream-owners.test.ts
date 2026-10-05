import { describe, expect, it } from 'vitest'
import { orderOwnerCandidates, type WorkstreamOwnerCandidate } from './workstream-owners'

// ADR-0101 d.8: the group's own department first — its department lead, then its team leads and
// deputies — then everyone else eligible, by department and the same role order.
describe('orderOwnerCandidates (ADR-0101 d.8)', () => {
  const people: WorkstreamOwnerCandidate[] = [
    { id: 'c-deputy', name: 'Zed', departmentId: 'content', role: 'deputy_team_lead' },
    { id: 'a-team', name: 'Ali', departmentId: 'creative', role: 'team_lead' },
    { id: 'c-lead', name: 'Maya', departmentId: 'content', role: 'department_lead' },
    { id: 'a-lead', name: 'Hana', departmentId: 'creative', role: 'department_lead' },
    { id: 'a-deputy', name: 'Bo', departmentId: 'creative', role: 'deputy_team_lead' },
  ]
  const name = (id: string | null) => ({ creative: 'Creative', content: 'Content' })[id ?? ''] ?? ''

  it("puts the group's own department first, lead before team leads before deputies", () => {
    expect(orderOwnerCandidates(people, 'creative', name).map((p) => p.id)).toEqual([
      'a-lead', 'a-team', 'a-deputy', 'c-lead', 'c-deputy',
    ])
  })

  it('with no department yet, orders everyone by department name and role', () => {
    expect(orderOwnerCandidates(people, null, name).map((p) => p.id)).toEqual([
      'c-lead', 'c-deputy', 'a-lead', 'a-team', 'a-deputy',
    ])
  })
})
