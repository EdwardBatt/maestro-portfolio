import { describe, expect, it } from 'vitest'
import { leadsOfDepartment } from './leads-of-department'

describe('leadsOfDepartment (I66.9)', () => {
  const leads = [
    { id: 'fadia', departmentId: 'creative' },
    { id: 'nour', departmentId: 'creative' },
    { id: 'omar', departmentId: 'content' },
  ]
  it("offers only the deliverable's own department's leads", () => {
    expect(leadsOfDepartment(leads, 'creative').map((l) => l.id)).toEqual(['fadia', 'nour'])
  })
  it('offers every lead where there is no department yet, or the department has no lead', () => {
    expect(leadsOfDepartment(leads, null)).toHaveLength(3)
    expect(leadsOfDepartment(leads, 'strategy')).toHaveLength(3)
  })
})
