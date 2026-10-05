import { describe, expect, it } from 'vitest'
import {
  campaignPieceHref,
  changeLines,
  changeSummary,
  escalationHref,
  extraDays,
  fromBlocks,
  fromChangeRequests,
  fromClientWaiting,
  fromEscalations,
  fromExtensionSteps,
  fromMessages,
  fromOverload,
  fromScopeUnacknowledged,
  isClientInput,
  rebalanceHref,
  shorterBounds,
  withoutDuplicateExtensions,
  type BlockRow,
  type ChangeRequestRow,
  type EscalationRow,
  type ExtensionStepRow,
  type MessageRow,
} from './needs-you-requests'
import { groupOf } from './needs-you'

/**
 * The database tracks' Needs-you sources (I59 Track 6): each mapper's sentence, clock and buttons,
 * and the small rules beside them. `say` echoes the key and its values so the mapping is read,
 * not the English.
 */
const say = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${String(v)}`).join(',')})` : key)
const H = 3_600_000
const T0 = '2026-09-24T08:00:00.000Z'
const plus = (h: number) => new Date(Date.parse(T0) + h * H).toISOString()
const rules = new Map([
  ['blocked', 24], ['extension_owner', 8], ['extension_am', 8], ['change_request', 8],
])

const block: BlockRow = {
  inputId: 'in1', subTaskId: 'st1', taskTitle: 'Winner cards', deliverableId: 'd1', deliverableName: 'Post 2',
  makerId: 'lujain', makerName: 'Lujain', kind: 'copy', description: 'Arabic copy', awaitedFrom: 'Abeer',
  requestedAt: T0, campaignId: 'cam1', departmentId: 'dep1',
}

describe('fromBlocks — someone is blocked (ADR-0107 d.2)', () => {
  it('names the maker and the task, what and from whom, and escalates after the blocked rule', () => {
    const [it0] = fromBlocks([block], rules, say)
    expect(it0).toMatchObject({ kind: 'blocked', id: 'in1', since: T0, clock: { escalatesAt: plus(24) } })
    expect(it0!.title).toBe('requests.ny.blocked(maker=Lujain,task=Winner cards)')
    expect(it0!.context).toBe('requests.ny.waitingOnFor(who=Abeer,what=Arabic copy) · Post 2')
    expect(it0!.primary).toMatchObject({ type: 'dialog', dialog: 'nudge', name: 'nudge' })
    expect(it0!.secondary).toMatchObject({ type: 'link', to: '/schedule?campaign=cam1&dept=dep1', name: 'reassign' })
  })

  it('has no Reassign when the piece has no campaign, and no clock without a rule', () => {
    const [it0] = fromBlocks([{ ...block, campaignId: null }], new Map(), say)
    expect(it0!.secondary).toBeNull()
    expect(it0!.clock.escalatesAt).toBeNull()
  })
})

const ext: ExtensionStepRow = {
  requestId: 'rq1', stage: 'owner', subTaskId: 'st2', deliverableId: 'd2', taskTitle: 'TVC B', deliverableName: 'TVC',
  campaignId: 'cam1', campaignName: 'LUMA', requestedBy: 'b', requestedByName: 'Badar', assigneeId: 'b',
  fromAt: '2026-10-01T15:00:00Z', toAt: '2026-10-03T15:00:00Z', reason: 'files late', attributedTo: 'client',
  ownerNote: null, requestedAt: T0, forwardedAt: null,
}

describe('fromExtensionSteps — the owner judges first (ADR-0109)', () => {
  it("owner's step: Forward and Decline open the same dialog in their mode; the owner rule's clock from the ask", () => {
    const [it0] = fromExtensionSteps([ext], rules, say)
    expect(it0).toMatchObject({ kind: 'extension_owner', clock: { escalatesAt: plus(8) } })
    expect(it0!.title).toBe('requests.ny.extensionAsks(who=Badar,count=2,task=TVC B)')
    expect(it0!.primary).toMatchObject({ dialog: 'extension_owner', mode: 'forward' })
    expect(it0!.secondary).toMatchObject({ dialog: 'extension_owner', mode: 'decline' })
  })

  it("the account manager's step waits from the forward and carries the owner's note", () => {
    const [it0] = fromExtensionSteps([{ ...ext, stage: 'am', forwardedAt: plus(2), ownerNote: 'fair' }], rules, say)
    expect(it0).toMatchObject({ kind: 'extension_am', since: plus(2), clock: { escalatesAt: plus(10) } })
    expect(it0!.context).toContain('requests.ny.forwardedWith(note=fair)')
    expect(it0!.primary).toMatchObject({ dialog: 'extension_am' })
  })

  it('a request that skipped the owner waits from when it was asked', () => {
    const [it0] = fromExtensionSteps([{ ...ext, stage: 'am' }], rules, say)
    expect(it0!.since).toBe(T0)
  })

  it('counts the extra days, at least one, and none without both dates', () => {
    expect(extraDays('2026-10-01T15:00:00Z', '2026-10-05T15:00:00Z')).toBe(4)
    expect(extraDays('2026-10-01T15:00:00Z', '2026-10-01T16:00:00Z')).toBe(1)
    expect(extraDays(null, '2026-10-05T15:00:00Z')).toBeNull()
  })

  it('drops the plain approval row when the richer step carries the same task', () => {
    const approvals = [
      { kind: 'extension_request', ref: { targetId: 'st2' } },
      { kind: 'extension_request', ref: { targetId: 'other' } },
      { kind: 'task_list', ref: { targetId: 'st2' } },
    ]
    expect(withoutDuplicateExtensions(approvals, [{ ...ext, stage: 'am' }])).toHaveLength(2)
    // At the owner's step the account manager has nothing to do yet — nothing is dropped.
    expect(withoutDuplicateExtensions(approvals, [ext])).toHaveLength(3)
  })
})

describe('shorterBounds — approve a shorter one (ADR-0109 d.3)', () => {
  it('offers the days strictly after the commitment and strictly before the day asked', () => {
    expect(shorterBounds('2026-10-01', '2026-10-05')).toEqual({ min: '2026-10-02', max: '2026-10-04' })
  })
  it('offers nothing when only one day more was asked', () => {
    expect(shorterBounds('2026-10-01', '2026-10-02')).toBeNull()
  })
  it('has no lower bound without a commitment, and nothing without a day asked', () => {
    expect(shorterBounds(null, '2026-10-05')).toEqual({ min: null, max: '2026-10-04' })
    expect(shorterBounds('2026-10-01', null)).toBeNull()
  })
})

const cr: ChangeRequestRow = {
  id: 'cr1', myPart: 'owner', status: 'pending', deliverableId: 'd3', deliverableName: 'Post 2', campaignId: 'cam1',
  campaignName: 'LUMA', requestedBy: 'inas', requestedByName: 'Inas',
  changes: [{ field: 'type', from: 't1', to: 't2', fromLabel: 'Static', toLabel: 'Reel' }],
  askedBy: 'client', cost: {}, declineReason: null, counterText: null, counterDate: null, answeredBy: null,
  answeredByName: null, createdAt: T0, answeredAt: null,
}

describe('fromChangeRequests — a change to started work (ADR-0110)', () => {
  it('owner: Decide and See what it costs, escalating after the change-request rule', () => {
    const [it0] = fromChangeRequests([cr], rules, say)
    expect(it0).toMatchObject({ kind: 'change_request', clock: { escalatesAt: plus(8) } })
    expect(it0!.title).toBe('requests.ny.changeWants(who=Inas,piece=Post 2,what=requests.field.type)')
    expect(it0!.primary).toMatchObject({ dialog: 'change_decide' })
    expect(it0!.secondary).toMatchObject({ dialog: 'change_cost' })
  })

  it('pushed back: Accept their version and Withdraw, no escalation clock, waiting since the answer', () => {
    const [it0] = fromChangeRequests([{ ...cr, myPart: 'requester', status: 'pushed_back', counterText: 'Reel first', answeredByName: 'Fadia', answeredAt: plus(3) }], rules, say)
    expect(it0).toMatchObject({ kind: 'change_pushed_back', since: plus(3), clock: {} })
    expect(it0!.primary).toMatchObject({ dialog: 'change_counter', mode: 'accept_counter' })
    expect(it0!.secondary).toMatchObject({ dialog: 'change_counter', mode: 'withdraw' })
  })

  it('declined: Send a new request (the piece\'s Edit) and Close in place', () => {
    const [it0] = fromChangeRequests([{ ...cr, myPart: 'requester', status: 'declined', declineReason: 'late' }], rules, say)
    expect(it0!.primary).toMatchObject({ type: 'link', to: campaignPieceHref('cam1', 'd3') })
    expect(it0!.secondary).toMatchObject({ type: 'act', act: 'change_close' })
    expect(campaignPieceHref('cam1', 'd3')).toBe('/campaigns/cam1?edit=d3')
  })

  it('an owner row that is not pending is not the owner\'s to answer', () => {
    expect(fromChangeRequests([{ ...cr, status: 'accepted' }], rules, say)).toEqual([])
  })

  it('reads the stored changes in a fixed order with names, and says the fields', () => {
    const lines = changeLines(
      { due: { from: '2026-09-24T15:00:00Z', to: '2026-09-30' }, type: { from: 't1', to: 't2' }, colour: { to: 'red' }, quantity: { from: '2', to: '3' } },
      { types: new Map([['t1', 'Static'], ['t2', 'Reel']]) },
    )
    expect(lines.map((l) => l.field)).toEqual(['type', 'quantity', 'due'])
    expect(lines[0]).toMatchObject({ fromLabel: 'Static', toLabel: 'Reel' })
    expect(changeSummary(lines, say)).toBe('requests.field.type, requests.field.quantity, requests.field.due')
    expect(changeLines(null)).toEqual([])
  })
})

describe('fromMessages — questions and too much (ADR-0113)', () => {
  const q: MessageRow = {
    id: 'm1', kind: 'question', deliverableId: 'd4', subTaskId: null, label: 'Post 2', deliverableName: 'Post 2',
    authorId: 'f', authorName: 'Fadia', body: 'English too?', createdAt: T0,
  }
  it('a question has Reply and no escalation clock', () => {
    const [it0] = fromMessages([q], say)
    expect(it0).toMatchObject({ kind: 'question', since: T0, clock: {}, primary: { dialog: 'reply' } })
    expect(it0!.context).toBe('')
  })
  it("too much: the maker's week in the sentence; Rebalance answers then opens the Schedule narrowed; Keep", () => {
    const [it0] = fromMessages([{ ...q, kind: 'too_much', label: 'Explainer', weekPct: 100, campaignId: 'cam1', departmentId: 'dep1', body: 'three launches' }], say)
    expect(it0!.title).toBe('requests.ny.tooMuchPct(who=Fadia,label=Explainer,pct=100)')
    expect(it0!.primary).toMatchObject({ type: 'act', act: 'too_much_rebalance', to: '/schedule?campaign=cam1&dept=dep1' })
    expect(it0!.secondary).toMatchObject({ type: 'act', act: 'too_much_keep' })
    const [bare] = fromMessages([{ ...q, kind: 'too_much', weekPct: null }], say)
    expect(bare!.title).toBe('requests.ny.tooMuch(who=Fadia,label=Post 2)')
    expect(bare!.primary).toMatchObject({ to: '/schedule' })
  })
})

describe('fromOverload — over capacity (ADR-0108 d.6)', () => {
  it('Rebalance narrows the Schedule to the department and the person; See the week opens Team', () => {
    const [it0] = fromOverload([{ resourceId: 'r1', userId: 'z', name: 'Zubaida Jamil', teamId: 't', departmentId: 'dep1', weekStart: '2026-09-20', bookedHours: 47, nominalHours: 40, utilPct: 118, overCapacityPct: 110 }], say)
    expect(it0!.primary).toMatchObject({ to: '/schedule?dept=dep1&who=Zubaida+Jamil' })
    expect(it0!.secondary).toMatchObject({ to: '/team' })
    expect(rebalanceHref({ departmentId: null, name: 'A' })).toBe('/schedule?who=A')
  })
})

describe('fromEscalations — escalated to you (ADR-0108 d.3)', () => {
  const esc: EscalationRow = {
    notificationId: 'n1', kind: 'unassigned', entityType: 'deliverable', entityId: 'd5', label: 'Post 2', contextLabel: 'LUMA',
    detail: { threshold: 24, owner: 'Fadia', since: T0 }, escalatedAt: plus(24), campaignId: 'cam1', departmentId: 'dep1',
  }
  it('is already escalated, so it sits in today; Open goes to the Schedule for unassigned work', () => {
    const [it0] = fromEscalations([esc], say)
    expect(it0!.clock.escalatesAt).toBe(plus(24))
    expect(groupOf(it0!.clock, Date.parse(plus(30)))).toBe('today')
    expect(it0!.title).toBe('requests.ny.escalated.unassigned(label=Post 2,hours=24)')
    expect(it0!.context).toContain('requests.ny.owner(name=Fadia)')
    expect(it0!.primary).toMatchObject({ to: '/schedule?campaign=cam1&dept=dep1' })
  })
  it('opens the piece for everything else — a task, a deliverable, a campaign', () => {
    expect(escalationHref({ ...esc, kind: 'review_escalate', entityType: 'sub_task', entityId: 'st9' })).toBe('/my-work/task/st9')
    expect(escalationHref({ ...esc, kind: 'task_list', campaignId: null })).toBe('/campaigns/piece/d5')
    expect(escalationHref({ ...esc, kind: 'task_list', entityType: 'campaign', entityId: 'c1' })).toBe('/campaigns/c1')
  })
  it('names a campaign brief waiting for approval apart from a task list', () => {
    const [it0] = fromEscalations([{ ...esc, kind: 'task_list', detail: { waiting_on: 'campaign_brief', threshold: 24 } }], say)
    expect(it0!.title).toContain('requests.ny.escalated.campaign_brief')
  })
  it('says a piece whose every task was cancelled was left that way, before anything else (I66.11)', () => {
    const [it0] = fromEscalations([{ ...esc, kind: 'task_list', detail: { waiting_on: 'task_list', all_cancelled: true, no_tasks: true, threshold: 24 } }], say)
    expect(it0!.title).toBe('requests.ny.escalated.tasks_all_cancelled(label=Post 2,hours=24)')
  })
  it('says a piece with no tasks has had none defined, not that its list waited for approval (I66.4)', () => {
    const [none] = fromEscalations([{ ...esc, kind: 'task_list', detail: { waiting_on: 'task_list', no_tasks: true, threshold: 24 } }], say)
    expect(none!.title).toBe('requests.ny.escalated.task_list_undefined(label=Post 2,hours=24)')
    const [list] = fromEscalations([{ ...esc, kind: 'task_list', detail: { waiting_on: 'task_list', no_tasks: false, threshold: 24 } }], say)
    expect(list!.title).toBe('requests.ny.escalated.task_list(label=Post 2,hours=24)')
  })
})

describe('waiting on the client, reduced scope (Q16, Q33)', () => {
  it("counts an input as the client's when it says so, or when it is a deliverable-wide input from before kinds", () => {
    expect(isClientInput({ kind: 'client', subTaskId: 'st1' })).toBe(true)
    expect(isClientInput({ kind: null, subTaskId: null })).toBe(true)
    expect(isClientInput({ kind: 'copy', subTaskId: null })).toBe(false)
    expect(isClientInput({ kind: null, subTaskId: 'st1' })).toBe(false)
  })
  it('Mark received opens its dialog; waiting since the input was raised', () => {
    const [it0] = fromClientWaiting([{ inputId: 'i1', deliverableId: 'd', deliverableName: 'Film', campaignId: 'c', campaignName: 'LUMA', description: 'terms', awaitedFrom: 'Kite', requestedAt: T0 }], say)
    expect(it0).toMatchObject({ kind: 'client_waiting', since: T0, primary: { dialog: 'mark_received' } })
  })
  it('Record the acknowledgement opens its dialog', () => {
    const [it0] = fromScopeUnacknowledged([{ campaignId: 'j', name: 'Eid', createdAt: T0, dueAt: null, leadTimeHours: null }], say)
    expect(it0).toMatchObject({ kind: 'scope_unacknowledged', primary: { dialog: 'scope_ack' } })
  })
})
