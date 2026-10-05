import { describe, expect, it } from 'vitest'
import { classifyWriteFailure, isPermissionDenied, namedRefusal, refusalSentence } from './classify'
import { describeCause } from './report'

/**
 * I48.39 / I48.42 — what a failure SAYS to the user, and what it CARRIES to the administrator.
 * The production case of 15 Sep: a bare RLS refusal shown verbatim with no report button, and a
 * report email that carried the friendly sentence and nothing else.
 */
describe('classifyWriteFailure', () => {
  const rls = { code: '42501', message: 'new row violates row-level security policy for table "sub_tasks"' }

  it('words a permission or scope refusal, and does not offer to report it', () => {
    const f = classifyWriteFailure(rls, 'fallback', 'outside your reach')
    expect(f).toEqual({ text: 'outside your reach', reportable: false })
  })

  it('shows an RPC validation sentence as written, not reportable', () => {
    const f = classifyWriteFailure({ code: '22023', message: 'a task title is required' }, 'fallback', 'reach')
    expect(f).toEqual({ text: 'a task title is required', reportable: false })
    expect(classifyWriteFailure({ code: 'P0002', message: 'sub_task x not found' }, 'fb', 'r').text).toBe('sub_task x not found')
    // 55000 is the server saying what is missing first — an instruction, not a failure.
    expect(classifyWriteFailure({ code: '55000', message: 'a change description is required to request changes' }, 'fb', 'r'))
      .toEqual({ text: 'a change description is required to request changes', reportable: false })
  })

  it('falls back for anything else, reportable, keeping the cause', () => {
    const err = { code: '23514', message: 'check constraint violated', details: 'Failing row…' }
    const f = classifyWriteFailure(err, 'That did not work', 'reach')
    expect(f.text).toBe('That did not work')
    expect(f.reportable).toBe(true)
    expect(f.cause).toBe(err)
  })

  it('never shows a raw message for an unknown code', () => {
    expect(classifyWriteFailure(new Error('TypeError: fetch failed'), 'fallback', 'reach').text).toBe('fallback')
    expect(classifyWriteFailure(null, 'fallback', 'reach').text).toBe('fallback')
  })

  it('agrees with isPermissionDenied on 42501', () => {
    expect(isPermissionDenied(rls)).toBe(true)
  })
})

describe('describeCause', () => {
  it('renders a PostgREST error with code, message, detail and hint', () => {
    const c = describeCause({ code: '42501', message: 'you cannot approve this campaign', details: 'Account Mgr', hint: 'account_manager' })
    expect(c.code).toBe('42501')
    expect(c.cause).toBe('you cannot approve this campaign · detail: Account Mgr · hint: account_manager')
  })

  it('renders an Edge Function failure with its status and name', () => {
    const c = describeCause({ name: 'FunctionsHttpError', status: 500, message: 'Edge Function returned a non-2xx status code' })
    expect(c.code).toBeUndefined()
    expect(c.cause).toBe('FunctionsHttpError · HTTP 500 · Edge Function returned a non-2xx status code')
  })

  it('renders a plain Error by its message only', () => {
    expect(describeCause(new Error('fetch failed')).cause).toBe('fetch failed')
  })

  it('is empty for nothing, and JSON for a shape it does not know', () => {
    expect(describeCause(null)).toEqual({ cause: '' })
    expect(describeCause({ weird: 1 }).cause).toBe('{"weird":1}')
    expect(describeCause('just a string').cause).toBe('just a string')
  })

  it('caps the rendering so a giant payload cannot break the report', () => {
    expect(describeCause({ message: 'x'.repeat(5000) }).cause.length).toBe(2000)
  })
})

describe('refusalSentence — a worded 42501 is shown as written (22 Sep)', () => {
  it("returns an RPC's own sentence", () => {
    expect(refusalSentence({ code: '42501', message: 'this department has not approved its brief yet, so its work cannot be assigned' }))
      .toBe('this department has not approved its brief yet, so its work cannot be assigned')
    expect(classifyWriteFailure({ code: '42501', message: 'you cannot assign this task: Lujain is outside the part of the organisation you can schedule' }, 'fallback', 'outside your reach').text)
      .toMatch(/^you cannot assign this task/)
  })
  it('keeps the generic sentence for a bare RLS refusal or an empty message', () => {
    expect(refusalSentence({ code: '42501', message: 'new row violates row-level security policy for table "bookings"' })).toBeNull()
    expect(refusalSentence({ code: '42501', message: 'permission denied for table sub_tasks' })).toBeNull()
    expect(refusalSentence({ code: '42501' })).toBeNull()
    expect(classifyWriteFailure({ code: '42501', message: 'permission denied for table sub_tasks' }, 'fallback', 'outside your reach').text).toBe('outside your reach')
  })
  it('is only for 42501', () => {
    expect(refusalSentence({ code: '22023', message: 'a title is required' })).toBeNull()
  })
})

// ---------------------------------------------------------------------------------
// I54.20 — a refusal names WHO CAN, in the reader's own language.
// Edward, 23 Sep: "Error messages must be explicit, they should state who to contact."

describe('namedRefusal', () => {
  const t = (key: string, opts?: Record<string, unknown>) =>
    key === 'refusals.ask' ? `Ask ${opts!.names}.` :
    key === 'refusals.askNobody' ? 'Ask your department lead or Traffic.' :
    key === 'refusals.remove_task' ? 'You cannot remove this task: it is outside your reach.' :
    key

  it('names the person the database put in the refusal', () => {
    const out = namedRefusal(
      { code: '42501', message: 'You cannot remove this task…', details: 'Dev Dept Lead', hint: 'remove_task' },
      t,
    )
    expect(out).toBe('You cannot remove this task: it is outside your reach. Ask Dev Dept Lead.')
  })

  it('still says where to go when nobody can be named', () => {
    // An unowned deliverable, or a department with no approver yet. The whole point of this work
    // is that a refusal never leaves the person with nowhere to go.
    const out = namedRefusal({ code: '42501', details: '', hint: 'remove_task' }, t)
    expect(out).toBe('You cannot remove this task: it is outside your reach. Ask your department lead or Traffic.')
  })

  it('lists several names as the database joined them', () => {
    const out = namedRefusal({ code: '42501', details: 'Dev Dept Lead, Dev Team Lead', hint: 'remove_task' }, t)
    expect(out).toContain('Ask Dev Dept Lead, Dev Team Lead.')
  })

  it('ignores a refusal that carries no hint, so the database sentence still shows', () => {
    expect(namedRefusal({ code: '42501', message: 'something else' }, t)).toBeNull()
  })

  it('ignores a hint it does not know, rather than rendering a raw key', () => {
    // The guard that stops a future function inventing a hint and a key appearing on screen.
    expect(namedRefusal({ code: '42501', details: 'X', hint: 'not_a_real_action' }, t)).toBeNull()
  })

  it('ignores anything that is not a refusal', () => {
    expect(namedRefusal({ code: '23514', details: 'X', hint: 'remove_task' }, t)).toBeNull()
  })
})

describe('classifyWriteFailure with a translator (I54.20)', () => {
  const t = (key: string, opts?: Record<string, unknown>) =>
    key === 'refusals.ask' ? `Ask ${opts!.names}.` :
    key === 'refusals.cancel_task' ? 'You cannot cancel this task: it is outside your reach.' : key

  it('prefers the translated, named refusal over the database sentence', () => {
    const c = classifyWriteFailure(
      { code: '42501', message: 'You cannot cancel this task: it is outside your reach. Ask Dev Dept Lead.', details: 'Dev Dept Lead', hint: 'cancel_task' },
      'fallback', 'outside your reach', t,
    )
    expect(c.text).toBe('You cannot cancel this task: it is outside your reach. Ask Dev Dept Lead.')
    expect(c.reportable).toBe(false)
  })

  it('falls back to the database sentence when no translator is passed', () => {
    // A caller not yet wired still shows something true, in English.
    const c = classifyWriteFailure(
      { code: '42501', message: 'You cannot cancel this task: it is outside your reach. Ask Dev Dept Lead.', details: 'Dev Dept Lead', hint: 'cancel_task' },
      'fallback', 'outside your reach',
    )
    expect(c.text).toContain('Ask Dev Dept Lead.')
  })
})
