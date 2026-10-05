/**
 * **Is the Schedule pop-up's read of the task fit to edit?** (test script step 14, 4 Oct.) The pop-up opens from a
 * booking — somebody holds the task. Its form must never start from a read that says otherwise: a stale task list
 * once opened a booked task as unbooked (Who, Dates and hours empty), and Save took the person off.
 *
 *  - `wait`: show "loading" — the read is older than the pop-up, or it disagrees with the booking and a fresh read
 *    is due (`refetch` says to ask for one);
 *  - `ready`: render the form. After the fresh reads still disagree, the database is the truth (the chip was stale).
 */
export const POPUP_MAX_REREADS = 2

export function popupRead(a: {
  /** when the pop-up opened (ms) */
  openedAt: number
  /** when the task list was last read (ms; 0 = never) */
  readAt: number
  /** a read is on its way */
  fetching: boolean
  /** the booking the pop-up was opened from has a person on it */
  bookingHeld: boolean
  /** the task, as read: its person (undefined = not in the list) */
  taskAssigneeId: string | null | undefined
  /** how many extra reads the disagreement has already asked for */
  rereads: number
}): { state: 'wait' | 'ready'; refetch: boolean } {
  if (a.readAt < a.openedAt) return { state: 'wait', refetch: false }
  const disagrees = a.bookingHeld && a.taskAssigneeId === null
  if (!disagrees || a.rereads >= POPUP_MAX_REREADS) return { state: a.fetching && disagrees ? 'wait' : 'ready', refetch: false }
  return { state: 'wait', refetch: !a.fetching }
}
