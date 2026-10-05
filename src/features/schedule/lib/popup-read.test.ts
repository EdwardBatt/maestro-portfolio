import { describe, expect, it } from 'vitest'
import { POPUP_MAX_REREADS, popupRead } from './popup-read'

const at = { openedAt: 1000, readAt: 2000, fetching: false, bookingHeld: true, taskAssigneeId: 'u1' as string | null | undefined, rereads: 0 }

describe('popupRead (test script step 14)', () => {
  it('waits for a read made after the pop-up opened — the memory may be older than the booking', () => {
    expect(popupRead({ ...at, readAt: 500, fetching: true })).toEqual({ state: 'wait', refetch: false })
  })
  it('renders the form when the fresh read agrees with the booking', () => {
    expect(popupRead(at)).toEqual({ state: 'ready', refetch: false })
  })
  it('never renders an empty form for a booked task: it waits and reads again', () => {
    expect(popupRead({ ...at, taskAssigneeId: null })).toEqual({ state: 'wait', refetch: true })
    expect(popupRead({ ...at, taskAssigneeId: null, fetching: true, rereads: 1 })).toEqual({ state: 'wait', refetch: false })
  })
  it('after the reads still say nobody, the database is the truth', () => {
    expect(popupRead({ ...at, taskAssigneeId: null, rereads: POPUP_MAX_REREADS })).toEqual({ state: 'ready', refetch: false })
  })
  it('a task nobody holds, opened from a held booking, is not the same as one missing from the list', () => {
    expect(popupRead({ ...at, taskAssigneeId: undefined })).toEqual({ state: 'ready', refetch: false })
  })
})
