import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import '../../lib/i18n'
import type {
  BlockRow,
  ChangeRequestRow,
  ClientWaitRow,
  EscalationRow,
  ExtensionStepRow,
  MessageRow,
  OverloadRow,
  ScopeRow,
} from './lib/needs-you-requests'

/**
 * "Needs you" — the database tracks' sources on screen (I59 Track 6, plan View 3 / View 6): each
 * card's kind, sentence, clock and buttons, and each button's dialog or in-place act, with its
 * "Who is told" line. The reads are mocked (their mapping is `needs-you-requests.test.ts`); the
 * writes are spies, so each test proves the RPC the button calls and what it passes.
 */

const H = 3_600_000
const ago = (h: number) => new Date(Date.now() - h * H).toISOString()

const spy = vi.hoisted(() => ({
  nudge: vi.fn(), reply: vi.fn(), forward: vi.fn(), decline: vi.fn(), decide: vi.fn(),
  answer: vi.fn(), resolve: vi.fn(), close: vi.fn(), tooMuch: vi.fn(), clear: vi.fn(), ack: vi.fn(),
}))
const state = vi.hoisted(() => ({
  rules: new Map<string, number>(),
  blocks: [] as BlockRow[],
  extensions: [] as ExtensionStepRow[],
  changes: [] as ChangeRequestRow[],
  messages: [] as MessageRow[],
  overload: [] as OverloadRow[],
  escalations: [] as EscalationRow[],
  client: [] as ClientWaitRow[],
  scope: [] as ScopeRow[],
  failing: null as string | null,
}))

// ADR-0123 d.3: the client's working week — Iraq's here.
vi.mock('../../lib/calendar/client-calendar', () => ({
  useClientCalendar: () => ({ calendar: { workingDays: [7, 1, 2, 3, 4] }, isLoading: false }),
  useWorkCalendar: () => ({ calendar: { workingDays: [7, 1, 2, 3, 4] }, isLoading: false }),
  useWorkClientId: () => ({ clientId: null, isLoading: false }),
}))
vi.mock('../../lib/clients/people', () => ({ useClientPeople: () => ({ data: [] }), suggestedNames: () => [] }))
vi.mock('./api/deliverables-api', () => ({
  useAwaitingMyReview: () => ({ data: [], isLoading: false, isError: false }),
  useMyAssignedWork: () => ({ data: [], isLoading: false }),
  useMarkTaskSeen: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('./api/pending-approvals-api', () => ({
  usePendingApprovals: () => ({ data: [], isLoading: false, isError: false }),
  pendingApprovalLink: () => null,
}))
vi.mock('./api/needs-you-api', () => ({
  useUnassignedPiecesIOwn: () => ({ data: [], isLoading: false, isError: false }),
}))
vi.mock('./api/needs-you-sources-api', () => {
  const q = (name: string, data: unknown) => ({
    data,
    isError: state.failing === name,
    error: state.failing === name ? new Error(`${name} refused`) : null,
  })
  return {
    useNeedsYouSources: () => ({
      rules: q('rules', state.rules),
      sentAt: q('sentAt', new Map()),
      cameBack: q('cameBack', new Map()),
      blocks: q('blocks', state.blocks),
      extensions: q('extensions', state.extensions),
      changes: q('changes', state.changes),
      messages: q('messages', state.messages),
      overload: q('overload', state.overload),
      escalations: q('escalations', state.escalations),
      client: q('client', state.client),
      scope: q('scope', state.scope),
      changeAsks: q('changeAsks', []),
    }),
  }
})
const m = (fn: ReturnType<typeof vi.fn>) => ({ mutate: fn, isPending: false })
vi.mock('./api/requests-api', () => ({
  useNudge: () => m(spy.nudge),
  useEveryone: () => ({ data: [{ id: 'abeer', name: 'Abeer' }, { id: 'hasan', name: 'Hasan' }] }),
  useReplyToQuestion: () => m(spy.reply),
  useSayTooMuch: () => m(vi.fn()),
  useAnswerTooMuch: () => m(spy.tooMuch),
  useForwardExtension: () => m(spy.forward),
  useOwnerDeclineExtension: () => m(spy.decline),
  useDecideExtensionStep: () => m(spy.decide),
  useAnswerChangeRequest: () => m(spy.answer),
  useResolveChangeRequest: () => m(spy.resolve),
  useCloseChangeRequest: () => m(spy.close),
  useClearInput: () => m(spy.clear),
  useRecordScopeAcknowledgement: () => m(spy.ack),
  ACK_VIA: ['whatsapp', 'email', 'phone', 'meeting', 'internal', 'other'],
}))
vi.mock('../team/api/team-api', () => ({ useMyLoad: () => ({ data: null, isLoading: false, isError: false }) }))
vi.mock('./components/ReviewerModal', () => ({ ReviewerModal: () => null }))
vi.mock('../notifications/AssignmentRequestActions', () => ({ AssignmentRequestActions: () => null }))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }))

import { NeedsYouPanel } from './NeedsYouPanel'

const renderPanel = () =>
  render(
    <MemoryRouter initialEntries={['/my-work']}>
      <Routes>
        <Route path="/my-work" element={<NeedsYouPanel />} />
        <Route path="/schedule" element={<p data-testid="schedule-page" />} />
      </Routes>
    </MemoryRouter>,
  )

const block = (o: Partial<BlockRow> = {}): BlockRow => ({
  inputId: 'in1', subTaskId: 'st1', taskTitle: 'Winner cards', deliverableId: 'd1', deliverableName: 'Post 2',
  makerId: 'lujain', makerName: 'Lujain', kind: 'copy', description: 'the Arabic copy', awaitedFrom: 'Abeer',
  requestedAt: ago(2), campaignId: 'cam1', departmentId: 'dep1', ...o,
})
const ext = (o: Partial<ExtensionStepRow> = {}): ExtensionStepRow => ({
  requestId: 'rq1', stage: 'owner', subTaskId: 'st2', deliverableId: 'd2', taskTitle: 'TVC cutdown B',
  deliverableName: 'TVC', campaignId: 'cam1', campaignName: 'LUMA', requestedBy: 'bad', requestedByName: 'Badar',
  assigneeId: 'bad', fromAt: '2026-10-01T15:00:00Z', toAt: '2026-10-05T15:00:00Z', reason: 'The files came late',
  attributedTo: 'client', ownerNote: null, requestedAt: ago(1), forwardedAt: null, ...o,
})
const change = (o: Partial<ChangeRequestRow> = {}): ChangeRequestRow => ({
  id: 'cr1', myPart: 'owner', status: 'pending', deliverableId: 'd3', deliverableName: 'Post 2', campaignId: 'cam1',
  campaignName: 'LUMA', requestedBy: 'inas', requestedByName: 'Inas',
  changes: [{ field: 'type', from: 't1', to: 't2', fromLabel: 'Static post', toLabel: 'Reel' }],
  // The cost as Track 10's Edit stores it (`costFigures`, campaigns/lib/change-request).
  askedBy: 'client', cost: { started_tasks: 2, booked_hours: 11, timed_hours: 5.3, lands_on: '2099-10-01' }, declineReason: null, counterText: null, counterDate: null,
  answeredBy: null, answeredByName: null, createdAt: ago(3), answeredAt: null, ...o,
})

beforeEach(() => {
  for (const f of Object.values(spy)) f.mockReset()
  state.rules = new Map([['blocked', 24], ['extension_owner', 8], ['extension_am', 8], ['change_request', 8]])
  state.blocks = []
  state.extensions = []
  state.changes = []
  state.messages = []
  state.overload = []
  state.escalations = []
  state.client = []
  state.scope = []
  state.failing = null
})

describe('Someone is blocked (ADR-0107)', () => {
  it('says who is stuck on what, with its clock from the rule, Nudge and Reassign', () => {
    state.blocks = [block()]
    renderPanel()
    const card = screen.getByTestId('needs-you-blocked-in1')
    expect(within(card).getByTestId('needs-you-kind-in1')).toHaveTextContent('Someone is blocked')
    expect(card).toHaveTextContent('Lujain is stuck on Winner cards')
    expect(card).toHaveTextContent('waiting on Abeer for the Arabic copy')
    expect(screen.getByTestId('needs-you-clock-in1')).toHaveTextContent('waiting 2 hours · escalates in 21 hours') // 21h 59m left: whole hours, rounded down
    expect(screen.getByTestId('needs-you-reassign-in1')).toHaveAttribute('href', '/schedule?campaign=cam1&dept=dep1')
  })

  it('Nudge: the person pre-filled from "who has it", a pre-written message, and who is told', () => {
    state.blocks = [block()]
    renderPanel()
    fireEvent.click(screen.getByTestId('needs-you-nudge-in1'))
    expect(screen.getByTestId('ny-nudge-dialog')).toBeInTheDocument()
    expect((screen.getByTestId('ny-nudge-body') as HTMLTextAreaElement).value).toContain('the Arabic copy')
    expect(screen.getByTestId('ny-nudge-told')).toHaveTextContent('Abeer')
    fireEvent.click(screen.getByTestId('ny-nudge-send'))
    expect(spy.nudge).toHaveBeenCalledWith(
      expect.objectContaining({ deliverableId: 'd1', subTaskId: 'st1', personId: 'abeer' }),
      expect.anything(),
    )
  })

  it('Nudge cannot be sent until a person is picked when "who has it" is nobody here', () => {
    state.blocks = [block({ awaitedFrom: 'the printer' })]
    renderPanel()
    fireEvent.click(screen.getByTestId('needs-you-nudge-in1'))
    expect(screen.getByTestId('ny-nudge-no-match')).toBeInTheDocument()
    expect(screen.getByTestId('ny-nudge-send')).toBeDisabled()
  })
})

describe('Extension — the owner\'s step and the account manager\'s (ADR-0109)', () => {
  it('owner: Forward needs a note, then forwards it; Decline needs a reason', () => {
    state.extensions = [ext()]
    renderPanel()
    expect(screen.getByTestId('needs-you-extension_owner-rq1')).toHaveTextContent('Badar asks for 4 more days on TVC cutdown B')
    fireEvent.click(screen.getByTestId('needs-you-forward-rq1'))
    expect(screen.getByTestId('ny-ext-owner-told')).toHaveTextContent('the account manager')
    expect(screen.getByTestId('ny-ext-owner-send')).toBeDisabled()
    fireEvent.change(screen.getByTestId('ny-ext-owner-text'), { target: { value: 'fair, the files came late' } })
    fireEvent.click(screen.getByTestId('ny-ext-owner-send'))
    expect(spy.forward).toHaveBeenCalledWith({ requestId: 'rq1', note: 'fair, the files came late' }, expect.anything())
  })

  it('owner: Decline opens on the decline choice, tells the maker, and sends the reason', () => {
    state.extensions = [ext()]
    renderPanel()
    fireEvent.click(screen.getByTestId('needs-you-decline-rq1'))
    expect(screen.getByTestId('ny-ext-owner-mode-decline')).toBeChecked()
    expect(screen.getByTestId('ny-ext-owner-told')).toHaveTextContent('Badar')
    fireEvent.change(screen.getByTestId('ny-ext-owner-text'), { target: { value: 'the files were on time' } })
    fireEvent.click(screen.getByTestId('ny-ext-owner-send'))
    expect(spy.decline).toHaveBeenCalledWith({ requestId: 'rq1', reason: 'the files were on time' }, expect.anything())
  })

  it('account manager: the owner\'s note, and a shorter day bounded between the commitment and the day asked', () => {
    state.extensions = [ext({ stage: 'am', ownerNote: 'fair', forwardedAt: ago(1) })]
    renderPanel()
    expect(screen.getByTestId('needs-you-extension_am-rq1')).toHaveTextContent('forwarded by the owner: “fair”')
    fireEvent.click(screen.getByTestId('needs-you-decide-extension-rq1'))
    expect(screen.getByTestId('ny-ext-am-owner-note')).toHaveTextContent('fair')
    fireEvent.click(screen.getByTestId('ny-ext-am-mode-shorter'))
    const day = screen.getByTestId('ny-ext-am-day') as HTMLInputElement
    expect(day.min).toBe('2026-10-02')
    expect(day.max).toBe('2026-10-04')
    expect(screen.getByTestId('ny-ext-am-send')).toBeDisabled()
    fireEvent.change(day, { target: { value: '2026-10-03' } })
    fireEvent.click(screen.getByTestId('ny-ext-am-send'))
    expect(spy.decide).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'rq1', approve: true, toDay: '2026-10-03' }), expect.anything())
    expect(screen.getByTestId('ny-ext-am-told')).toHaveTextContent('Badar and the owner')
  })

  it('account manager: Refuse sends no day', () => {
    state.extensions = [ext({ stage: 'am' })]
    renderPanel()
    fireEvent.click(screen.getByTestId('needs-you-decide-extension-rq1'))
    fireEvent.click(screen.getByTestId('ny-ext-am-mode-refuse'))
    fireEvent.click(screen.getByTestId('ny-ext-am-send'))
    expect(spy.decide).toHaveBeenCalledWith(expect.objectContaining({ approve: false, toDay: null }), expect.anything())
  })
})

describe('Change requests (ADR-0110)', () => {
  it('owner: Decide shows before → after and the cost; Push back needs words, a date optional', () => {
    state.changes = [change()]
    renderPanel()
    expect(screen.getByTestId('needs-you-change_request-cr1')).toHaveTextContent('Inas wants Post 2 changed: type')
    fireEvent.click(screen.getByTestId('needs-you-decide-change-cr1'))
    expect(screen.getByTestId('ny-change-decide-change-type')).toHaveTextContent('Static post')
    expect(screen.getByTestId('ny-change-decide-change-type')).toHaveTextContent('Reel')
    expect(screen.getByTestId('ny-change-decide-asked-by')).toHaveTextContent('The client asked')
    fireEvent.click(screen.getByTestId('ny-change-decide-mode-push_back'))
    expect(screen.getByTestId('ny-change-decide-send')).toBeDisabled()
    fireEvent.change(screen.getByTestId('ny-change-decide-text'), { target: { value: 'Reel first Tue 29' } })
    fireEvent.change(screen.getByTestId('ny-change-decide-date'), { target: { value: '2026-09-29' } })
    fireEvent.click(screen.getByTestId('ny-change-decide-send'))
    expect(spy.answer).toHaveBeenCalledWith({ requestId: 'cr1', answer: 'push_back', text: 'Reel first Tue 29', date: '2026-09-29' }, expect.anything())
  })

  it('owner: Accept applies it with nothing written', () => {
    state.changes = [change()]
    renderPanel()
    fireEvent.click(screen.getByTestId('needs-you-decide-change-cr1'))
    fireEvent.click(screen.getByTestId('ny-change-decide-send'))
    expect(spy.answer).toHaveBeenCalledWith({ requestId: 'cr1', answer: 'accept', text: null, date: null }, expect.anything())
  })

  it('See what it costs: the figures as Edit sent them, in Edit’s words, read only', () => {
    state.changes = [change()]
    renderPanel()
    fireEvent.click(screen.getByTestId('needs-you-change-cost-cr1'))
    expect(screen.getByTestId('ny-change-cost-cost-work')).toHaveTextContent('2 tasks started — 11 h booked, 5.3 h timed.')
    expect(screen.getByTestId('ny-change-cost-cost-lands')).toHaveTextContent('It lands on')
    expect(screen.getByTestId('ny-change-cost-cost-lands')).toHaveTextContent('2099')
    expect(screen.queryByTestId('ny-change-cost-cost-none')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ny-change-cost-close'))
    expect(screen.queryByTestId('ny-change-cost-dialog')).not.toBeInTheDocument()
  })

  it('pushed back: Accept their version or Withdraw, the owner told', () => {
    state.changes = [change({ myPart: 'requester', status: 'pushed_back', counterText: 'Reel first', counterDate: '2026-09-29', answeredByName: 'Fadia', answeredAt: ago(1) })]
    renderPanel()
    expect(screen.getByTestId('needs-you-change_pushed_back-cr1')).toHaveTextContent('Fadia cannot take your change as written')
    fireEvent.click(screen.getByTestId('needs-you-withdraw-change-cr1'))
    expect(screen.getByTestId('ny-change-counter-mode-withdraw')).toBeChecked()
    expect(screen.getByTestId('ny-change-counter-told')).toHaveTextContent('Fadia')
    fireEvent.click(screen.getByTestId('ny-change-counter-mode-accept'))
    fireEvent.click(screen.getByTestId('ny-change-counter-send'))
    expect(spy.resolve).toHaveBeenCalledWith({ requestId: 'cr1', resolution: 'accept_counter' }, expect.anything())
  })

  it('declined: Send a new request goes to the piece\'s Edit on the campaign page; Close closes it', () => {
    state.changes = [change({ myPart: 'requester', status: 'declined', declineReason: 'Too late', answeredByName: 'Fadia' })]
    renderPanel()
    expect(screen.getByTestId('needs-you-change_declined-cr1')).toHaveTextContent('Fadia declined your change: Too late')
    expect(screen.getByTestId('needs-you-send-new-request-cr1')).toHaveAttribute('href', '/campaigns/cam1?edit=d3')
    fireEvent.click(screen.getByTestId('needs-you-close-change-cr1'))
    expect(spy.close).toHaveBeenCalledWith('cr1', expect.anything())
  })
})

describe('Too much, questions, over capacity, escalations (ADR-0113, ADR-0108)', () => {
  it('too much: the maker\'s week in the sentence; Rebalance answers and opens the Schedule; Keep answers', () => {
    state.messages = [{
      id: 'm1', kind: 'too_much', deliverableId: 'd4', subTaskId: 'st4', label: 'Week 2 explainer', deliverableName: 'Explainer',
      authorId: 'zubaida', authorName: 'Zubaida', body: 'I have three launches', createdAt: ago(1), weekPct: 100, campaignId: 'cam1', departmentId: 'dep1',
    }]
    spy.tooMuch.mockImplementation((_a: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.())
    renderPanel()
    expect(screen.getByTestId('needs-you-too_much-m1')).toHaveTextContent('Zubaida says Week 2 explainer is too much (100% this week)')
    fireEvent.click(screen.getByTestId('needs-you-keep-m1'))
    expect(spy.tooMuch).toHaveBeenCalledWith({ messageId: 'm1', answer: 'keep' }, expect.anything())
    fireEvent.click(screen.getByTestId('needs-you-rebalance-m1'))
    expect(spy.tooMuch).toHaveBeenLastCalledWith({ messageId: 'm1', answer: 'rebalance' }, expect.anything())
    expect(screen.getByTestId('schedule-page')).toBeInTheDocument()
  })

  it('a question: Reply shows the question and tells the asker', () => {
    state.messages = [{
      id: 'q1', kind: 'question', deliverableId: 'd5', subTaskId: null, label: 'Post 2', deliverableName: 'Post 2',
      authorId: 'fadia', authorName: 'Fadia', body: 'Is the English cut needed Thursday too?', createdAt: ago(1),
    }]
    renderPanel()
    fireEvent.click(screen.getByTestId('needs-you-reply-q1'))
    expect(screen.getByTestId('ny-reply-question')).toHaveTextContent('Is the English cut needed Thursday too?')
    expect(screen.getByTestId('ny-reply-told')).toHaveTextContent('Fadia')
    expect(screen.getByTestId('ny-reply-send')).toBeDisabled()
    fireEvent.change(screen.getByTestId('ny-reply-body'), { target: { value: 'Yes' } })
    fireEvent.click(screen.getByTestId('ny-reply-send'))
    expect(spy.reply).toHaveBeenCalledWith({ questionId: 'q1', body: 'Yes' }, expect.anything())
  })

  it('over capacity: Rebalance narrows the Schedule to the person; See the week opens Team', () => {
    state.overload = [{
      resourceId: 'r1', userId: 'zubaida', name: 'Zubaida', teamId: 't1', departmentId: 'dep1', weekStart: '2026-09-20',
      bookedHours: 47.2, nominalHours: 40, utilPct: 118, overCapacityPct: 110,
    }]
    renderPanel()
    expect(screen.getByTestId('needs-you-over_capacity-r1')).toHaveTextContent('Zubaida is booked at 118% this week')
    expect(screen.getByTestId('needs-you-rebalance-week-r1')).toHaveAttribute('href', '/schedule?dept=dep1&who=Zubaida')
    expect(screen.getByTestId('needs-you-see-week-r1')).toHaveAttribute('href', '/team')
  })

  it('escalated to you: sits in "today", says so, and opens the piece', () => {
    state.escalations = [{
      notificationId: 'n1', kind: 'review_escalate', entityType: 'sub_task', entityId: 'st9', label: 'Eid banner set',
      contextLabel: 'LUMA', detail: { threshold: 48, since: ago(50) }, escalatedAt: ago(2),
    }]
    renderPanel()
    const today = screen.getByTestId('needs-you-group-today')
    expect(within(today).getByTestId('needs-you-escalated-n1')).toHaveTextContent('Escalated: Eid banner set has waited 48h in review')
    expect(screen.getByTestId('needs-you-clock-n1')).toHaveTextContent('escalated 2 hours ago')
    expect(screen.getByTestId('needs-you-open-escalated-n1')).toHaveAttribute('href', '/my-work/task/st9')
  })
})

describe('Waiting on the client and reduced scope (Q16, Q33)', () => {
  it('Mark received confirms and clears the input', () => {
    state.client = [{
      inputId: 'in9', deliverableId: 'd6', deliverableName: 'Launch film', campaignId: 'cam1', campaignName: 'LUMA',
      description: 'the offer terms', awaitedFrom: 'Kite', requestedAt: ago(6 * 24),
    }]
    renderPanel()
    expect(screen.getByTestId('needs-you-client_waiting-in9')).toHaveTextContent('Launch film: waiting on the client for the offer terms')
    expect(screen.getByTestId('needs-you-clock-in9')).toHaveTextContent('waiting 6 days')
    fireEvent.click(screen.getByTestId('needs-you-mark-received-in9'))
    fireEvent.click(screen.getByTestId('ny-received-send'))
    expect(spy.clear).toHaveBeenCalledWith('in9', expect.anything())
  })

  it('Record the acknowledgement: who, how, when — the days counted, not asked', () => {
    state.scope = [{ campaignId: 'job1', name: 'Eid banner set', createdAt: '2026-09-20T08:00:00Z', dueAt: '2026-09-24T15:00:00Z', leadTimeHours: 40 }]
    renderPanel()
    fireEvent.click(screen.getByTestId('needs-you-record-ack-job1'))
    expect(screen.getByTestId('ny-scope-ack-days')).toHaveTextContent('needed 5 working days')
    expect(screen.getByTestId('ny-scope-ack-send')).toBeDisabled()
    fireEvent.change(screen.getByTestId('ny-scope-ack-by'), { target: { value: 'Ahmed' } })
    fireEvent.change(screen.getByTestId('ny-scope-ack-via'), { target: { value: 'email' } })
    fireEvent.click(screen.getByTestId('ny-scope-ack-send'))
    expect(spy.ack).toHaveBeenCalledWith(expect.objectContaining({ campaignId: 'job1', by: 'Ahmed', via: 'email', needsDays: 5 }), expect.anything())
    expect(screen.getByTestId('ny-scope-ack-told')).toHaveTextContent('nobody')
  })
})

describe('a failing source is said, not swallowed', () => {
  it('names the source that could not be read', () => {
    state.failing = 'changes'
    renderPanel()
    expect(screen.getByTestId('needs-you-changes-load-error')).toHaveTextContent('changes refused')
  })
})
