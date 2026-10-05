import { describe, expect, it } from 'vitest'
import { notificationDoor } from './door'

const n = (type: string, entityType: string, entityId: string) => ({ id: 'n1', type, entityType, entityId, detail: null })

/** ADR-0132 d.6: a notification about a piece opens the campaign page with that piece's panel open. */
describe('notificationDoor — the piece', () => {
  it('opens the piece on its campaign when the campaign is known (the email)', () => {
    expect(notificationDoor(n('deliverable_added', 'deliverable', 'd1'), { campaignId: 'c1' })).toBe('/campaigns/c1?piece=d1')
  })
  it('looks the campaign up when it is not (the bell)', () => {
    expect(notificationDoor(n('deliverable_added', 'deliverable', 'd1'))).toBe('/campaigns/piece/d1')
  })
  it('still sends the maker\'s own task to the task page', () => {
    expect(notificationDoor(n('assigned', 'sub_task', 't1'))).toBe('/my-work/task/t1')
  })
})

/** ADR-0133 (I70.3, I70.5): a hand-over notice opens the leaving person's hand-over page. */
describe('the hand-over door', () => {
  it('opens the person named by the notice', () => {
    expect(notificationDoor(n('handover_list', 'user_profile', 'u9'))).toBe('/people/handover/u9')
    expect(notificationDoor({ id: 'n2', type: 'deactivation_complete', entityType: null, entityId: null, detail: { user_id: 'u9' } }))
      .toBe('/people/handover/u9')
  })
  it('falls back to My Work when it names nobody', () => {
    expect(notificationDoor({ id: 'n3', type: 'handover_list', entityType: null, entityId: null, detail: null })).toBe('/my-work')
  })
})
