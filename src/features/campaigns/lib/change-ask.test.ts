import { describe, expect, it } from 'vitest'
import {
  aboutHours,
  agoParts,
  askAccountManagerOf,
  askReady,
  askRefusal,
  askToShow,
  kindsToMakeInThePiece,
  num,
  pastPieceDue,
  toldNames,
  wasNow,
  type ChangeAskRow,
} from './change-ask'

const row = (over: Partial<ChangeAskRow>): ChangeAskRow => ({
  id: 'a1',
  deliverableId: 'd1',
  askedBy: 'fadia',
  askedByName: 'Fadia',
  kinds: ['due_date'],
  requestedDueDay: '2026-10-04',
  requestedHours: null,
  reason: 'Too tight',
  fromSubTaskId: null,
  status: 'pending',
  answeredBy: null,
  answeredByName: null,
  answeredAt: null,
  answerNote: null,
  appliedDueDay: null,
  appliedHours: null,
  escalatedAt: null,
  createdAt: '2026-10-03T08:00:00Z',
  ...over,
})

describe('the one change form (ADR-0141)', () => {
  it('is ready only with a kind and a reason; a due-date ask needs the day, an hours ask a positive number', () => {
    expect(askReady({ kinds: [], reason: 'x', dueDay: '', hours: '' })).toBe(false)
    expect(askReady({ kinds: ['format'], reason: '  ', dueDay: '', hours: '' })).toBe(false)
    expect(askReady({ kinds: ['format'], reason: 'wrong size', dueDay: '', hours: '' })).toBe(true)
    expect(askReady({ kinds: ['due_date'], reason: 'x', dueDay: '', hours: '' })).toBe(false)
    expect(askReady({ kinds: ['due_date'], reason: 'x', dueDay: '2026-10-04', hours: '' })).toBe(true)
    expect(askReady({ kinds: ['hours'], reason: 'x', dueDay: '', hours: '0' })).toBe(false)
    expect(askReady({ kinds: ['hours'], reason: 'x', dueDay: '', hours: '16' })).toBe(true)
  })

  it('opens from a move only past the PIECE’s due day', () => {
    expect(pastPieceDue('2026-10-04', '2026-10-01')).toBe(true)
    expect(pastPieceDue('2026-10-01', '2026-10-01')).toBe(false)
    expect(pastPieceDue('2026-10-04', null)).toBe(false)
    expect(pastPieceDue(null, '2026-10-01')).toBe(false)
  })

  it('says which kinds the account manager makes in the piece herself (only the due date is applied)', () => {
    expect(kindsToMakeInThePiece(['hours', 'due_date', 'format', 'quantity'])).toEqual(['format', 'quantity'])
  })

  it('words a refusal by its hint, with the name the database put in DETAIL', () => {
    expect(askRefusal({ hint: 'ask_account_manager', details: 'Inas' })).toEqual({ key: 'changeAsk.error.ask_account_manager', name: 'Inas' })
    expect(askRefusal({ hint: 'change_pending', details: '' })).toEqual({ key: 'changeAsk.error.change_pending', name: null })
    expect(askRefusal({ hint: 'something_else' })).toBeNull()
    expect(askRefusal(null)).toBeNull()
    expect(askAccountManagerOf({ hint: 'ask_account_manager', details: 'Inas' })).toEqual({ name: 'Inas' })
    expect(askAccountManagerOf({ hint: 'change_pending' })).toBeNull()
  })

  it('shows the waiting ask first, else the latest answered — never a withdrawn one', () => {
    const answered = row({ id: 'old', status: 'kept', answeredAt: '2026-10-02T10:00:00Z' })
    const newer = row({ id: 'new', status: 'accepted', answeredAt: '2026-10-03T10:00:00Z' })
    const withdrawn = row({ id: 'w', status: 'withdrawn', answeredAt: '2026-10-03T11:00:00Z' })
    expect(askToShow([answered, newer, withdrawn])?.id).toBe('new')
    expect(askToShow([answered, row({ id: 'p' })])?.id).toBe('p')
    expect(askToShow([withdrawn])).toBeNull()
  })

  it('counts "sent 20 min ago" in minutes, hours, then days', () => {
    const now = Date.parse('2026-10-03T08:20:00Z')
    expect(agoParts('2026-10-03T08:19:40Z', now)).toEqual({ unit: 'now', count: 0 })
    expect(agoParts('2026-10-03T08:00:00Z', now)).toEqual({ unit: 'min', count: 20 })
    expect(agoParts('2026-10-03T05:00:00Z', now)).toEqual({ unit: 'hour', count: 3 })
    expect(agoParts('2026-10-01T08:00:00Z', now)).toEqual({ unit: 'day', count: 2 })
  })

  it('sums the live tasks’ hours for "About 12", reading numerics as numbers', () => {
    expect(aboutHours([
      { status: 'todo', hours: 4 },
      { status: 'done', hours: 6 },
      { status: 'cancelled', hours: 10 },
      { status: 'in_progress', hours: num('2.5') },
    ])).toBe(12.5)
    expect(aboutHours([{ status: 'todo', hours: null }])).toBeNull()
    expect(num('')).toBeNull()
    expect(num('x')).toBeNull()
  })

  it('names who an applied answer told: the people on live tasks, not the asker or the answerer, once each', () => {
    const tasks = [
      { status: 'todo', assigneeId: 'zubaida', assigneeName: 'Zubaida' },
      { status: 'in_progress', assigneeId: 'zubaida', assigneeName: 'Zubaida' },
      { status: 'todo', assigneeId: 'fadia', assigneeName: 'Fadia' },
      { status: 'done', assigneeId: 'ahmed', assigneeName: 'Ahmed' },
      { status: 'todo', assigneeId: 'bad', assigneeName: 'Basheer' },
      { status: 'todo', assigneeId: null, assigneeName: null },
    ]
    expect(toldNames(tasks, 'fadia', 'inas')).toEqual(['Zubaida', 'Basheer'])
  })

  it('pairs a value with the one it replaced, and says nothing when nothing changed', () => {
    expect(wasNow(16, 12)).toEqual({ now: 16, was: 12 })
    expect(wasNow(12, 12)).toBeNull()
    expect(wasNow(null, 12)).toBeNull()
  })
})
