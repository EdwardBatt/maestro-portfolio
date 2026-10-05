import { describe, expect, it } from 'vitest'
import { departmentSections, UNASSIGNED } from './department-sections'
import type { DeliverableRow } from '../../deliverables/api/deliverables-api'

const mk = (o: Partial<DeliverableRow> & { id: string }): DeliverableRow => ({
  name: o.id,
  state: 'draft',
  dueAt: null,
  revisionRound: 0,
  ownerUserId: null,
  ownerName: null,
  typeName: null,
  taskCount: 0,
  unassignedCount: 0,
  revisionLimit: null,
  streamId: null,
  workstreamId: null,
  streamName: null,
  discipline: null,
  departmentId: null,
  campaignId: 'cam1',
  approvedVersion: null,
  // I40.22: where the work actually is, derived from the tasks. Fixtures here carry no tasks.
  progress: { phase: 'no_tasks', total: 0, unassigned: 0, done: 0, everTotal: 0, inReview: 0, inProgress: 0, notStarted: 0 },
  assigneeNames: [],
  assignerNames: [],
  blockingReviewers: { names: [], allRequired: false },
  tasksApprovedAt: null,
  tasksApprovedBy: null,
  canApproveTasks: false,
  campaignKind: 'campaign',
  ...o,
})

describe('campaign sections (ADR-0050 d.4 / ADR-0053 d.1)', () => {
  it('groups the deliverables by department, not by stream', () => {
    const sections = departmentSections([
      mk({ id: 'a', departmentId: 'd-creative', discipline: 'Creative' }),
      mk({ id: 'b', departmentId: 'd-film', discipline: 'Film' }),
      mk({ id: 'c', departmentId: 'd-creative', discipline: 'Creative' }),
    ])
    expect(sections.map((s) => s.name)).toEqual(['Creative', 'Film'])
    expect(sections[0]!.deliverables.map((d) => d.id)).toEqual(['a', 'c'])
  })

  it('keeps work with no department, in its own section, last', () => {
    // `deliverables.department_id` is stamped from the OWNER (ADR-0050), so unowned work has none.
    // Grouping it away would hide exactly the work nobody has picked up — on the screen whose job
    // is to be read before the campaign is approved.
    const sections = departmentSections([
      mk({ id: 'orphan' }),
      mk({ id: 'owned', departmentId: 'd-film', discipline: 'Film' }),
    ])
    expect(sections.map((s) => s.key)).toEqual(['d-film', UNASSIGNED])
    expect(sections[1]!.departmentId).toBeNull()
    expect(sections[1]!.name).toBeNull() // the page translates this into "not yet with a department"
    expect(sections.flatMap((s) => s.deliverables.map((d) => d.id))).toEqual(['owned', 'orphan'])
  })

  it('takes the department name off whichever row carries one', () => {
    // A null name is a join that returned nothing, not a department called "". One row with the
    // name is enough to head the section, and the section must not be split in two by it.
    const sections = departmentSections([
      mk({ id: 'a', departmentId: 'd-film', discipline: null }),
      mk({ id: 'b', departmentId: 'd-film', discipline: 'Film' }),
    ])
    expect(sections).toHaveLength(1)
    expect(sections[0]!.name).toBe('Film')
  })

  it('is empty for a campaign with no deliverables', () => {
    expect(departmentSections([])).toEqual([])
  })

  it('raises a section for a department that has a brief but no deliverables yet', () => {
    // The approval surface exists to have every brief READ before approving (ADR-0048 d.9). A
    // department whose brief is written but whose deliverables are not created yet used to have no
    // section at all, so its brief was invisible to the person approving.
    const sections = departmentSections(
      [mk({ id: 'a', departmentId: 'd-creative', discipline: 'Creative' })],
      [
        { departmentId: 'd-creative', departmentName: 'Creative' },
        { departmentId: 'd-film', departmentName: 'Film' },
      ],
    )
    expect(sections.map((s) => s.key)).toEqual(['d-creative', 'd-film'])
    expect(sections[1]!.name).toBe('Film')
    expect(sections[1]!.deliverables).toEqual([]) // the page renders "nothing to deliver yet"
  })

  it('renders only the briefs when no deliverables exist at all', () => {
    const sections = departmentSections(
      [],
      [
        { departmentId: 'd-film', departmentName: 'Film' },
        { departmentId: 'd-creative', departmentName: 'Creative' },
      ],
    )
    expect(sections.map((s) => s.name)).toEqual(['Creative', 'Film']) // ordered, not as supplied
    expect(sections.every((s) => s.deliverables.length === 0)).toBe(true)
  })

  it('keeps the union ordered by name with the unassigned group still last', () => {
    const sections = departmentSections(
      [mk({ id: 'orphan' }), mk({ id: 'z', departmentId: 'd-film', discipline: 'Film' })],
      [{ departmentId: 'd-creative', departmentName: 'Creative' }],
    )
    expect(sections.map((s) => s.key)).toEqual(['d-creative', 'd-film', UNASSIGNED])
  })

  it('does not split a department that has both a brief and deliverables', () => {
    const sections = departmentSections(
      [mk({ id: 'a', departmentId: 'd-film', discipline: null })],
      [{ departmentId: 'd-film', departmentName: 'Film' }],
    )
    expect(sections).toHaveLength(1)
    expect(sections[0]!.name).toBe('Film') // the brief names the section the join left blank
    expect(sections[0]!.deliverables.map((d) => d.id)).toEqual(['a'])
  })
})
