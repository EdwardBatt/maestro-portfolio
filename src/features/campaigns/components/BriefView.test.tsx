import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../../lib/i18n'
import type { DeliverableRow } from '../../deliverables/api/deliverables-api'
import type { WorkPhase } from '../../../lib/deliverables/work-phase'
import type { CampaignDetail } from '../api/campaign-detail-api'

const m = vi.hoisted(() => ({ updateBrief: vi.fn(), saveBrief: vi.fn() }))

// The apis reach lib/supabase → lib/env, which throws where no VITE_* exists (traps.md).
vi.mock('../api/campaign-detail-api', () => ({
  useUpdateCampaignBrief: () => ({ mutate: m.updateBrief, isPending: false }),
  useUpdateSingleJobBrief: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../api/brief-ingest-api', () => ({
  useIngestBrief: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../api/department-briefs-api', () => ({
  masterBriefText: (b: Record<string, string>) => Object.values(b).join(', '),
  useSaveDepartmentBrief: () => ({ mutate: m.saveBrief, isPending: false }),
}))
vi.mock('../../deliverables/DeliverablesPage', () => ({
  failed: (_e: unknown, text: string) => ({ kind: 'error', text }),
}))
vi.mock('./GenerateDeliverablesDialog', () => ({
  GenerateDeliverablesDialog: () => <div data-testid="campaign-generate-dialog" />,
}))
vi.mock('./BriefApproval', () => ({
  BriefApproval: ({ testId }: { testId: string }) => <div data-testid={testId} />,
}))
vi.mock('./ConceptsPanel', () => ({
  ConceptsPanel: ({ briefId }: { briefId: string }) => <div data-testid={`concepts-panel-stub-${briefId}`} />,
}))

import { BriefView, type BriefViewProps } from './BriefView'

const TODAY = Date.parse('2026-09-24T09:00:00Z')

const FULL = {
  background: 'Season 1 proved the mechanic.',
  task: 'Make the mechanic obvious.',
  beautifulProblem: 'People trust the prize.',
  audiencePrimary: 'Iraq · 18–34',
  brandFunctionalBenefit: 'Every purchase is a ticket.',
  insight: 'The chime is a ticket.',
  proposition: 'Every chime is a ticket.',
}

const CAMPAIGN: CampaignDetail = {
  id: 'cam1', name: 'LUMA Season 2', status: 'approved', kind: 'campaign', clientId: 'cli', clientName: 'Kite', brandName: 'LUMA',
  accountManagerId: 'me', clientAccountManagerId: null, accountManagerName: 'Inas', clientAccountManagerName: null,
  createdAt: '2026-09-10T08:00:00Z', updatedAt: '2026-09-20T08:00:00Z', createdByName: 'Inas', updatedByName: 'Inas',
  approvedAt: '2026-09-11T08:00:00Z', goLiveAt: null, hasPhases: true, briefType: null,
  brief: { ...FULL }, briefs: [], promotedJob: null,
}

const piece = (over: Partial<DeliverableRow> & { phase?: WorkPhase } = {}): DeliverableRow => {
  const { phase = 'in_progress', ...rest } = over
  return {
    id: 'd1', name: 'Piece', state: 'in_progress', dueAt: '2099-01-01T15:00:00Z', revisionRound: 0, revisionLimit: null,
    streamId: 's', streamName: null, taskCount: 1, unassignedCount: 0, typeName: null, ownerUserId: null, ownerName: null,
    progress: { phase, total: 1, unassigned: 0, done: 0, everTotal: 1, inReview: 0, inProgress: 0, notStarted: 0 }, assigneeNames: [], assignerNames: [],
    blockingReviewers: { names: [], allRequired: false }, discipline: 'Creative', departmentId: 'dep-c', campaignId: 'cam1',
    approvedVersion: null, tasksApprovedAt: null, tasksApprovedBy: null, canApproveTasks: false, campaignKind: 'campaign',
    workstreamId: null, phaseId: null, code: null, taskList: [],
    ...rest,
  } as DeliverableRow
}

const renderView = (props: Partial<BriefViewProps> = {}) => {
  const all: BriefViewProps = {
    campaign: CAMPAIGN, templateFields: {}, pieces: [], workstreams: [], phases: [],
    mayEdit: true, canManageProjects: true, canSeeBudget: true,
    onOpenPiece: vi.fn(), onEditPiece: null, onBanner: vi.fn(), today: TODAY, ...props,
  }
  const view = render(<MemoryRouter><BriefView {...all} /></MemoryRouter>)
  return { props: all, view }
}

beforeEach(() => { m.updateBrief.mockReset(); m.saveBrief.mockReset() })

describe('BriefView — CG-07, the brief and what it produced (I57.7)', () => {
  it('heads the brief with its field count, approval and last edit, and the parts count what is written', () => {
    renderView()
    expect(screen.getByTestId('campaign-panel-brief')).toHaveAttribute('role', 'tabpanel')
    expect(screen.getByTestId('campaign-master-brief-details')).toHaveAttribute('open')
    expect(screen.getByTestId('brief-view-fields-tag')).toHaveTextContent(/Creative brief · 9 fields/i)
    expect(screen.getByTestId('brief-view-approved-tag')).toHaveTextContent(/Approved · .*11 Sep/)
    expect(screen.getByTestId('brief-part-count-context')).toHaveTextContent('3 of 3')
    expect(screen.getByTestId('brief-part-count-audience')).toHaveTextContent('2 of 4')
    expect(screen.getByTestId('campaign-master-brief')).toHaveTextContent('Every chime is a ticket.')
    expect(screen.getByTestId('campaign-master-brief-task')).toHaveTextContent('Make the mechanic obvious.')
  })

  it('marks an unwritten field EMPTY, and the callout names every empty field', () => {
    renderView()
    expect(screen.getByTestId('campaign-master-brief-empty-audienceSecondary')).toHaveTextContent(/empty/i)
    expect(screen.getByTestId('campaign-master-brief-audienceSecondary')).toHaveTextContent('Not written yet')
    expect(screen.getByTestId('brief-empty-callout')).toHaveTextContent('2 fields are empty')
    expect(screen.getByTestId('brief-empty-fields')).toHaveTextContent('Audience — secondary and Brand — emotional benefit')
    expect(screen.getByTestId('brief-itself-filled')).toHaveTextContent('7 of 9')
  })

  it('"Fill them in" starts the edit; Save writes the whole brief back', () => {
    const { props } = renderView()
    fireEvent.click(screen.getByTestId('brief-empty-fill'))
    fireEvent.change(screen.getByTestId('campaign-master-brief-field-audienceSecondary'), { target: { value: 'Parents' } })
    fireEvent.click(screen.getByTestId('campaign-master-brief-save'))
    expect(m.updateBrief).toHaveBeenCalledWith(
      { campaignId: 'cam1', brief: expect.objectContaining({ audienceSecondary: 'Parents', task: 'Make the mechanic obvious.' }) },
      expect.anything(),
    )
    m.updateBrief.mock.calls[0][1].onSuccess()
    expect(props.onBanner).toHaveBeenCalledWith({ kind: 'ok', text: expect.any(String) })
  })

  it('Edit and Cancel: nothing is saved', () => {
    renderView()
    fireEvent.click(screen.getByTestId('campaign-brief-edit'))
    fireEvent.change(screen.getByTestId('campaign-master-brief-field-proposition'), { target: { value: 'Never saved.' } })
    fireEvent.click(screen.getByTestId('campaign-master-brief-cancel'))
    expect(m.updateBrief).not.toHaveBeenCalled()
    expect(screen.getByTestId('campaign-master-brief')).not.toHaveTextContent('Never saved.')
  })

  it('offers no Edit, Generate or Fill to someone who may not edit — the callout still says what is missing', () => {
    renderView({ mayEdit: false })
    expect(screen.queryByTestId('campaign-brief-actions')).toBeNull()
    expect(screen.queryByTestId('campaign-brief-edit')).toBeNull()
    expect(screen.queryByTestId('campaign-generate-deliverables')).toBeNull()
    expect(screen.queryByTestId('brief-empty-fill')).toBeNull()
    expect(screen.getByTestId('brief-empty-callout')).toBeInTheDocument()
  })

  it('Generate opens the dialog', () => {
    renderView()
    fireEvent.click(screen.getByTestId('campaign-generate-deliverables'))
    expect(screen.getByTestId('campaign-generate-dialog')).toBeInTheDocument()
  })

  it('no callout when every field is written; N/A reads as a considered answer', () => {
    renderView({ campaign: { ...CAMPAIGN, brief: { ...FULL, audienceSecondary: 'Parents', brandEmotionalBenefit: 'N/A' } } })
    expect(screen.queryByTestId('brief-empty-callout')).toBeNull()
    expect(screen.getByTestId('campaign-master-brief-brandEmotionalBenefit')).toHaveTextContent('Not applicable')
  })

  it('shows the performance flight only when the campaign has one', () => {
    const { view } = renderView()
    expect(screen.queryByTestId('campaign-perf-heading')).toBeNull()
    view.unmount()
    renderView({ campaign: { ...CAMPAIGN, brief: { ...FULL, perfObjective: 'Downloads', perfBudget: 'IQD 90m' } } })
    expect(screen.getByTestId('campaign-perf-heading')).toBeInTheDocument()
    expect(screen.getByTestId('campaign-perf-brief-perfBudget')).toHaveTextContent('IQD 90m')
  })

  it('hides the budget from someone without campaign_budget:view, and an edit keeps it untouched', () => {
    renderView({ canSeeBudget: false, campaign: { ...CAMPAIGN, brief: { ...FULL, perfObjective: 'Downloads', perfBudget: 'IQD 90m' } } })
    expect(screen.getByTestId('campaign-perf-brief')).toBeInTheDocument()
    expect(screen.queryByTestId('campaign-perf-brief-perfBudget')).toBeNull()
    expect(screen.getByTestId('campaign-panel-brief')).not.toHaveTextContent('IQD 90m')
    fireEvent.click(screen.getByTestId('campaign-brief-edit'))
    expect(screen.queryByTestId('campaign-master-brief-field-perfBudget')).toBeNull()
    fireEvent.click(screen.getByTestId('campaign-master-brief-save'))
    expect(m.updateBrief.mock.calls[0][0].brief.perfBudget).toBe('IQD 90m')
  })

  it('the rail: what it produced, by workstream, one square per piece that opens the drawer', () => {
    const onOpenPiece = vi.fn()
    renderView({
      onOpenPiece,
      workstreams: [{ id: 'w1', name: 'Design & Creative', ownerName: null }],
      pieces: [
        piece({ id: 'a', workstreamId: 'w1', state: 'delivered', phase: 'delivered' }),
        piece({ id: 'b', workstreamId: 'w1' }),
        piece({ id: 'z', workstreamId: 'w1', state: 'archived' }),
      ],
    })
    expect(screen.getByTestId('brief-itself-inherited')).toHaveTextContent('2 deliverables · 1 workstream')
    expect(screen.getByTestId('brief-produced-line-w1')).toHaveTextContent('1 of 2 delivered')
    expect(screen.getByTestId('brief-produced-w1')).toContainElement(screen.getByTestId('season-square-a'))
    expect(screen.queryByTestId('season-square-z')).toBeNull()
    fireEvent.click(screen.getByTestId('season-square-b'))
    expect(onOpenPiece).toHaveBeenCalledWith('b')
  })

  it("shows a campaign's retired department briefs read only; concepts stay off the page", () => {
    renderView({
      campaign: { ...CAMPAIGN, briefs: [{ id: 'b1', departmentId: 'dep-c', departmentName: 'Creative', briefType: '360', values: { objective: 'Reach' }, approvedAt: '2026-09-12T08:00:00Z', approvedByName: 'Lina' }] },
      pieces: [piece({ id: 'a', departmentId: 'dep-c', discipline: 'Creative' })],
    })
    expect(screen.getByTestId('campaign-department-dep-c')).toHaveTextContent('Creative')
    expect(screen.getByTestId('campaign-department-brief-dep-c')).toHaveTextContent('Reach')
    expect(screen.getByTestId('campaign-brief-approval-dep-c')).toBeInTheDocument()
    expect(screen.queryByTestId('campaign-department-brief-dep-c-edit')).toBeNull()
    expect(screen.queryByTestId('concepts-panel-stub-b1')).toBeNull()
  })

  it('a single job: no master brief, its one brief keeps its edit', () => {
    renderView({
      campaign: { ...CAMPAIGN, kind: 'single_job', briefs: [{ id: 'b1', departmentId: 'dep-c', departmentName: 'Creative', briefType: '360', values: { objective: 'Reach' }, approvedAt: null, approvedByName: null }] },
    })
    expect(screen.queryByTestId('campaign-master-brief-details')).toBeNull()
    expect(screen.queryByTestId('brief-view-rail')).toBeNull()
    fireEvent.click(screen.getByTestId('campaign-department-brief-dep-c-edit'))
    fireEvent.change(screen.getByTestId('campaign-department-brief-dep-c-input-objective'), { target: { value: 'Reach more' } })
    fireEvent.click(screen.getByTestId('campaign-department-brief-dep-c-save'))
    expect(m.saveBrief).toHaveBeenCalledWith(expect.objectContaining({ briefId: 'b1', values: { objective: 'Reach more' } }), expect.anything())
  })
})
