import { describe, expect, it } from 'vitest'
import {
  requestDayCount,
  requestDepartmentName,
  requestHoursPerDay,
  requestSpan,
  toAssignmentRequest,
  type AssignmentRequestRow,
} from './requests'

/**
 * ADR-0087 d.11 — what the *requested* chip and the *awaiting approval from …* line are derived
 * from. The department answering is read the way `app.in_write_scope` reads it, and the span is
 * measured the way the grid measures a booking, so the chip lands where the booking will.
 */

const row = (over: Partial<AssignmentRequestRow> = {}): AssignmentRequestRow => ({
  id: 'q1',
  sub_task_id: 's1',
  resource_id: 'r1',
  assignee_id: 'u-maker',
  requested_by: 'u-lead',
  requested_at: '2026-09-11T08:00:00Z',
  title: 'Studio day',
  starts_at: '2026-09-14T05:00:00Z',
  due_at: '2026-09-15T13:00:00Z',
  hours: '16',
  status: 'pending',
  decided_by: null,
  decided_at: null,
  reason: null,
  requester: { display_name: 'Creative Lead' },
  resource: { name: 'Studio Maker', departments: { name: 'Production' }, teams: { name: 'Studio', departments: { name: 'Production' } } },
  sub_task: { title: 'Studio day (task)', deliverables: { streams: { campaigns: { name: 'Ramadan 2027' } } } },
  ...over,
})

describe('requestDepartmentName — who answers, read as in_write_scope reads it', () => {
  it('is the resource’s own department first', () => {
    expect(requestDepartmentName(row().resource)).toBe('Production')
  })

  it('falls back to the department the team sits in for a resource naming only a team (ADR-0070 d.3)', () => {
    expect(requestDepartmentName({ name: 'X', departments: null, teams: { name: 'Studio', departments: { name: 'Production' } } })).toBe('Production')
  })

  it('names the team when that is all there is, and nothing when the resource is unplaced', () => {
    expect(requestDepartmentName({ name: 'X', departments: null, teams: { name: 'Studio', departments: null } })).toBe('Studio')
    expect(requestDepartmentName({ name: 'X', departments: null, teams: null })).toBeNull()
    expect(requestDepartmentName(null)).toBeNull()
  })

  it('accepts PostgREST’s array form of an embed', () => {
    expect(requestDepartmentName({ name: 'X', departments: [{ name: 'Media' }], teams: [] })).toBe('Media')
  })
})

describe('toAssignmentRequest', () => {
  it('maps the row, numbers the hours, and reads the campaign through the task', () => {
    const r = toAssignmentRequest(row())
    expect(r).toMatchObject({
      id: 'q1', subTaskId: 's1', resourceId: 'r1', requesterName: 'Creative Lead', resourceName: 'Studio Maker',
      hours: 16, departmentName: 'Production', taskTitle: 'Studio day (task)', campaignName: 'Ramadan 2027',
    })
  })

  it('falls back to the payload title when the task embed is missing, and to no campaign for ad-hoc work', () => {
    const r = toAssignmentRequest(row({ sub_task: null }))
    expect(r.taskTitle).toBe('Studio day')
    expect(r.campaignName).toBeNull()
  })
})

describe('requestSpan / requestDayCount / requestHoursPerDay — the chip’s geometry', () => {
  it('measures the span as the grid measures a booking', () => {
    const r = toAssignmentRequest(row())
    expect(requestSpan(r)).toEqual({ start: Date.parse('2026-09-14T05:00:00Z'), end: Date.parse('2026-09-15T13:00:00Z') })
    expect(requestDayCount(r)).toBe(2) // the 14th and the 15th — the columns the chip lands on
    expect(requestHoursPerDay(r)).toBe(8)
  })

  it('spreads the hours over the days asked for', () => {
    const r = toAssignmentRequest(row({ starts_at: '2026-09-14T05:00:00Z', due_at: '2026-09-17T13:00:00Z', hours: 24 }))
    expect(requestDayCount(r)).toBe(4)
    expect(requestHoursPerDay(r)).toBe(6)
    // A span ending exactly at midnight does not touch the next day.
    expect(requestDayCount({ startsAt: '2026-09-14T05:00:00Z', dueAt: '2026-09-15T00:00:00Z' })).toBe(1)
  })

  it('has nothing to draw when the payload leaves the dates alone', () => {
    const r = toAssignmentRequest(row({ starts_at: null, due_at: null, hours: null }))
    expect(requestSpan(r)).toBeNull()
    expect(requestDayCount(r)).toBe(1)
    expect(requestHoursPerDay(r)).toBeNull()
  })

  it('refuses an inverted span rather than drawing a negative chip', () => {
    expect(requestSpan({ startsAt: '2026-09-15T05:00:00Z', dueAt: '2026-09-14T05:00:00Z' })).toBeNull()
  })
})
