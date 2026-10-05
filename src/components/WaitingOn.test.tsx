import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../lib/i18n'
import { WaitingOn } from './WaitingOn'
import type { TaskReviewer } from '../lib/reviewers/task-reviewers'

/**
 * ADR-0043 d.8. With one reviewer, "waiting on review" had exactly one name against it. With three
 * it has none unless something puts it there, and a task can sit for a week while each person
 * assumes another is looking. These assertions are that closing act: only the people who have NOT
 * acted, with the required ones marked.
 *
 * Imports nothing that reaches `lib/supabase` — the component is deliberately dumb, so this suite
 * needs no mocks (traps.md: `lib/env` throws in CI).
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

describe('WaitingOn (ADR-0043 d.8)', () => {
  it('names only the reviewers who have not acted', () => {
    render(
      <WaitingOn
        reviewers={[
          r({ userId: 'amir', name: 'Amir', approvedAt: '2026-08-27T09:00:00Z' }),
          r({ userId: 'yara', name: 'Yara' }),
        ]}
      />,
    )
    expect(screen.getByTestId('waiting-on')).toHaveTextContent('Yara')
    // Amir has already agreed; showing him would say the task is waiting on somebody it is not.
    expect(screen.queryByTestId('waiting-on-amir')).not.toBeInTheDocument()
  })

  it('marks the mandatory ones, because they are the people who can actually unblock it', () => {
    render(
      <WaitingOn
        reviewers={[r({ userId: 'yara', name: 'Yara', isMandatory: true }), r({ userId: 'zoe', name: 'Zoe' })]}
      />,
    )
    expect(screen.getByTestId('waiting-on-required-yara')).toBeInTheDocument()
    expect(screen.queryByTestId('waiting-on-required-zoe')).not.toBeInTheDocument()
    // Mandatory first: the order is the answer to "who do I chase?".
    expect(screen.getByTestId('waiting-on').textContent).toMatch(/Yara.*Zoe/)
  })

  it('renders nothing when nobody is outstanding', () => {
    render(<WaitingOn reviewers={[r({ userId: 'amir', approvedAt: '2026-08-27T09:00:00Z' })]} />)
    expect(screen.queryByTestId('waiting-on')).not.toBeInTheDocument()
  })

  it('renders nothing for a task with no reviewers at all', () => {
    render(<WaitingOn reviewers={[]} />)
    expect(screen.queryByTestId('waiting-on')).not.toBeInTheDocument()
  })
})

/**
 * ADR-0061 d.11 — a reviewer who has since been deactivated.
 *
 * They cannot be APPOINTED any more (the picker hides them, the write guard refuses them), but
 * somebody deactivated AFTER they were appointed keeps the appointment: deleting it would silently
 * drop a reviewer from work in progress. So the appointment stands and the screen says so.
 *
 * The mandatory case is the one that matters. `maybe_complete_sub_task` waits for EVERY mandatory
 * reviewer, so a deactivated one means the task can never complete — an approval owed by an account
 * that cannot sign in. Without this marker that reads as a colleague who is simply slow.
 */
describe('a deactivated reviewer (ADR-0061 d.11)', () => {
  it('is marked, so a name that will never approve does not read as one that might', () => {
    render(<WaitingOn reviewers={[r({ userId: 'gone', isActive: false })]} />)
    expect(screen.getByTestId('waiting-on-inactive-gone')).toBeInTheDocument()
  })

  it('is not marked when the account is live', () => {
    render(<WaitingOn reviewers={[r({ userId: 'here' })]} />)
    expect(screen.queryByTestId('waiting-on-inactive-here')).toBeNull()
  })

  // Both marks together: required AND gone is the dead end, and the row has to show both halves or
  // it reads as an ordinary outstanding approval.
  it('shows required and deactivated together', () => {
    render(<WaitingOn reviewers={[r({ userId: 'gone', isMandatory: true, isActive: false })]} />)
    expect(screen.getByTestId('waiting-on-required-gone')).toBeInTheDocument()
    expect(screen.getByTestId('waiting-on-inactive-gone')).toBeInTheDocument()
  })

  // Somebody who already approved is not outstanding, so they are not listed at all — their verdict
  // stands and deactivating them afterwards takes nothing away.
  it('says nothing about a deactivated reviewer who already approved', () => {
    render(<WaitingOn reviewers={[r({ userId: 'gone', isActive: false, approvedAt: '2026-08-30T10:00:00Z' })]} />)
    expect(screen.queryByTestId('waiting-on-inactive-gone')).toBeNull()
  })
})

/**
 * ADR-0089 d.12 — two kinds of wait. A required reviewer is outstanding until they approve; an
 * optional one until they ANSWER. The marks differ because the required reviewer, reading this
 * line, is deciding whether to wait — and "no answer yet" is who they are waiting for.
 */
describe('which kind of wait (ADR-0089 d.12)', () => {
  const required = r({ userId: 'ismail', name: 'Ismail', isMandatory: true })

  it('marks an optional reviewer who has not answered as (no answer yet), not (required)', () => {
    render(<WaitingOn reviewers={[required, r({ userId: 'zara', name: 'Zara' })]} />)
    expect(screen.getByTestId('waiting-on-unanswered-zara')).toHaveTextContent('(no answer yet)')
    expect(screen.queryByTestId('waiting-on-required-zara')).toBeNull()
    expect(screen.getByTestId('waiting-on-required-ismail')).toBeInTheDocument()
    expect(screen.queryByTestId('waiting-on-unanswered-ismail')).toBeNull()
  })

  it('says nothing about an optional reviewer who has answered', () => {
    render(
      <WaitingOn
        reviewers={[required, r({ userId: 'zara', name: 'Zara', respondedAt: '2026-09-11T09:00:00Z', response: 'feedback' })]}
      />,
    )
    expect(screen.queryByTestId('waiting-on-zara')).toBeNull()
    expect(screen.getByTestId('waiting-on-ismail')).toBeInTheDocument()
  })

  it('says nothing about a required reviewer who has approved', () => {
    render(
      <WaitingOn
        reviewers={[r({ userId: 'ismail', name: 'Ismail', isMandatory: true, approvedAt: '2026-09-11T09:00:00Z' }), r({ userId: 'zara' })]}
      />,
    )
    expect(screen.queryByTestId('waiting-on-ismail')).toBeNull()
  })

  it('on a tracking surface (blockingOnly) still names only the required reviewers — an optional one does not block the work', () => {
    render(<WaitingOn reviewers={[required, r({ userId: 'zara', name: 'Zara' })]} blockingOnly />)
    expect(screen.getByTestId('waiting-on-ismail')).toBeInTheDocument()
    expect(screen.queryByTestId('waiting-on-zara')).toBeNull()
  })
})
