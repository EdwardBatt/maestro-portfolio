import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../lib/i18n'
import type { CampaignListRow } from './api/campaign-api'
import type { CampaignPulseSource } from './api/campaign-pulse-api'
import type { PulsePiece, PulseTask } from '../../lib/campaigns/pulse'

const listState = vi.hoisted(() => ({
  data: [] as CampaignListRow[],
  isLoading: false,
  isError: false,
}))

const discardMutate = vi.hoisted(() => vi.fn())
const closeOutMutate = vi.hoisted(() => vi.fn())
const reopenMutate = vi.hoisted(() => vi.fn())
// Self-contained factory (no importOriginal — the real module reaches lib/env,
// which throws in CI where no VITE_* env exists).
vi.mock('./api/campaign-api', () => ({
  useCampaignList: () => listState,
  useDiscardCampaignDraft: () => ({ mutate: discardMutate, isPending: false }),
  useCloseOutCampaign: () => ({ mutate: closeOutMutate, isPending: false }),
  useReopenCampaign: () => ({ mutate: reopenMutate, isPending: false }),
  useMyDrafts: () => ({ data: undefined }),
}))

// The pieces behind each card (I57.3). Empty unless a test says otherwise.
const pulseState = vi.hoisted(() => ({
  data: new Map() as Map<string, CampaignPulseSource>,
  isLoading: false,
  dataUpdatedAt: 1,
}))
vi.mock('./api/campaign-pulse-api', () => ({ useCampaignPulse: () => pulseState }))

// Who is looking — "Mine" is theirs.
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }))

// Where promotion lands (ADR-0086 d.10 and its addendum) is asserted on the navigate call.
const navigateMock = vi.hoisted(() => vi.fn())
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>()
  return { ...actual, useNavigate: () => navigateMock }
})

const openDoor = vi.hoisted(() => vi.fn())
vi.mock('../intake/lib/new-request', () => ({ openNewRequest: openDoor }))

// The page is read-only for everyone (Edward, 12 Sep); the write actions need projects:manage.
// These tests assert the manager surface, so the mock grants it.
vi.mock('../../app/permissions', () => ({
  // ADR-0103: re-opening a closed campaign needs project_tasks:manage, which every holder of
  // projects:manage also holds.
  usePermissions: () => ({ can: (k: string) => k === 'projects:manage' || k === 'project_tasks:manage' }),
}))

// ADR-0086 d.9: the promotion press.
const promoteMutate = vi.hoisted(() => vi.fn((_id: string, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.()))
vi.mock('../intake/api/intake-api', () => ({
  usePromoteSingleJob: () => ({ mutate: promoteMutate, isPending: false }),
}))

import { CampaignsPage } from './CampaignsPage'

const source = (id: string, over: Partial<CampaignPulseSource> = {}): CampaignPulseSource => ({
  campaignId: id,
  clientId: null,
  accountManagerId: 'me',
  hasPhases: false,
  phases: [],
  pieces: [],
  searchText: '',
  ...over,
})

const piece = (over: Partial<PulsePiece> = {}): PulsePiece => ({
  state: 'in_progress',
  dueAt: '2099-10-20T15:00:00Z',
  taskListApprovedAt: '2026-09-20T08:00:00Z',
  ownerId: 'owner',
  reviewerId: null,
  workstreamOwnerId: null,
  outstandingInputs: 0,
  tasks: [],
  ...over,
})

const task = (over: Partial<PulseTask> = {}): PulseTask => ({
  id: 't',
  status: 'todo',
  assigneeId: null,
  committedStartsAt: null,
  committedDueAt: null,
  hours: 8,
  submittedAt: null,
  reviewerIds: [],
  ...over,
})

/** Every listed campaign is "mine" unless a test builds its own sources — so the tests that are
 *  about something else are not also about the Mine filter. */
function mineAll() {
  pulseState.data = new Map(listState.data.map((r) => [r.id, source(r.id)]))
}

function renderPage(opts: { sources?: 'keep' } = {}) {
  if (opts.sources !== 'keep') mineAll()
  return render(
    <MemoryRouter>
      <CampaignsPage />
    </MemoryRouter>,
  )
}

const draft = (id: string, name: string): CampaignListRow => ({
  id,
  name,
  clientName: 'Zeta',
  brandName: null,
  goLiveAt: null,
  status: 'draft',
  accountManagerName: null,
  departmentBriefTotal: 0,
  departmentBriefApproved: 0,
  briefOwnerNames: [],
  deliverableTotal: 0,
  deliverableTasksApproved: 0,
  kind: 'campaign',
  createdAt: '2026-09-10T08:00:00Z',
  updatedAt: '2026-09-12T09:30:00Z',
  createdByName: 'Mira Adel',
  updatedByName: null,
})

describe('CampaignsPage (ADR-0020)', () => {
  afterEach(() => { vi.useRealTimers() })
  // ADR-0082 d.7: New opens the one door rather than going straight to the wizard.
  it('shows the empty state with a New CTA that opens the door when there are no campaigns', () => {
    listState.data = []
    listState.isLoading = false
    renderPage()
    expect(screen.getByTestId('campaigns-empty')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('campaigns-empty-cta'))
    expect(openDoor).toHaveBeenCalledTimes(1)
  })

  it('always offers New in the header, and it opens the door', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('campaigns-new-brief'))
    expect(openDoor).toHaveBeenCalled()
  })

  /**
   * CG-00 (I57.3): a card says whose it is, where it is in time and its status — the client, the
   * brand, the go-live and the account manager on one line, the status as today's badge.
   */
  it('says where the campaign is: client, brand, go-live, account manager and status', () => {
    // I66.8: a date shows its year only when it is not this year, so pin "today" (the date only).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-29T09:00:00Z'))
    listState.data = [
      {
        id: 'cmp1',
        name: 'Zeta Ramadan',
        clientName: 'Zeta',
        brandName: 'Zeta KW',
        goLiveAt: '2026-03-01T00:00:00Z',
        status: 'approved',
        accountManagerName: 'Lina Haddad',
        departmentBriefTotal: 2,
        departmentBriefApproved: 1,
        briefOwnerNames: ['Omar Reviewer', 'Sara Designer'],
        deliverableTotal: 2,
        deliverableTasksApproved: 0,
        kind: 'campaign',
        createdAt: '2026-09-10T08:00:00Z',
        updatedAt: '2026-09-12T09:30:00Z',
        createdByName: 'Mira Adel',
        updatedByName: null,
      },
    ]
    listState.isLoading = false
    renderPage()
    const row = screen.getByTestId('campaign-row-cmp1')
    expect(row).toHaveTextContent('Zeta Ramadan')
    expect(row).toHaveTextContent('Zeta KW')
    expect(row).toHaveTextContent('Approved')
    expect(row).toHaveTextContent('Lina Haddad')
    expect(screen.getByTestId('campaign-line-cmp1')).toHaveTextContent('go-live Sun, 1 Mar')
    expect(screen.getByTestId('campaign-status-cmp1')).toHaveTextContent('Approved')
  })

  // Task lists, not department briefs (Edward, 24 Sep): each piece's owner approves its task list.
  // CG-00: counted as an alert badge, shown only above zero.
  it('counts the task lists still waiting as a badge, and shows none when every list is approved', () => {
    listState.data = [
      { ...draft('cmp2', 'Half done'), status: 'approved' },
      { ...draft('cmp4', 'Moving'), status: 'approved' },
    ]
    listState.isLoading = false
    pulseState.data = new Map([
      ['cmp2', source('cmp2', { pieces: [piece({ taskListApprovedAt: null, tasks: [task()] }), piece({ taskListApprovedAt: null, tasks: [task()] }), piece({ tasks: [task()] })] })],
      ['cmp4', source('cmp4', { pieces: [piece({ tasks: [task()] })] })],
    ])
    renderPage({ sources: 'keep' })
    expect(screen.getByTestId('campaign-task-lists-cmp2')).toHaveTextContent('2 task lists to approve')
    expect(screen.queryByTestId('campaign-task-lists-cmp4')).toBeNull()
  })

  it('shows each alert as its own badge, and the delivered progress', () => {
    listState.data = [{ ...draft('c1', 'LUMA'), status: 'approved' }]
    pulseState.data = new Map([
      ['c1', source('c1', {
        pieces: [
          piece({ dueAt: '2020-01-01T15:00:00Z' }), // late
          piece({ state: 'approved' }), // with the client
          piece({ outstandingInputs: 1 }), // waiting on a client input
          piece({ state: 'delivered' }),
          piece({ tasks: [task({ id: 'u' })] }), // a task nobody has
        ],
      })],
    ])
    renderPage({ sources: 'keep' })
    expect(screen.getByTestId('campaign-alert-risk-c1')).toHaveTextContent('1 at risk')
    expect(screen.getByTestId('campaign-alert-client-c1')).toHaveTextContent('2 waiting on client')
    expect(screen.getByTestId('campaign-alert-unassigned-c1')).toHaveTextContent('1 task unassigned')
    expect(screen.getByTestId('campaign-progress-c1')).toHaveTextContent('1 of 5')
  })

  it('a healthy campaign carries its status and no alerts', () => {
    listState.data = [{ ...draft('c1', 'Calm'), status: 'approved' }]
    pulseState.data = new Map([['c1', source('c1', { pieces: [piece()] })]])
    renderPage({ sources: 'keep' })
    expect(screen.getByTestId('campaign-status-c1')).toHaveTextContent('Approved')
    for (const k of ['risk', 'client', 'unassigned']) expect(screen.queryByTestId(`campaign-alert-${k}-c1`)).toBeNull()
    expect(screen.queryByTestId('campaign-task-lists-c1')).toBeNull()
  })

  // ADR-0067 d.3
  it('keeps drafts out of the campaigns table — one has no stream, no deliverables and no brief', () => {
    listState.data = [draft('d1', 'Half-written brief')]
    listState.isLoading = false
    renderPage()
    // Not in the live table at all; listing it there would make that table lie.
    expect(screen.queryByTestId('campaigns-cards')).not.toBeInTheDocument()
    expect(screen.getByTestId('campaigns-drafts')).toBeInTheDocument()
    expect(screen.getByTestId('campaign-draft-row-d1')).toHaveTextContent('Half-written brief')
  })

  it('does not show the empty state when the only thing there is a draft', () => {
    listState.data = [draft('d1', 'Half-written brief')]
    renderPage()
    expect(screen.queryByTestId('campaigns-empty')).not.toBeInTheDocument()
  })

  it('offers to continue a draft where it was left', () => {
    listState.data = [draft('d1', 'Half-written brief')]
    renderPage()
    expect(screen.getByTestId('campaign-draft-resume-d1')).toHaveAttribute(
      'href',
      '/campaigns/new?draft=d1',
    )
  })

  it('arms discard before doing it — a draft is somebody\'s unfinished work', () => {
    discardMutate.mockReset()
    listState.data = [draft('d1', 'Half-written brief')]
    renderPage()
    const button = screen.getByTestId('campaign-draft-discard-d1')
    fireEvent.click(button)
    expect(discardMutate).not.toHaveBeenCalled()
    fireEvent.click(button)
    expect(discardMutate).toHaveBeenCalledWith('d1', expect.anything())
  })

  it('explains a refused discard rather than repeating it', () => {
    // The database refuses once documents are filed under the draft (d.7): the cascade would
    // take them with it. That is a sentence, not something to retry.
    discardMutate.mockReset().mockImplementation((_id, opts) =>
      opts?.onError?.(Object.assign(new Error('nope'), { code: '23514' })),
    )
    listState.data = [draft('d1', 'Half-written brief')]
    renderPage()
    fireEvent.click(screen.getByTestId('campaign-draft-discard-d1'))
    fireEvent.click(screen.getByTestId('campaign-draft-discard-d1'))
    expect(screen.getByTestId('campaigns-banner')).toHaveTextContent('documents filed against it')
  })
})

/**
 * SJ-A2 (ADR-0086 d.9–d.11): Promote is a row action for single jobs only, one-way, said before
 * the press; it opens the existing builder at Strategy.
 */
describe('CampaignsPage — promote a single job (ADR-0086)', () => {
  it('offers Promote on a single job and nothing of the kind on a campaign', () => {
    listState.data = [
      { ...draft('job1', 'Ramadan teaser posts'), status: 'approved', kind: 'single_job' },
      { ...draft('cmp1', 'Zeta Ramadan'), status: 'approved' },
    ]
    listState.isLoading = false
    renderPage()
    fireEvent.click(screen.getByTestId('campaign-menu-job1'))
    expect(screen.getByTestId('campaign-promote-job1')).toBeInTheDocument()
    expect(screen.getByTestId('campaign-kind-job1')).toHaveTextContent('Single job')
    fireEvent.click(screen.getByTestId('campaign-menu-cmp1'))
    expect(screen.queryByTestId('campaign-promote-cmp1')).toBeNull()
    expect(screen.queryByTestId('campaign-kind-cmp1')).toBeNull()
  })

  it('says it is one-way before promoting, then opens a RELEASED job as the campaign it now is', () => {
    promoteMutate.mockClear()
    navigateMock.mockClear()
    listState.data = [{ ...draft('job1', 'Ramadan teaser posts'), status: 'approved', kind: 'single_job' }]
    renderPage()
    fireEvent.click(screen.getByTestId('campaign-menu-job1'))
    fireEvent.click(screen.getByTestId('campaign-promote-job1'))
    expect(promoteMutate).not.toHaveBeenCalled()
    expect(screen.getByTestId('campaign-promote-detail')).toHaveTextContent(/cannot be undone/i)
    fireEvent.click(screen.getByTestId('campaign-promote-confirm'))
    expect(promoteMutate).toHaveBeenCalledWith('job1', expect.anything())
    // ADR-0086 addendum: the wizard resumes drafts only, so a released job lands on its own page.
    expect(navigateMock).toHaveBeenCalledWith('/campaigns/job1')
  })

  // ADR-0085 d.8: a job left unreleased is a draft, picked up in its own flow rather than the builder.
  it('resumes a single job draft in the single-job flow, and a campaign draft in the builder', () => {
    listState.data = [
      { ...draft('job1', 'Ramadan teaser posts'), kind: 'single_job' },
      draft('d1', 'Half-written brief'),
    ]
    renderPage()
    expect(screen.getByTestId('campaign-draft-resume-job1')).toHaveAttribute('href', '/campaigns/new-job?job=job1')
    expect(screen.getByTestId('campaign-draft-resume-d1')).toHaveAttribute('href', '/campaigns/new?draft=d1')
  })

  it('offers to continue a single job whose release stopped half-way', () => {
    listState.data = [{ ...draft('job1', 'Ramadan teaser posts'), status: 'pending_approval', kind: 'single_job' }]
    renderPage()
    expect(screen.getByTestId('campaign-job-continue-job1')).toHaveAttribute('href', '/campaigns/new-job?job=job1')
  })

  // I48 (C), carried onto the card: a single job's unapproved task list is the same badge.
  it('shows a single job\'s unapproved task list as the badge, and nothing once it is approved', () => {
    listState.data = [
      { ...draft('j1', 'Statics'), status: 'approved', kind: 'single_job' },
      { ...draft('j2', 'Statics'), status: 'approved', kind: 'single_job' },
    ]
    pulseState.data = new Map([
      ['j1', source('j1', { pieces: [piece({ taskListApprovedAt: null, tasks: [task()] })] })],
      ['j2', source('j2', { pieces: [piece({ tasks: [task()] })] })],
    ])
    renderPage({ sources: 'keep' })
    expect(screen.getByTestId('campaign-task-lists-j1')).toHaveTextContent('1 task list to approve')
    expect(screen.queryByTestId('campaign-task-lists-j2')).toBeNull()
  })

  // I48.1 — search over name / brand / client (I57.3 adds pieces and people, tested below).
  it('filters the list by the search box, over name, brand and client', () => {
    listState.data = [
      { ...draft('c1', 'Ramadan teaser'), status: 'approved', clientName: 'Zeta', brandName: 'Zeta KW' },
      { ...draft('c2', 'Eid film'), status: 'approved', clientName: 'Kite Card', brandName: null },
    ]
    renderPage()
    fireEvent.change(screen.getByTestId('campaigns-search'), { target: { value: 'kite' } })
    expect(screen.queryByTestId('campaign-row-c1')).toBeNull()
    expect(screen.getByTestId('campaign-row-c2')).toBeInTheDocument()
    // A search that matches nothing says so, without the empty-product CTA.
    fireEvent.change(screen.getByTestId('campaigns-search'), { target: { value: 'zzz' } })
    expect(screen.getByTestId('campaigns-no-matches')).toBeInTheDocument()
    expect(screen.queryByTestId('campaigns-empty')).toBeNull()
  })

  // I48.3 / I48.9 — Actions carries Open always, and Close out on an approved campaign.
  it('gives every row an Open action and closes out an approved campaign', () => {
    listState.data = [{ ...draft('c1', 'Ramadan teaser'), status: 'approved' }]
    renderPage()
    expect(screen.getByTestId('campaign-action-open-c1')).toHaveAttribute('href', '/campaigns/c1')
    fireEvent.click(screen.getByTestId('campaign-menu-c1'))
    fireEvent.click(screen.getByTestId('campaign-close-out-c1'))
    expect(closeOutMutate).toHaveBeenCalledWith('c1', expect.anything())
  })

  // ADR-0091 d.5 — closed campaigns leave the active list until the toggle brings them back.
  it('hides closed campaigns by default and reveals them with the toggle, offering Reopen', () => {
    listState.data = [
      { ...draft('c1', 'Ramadan teaser'), status: 'approved' },
      { ...draft('c2', 'Finished'), status: 'closed' },
    ]
    renderPage()
    expect(screen.queryByTestId('campaign-row-c2')).toBeNull()
    fireEvent.click(screen.getByTestId('campaigns-show-closed'))
    expect(screen.getByTestId('campaign-row-c2')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('campaign-menu-c2'))
    fireEvent.click(screen.getByTestId('campaign-reopen-c2'))
    expect(reopenMutate).toHaveBeenCalledWith('c2', expect.anything())
  })
})

describe('CampaignsPage — Mine and All, and the filters (CG-00, I57.3)', () => {
  const rows = (): CampaignListRow[] => [
    { ...draft('mine1', 'LUMA Season 2'), status: 'approved', clientName: 'Kite', accountManagerName: 'Inas' },
    { ...draft('theirs', 'Eid banner set'), status: 'approved', clientName: 'Auracell', accountManagerName: 'Rowan' },
  ]

  it('opens on Mine and shows All with one press', () => {
    listState.data = rows()
    pulseState.data = new Map([['mine1', source('mine1')], ['theirs', source('theirs', { accountManagerId: 'rowan' })]])
    renderPage({ sources: 'keep' })
    expect(screen.getByTestId('campaigns-scope-mine')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('campaign-row-mine1')).toBeInTheDocument()
    expect(screen.queryByTestId('campaign-row-theirs')).toBeNull()
    fireEvent.click(screen.getByTestId('campaigns-scope-all'))
    expect(screen.getByTestId('campaign-row-theirs')).toBeInTheDocument()
  })

  it('Mine counts a campaign I hold a task on, not only the ones I manage', () => {
    listState.data = rows()
    pulseState.data = new Map([
      ['mine1', source('mine1', { accountManagerId: 'inas' })],
      ['theirs', source('theirs', { accountManagerId: 'rowan', pieces: [piece({ tasks: [task({ status: 'in_progress', assigneeId: 'me' })] })] })],
    ])
    renderPage({ sources: 'keep' })
    expect(screen.getByTestId('campaign-row-theirs')).toBeInTheDocument()
    expect(screen.queryByTestId('campaign-row-mine1')).toBeNull()
  })

  it('an empty Mine shows All and says so in one line — never an empty page', () => {
    listState.data = rows()
    pulseState.data = new Map([['mine1', source('mine1', { accountManagerId: 'x' })], ['theirs', source('theirs', { accountManagerId: 'y' })]])
    renderPage({ sources: 'keep' })
    expect(screen.getByTestId('campaigns-mine-fallback')).toBeInTheDocument()
    expect(screen.getByTestId('campaign-row-mine1')).toBeInTheDocument()
    expect(screen.getByTestId('campaign-row-theirs')).toBeInTheDocument()
  })

  it('filters by client, account manager and status', () => {
    listState.data = [...rows(), { ...draft('pending', 'Borderless Card'), status: 'pending_approval', clientName: 'Kite', accountManagerName: 'Inas' }]
    renderPage()
    fireEvent.change(screen.getByTestId('campaigns-filter-client'), { target: { value: 'Auracell' } })
    expect(screen.getByTestId('campaign-row-theirs')).toBeInTheDocument()
    expect(screen.queryByTestId('campaign-row-mine1')).toBeNull()
    fireEvent.change(screen.getByTestId('campaigns-filter-client'), { target: { value: '' } })
    fireEvent.change(screen.getByTestId('campaigns-filter-am'), { target: { value: 'Inas' } })
    expect(screen.queryByTestId('campaign-row-theirs')).toBeNull()
    fireEvent.change(screen.getByTestId('campaigns-filter-status'), { target: { value: 'pending_approval' } })
    expect(screen.getByTestId('campaign-row-pending')).toBeInTheDocument()
    expect(screen.queryByTestId('campaign-row-mine1')).toBeNull()
  })

  it('the smart search finds a campaign by a piece code', () => {
    listState.data = rows()
    pulseState.data = new Map([['mine1', source('mine1', { searchText: 'da-017 week 2 explainer' })], ['theirs', source('theirs')]])
    renderPage({ sources: 'keep' })
    fireEvent.click(screen.getByTestId('campaigns-scope-all'))
    fireEvent.change(screen.getByTestId('campaigns-search'), { target: { value: 'DA-017' } })
    expect(screen.getByTestId('campaign-row-mine1')).toBeInTheDocument()
    expect(screen.queryByTestId('campaign-row-theirs')).toBeNull()
  })

  it('closes the card menu on Escape', () => {
    listState.data = rows()
    renderPage()
    fireEvent.click(screen.getByTestId('campaign-menu-mine1'))
    expect(screen.getByTestId('campaign-close-out-mine1')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('campaign-close-out-mine1')).toBeNull()
  })
})
