import { describe, expect, it } from 'vitest'
import {
  appointmentsOf,
  approvalCompletesTask,
  approvalWaitsFor,
  sendBackWaitsFor,
  approvedReviewers,
  isReviewerOutstanding,
  lacksRequiredReviewer,
  outstandingReviewers,
  reviewerPayload,
  reviewerRole,
  sortReviewers,
  unansweredOptionalReviewers,
  type TaskReviewer,
} from './task-reviewers'

/**
 * ADR-0043, ADR-0089. The rule these helpers describe is enforced in the database, not here — this
 * is the presentation side of it, and the assertions exist so the screen and
 * `public.sub_task_approve` cannot tell a reviewer two different stories about whether their
 * approval finishes the work, or whether they approve at all.
 */

const r = (over: Partial<TaskReviewer> & { userId: string }): TaskReviewer => ({
  name: over.userId,
  isMandatory: false,
  approvedAt: null,
  respondedAt: null,
  response: null,
  isActive: true,
  ...over,
})

describe('task reviewers (ADR-0043)', () => {
  it('puts mandatory reviewers first, then sorts by name', () => {
    const sorted = sortReviewers([
      r({ userId: 'zoe' }),
      r({ userId: 'amir' }),
      r({ userId: 'yara', isMandatory: true }),
    ])
    // Not cosmetic: when a task is late, the mandatory reviewers are the ones who can unblock it.
    expect(sorted.map((x) => x.userId)).toEqual(['yara', 'amir', 'zoe'])
  })

  it('a required reviewer is outstanding until they approve (ADR-0043 d.8)', () => {
    const all = [
      r({ userId: 'done', isMandatory: true, approvedAt: '2026-08-27T09:00:00Z' }),
      r({ userId: 'owed', isMandatory: true }),
    ]
    expect(outstandingReviewers(all).map((x) => x.userId)).toEqual(['owed'])
    expect(approvedReviewers(all).map((x) => x.userId)).toEqual(['done'])
  })

  it('round-trips appointments into the RPC payload, using the database naming', () => {
    const appointments = appointmentsOf([r({ userId: 'b' }), r({ userId: 'a', isMandatory: true })])
    expect(appointments).toEqual([
      { userId: 'a', isMandatory: true },
      { userId: 'b', isMandatory: false },
    ])
    expect(reviewerPayload(appointments)).toEqual([
      { user_id: 'a', is_mandatory: true },
      { user_id: 'b', is_mandatory: false },
    ])
  })
})

describe('two kinds of reviewer, two kinds of wait (ADR-0089)', () => {
  const required = r({ userId: 'req', isMandatory: true })
  const answered = r({ userId: 'ans', respondedAt: '2026-09-11T09:00:00Z', response: 'no_comment' })
  const silent = r({ userId: 'silent' })

  it('an optional reviewer is outstanding until they ANSWER, not until they approve (d.12)', () => {
    const all = [required, answered, silent]
    expect(isReviewerOutstanding(answered, all)).toBe(false)
    expect(isReviewerOutstanding(silent, all)).toBe(true)
    expect(isReviewerOutstanding(required, all)).toBe(true)
    expect(outstandingReviewers(all).map((x) => x.userId)).toEqual(['req', 'silent'])
  })

  it('a lone unmarked reviewer is the required one by definition (d.2)', () => {
    // The flag is written at commit; before that the list reads as nobody marked.
    expect(reviewerRole(silent, [silent])).toBe('required')
    expect(isReviewerOutstanding(silent, [silent])).toBe(true)
    expect(isReviewerOutstanding(r({ userId: 'x', approvedAt: '2026-09-11T09:00:00Z' }), [silent])).toBe(false)
    expect(unansweredOptionalReviewers([silent])).toEqual([])
  })

  it('names the optional reviewers who have not answered, and nobody else (d.7)', () => {
    expect(unansweredOptionalReviewers([required, answered, silent]).map((x) => x.userId)).toEqual(['silent'])
  })

  it('a form may not submit several reviewers with none marked (d.3)', () => {
    expect(lacksRequiredReviewer([])).toBe(false)
    expect(lacksRequiredReviewer([{ isMandatory: false }])).toBe(false)
    expect(lacksRequiredReviewer([{ isMandatory: false }, { isMandatory: false }])).toBe(true)
    expect(lacksRequiredReviewer([{ isMandatory: true }, { isMandatory: false }])).toBe(false)
  })

  describe('would my approval complete the task?', () => {
    it('yes, when nobody is mandatory — the defensive pool line the database also keeps (ADR-0043 d.5)', () => {
      expect(approvalCompletesTask([r({ userId: 'a' }), r({ userId: 'b' })], 'a')).toBe(true)
    })

    it('no, while another mandatory reviewer is still owed', () => {
      const all = [r({ userId: 'a', isMandatory: true }), r({ userId: 'b', isMandatory: true })]
      expect(approvalCompletesTask(all, 'a')).toBe(false)
    })

    it('yes, when I am the last mandatory reviewer left', () => {
      const all = [
        r({ userId: 'a', isMandatory: true, approvedAt: '2026-08-27T09:00:00Z' }),
        r({ userId: 'b', isMandatory: true }),
      ]
      expect(approvalCompletesTask(all, 'b')).toBe(true)
    })

    it('no, while an optional reviewer has not answered — the task cannot complete (d.6)', () => {
      expect(approvalCompletesTask([required, silent], 'req')).toBe(false)
      expect(approvalCompletesTask([required, answered], 'req')).toBe(true)
    })
  })

  describe('who does my send-back wait for? (addendum d.14)', () => {
    it('every silent optional reviewer, even when another required approval is still owed', () => {
      const other = r({ userId: 'other', isMandatory: true })
      expect(sendBackWaitsFor([required, other, answered, silent], 'req').map((x) => x.userId)).toEqual(['silent'])
    })

    it('never the caller: an optional reviewer sending it back has spoken', () => {
      expect(sendBackWaitsFor([required, silent], 'silent')).toEqual([])
    })
  })

  describe('who does my approval wait for? (d.7)', () => {
    it('the silent optional reviewers, when mine would be the completing approval', () => {
      expect(approvalWaitsFor([required, answered, silent], 'req').map((x) => x.userId)).toEqual(['silent'])
    })

    it('nobody, when another required approval is still owed — only the COMPLETING approval is gated', () => {
      const other = r({ userId: 'other', isMandatory: true })
      expect(approvalWaitsFor([required, other, silent], 'req')).toEqual([])
      // Once the other has approved, mine completes — and waits.
      const otherDone = r({ userId: 'other', isMandatory: true, approvedAt: '2026-09-11T09:00:00Z' })
      expect(approvalWaitsFor([required, otherDone, silent], 'req').map((x) => x.userId)).toEqual(['silent'])
    })

    it('nobody, once everyone has answered', () => {
      expect(approvalWaitsFor([required, answered], 'req')).toEqual([])
    })
  })
})
