import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import type { ChangeAskRow } from '../lib/change-ask'
import type { PieceAskContext } from '../api/change-asks-api'

/**
 * The owner's read of a change ask (ADR-0141 d.1–d.4). Test script, 4 Oct:
 *  - step 24: the answer to an accepted due-date ask says the new due day ("… accepted · due now Thu, 5 Nov");
 *  - the read-only line always shows the deliverable's own due date, never an old ask's day.
 */
const m = vi.hoisted(() => ({ ctx: null as PieceAskContext | null, asks: [] as ChangeAskRow[] }))
vi.mock('../api/change-asks-api', () => ({
  usePieceAskContext: () => ({ data: m.ctx }),
  usePieceChangeAsks: () => ({ data: m.asks }),
  useWithdrawDeliverableChange: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../../admin/api/deliverable-types-api', () => ({ useLanguageWords: () => ({ words: () => 'Arabic, English' }) }))
vi.mock('./ChangeAskAnswerDialog', () => ({ ChangeAskAnswerDialog: () => null }))
vi.mock('./ChangeAskDialog', () => ({ ChangeAskDialog: () => null }))

import { PieceChangeAsk } from './PieceChangeAsk'

const ctx = (dueAt: string): PieceAskContext => ({
  id: 'd1', name: 'Summer key visual', code: 'LV-001', dueAt, channel: null, languages: ['ar', 'en'], quantity: 1,
  typeName: 'Billboard', campaignId: 'c1', campaignName: 'Northwind', accountManagerId: 'am', accountManagerName: 'Dev Account Mgr',
  hours: 6, tasks: [],
})
const ask = (over: Partial<ChangeAskRow>): ChangeAskRow => ({
  id: 'a1', deliverableId: 'd1', askedBy: 'me', askedByName: 'Dev Team Lead', kinds: ['due_date'], requestedDueDay: '2026-11-05',
  requestedHours: null, reason: 'more time', fromSubTaskId: null, status: 'accepted', answeredBy: 'am', answeredByName: 'Dev Account Mgr',
  answeredAt: '2026-10-04T06:15:00Z', answerNote: null, appliedDueDay: '2026-11-05', appliedHours: null, escalatedAt: null,
  createdAt: '2026-10-04T06:00:00Z', ...over,
})

beforeEach(() => {
  window.localStorage.clear()
})

describe('PieceChangeAsk — the owner reads the answer', () => {
  it('an accepted due-date ask states the new due day', () => {
    m.ctx = ctx('2026-11-05T15:00:00Z')
    m.asks = [ask({})]
    render(<PieceChangeAsk deliverableId="d1" locked viewerId="me" />)
    expect(screen.getByTestId('piece-ask-answered')).toHaveTextContent(/accepted.*due now Thu, 5 Nov/)
  })

  it('a kept ask states no new day', () => {
    m.ctx = ctx('2026-10-25T15:00:00Z')
    m.asks = [ask({ status: 'kept', appliedDueDay: null })]
    render(<PieceChangeAsk deliverableId="d1" locked viewerId="me" />)
    expect(screen.queryByTestId('piece-ask-answered-due')).toBeNull()
  })

  it('the read-only line shows the deliverable’s own due date, not the old ask’s day', () => {
    m.ctx = ctx('2026-10-25T15:00:00Z')
    m.asks = [ask({ appliedDueDay: '2026-11-05' })]
    render(<PieceChangeAsk deliverableId="d1" locked viewerId="me" />)
    expect(screen.getByTestId('piece-ask-strip')).toHaveTextContent('25 Oct')
    expect(screen.getByTestId('piece-ask-strip')).not.toHaveTextContent('5 Nov')
  })
})
