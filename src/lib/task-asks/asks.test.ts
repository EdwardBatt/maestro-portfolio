import { describe, expect, it } from 'vitest'
import {
  askCardState,
  askDays,
  askEscalatesAt,
  askHintKey,
  askHoursPerDay,
  asksToShow,
  isUnanswered,
  timeAskAgainstDue,
  timeLeftToAnswer,
  type TaskAsk,
} from './asks'

const base: TaskAsk = {
  id: 'a1', subTaskId: 't1', taskTitle: 'Translation', deliverableId: 'd1', pieceName: 'Post 2', campaignId: 'c1', campaignName: 'LUMA',
  teamId: 'copy', teamName: 'Copy', assigneeId: null, assigneeName: null, requestedBy: 'fadia', requesterName: 'Fadia',
  requesterTeamName: 'Art & Video', createdAt: '2026-09-28T07:52:00Z', hours: 2, neededBy: '2026-09-30', startsAt: null,
  dueAt: null, note: null, status: 'pending', offeredStartsAt: null, offeredEndsAt: null, answeredBy: null,
  answeredByName: null, answerNote: null, answeredAt: null, escalatedAt: null,
}

describe('askCardState — what the asker’s card says (SC-18, SC-30)', () => {
  it('maps each status to its card', () => {
    expect(askCardState({ status: 'pending' })).toBe('waiting')
    expect(askCardState({ status: 'offered' })).toBe('offer')
    expect(askCardState({ status: 'approved' })).toBe('booked')
    expect(askCardState({ status: 'refused' })).toBe('no')
    expect(askCardState({ status: 'withdrawn' })).toBe('closed')
  })
})

describe('the 4-hour clock (ADR-0139 d.5)', () => {
  const asked = '2026-09-28T07:52:00Z'
  const at = Date.parse(asked)
  it('escalates the rule’s hours after it was asked, in real time', () => {
    expect(askEscalatesAt(asked, 4)).toBe(at + 4 * 3_600_000)
    expect(askEscalatesAt(asked, null)).toBeNull()
    expect(askEscalatesAt(asked, 0)).toBeNull()
  })
  it('says the time left in hours and minutes, and nothing once it has gone', () => {
    expect(timeLeftToAnswer(asked, 4, at + 20 * 60_000)).toEqual({ h: 3, m: 40 })
    expect(timeLeftToAnswer(asked, 4, at + 4 * 3_600_000)).toBeNull()
  })
  it('is unanswered once stamped by the sweep or past the clock — and only while pending', () => {
    expect(isUnanswered(base, 4, at + 3_600_000)).toBe(false)
    expect(isUnanswered(base, 4, at + 5 * 3_600_000)).toBe(true)
    expect(isUnanswered({ ...base, escalatedAt: '2026-09-28T12:00:00Z' }, null, at)).toBe(true)
    expect(isUnanswered({ ...base, status: 'offered' }, 4, at + 9 * 3_600_000)).toBe(false)
  })
})

describe('askDays — where the ⏳ chip sits', () => {
  it('is the needed-by day when no days were asked', () => {
    expect(askDays(base)).toEqual(['2026-09-30'])
  })
  it('is the days asked for, in Iraq days', () => {
    expect(askDays({ ...base, startsAt: '2026-09-29T05:00:00Z', dueAt: '2026-09-30T15:00:00Z' })).toEqual(['2026-09-29', '2026-09-30'])
  })
  it('is the offered days while an offer waits', () => {
    expect(askDays({ ...base, status: 'offered', offeredStartsAt: '2026-10-01T05:00:00Z', offeredEndsAt: '2026-10-01T15:00:00Z' })).toEqual(['2026-10-01'])
  })
  it('spreads the hours over the days', () => {
    expect(askHoursPerDay({ ...base, hours: 6, startsAt: '2026-09-29T05:00:00Z', dueAt: '2026-09-30T15:00:00Z' })).toBe(3)
    expect(askHoursPerDay({ ...base, hours: null })).toBeNull()
  })
})

describe('asksToShow — the asker’s list', () => {
  it('keeps open asks and answers not yet put away, newest first', () => {
    const list = [
      { ...base, id: 'old', createdAt: '2026-09-27T00:00:00Z' },
      { ...base, id: 'booked', status: 'approved' as const, createdAt: '2026-09-28T00:00:00Z' },
      { ...base, id: 'seen', status: 'refused' as const, createdAt: '2026-09-29T00:00:00Z' },
      { ...base, id: 'gone', status: 'withdrawn' as const, createdAt: '2026-09-30T00:00:00Z' },
    ]
    expect(asksToShow(list, new Set(['seen'])).map((a) => a.id)).toEqual(['booked', 'old'])
  })
})

describe('timeAskAgainstDue and askHintKey', () => {
  it('places the day asked against the piece’s due day', () => {
    expect(timeAskAgainstDue({ toDay: '2026-09-30', pieceDueAt: '2026-10-01T15:00:00Z' })).toBe('before')
    expect(timeAskAgainstDue({ toDay: '2026-10-01', pieceDueAt: '2026-10-01T15:00:00Z' })).toBe('on')
    expect(timeAskAgainstDue({ toDay: '2026-10-02', pieceDueAt: '2026-10-01T15:00:00Z' })).toBe('past')
    expect(timeAskAgainstDue({ toDay: '2026-10-02', pieceDueAt: null })).toBe('none')
  })
  it('words the hints it knows and leaves the rest to the server’s message', () => {
    expect(askHintKey({ hint: 'book_directly' })).toBe('schedule.asks.hint.book_directly')
    expect(askHintKey({ hint: 'something_else' })).toBeNull()
    expect(askHintKey(null)).toBeNull()
  })
})
