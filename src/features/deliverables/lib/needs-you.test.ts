import { describe, expect, it } from 'vitest'
import {
  assignHref,
  byUrgency,
  fromChangesBack,
  fromNewOnYou,
  fromPendingApprovals,
  fromReviews,
  fromUnassigned,
  groupNeedsYou,
  groupOf,
  isChangesRequested,
  isNewOnYou,
  SLIP_WINDOW_MS,
  urgencyOf,
  type MyTaskRow,
  type NeedsYouItem,
  type PendingApprovalRow,
  type UnassignedPiece,
} from './needs-you'

/**
 * "Needs you" (ADR-0105 d.2, D1): the grouping by the clock, the order inside a group, and each
 * source's mapping onto the one item shape.
 */

// A fixed local noon, so "today" never straddles midnight whatever the run's clock says.
const NOW = new Date(2026, 8, 24, 12, 0, 0).getTime()
const H = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()
const localDay = (y: number, m: number, d: number, h = 18) => new Date(y, m, d, h, 0, 0).toISOString()

const item = (o: Partial<NeedsYouItem> & { id: string }): NeedsYouItem => ({
  kind: 'review',
  title: o.id,
  context: '',
  since: null,
  clock: {},
  primary: null,
  ...o,
})

describe('groupOf — the three groups (ADR-0105 d.2)', () => {
  it('puts an item escalating within 8h in "today"', () => {
    expect(groupOf({ escalatesAt: iso(NOW + 4 * H) }, NOW)).toBe('today')
    expect(groupOf({ escalatesAt: iso(NOW + SLIP_WINDOW_MS) }, NOW)).toBe('today') // exactly 8h
  })

  it('puts an already-escalated item in "today"', () => {
    expect(groupOf({ escalatesAt: iso(NOW - 2 * H) }, NOW)).toBe('today')
  })

  it('puts an item whose task is due today, or overdue, in "today"', () => {
    expect(groupOf({ dueAt: localDay(2026, 8, 24) }, NOW)).toBe('today') // later today
    expect(groupOf({ dueAt: localDay(2026, 8, 24, 8) }, NOW)).toBe('today') // earlier today
    expect(groupOf({ dueAt: localDay(2026, 8, 20) }, NOW)).toBe('today') // four days late
  })

  it('puts any other clock in "this week" — an escalation past 8h, a later due date', () => {
    expect(groupOf({ escalatesAt: iso(NOW + SLIP_WINDOW_MS + 60_000) }, NOW)).toBe('week')
    expect(groupOf({ dueAt: localDay(2026, 8, 25) }, NOW)).toBe('week')
    expect(groupOf({ dueAt: localDay(2026, 10, 30) }, NOW)).toBe('week') // weeks away: still a clock
  })

  it('puts an item with no clock in "quietly" — nulls, blanks and junk dates are no clock', () => {
    expect(groupOf({}, NOW)).toBe('quiet')
    expect(groupOf({ escalatesAt: null, dueAt: null }, NOW)).toBe('quiet')
    expect(groupOf({ dueAt: '' }, NOW)).toBe('quiet')
    expect(groupOf({ dueAt: 'not a date' }, NOW)).toBe('quiet')
  })

  it('lets either clock pull an item into "today"', () => {
    // A far escalation does not hide a task that is due today, and vice versa.
    expect(groupOf({ escalatesAt: iso(NOW + 72 * H), dueAt: localDay(2026, 8, 24) }, NOW)).toBe('today')
    expect(groupOf({ escalatesAt: iso(NOW + H), dueAt: localDay(2026, 9, 30) }, NOW)).toBe('today')
  })
})

describe('the order inside a group — most urgent first', () => {
  it('reads urgency as the earlier of the two clocks', () => {
    expect(urgencyOf({ escalatesAt: iso(NOW + 5 * H), dueAt: iso(NOW + 2 * H) })).toBe(NOW + 2 * H)
    expect(urgencyOf({})).toBe(Infinity)
  })

  it('sorts by the clock, then the one waiting longest, then the title', () => {
    const a = item({ id: 'a', clock: { dueAt: iso(NOW + 3 * H) } })
    const b = item({ id: 'b', clock: { dueAt: iso(NOW + H) } })
    const c = item({ id: 'c', since: iso(NOW - 48 * H) })
    const d = item({ id: 'd', since: iso(NOW - 2 * H) })
    const e = item({ id: 'e' })
    const f = item({ id: 'f', title: 'A first' })
    expect([a, e, d, c, b, f].sort(byUrgency).map((x) => x.id)).toEqual(['b', 'a', 'c', 'd', 'f', 'e'])
  })

  it('groups and orders a mixed list, leaving empty groups out', () => {
    const sections = groupNeedsYou(
      [
        item({ id: 'week-later', clock: { dueAt: localDay(2026, 8, 30) } }),
        item({ id: 'quiet-old', since: iso(NOW - 99 * H) }),
        item({ id: 'today-late', clock: { dueAt: localDay(2026, 8, 22) } }),
        item({ id: 'today-esc', clock: { escalatesAt: iso(NOW - H) } }),
        item({ id: 'week-soon', clock: { dueAt: localDay(2026, 8, 26) } }),
      ],
      NOW,
    )
    expect(sections.map((s) => s.group)).toEqual(['today', 'week', 'quiet'])
    expect(sections[0]!.items.map((i) => i.id)).toEqual(['today-late', 'today-esc'])
    expect(sections[1]!.items.map((i) => i.id)).toEqual(['week-soon', 'week-later'])
    expect(sections[2]!.items.map((i) => i.id)).toEqual(['quiet-old'])
    expect(groupNeedsYou([], NOW)).toEqual([])
    expect(groupNeedsYou([item({ id: 'q' })], NOW).map((s) => s.group)).toEqual(['quiet'])
  })
})

describe('sources → the one item shape', () => {
  const approval = (o: Partial<PendingApprovalRow> & { kind: PendingApprovalRow['kind']; id: string }): PendingApprovalRow => ({
    title: 'LUMA Season 2',
    campaignId: 'c1',
    campaignName: 'LUMA',
    department: 'Creative',
    since: iso(NOW - 26 * H),
    targetId: 't1',
    deliverableId: 'd1',
    ...o,
  })

  it('keeps every pending approval as the old row said it, with no clock yet', () => {
    const link = (a: PendingApprovalRow) => (a.kind === 'campaign' ? `/campaigns/${a.campaignId}` : null)
    const [camp, booking, unwritten] = fromPendingApprovals(
      [
        approval({ kind: 'campaign', id: 'c1' }),
        approval({ kind: 'booking_request', id: 'q1' }),
        approval({ kind: 'department_brief_unwritten', id: 'c2', campaignName: 'LUMA' }),
      ],
      link,
      (department, campaign) => `Write ${department}'s brief for ${campaign}`,
    )
    expect(camp).toMatchObject({ kind: 'campaign', title: 'LUMA Season 2', context: 'LUMA · Creative', clock: {} })
    expect(camp!.primary).toEqual({ type: 'link', to: '/campaigns/c1', labelKey: 'waitingForYou.action.campaign' })
    // Answered in place — never a link away.
    expect(booking!.primary).toEqual({ type: 'booking' })
    // I53.22: the department is in the sentence, so it is not repeated beside it.
    expect(unwritten).toMatchObject({ title: "Write Creative's brief for LUMA Season 2", context: 'LUMA' })
    // A row with nowhere to go has no button rather than a dead one.
    expect(fromPendingApprovals([approval({ kind: 'task_list', id: 'x' })], () => null, () => '')[0]!.primary).toBeNull()
    // ADR-0133 (I70.3): a leaving person's hand-over is said as the thing to do, and opens their page.
    const [handover] = fromPendingApprovals(
      [approval({ kind: 'handover', id: 'u9', title: 'Mira Adel Mansour', targetId: 'u9', itemsLeft: 14 })],
      (a) => (a.kind === 'handover' ? `/people/handover/${a.targetId}` : null),
      () => '',
      null,
      { approve: (d) => d, define: (d) => d, handover: (name, n) => `Hand over ${name}'s work — ${n} items` },
    )
    expect(handover).toMatchObject({ kind: 'handover', title: "Hand over Mira Adel Mansour's work — 14 items" })
    expect(handover!.primary).toMatchObject({ type: 'link', to: '/people/handover/u9' })
    expect(groupOf(camp!.clock, NOW)).toBe('quiet')
  })

  it('asks the owner of a piece with no tasks to define them, on the task list clock (I66.3)', () => {
    const [empty, list] = fromPendingApprovals(
      [approval({ kind: 'task_list_undefined', id: 'd9', title: 'Eid KV', targetId: 'd9' }), approval({ kind: 'task_list', id: 'd8', title: 'Teaser', targetId: 'd8' })],
      (a) => `/deliverables?open=${a.targetId}`,
      () => '',
      new Map([['task_list', 24]]),
      { approve: (d) => `Review and approve the task list for ${d}`, define: (d) => `No tasks have been created for ${d} — define the tasks` },
    )
    expect(empty).toMatchObject({ kind: 'task_list_undefined', title: 'No tasks have been created for Eid KV — define the tasks' })
    expect(empty!.primary).toEqual({ type: 'link', to: '/deliverables?open=d9', labelKey: 'waitingForYou.action.task_list_undefined' })
    expect(empty!.clock.escalatesAt).toBeDefined()
    expect(empty!.clock).toEqual(list!.clock)
    // I66.5: the task list says what is required too.
    expect(list!.title).toBe('Review and approve the task list for Teaser')
  })

  it('asks the owner of a piece whose every task was cancelled to add one or close it, on the task-list clock (I66.11)', () => {
    const [cancelled] = fromPendingApprovals(
      [approval({ kind: 'tasks_all_cancelled', id: 'd7', title: 'Packaging', targetId: 'd7' })],
      (a) => `/deliverables?open=${a.targetId}`,
      () => '',
      new Map([['task_list', 24]]),
      { approve: (d) => d, define: (d) => d, allCancelled: (d) => `Every task on ${d} was cancelled — add a task, or close the deliverable` },
    )
    expect(cancelled).toMatchObject({ kind: 'tasks_all_cancelled', title: 'Every task on Packaging was cancelled — add a task, or close the deliverable' })
    expect(cancelled!.primary).toEqual({ type: 'link', to: '/deliverables?open=d7', labelKey: 'waitingForYou.action.tasks_all_cancelled' })
    expect(cancelled!.clock.escalatesAt).toBeDefined()
  })

  it('files a review by its task deadline, titled by the piece, the task and project as context', () => {
    const [r] = fromReviews([{ subTaskId: 's1', title: 'Create artwork', dueAt: localDay(2026, 8, 24), deliverableName: 'Eid banner set', campaignName: 'Eid' }])
    expect(r).toMatchObject({ kind: 'review', id: 's1', title: 'Eid banner set', context: 'Create artwork · Eid', primary: { type: 'review' } })
    expect(groupOf(r!.clock, NOW)).toBe('today')
    expect(fromReviews([{ subTaskId: 's2', title: 'Standalone', dueAt: null, deliverableName: null }])[0]!.title).toBe('Standalone')
  })

  const piece = (o: Partial<UnassignedPiece> = {}): UnassignedPiece => ({
    deliverableId: 'd1',
    name: 'Post 2',
    campaignId: 'c1',
    campaignName: 'LUMA',
    departmentId: 'dep1',
    department: 'Creative',
    unassignedCount: 2,
    since: iso(NOW - 26 * H),
    dueAt: localDay(2026, 8, 29),
    ...o,
  })

  it('offers Assign on a piece with tasks nobody has, opening the Schedule on its campaign and department', () => {
    const [a] = fromUnassigned([piece(), piece({ deliverableId: 'd2', unassignedCount: 0 })])
    expect(a).toMatchObject({ kind: 'assign', id: 'd1', title: 'Post 2', context: 'LUMA · Creative' })
    expect(a!.primary).toEqual({ type: 'link', to: '/schedule?campaign=c1&dept=dep1', labelKey: 'needsYou.action.assign' })
    expect(fromUnassigned([piece({ unassignedCount: 0 })])).toEqual([])
    expect(assignHref({ campaignId: 'c1', departmentId: null })).toBe('/schedule?campaign=c1')
  })

  const task = (o: Partial<MyTaskRow> & { subTaskId: string }): MyTaskRow => ({
    title: 'Draw Night 1 opener',
    status: 'todo',
    dueAt: localDay(2026, 8, 25),
    revisionRound: 0,
    deliverableId: 'd1',
    deliverableName: 'Opener',
    deliverableState: 'in_progress',
    campaignName: 'LUMA',
    assignerName: 'Fadia',
    assignedAt: iso(NOW - 2 * H),
    ...o,
  })

  it('says "changes came back" on a sent-back task — todo or in progress, not once approved', () => {
    expect(isChangesRequested(task({ subTaskId: 'a', revisionRound: 1 }))).toBe(true)
    expect(isChangesRequested(task({ subTaskId: 'b', revisionRound: 1, status: 'in_progress' }))).toBe(true)
    expect(isChangesRequested(task({ subTaskId: 'c', revisionRound: 1, status: 'review' }))).toBe(false)
    expect(isChangesRequested(task({ subTaskId: 'd', revisionRound: 1, deliverableState: 'approved' }))).toBe(false)
    expect(isChangesRequested(task({ subTaskId: 'e', revisionRound: 0 }))).toBe(false)
    const [c] = fromChangesBack([task({ subTaskId: 'a', revisionRound: 1 }), task({ subTaskId: 'z' })])
    expect(c).toMatchObject({ kind: 'changes_back', id: 'a', context: 'Opener · LUMA' })
    expect(c!.primary).toEqual({ type: 'link', to: '/my-work/task/a', labelKey: 'needsYou.action.open' })
  })

  it('says "new on you" for work given within a day and not started, and never twice once hidden', () => {
    expect(isNewOnYou(task({ subTaskId: 'n' }), NOW)).toBe(true)
    expect(isNewOnYou(task({ subTaskId: 'old', assignedAt: iso(NOW - 25 * H) }), NOW)).toBe(false)
    expect(isNewOnYou(task({ subTaskId: 'started', status: 'in_progress' }), NOW)).toBe(false)
    expect(isNewOnYou(task({ subTaskId: 'sentback', revisionRound: 1 }), NOW)).toBe(false)
    expect(isNewOnYou(task({ subTaskId: 'nodate', assignedAt: null }), NOW)).toBe(false)
    expect(isNewOnYou(task({ subTaskId: 'future', assignedAt: iso(NOW + H) }), NOW)).toBe(false)
    // I59: seen on the server (the task page opened) — not new, on any device.
    expect(isNewOnYou(task({ subTaskId: 'seen', seenAt: iso(NOW - H / 2) }), NOW)).toBe(false)
    expect(isNewOnYou(task({ subTaskId: 'unseen', seenAt: null }), NOW)).toBe(true)

    const rows = [task({ subTaskId: 'n1' }), task({ subTaskId: 'n2', seenAt: iso(NOW - H / 2) })]
    const items = fromNewOnYou(rows, NOW)
    expect(items.map((i) => i.id)).toEqual(['n1'])
    expect(items[0]).toMatchObject({ kind: 'new_on_you', context: 'Opener · LUMA · Fadia', secondary: { type: 'dialog', dialog: 'too_much' } })
    expect(items[0]).not.toHaveProperty('tertiary')
    expect(items[0]!.since).toBe(rows[0]!.assignedAt)
  })
})

// ---------------------------------------------------------------- I59 Track 6: the clocks ----
import { APPROVAL_RULE, clockOf, escalatesAtFor, spanOf } from './needs-you'

describe('the clock from the escalation rules (ADR-0108 d.2)', () => {
  const rules = new Map([['task_list', 24], ['unassigned', 24], ['review_escalate', 48], ['extension_am', 8]])
  const T = '2026-09-24T08:00:00.000Z'
  const at = (h: number) => new Date(Date.parse(T) + h * H).toISOString()

  it('escalates at the moment it started waiting plus the rule\'s hours, in real time', () => {
    expect(escalatesAtFor(T, rules, 'task_list')).toBe(at(24))
    expect(escalatesAtFor(T, rules, 'blocked')).toBeNull() // no rule, no clock
    expect(escalatesAtFor(null, rules, 'task_list')).toBeNull()
    expect(escalatesAtFor(T, null, 'task_list')).toBeNull()
  })

  it('gives the approvals the rule of their kind — a campaign falls back to task_list while campaign_brief is absent', () => {
    const row = (kind: PendingApprovalRow['kind']): PendingApprovalRow => ({
      kind, id: kind, title: kind, campaignId: 'c', campaignName: null, department: null, since: T, targetId: 't', deliverableId: null,
    })
    const items = fromPendingApprovals([row('task_list'), row('campaign'), row('booking_request'), row('extension_request')], () => '/x', () => '', rules)
    expect(items.map((i) => i.clock.escalatesAt ?? null)).toEqual([at(24), at(24), null, at(8)])
    const withBrief = fromPendingApprovals([row('campaign')], () => '/x', () => '', new Map([['campaign_brief', 12], ['task_list', 24]]))
    expect(withBrief[0]!.clock.escalatesAt).toBe(at(12))
    expect(APPROVAL_RULE.booking_request).toBeUndefined()
  })

  it('a review waits from the round sent and escalates after review_escalate; Assign after unassigned', () => {
    const [rv] = fromReviews([{ subTaskId: 'r', title: 'Create', dueAt: null, deliverableName: 'Eid' }], new Map([['r', T]]), rules)
    expect(rv).toMatchObject({ since: T, clock: { escalatesAt: at(48) } })
    const [as] = fromUnassigned([{ deliverableId: 'd', name: 'P', campaignId: 'c', campaignName: null, departmentId: null, department: null, unassignedCount: 1, since: T, dueAt: null }], rules)
    expect(as!.clock.escalatesAt).toBe(at(24))
  })

  it('"changes came back" waits from the send-back', () => {
    const row: MyTaskRow = { subTaskId: 'cb', title: 'Opener', status: 'todo', dueAt: null, revisionRound: 1, deliverableId: 'd1', deliverableName: 'Opener', deliverableState: 'in_progress', campaignName: null, assignerName: null }
    const [cb] = fromChangesBack([row], new Map([['cb', T]]))
    expect(cb!.since).toBe(T)
  })

  it('says minutes under an hour, hours under 48, days after (Settled, 25 Sep)', () => {
    expect(spanOf(30 * 1000)).toEqual({ n: 1, unit: 'minute' })
    expect(spanOf(45 * 60_000)).toEqual({ n: 45, unit: 'minute' })
    expect(spanOf(26 * H)).toEqual({ n: 26, unit: 'hour' })
    expect(spanOf(47.9 * H)).toEqual({ n: 47, unit: 'hour' })
    expect(spanOf(48 * H)).toEqual({ n: 2, unit: 'day' })
    expect(spanOf(6.5 * 24 * H)).toEqual({ n: 6, unit: 'day' })
  })

  it('reads waiting, escalates-in and escalated-ago off the item', () => {
    const now = Date.parse(at(26))
    expect(clockOf({ since: T, clock: { escalatesAt: at(30) } }, now)).toEqual({
      waited: { n: 26, unit: 'hour' }, escalatesIn: { n: 4, unit: 'hour' }, escalatedAgo: null,
    })
    expect(clockOf({ since: null, clock: { escalatesAt: at(24) } }, now)).toEqual({
      waited: null, escalatesIn: null, escalatedAgo: { n: 2, unit: 'hour' },
    })
    expect(clockOf({ since: null, clock: {} }, now)).toEqual({ waited: null, escalatesIn: null, escalatedAgo: null })
  })
})

describe("seen when the maker opens the task (Q38, I59: the server's)", () => {
  it('lists only the tasks the server has not seen opened', () => {
    const row = (subTaskId: string, seenAt: string | null): MyTaskRow => ({
      subTaskId, title: 'Opener', status: 'todo', dueAt: null, revisionRound: 0, deliverableId: 'd1',
      deliverableName: 'Opener', deliverableState: 'in_progress', campaignName: 'LUMA', assignerName: 'Fadia',
      assignedAt: iso(NOW - 2 * H), seenAt,
    })
    const rows = [row('a', iso(NOW - H)), row('b', null)]
    expect(fromNewOnYou(rows, NOW).map((i) => i.id)).toEqual(['b'])
  })
})
