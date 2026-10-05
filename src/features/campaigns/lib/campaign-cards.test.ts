import { describe, expect, it } from 'vitest'
import type { CampaignListRow } from '../api/campaign-api'
import type { CampaignPulseSource } from '../api/campaign-pulse-api'
import type { PulsePiece } from '../../../lib/campaigns/pulse'
import { buildCards, optionsOf, timingOf, type CardFilters } from './campaign-cards'

const NOW = Date.parse('2026-09-24T09:00:00Z') // Thu 24 Sep, Baghdad noon

const row = (id: string, over: Partial<CampaignListRow> = {}): CampaignListRow => ({
  id,
  name: `Campaign ${id}`,
  clientName: 'Kite',
  brandName: 'LUMA',
  goLiveAt: null,
  status: 'approved',
  accountManagerName: 'Inas',
  departmentBriefTotal: 0,
  departmentBriefApproved: 0,
  briefOwnerNames: [],
  deliverableTotal: 0,
  deliverableTasksApproved: 0,
  kind: 'campaign',
  createdAt: null,
  updatedAt: null,
  createdByName: null,
  updatedByName: null,
  ...over,
})

const piece = (over: Partial<PulsePiece> = {}): PulsePiece => ({
  state: 'in_progress',
  dueAt: '2026-10-20T15:00:00Z',
  taskListApprovedAt: '2026-09-20T08:00:00Z',
  ownerId: 'owner',
  reviewerId: null,
  workstreamOwnerId: null,
  outstandingInputs: 0,
  tasks: [],
  ...over,
})

const src = (id: string, over: Partial<CampaignPulseSource> = {}): CampaignPulseSource => ({
  campaignId: id,
  clientId: null,
  accountManagerId: 'inas',
  hasPhases: false,
  phases: [],
  pieces: [],
  searchText: '',
  ...over,
})

const f = (over: Partial<CardFilters> = {}): CardFilters => ({
  scope: 'all',
  query: '',
  client: '',
  accountManager: '',
  status: '',
  showClosed: false,
  ...over,
})

describe('buildCards — the campaigns list (CG-00, I57.3)', () => {
  const rows = [row('a'), row('b', { accountManagerName: 'Rowan' }), row('c', { status: 'closed' }), row('d', { status: 'draft' })]
  const sources = new Map([
    ['a', src('a')],
    ['b', src('b', { accountManagerId: 'rowan', pieces: [piece({ ownerId: 'zubaida' })] })],
    ['c', src('c')],
  ])

  it('everyone sees every campaign under All; drafts are never cards; closed hides until asked', () => {
    const r = buildCards(rows, sources, 'nobody', f(), NOW)
    expect(r.cards.map((c) => c.row.id)).toEqual(['a', 'b'])
    expect(r.closedCount).toBe(1)
    expect(buildCards(rows, sources, 'nobody', f({ showClosed: true }), NOW).cards.map((c) => c.row.id)).toEqual(['a', 'b', 'c'])
  })

  it('Mine is the account manager\'s campaigns', () => {
    expect(buildCards(rows, sources, 'inas', f({ scope: 'mine' }), NOW).cards.map((c) => c.row.id)).toEqual(['a'])
  })

  it('Mine includes a campaign I am ON — here, owning a piece', () => {
    expect(buildCards(rows, sources, 'zubaida', f({ scope: 'mine' }), NOW).cards.map((c) => c.row.id)).toEqual(['b'])
  })

  it('an empty Mine falls back to All and says so', () => {
    const r = buildCards(rows, sources, 'nobody', f({ scope: 'mine' }), NOW)
    expect(r.mineFellBack).toBe(true)
    expect(r.cards.map((c) => c.row.id)).toEqual(['a', 'b'])
  })

  it('lists live campaigns first, then those awaiting approval, then closed', () => {
    const r = buildCards(
      [row('p', { status: 'pending_approval' }), row('x', { status: 'closed' }), row('l')],
      undefined,
      null,
      f({ showClosed: true }),
      NOW,
    )
    expect(r.cards.map((c) => c.row.id)).toEqual(['l', 'p', 'x'])
  })

  it('the smart search finds a campaign by a piece code, a piece name or a person', () => {
    const s = new Map([['a', src('a', { searchText: 'da-017 week 2 explainer zubaida jamil' })], ['b', src('b')]])
    const find = (q: string) => buildCards(rows, s, null, f({ query: q }), NOW).cards.map((c) => c.row.id)
    expect(find('da-017')).toEqual(['a'])
    expect(find('explainer')).toEqual(['a'])
    expect(find('zubaida')).toEqual(['a'])
    expect(find('rowan')).toEqual(['b']) // the account manager's name, from the row
    expect(find('nothing like this')).toEqual([])
  })

  it('filters by client, account manager and status', () => {
    const rs = [row('a'), row('b', { clientName: 'Auracell', accountManagerName: 'Rowan', status: 'pending_approval' })]
    expect(buildCards(rs, undefined, null, f({ client: 'Auracell' }), NOW).cards.map((c) => c.row.id)).toEqual(['b'])
    expect(buildCards(rs, undefined, null, f({ accountManager: 'Inas' }), NOW).cards.map((c) => c.row.id)).toEqual(['a'])
    expect(buildCards(rs, undefined, null, f({ status: 'pending_approval' }), NOW).cards.map((c) => c.row.id)).toEqual(['b'])
  })

  it('choosing the Closed status shows closed campaigns without the toggle', () => {
    expect(buildCards(rows, sources, null, f({ status: 'closed' }), NOW).cards.map((c) => c.row.id)).toEqual(['c'])
  })

  it('a card carries the pulse when the pieces are known, and none while they load', () => {
    expect(buildCards(rows, sources, null, f(), NOW).cards[1].pulse?.total).toBe(1)
    expect(buildCards(rows, undefined, null, f(), NOW).cards[0].pulse).toBeNull()
  })
})

describe('timingOf — the card\'s line', () => {
  const phases = [
    { number: 1, name: 'Pre-launch', startsOn: '2026-09-13', endsOn: '2026-09-17' },
    { number: 2, name: 'Week 1', startsOn: '2026-09-20', endsOn: '2026-09-25' },
    { number: 3, name: 'Week 2', startsOn: '2026-09-27', endsOn: '2026-10-02' },
  ]
  it('names the phase today falls in, n of N', () => {
    expect(timingOf(row('a'), src('a', { hasPhases: true, phases }), NOW)).toEqual({ kind: 'phase', name: 'Week 1', number: 2, of: 3 })
  })
  it('before the first phase, or between two, names the next', () => {
    expect(timingOf(row('a'), src('a', { hasPhases: true, phases }), Date.parse('2026-09-10T09:00:00Z')))
      .toEqual({ kind: 'before_phases', name: 'Pre-launch', startsOn: '2026-09-13' })
    expect(timingOf(row('a'), src('a', { hasPhases: true, phases }), Date.parse('2026-09-19T09:00:00Z')))
      .toEqual({ kind: 'before_phases', name: 'Week 1', startsOn: '2026-09-20' })
  })
  it('after the last phase says they are done', () => {
    expect(timingOf(row('a'), src('a', { hasPhases: true, phases }), Date.parse('2026-10-10T09:00:00Z'))).toEqual({ kind: 'after_phases', of: 3 })
  })
  it('a campaign without phases reads its go-live', () => {
    expect(timingOf(row('a', { goLiveAt: '2026-10-01T15:00:00Z' }), src('a'), NOW)).toEqual({ kind: 'single', goLiveAt: '2026-10-01T15:00:00Z' })
  })
  it('a single job reads its piece\'s due date', () => {
    expect(timingOf(row('a', { kind: 'single_job' }), src('a', { pieces: [piece({ dueAt: '2026-09-28T15:00:00Z' })] }), NOW))
      .toEqual({ kind: 'job', dueAt: '2026-09-28T15:00:00Z' })
  })
})

describe('optionsOf', () => {
  it('offers each value once, sorted, without drafts or blanks', () => {
    const rs = [row('a', { clientName: 'Kite' }), row('b', { clientName: 'Auracell' }), row('c', { clientName: 'Kite' }), row('d', { clientName: 'Zeta', status: 'draft' })]
    expect(optionsOf(rs, (r) => r.clientName)).toEqual(['Auracell', 'Kite'])
    expect(optionsOf([row('a', { accountManagerName: null })], (r) => r.accountManagerName)).toEqual([])
  })
})

describe('buildCards — the "Task lists to approve" alert (I66.2)', () => {
  const todo = { id: 't', status: 'todo' as const, assigneeId: null, committedStartsAt: null, committedDueAt: null, hours: null, submittedAt: null, reviewerIds: [] }
  const waiting = piece({ taskListApprovedAt: null, tasks: [todo] })

  it('keeps only approved campaigns with a task list still to approve', () => {
    const rows = [row('a'), row('b'), row('c', { status: 'pending_approval' })]
    const sources = new Map([
      ['a', src('a', { pieces: [waiting] })],
      ['b', src('b', { pieces: [piece({ tasks: [todo] })] })],
      ['c', src('c', { pieces: [waiting] })],
    ])
    const { cards } = buildCards(rows, sources, null, f({ alert: 'taskLists' }), NOW)
    expect(cards.map((c) => c.row.id)).toEqual(['a'])
  })
})
