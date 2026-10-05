import { describe, expect, it } from 'vitest'
import { notificationTextKey } from './words'

describe('notificationTextKey', () => {
  it("says a type's own sentence by default", () => {
    expect(notificationTextKey({ type: 'deliverable_added', detail: { for_owner: true } })).toEqual({ key: 'notifications.type.deliverable_added' })
  })

  it('tells a new owner of an approved list that nothing is owed (I57.44)', () => {
    expect(notificationTextKey({ type: 'deliverable_reassigned', detail: { tasks_approved: true } }).key).toBe('notifications.reassignedApproved')
  })

  it('asks the owner of a piece with no tasks to define them (I66.3)', () => {
    expect(notificationTextKey({ type: 'deliverable_reassigned', detail: { tasks_approved: false, no_tasks: true } }).key)
      .toBe('notifications.noTasks.deliverable_reassigned')
    expect(notificationTextKey({ type: 'deliverable_added', detail: { no_tasks: true } }).key).toBe('notifications.noTasks.deliverable_added')
  })

  it('on a release: all without tasks, some without, or none', () => {
    expect(notificationTextKey({ type: 'campaign_approved', detail: { deliverable_count: 2, no_tasks_count: 2 } }).key)
      .toBe('notifications.noTasks.campaign_approved_all')
    expect(notificationTextKey({ type: 'campaign_approved', detail: { deliverable_count: 3, no_tasks_count: 1 } }).key)
      .toBe('notifications.noTasks.campaign_approved_some')
    expect(notificationTextKey({ type: 'campaign_approved', detail: { deliverable_count: 3, no_tasks_count: 0 } }).key)
      .toBe('notifications.type.campaign_approved')
  })
})
