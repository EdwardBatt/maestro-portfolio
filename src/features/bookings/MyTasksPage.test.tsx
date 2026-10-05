import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../lib/i18n'
import type { AssignedWorkItem } from '../deliverables/api/deliverables-api'
import type { MyLoad } from '../team/api/team-api'

/**
 * My Work, the page (ADR-0105 d.1, I59.10, Figma M1): the panels in their order — greeting,
 * attendance, the counts, Needs you, the lists, news — and the right column, Your week and Before
 * you start. Each panel has its own suite; they are stubbed here to markers.
 */

const state = vi.hoisted(() => ({
  work: [] as AssignedWorkItem[],
  rules: [] as { kind: 'do' | 'dont'; text: string }[],
  load: null as MyLoad | null,
  rulesAskedFor: [] as (string | null)[],
  team: [] as { people: { userId: string | null; teamId: string | null; utilPct: number }[] }[],
}))

vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }))
vi.mock('../../app/useCurrentUser', () => ({ useCurrentUser: () => ({ data: { displayName: 'Zubaida Jamil' } }) }))
vi.mock('../deliverables/api/deliverables-api', () => ({
  useMyAssignedWork: () => ({ data: state.work, isLoading: false }),
  useTaskListRules: (campaignId: string | null) => {
    state.rulesAskedFor.push(campaignId)
    return { data: state.rules }
  },
}))
vi.mock('../team/api/team-api', () => ({
  useMyLoad: () => ({ data: state.load, isLoading: false, isError: false }),
  // I59 Track 6: Your week reads the team's week for the most-booked line.
  useTeamLoad: () => ({ week: { start: '', end: '', label: '' }, groups: state.team, isLoading: false, isError: false }),
}))
vi.mock('../deliverables/MyWorkPanel', () => ({ MyWorkLists: () => <div data-testid="lists-stub" /> }))
// I74.26: the asks card reads the server on its own; this page test is about the layout around it.
vi.mock('../deliverables/components/AsksFromOtherTeams', () => ({ AsksFromOtherTeams: () => <div data-testid="asks-stub" /> }))
vi.mock('../deliverables/NeedsYouPanel', () => ({ NeedsYouPanel: () => <div data-testid="needs-you-stub" /> }))
vi.mock('../attendance/AttendanceWidget', () => ({ AttendanceWidget: () => <div data-testid="attendance-stub" /> }))
vi.mock('../deliverables/ExceptionsPanel', () => ({ ExceptionsPanel: () => <div data-testid="exceptions-stub" /> }))

import { MyTasksPage } from './MyTasksPage'

const day = (n: number) => new Date(new Date().setHours(12, 0, 0, 0) + n * 86_400_000).toISOString()
const task = (o: Partial<AssignedWorkItem> & { subTaskId: string }): AssignedWorkItem => ({
  title: 'Task', status: 'todo', priority: null, slaHours: 8, startsAt: null, dueAt: day(2), committedDueAt: null,
  scheduleOverridden: false, deliverableId: 'd', deliverableName: 'Piece', deliverableState: 'in_progress',
  deliverableDueAt: null, revisionRound: 0, campaignId: 'cam-x', campaignName: 'LUMA', goLiveAt: null, discipline: null,
  isAdhoc: false, assignerName: null, reviewers: [], reviewMode: 'digital', departmentId: 'dep1', ...o,
})

const renderPage = () => render(<MemoryRouter><MyTasksPage /></MemoryRouter>)

beforeEach(() => {
  state.work = []
  state.team = []
  state.rules = []
  state.load = null
  state.rulesAskedFor = []
})

describe('My Work — the page (I59.10)', () => {
  it('keeps every panel, in order: attendance, counts, Needs you, the lists, news', () => {
    renderPage()
    const order = ['attendance-stub', 'exceptions-stub', 'needs-you-stub', 'lists-stub', 'news-feed'].map((id) => screen.getByTestId(id))
    for (let i = 1; i < order.length; i++) {
      // Each comes after the one before it in the document.
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('greets the person by first name and names what comes first', () => {
    state.work = [
      task({ subTaskId: 'b', title: 'Later one', dueAt: day(5) }),
      task({ subTaskId: 'a', title: 'Draw Night 1 opener', dueAt: day(1) }),
      // With somebody else — not what bites first.
      task({ subTaskId: 'r', title: 'In review', status: 'review', dueAt: day(0) }),
    ]
    renderPage()
    expect(screen.getByTestId('my-work-greeting')).toHaveTextContent(/Good (morning|afternoon|evening), Zubaida/)
    expect(screen.getByTestId('my-work-greeting-line')).toHaveTextContent('Draw Night 1 opener comes first')
  })

  it('says nothing is open when nothing is', () => {
    renderPage()
    expect(screen.getByTestId('my-work-greeting-line')).toHaveTextContent('Nothing of yours is open')
  })

  it('shows Your week: the total and %, the working days, and the warn line only when due', () => {
    const days = [
      { date: '2026-09-20', weekday: 0, hours: 8, working: true },
      { date: '2026-09-21', weekday: 1, hours: 9, working: true },
      { date: '2026-09-22', weekday: 2, hours: 0, working: true },
      { date: '2026-09-25', weekday: 5, hours: 0, working: false },
    ]
    state.load = { hasResource: true, week: { start: '', end: '', label: '' }, bookedHours: 17, bookingCount: 3, utilPct: 43, level: 'ok', days, dayHours: 8, warnPct: 100 }
    const { unmount } = renderPage()
    expect(screen.getByTestId('your-week-total')).toHaveTextContent('Your week 17h booked · 43%')
    expect(screen.getByTestId('your-week-day-2026-09-21')).toHaveTextContent('9h')
    // A closed day with nothing on it is not drawn.
    expect(screen.queryByTestId('your-week-day-2026-09-25')).not.toBeInTheDocument()
    expect(screen.queryByTestId('your-week-level')).not.toBeInTheDocument()
    unmount()
    state.load = { ...state.load, utilPct: 125, level: 'over' }
    renderPage()
    expect(screen.getByTestId('your-week-level')).toHaveTextContent('125%')
  })

  it('says "the most booked in your team" only when I am, strictly (I59 Track 6)', () => {
    state.load = { hasResource: true, week: { start: '', end: '', label: '' }, bookedHours: 36, bookingCount: 4, utilPct: 90, level: 'ok', days: [], dayHours: 8, warnPct: 100 }
    state.team = [{ people: [{ userId: 'me', teamId: 't1', utilPct: 90 }, { userId: 'lujain', teamId: 't1', utilPct: 60 }] }]
    const { unmount } = renderPage()
    expect(screen.getByTestId('your-week-most-booked')).toHaveTextContent('You are the most booked in your team this week.')
    unmount()
    state.team = [{ people: [{ userId: 'me', teamId: 't1', utilPct: 90 }, { userId: 'lujain', teamId: 't1', utilPct: 90 }] }]
    renderPage()
    expect(screen.queryByTestId('your-week-most-booked')).not.toBeInTheDocument()
  })

  it('hides Your week for a login with no resource', () => {
    state.load = { hasResource: false, week: { start: '', end: '', label: '' }, bookedHours: 0, bookingCount: 0, utilPct: 0, level: 'ok', days: [], dayHours: 8, warnPct: 100 }
    renderPage()
    expect(screen.queryByTestId('your-week')).not.toBeInTheDocument()
  })

  it('shows Before you start: the rules of the most urgent task\'s campaign, only when it has rules', () => {
    state.work = [task({ subTaskId: 'a', campaignId: 'cam-first', campaignName: 'LUMA Season 2', dueAt: day(1) }), task({ subTaskId: 'b', campaignId: 'cam-other', dueAt: day(4) })]
    const { unmount } = renderPage()
    expect(screen.queryByTestId('before-you-start')).not.toBeInTheDocument()
    expect(state.rulesAskedFor).toContain('cam-first')
    expect(state.rulesAskedFor).not.toContain('cam-other')
    unmount()
    state.rules = [{ kind: 'do', text: 'Arabic leads' }, { kind: 'dont', text: 'Never قرعة' }]
    renderPage()
    expect(screen.getByTestId('before-you-start-line')).toHaveTextContent('LUMA Season 2 carries 2 rules.')
    expect(screen.getByTestId('before-you-start-rule-1')).toHaveTextContent('Never قرعة')
  })
})
