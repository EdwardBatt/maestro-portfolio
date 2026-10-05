import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../../../../lib/i18n'
import type { ExtensionStepRow } from '../../lib/needs-you-requests'

/** The request's dates, as both steps read them (25 Sep): a missing date is "No date yet", never "—". */

vi.mock('../../api/requests-api', () => ({
  useForwardExtension: () => ({ mutate: vi.fn(), isPending: false }),
  useOwnerDeclineExtension: () => ({ mutate: vi.fn(), isPending: false }),
  useDecideExtensionStep: () => ({ mutate: vi.fn(), isPending: false }),
}))

import { ExtensionAmDialog, ExtensionOwnerDialog } from './ExtensionDialogs'

const row = (over: Partial<ExtensionStepRow>): ExtensionStepRow => ({
  requestId: 'r1', stage: 'owner', subTaskId: 't1', deliverableId: 'd1', taskTitle: 'Carousel layout',
  deliverableName: 'Social Advertisement', campaignId: null, campaignName: null, requestedBy: 'u1',
  requestedByName: 'Dev Deputy Lead', assigneeId: 'u1', fromAt: null, toAt: '2026-10-25T14:00:00Z',
  reason: 'Late photography', attributedTo: 'assignee', ownerNote: null, requestedAt: '2026-09-25T10:00:00Z', forwardedAt: null,
  ...over,
})

describe('extension steps — the dates, in words', () => {
  // I66.8: a date shows its year only when it is not this year, so pin "today" (the date only).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-29T09:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('the owner reads "No date yet → <the date asked>" when there was no commitment', () => {
    render(<ExtensionOwnerDialog request={row({})} onClose={() => {}} />)
    const dates = screen.getByTestId('ext-owner-dates')
    expect(dates).toHaveTextContent(/^No date yet → Sun, 25 Oct \(Iraq time\)$/)
    expect(dates).not.toHaveTextContent('—')
  })

  it('the account manager reads the same', () => {
    render(<ExtensionAmDialog request={row({ stage: 'am', forwardedAt: '2026-09-25T11:00:00Z' })} onClose={() => {}} />)
    expect(screen.getByTestId('ext-am-dates')).toHaveTextContent(/^No date yet → /)
  })

  it('a dated commitment reads date → date and the extra days', () => {
    render(<ExtensionOwnerDialog request={row({ fromAt: '2026-10-20T14:00:00Z' })} onClose={() => {}} />)
    expect(screen.getByTestId('ext-owner-dates')).toHaveTextContent('Tue, 20 Oct (Iraq time) → Sun, 25 Oct (Iraq time) · 5 more days')
  })
})
