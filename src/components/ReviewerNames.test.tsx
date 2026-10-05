import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../lib/i18n'
import { ReviewerNames } from './ReviewerNames'
import type { TaskReviewer } from '../lib/reviewers/task-reviewers'

/**
 * I42.3. Edward, 9 Sep: *"we allowed users to update reviewers and mandatory reviewers via the
 * /deliverable task link… when I select the corresponding task on the /schedule page it is not
 * showing the reviewer as mandatory."*
 *
 * The flag was saving correctly all along — 216 appointments live, 25 marked mandatory. The
 * schedule modal's Reviewers line simply printed `map(r => r.name).join(', ')` and dropped it, and
 * the only place carrying the mark was `WaitingOn`, which by design names ONLY reviewers who have
 * not acted. So the mark was missing before anybody approved and missing again afterwards.
 *
 * These assertions are that gap closed: everybody appointed, marked, whether or not they have acted.
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

describe('ReviewerNames (I42.3)', () => {
  it('marks a required reviewer', () => {
    render(<ReviewerNames reviewers={[r({ userId: 'Ismail', isMandatory: true })]} />)
    expect(screen.getByTestId('reviewer-names-required-Ismail')).toHaveTextContent('(required)')
  })

  it('does not mark an optional one', () => {
    render(<ReviewerNames reviewers={[r({ userId: 'Ismail' })]} />)
    expect(screen.queryByTestId('reviewer-names-required-Ismail')).not.toBeInTheDocument()
  })

  /** The half `WaitingOn` structurally cannot show: it filters to `approvedAt == null`. */
  it('still marks a required reviewer who has ALREADY approved', () => {
    render(
      <ReviewerNames
        reviewers={[r({ userId: 'Ismail', isMandatory: true, approvedAt: '2026-09-07T15:14:40Z' })]}
      />,
    )
    expect(screen.getByTestId('reviewer-names-required-Ismail')).toBeInTheDocument()
  })

  it('names everyone appointed, required first (sortReviewers)', () => {
    const { container } = render(
      <ReviewerNames
        reviewers={[r({ userId: 'Zara' }), r({ userId: 'Maya', isMandatory: true })]}
      />,
    )
    expect(container.textContent).toBe('Maya (required), Zara (no answer yet)')
  })

  /** ADR-0061 d.11 — an appointment kept by somebody who can no longer sign in. */
  it('flags a reviewer whose account is deactivated', () => {
    render(<ReviewerNames reviewers={[r({ userId: 'Gone', isActive: false })]} />)
    expect(screen.getByTestId('reviewer-names-inactive-Gone')).toBeInTheDocument()
  })

  /** Blank means "not loaded" on a task modal; a dash means "nobody". They must not look the same. */
  it('renders a dash for an unassigned task rather than nothing', () => {
    const { container } = render(<ReviewerNames reviewers={[]} />)
    expect(container.textContent).toBe('—')
  })
})

/** ADR-0089 d.12 — "not answered" and "not approved" are two different things, and this line says which. */
describe("an optional reviewer's standing (ADR-0089 d.12)", () => {
  const required = r({ userId: 'Ismail', isMandatory: true })

  it('reads (no answer yet) until they answer', () => {
    render(<ReviewerNames reviewers={[required, r({ userId: 'Zara' })]} />)
    expect(screen.getByTestId('reviewer-names-unanswered-Zara')).toHaveTextContent('(no answer yet)')
  })

  it('says what kind of answer it was', () => {
    render(
      <ReviewerNames
        reviewers={[
          required,
          r({ userId: 'Zara', respondedAt: '2026-09-11T09:00:00Z', response: 'feedback' }),
          r({ userId: 'Omar', respondedAt: '2026-09-11T09:00:00Z', response: 'no_comment' }),
        ]}
      />,
    )
    expect(screen.getByTestId('reviewer-names-answered-Zara')).toHaveTextContent('(feedback left)')
    expect(screen.getByTestId('reviewer-names-answered-Omar')).toHaveTextContent('(no comment)')
  })

  it('marks a required reviewer as approved once they have, and never as answered', () => {
    render(<ReviewerNames reviewers={[r({ userId: 'Ismail', isMandatory: true, approvedAt: '2026-09-11T09:00:00Z' })]} />)
    expect(screen.getByTestId('reviewer-names-approved-Ismail')).toHaveTextContent('approved')
    expect(screen.queryByTestId('reviewer-names-unanswered-Ismail')).toBeNull()
  })

  it('treats a lone unmarked reviewer as the required one (d.2), not as unanswered', () => {
    render(<ReviewerNames reviewers={[r({ userId: 'Ismail' })]} />)
    expect(screen.queryByTestId('reviewer-names-unanswered-Ismail')).toBeNull()
  })
})
