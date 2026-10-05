import { describe, expect, it } from 'vitest'
import { approvalFigures, reachFor, waitingOnCaption, type BriefRow } from './approvals'
import type { DashCampaign, DashPiece } from './figures'

const todo = { id: 't', status: 'todo' as const, assigneeId: null, committedStartsAt: null, committedDueAt: null, hours: null, submittedAt: null, reviewerIds: [] }

const brief = (id: string, over: Partial<BriefRow> = {}): BriefRow => ({
  id, name: id, status: 'draft', clientName: 'Kite', accountManagerId: 'sara', createdBy: 'sara', ...over,
})
const campaign = (id: string, over: Partial<DashCampaign> = {}): DashCampaign => ({
  id, name: id, clientName: 'Kite', goLiveAt: null, status: 'approved', accountManagerId: 'sara', ...over,
})
const piece = (id: string, over: Partial<DashPiece> = {}): DashPiece => ({
  id, name: id, campaignId: 'c1', state: 'in_progress', dueAt: null, taskListApprovedAt: null, ownerId: 'omar',
  reviewerId: null, workstreamOwnerId: null, outstandingInputs: 0, tasks: [todo], ...over,
})

describe('approvalFigures (I66.2)', () => {
  const briefs = [
    brief('d1'), brief('d2', { createdBy: 'ali', accountManagerId: 'ali' }),
    brief('p1', { status: 'pending_approval' }), brief('p2', { status: 'pending_approval', accountManagerId: 'ali', clientName: 'Zeta' }),
  ]
  const campaigns = [campaign('c1'), campaign('c2', { status: 'pending_approval' }), campaign('c3', { accountManagerId: 'ali' })]
  const pieces = [
    piece('k1'), piece('k2', { ownerId: 'rana' }),
    piece('k3', { taskListApprovedAt: '2026-09-20T00:00:00Z' }), // approved list
    piece('k4', { campaignId: 'c2' }), // campaign not approved yet — the first gate still holds
    piece('k5', { state: 'archived' }),
    piece('k6', { tasks: [{ ...todo, status: 'done' }] }), // nothing live on the list
    piece('k7', { campaignId: 'c3' }),
  ]

  it('everything, for the company views: each item waits on its starter, its account manager, its owner', () => {
    const f = approvalFigures(briefs, campaigns, pieces, { kind: 'all' }, null)
    expect(f.unfinished).toEqual([{ id: 'd1', name: 'd1', on: 'sara' }, { id: 'd2', name: 'd2', on: 'ali' }])
    expect(f.briefs.map((b) => [b.id, b.on])).toEqual([['p1', 'sara'], ['p2', 'ali']])
    expect(f.taskLists.map((p) => [p.id, p.on])).toEqual([['k1', 'omar'], ['k2', 'rana'], ['k7', 'omar']])
  })

  it('a team member: only what waits on them', () => {
    const f = approvalFigures(briefs, campaigns, pieces, { kind: 'me', myId: 'omar' }, null)
    expect(f.unfinished).toEqual([])
    expect(f.briefs).toEqual([])
    expect(f.taskLists.map((p) => p.id)).toEqual(['k1', 'k7'])
  })

  it('a lead: what waits on the people of the team or department', () => {
    const f = approvalFigures(briefs, campaigns, pieces, { kind: 'people', ids: new Set(['rana', 'ali']) }, null)
    expect(f.unfinished.map((b) => b.id)).toEqual(['d2'])
    expect(f.briefs.map((b) => b.id)).toEqual(['p2'])
    expect(f.taskLists.map((p) => p.id)).toEqual(['k2'])
  })

  it('an account manager: their accounts, whoever the task list waits on', () => {
    const f = approvalFigures(briefs, campaigns, pieces, { kind: 'accounts', myId: 'sara' }, null)
    expect(f.unfinished.map((b) => b.id)).toEqual(['d1'])
    expect(f.briefs.map((b) => b.id)).toEqual(['p1'])
    expect(f.taskLists.map((p) => p.id)).toEqual(['k1', 'k2'])
  })

  it('narrows to the client the dashboard is filtered to', () => {
    const f = approvalFigures(briefs, campaigns, pieces, { kind: 'all' }, 'Zeta')
    expect(f.unfinished).toEqual([])
    expect(f.briefs.map((b) => b.id)).toEqual(['p2'])
    expect(f.taskLists).toEqual([])
  })
})

describe('waitingOnCaption', () => {
  const names = new Map([['omar', 'Omar Hadi'], ['rana', 'Reem Saleh'], ['ali', 'Ali Kareem'], ['nour', 'Noor Kanaan']])
  const words = { you: 'you', nobody: 'no owner', others: (p: number, n: number) => `${p} others ${n}` }
  let k = 0
  const w = (on: string | null) => ({ id: `i${k++}`, name: 'x', on })
  const say = (items: ReturnType<typeof w>[], me = 'nobody-here') => waitingOnCaption(items, (id) => names.get(id), me, words)

  it('names up to three people, most first, and every item is accounted for (I66.5: 42 shown, 32 named)', () => {
    const items = [...Array(21)].map(() => w('omar')).concat([...Array(11)].map(() => w('rana')), [...Array(10)].map(() => w('nour')))
    expect(say(items)!.short).toBe('Omar Hadi 21 · Reem Saleh 11 · Noor Kanaan 10')
  })

  it('past three, the first two and the others with what they hold; the whole list for the hover', () => {
    const items = [w('ali'), w('ali'), w('ali'), w('omar'), w('omar'), w('rana'), w('nour')]
    expect(say(items)).toEqual({
      short: 'Ali Kareem 3 · Omar Hadi 2 · 2 others 2',
      full: 'Ali Kareem 3 · Omar Hadi 2 · Noor Kanaan 1 · Reem Saleh 1',
    })
  })

  it('says "you" for the viewer and "no owner" for an item nobody holds', () => {
    expect(say([w('rana'), w(null)], 'rana')!.short).toBe('no owner 1 · you 1')
  })

  it('says nothing when nothing waits', () => {
    expect(say([])).toBeNull()
  })
})

describe('reachFor (I66.6: the card and the list it opens count over one reach)', () => {
  it('maps each Dashboard view to its reach', () => {
    expect(reachFor('member', 'me', ['x'])).toEqual({ kind: 'me', myId: 'me' })
    expect(reachFor('team', 'me', ['a', 'b'])).toEqual({ kind: 'people', ids: new Set(['a', 'b']) })
    expect(reachFor('department', 'me', ['a'])).toEqual({ kind: 'people', ids: new Set(['a']) })
    expect(reachFor('account', 'me', [])).toEqual({ kind: 'accounts', myId: 'me' })
    for (const v of ['director', 'traffic', 'clevel', 'admin'] as const) expect(reachFor(v, 'me', [])).toEqual({ kind: 'all' })
  })
})
