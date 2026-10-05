import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '../../lib/i18n'
import type { WorkflowStep, WorkflowTemplate } from './api/workflow-templates-api'

/**
 * Admin → Workflow templates (ADR-0052, I19.12).
 *
 * This screen exists because the 14 seeded templates and their 154 steps had no surface at all —
 * nothing in `src/` read either table. The api module reaches lib/env (throws in CI), so it is
 * mocked; what is asserted here is only what the SURFACE decides.
 */
const state = vi.hoisted(() => ({
  templates: [] as WorkflowTemplate[],
  steps: [] as WorkflowStep[],
  saveTemplate: vi.fn(),
  createTemplate: vi.fn(),
  saveStep: vi.fn(),
  createStep: vi.fn(),
  resequence: vi.fn(),
  deleteStep: vi.fn(),
}))

vi.mock('./api/workflow-templates-api', () => ({
  useWorkflowTemplates: () => ({ data: state.templates, isLoading: false, isError: false }),
  useWorkflowSteps: () => ({ data: state.steps, isLoading: false, isError: false }),
  useSaveWorkflowTemplate: () => ({ mutate: state.saveTemplate, isPending: false }),
  useCreateWorkflowTemplate: () => ({ mutate: state.createTemplate, isPending: false }),
  useSaveWorkflowStep: () => ({ mutate: state.saveStep, isPending: false }),
  useCreateWorkflowStep: () => ({ mutate: state.createStep, isPending: false }),
  useResequenceWorkflowSteps: () => ({ mutate: state.resequence, isPending: false }),
  useDeleteWorkflowStep: () => ({ mutate: state.deleteStep, isPending: false }),
}))

vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ claims: { tenantId: 't1' } }),
}))

import { WorkflowTemplatesPage } from './WorkflowTemplatesPage'

const TPL = (o: Partial<WorkflowTemplate> & { id: string; code: string }): WorkflowTemplate => ({
  nameEn: 'Social Content', nameAr: null, descriptionEn: null, descriptionAr: null,
  isSystem: true, isActive: true, ...o,
})
const STEP = (o: Partial<WorkflowStep> & { id: string; templateId: string; sortOrder: number }): WorkflowStep => ({
  titleEn: 'Storyboard', titleAr: null, defaultHours: null, reviewMode: 'digital', isActive: true, ...o,
})

describe('WorkflowTemplatesPage (ADR-0052, I19.12)', () => {
  beforeEach(() => {
    state.templates = [TPL({ id: 'w1', code: 'WF-02' })]
    state.steps = [
      STEP({ id: 's1', templateId: 'w1', sortOrder: 1, titleEn: 'Concept' }),
      STEP({ id: 's2', templateId: 'w1', sortOrder: 2, titleEn: 'Design', defaultHours: 4 }),
      STEP({ id: 's3', templateId: 'w1', sortOrder: 3, titleEn: 'Copy' }),
    ]
    state.saveTemplate = vi.fn()
    state.createTemplate = vi.fn()
    state.saveStep = vi.fn()
    state.createStep = vi.fn()
    state.resequence = vi.fn()
    state.deleteStep = vi.fn()
  })

  it('lists the templates with their live step count', () => {
    render(<WorkflowTemplatesPage />)
    const row = screen.getByTestId('workflow-template-WF-02')
    expect(row).toHaveTextContent('WF-02')
    expect(row).toHaveTextContent('Social Content')
    expect(row).toHaveTextContent('3')
  })

  // A seeded row is marked, because a later seed refresh finds its own rows by that flag and an
  // admin renaming one is making a decision rather than fixing a typo.
  it('marks a seeded template as seeded', () => {
    render(<WorkflowTemplatesPage />)
    expect(screen.getByTestId('workflow-template-WF-02')).toHaveTextContent(/seeded/i)
  })

  it('opens a template to reveal its steps, in order', () => {
    render(<WorkflowTemplatesPage />)
    expect(screen.queryByTestId('workflow-steps-WF-02')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('workflow-open-WF-02'))
    const panel = screen.getByTestId('workflow-steps-WF-02')
    const items = within(panel).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Concept'),
      expect.stringContaining('Design'),
      expect.stringContaining('Copy'),
    ])
  })

  it('shows a step estimate as an estimate, never as an SLA', () => {
    // ADR-0052 d.4: default_hours is a prefill offered at assignment. It is deliberately never
    // written into sub_tasks.sla_hours, which is tier 1 of effective_sla and would short-circuit
    // every tier beneath it — so the surface must not imply it is a deadline.
    render(<WorkflowTemplatesPage />)
    fireEvent.click(screen.getByTestId('workflow-open-WF-02'))
    expect(screen.getByTestId('workflow-step-s2')).toHaveTextContent(/estimate/i)
  })

  it('reorders a step and hands over the whole list in its new order', () => {
    render(<WorkflowTemplatesPage />)
    fireEvent.click(screen.getByTestId('workflow-open-WF-02'))
    fireEvent.click(screen.getByTestId('workflow-step-down-s1'))
    expect(state.resequence).toHaveBeenCalledWith(
      { orderedIds: ['s2', 's1', 's3'] },
      expect.anything(),
    )
  })

  it('cannot move the first step up or the last one down', () => {
    render(<WorkflowTemplatesPage />)
    fireEvent.click(screen.getByTestId('workflow-open-WF-02'))
    expect(screen.getByTestId('workflow-step-up-s1')).toBeDisabled()
    expect(screen.getByTestId('workflow-step-down-s3')).toBeDisabled()
  })

  it('renames a step in both languages and keeps its estimate', () => {
    render(<WorkflowTemplatesPage />)
    fireEvent.click(screen.getByTestId('workflow-open-WF-02'))
    fireEvent.click(screen.getByTestId('workflow-step-edit-s2'))
    fireEvent.change(screen.getByTestId('workflow-step-edit-en'), { target: { value: 'Art Direction' } })
    fireEvent.change(screen.getByTestId('workflow-step-edit-ar'), { target: { value: 'الإخراج الفني' } })
    fireEvent.click(screen.getByTestId('workflow-step-save'))
    expect(state.saveStep).toHaveBeenCalledWith(
      { id: 's2', titleEn: 'Art Direction', titleAr: 'الإخراج الفني', defaultHours: 4, reviewMode: 'digital' },
      expect.anything(),
    )
  })

  // ADR-0059 d.2: the template says what a KIND of work usually needs. It is the one field on this
  // screen that changes what a person will be ASKED FOR later, so it is asserted rather than
  // assumed to have come along with the row.
  it('sets a step to manual review, for work that produces no file', () => {
    render(<WorkflowTemplatesPage />)
    fireEvent.click(screen.getByTestId('workflow-open-WF-02'))
    fireEvent.click(screen.getByTestId('workflow-step-edit-s2'))
    fireEvent.change(screen.getByTestId('workflow-step-edit-review-mode'), { target: { value: 'manual' } })
    fireEvent.click(screen.getByTestId('workflow-step-save'))
    expect(state.saveStep).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's2', reviewMode: 'manual' }),
      expect.anything(),
    )
  })

  // Only manual is labelled. Digital is what every step has always been, and marking the ones that
  // did not change would bury the ones that did.
  it('marks a manual step on the list and leaves a digital one unmarked', () => {
    state.steps = [
      STEP({ id: 's1', templateId: 'w1', sortOrder: 1, titleEn: 'Copy' }),
      STEP({ id: 's2', templateId: 'w1', sortOrder: 2, titleEn: 'Scheduling', reviewMode: 'manual' }),
    ]
    render(<WorkflowTemplatesPage />)
    fireEvent.click(screen.getByTestId('workflow-open-WF-02'))
    expect(screen.getByTestId('workflow-step-mode-s2')).toBeInTheDocument()
    expect(screen.queryByTestId('workflow-step-mode-s1')).toBeNull()
  })

  // Appended from the highest position that exists, not from the count: a template with a gap in
  // its ordering would otherwise collide on uq_workflow_steps_tenant_template_order.
  it('appends a new step after the highest position, not after the count', () => {
    state.steps = [
      STEP({ id: 's1', templateId: 'w1', sortOrder: 1 }),
      STEP({ id: 's9', templateId: 'w1', sortOrder: 9 }),
    ]
    render(<WorkflowTemplatesPage />)
    fireEvent.click(screen.getByTestId('workflow-open-WF-02'))
    fireEvent.change(screen.getByTestId('workflow-step-new-en'), { target: { value: 'Grade' } })
    fireEvent.click(screen.getByTestId('workflow-step-new-submit'))
    expect(state.createStep).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: 'w1', sortOrder: 10, titleEn: 'Grade' }),
      expect.anything(),
    )
  })

  it('warns that a template with no steps would create an empty task list', () => {
    state.steps = []
    render(<WorkflowTemplatesPage />)
    fireEvent.click(screen.getByTestId('workflow-open-WF-02'))
    expect(screen.getByTestId('workflow-no-steps')).toHaveTextContent(/empty task list/i)
  })

  // Edward, 29 Aug: "we can add steps but not remove them… to make this truly customisable we
  // should be able to edit the workflow templates." A template is a PLAN — nothing happened to it,
  // so an unwanted step is removed, not left switched off in the middle of a list being read.
  it('removes a step outright, after asking', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<WorkflowTemplatesPage />)
    fireEvent.click(screen.getByTestId('workflow-open-WF-02'))
    fireEvent.click(screen.getByTestId('workflow-step-remove-s2'))
    expect(confirm).toHaveBeenCalled()
    expect(state.deleteStep).toHaveBeenCalledWith('s2', expect.anything())
    confirm.mockRestore()
  })

  it('removes nothing if the question is declined', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<WorkflowTemplatesPage />)
    fireEvent.click(screen.getByTestId('workflow-open-WF-02'))
    fireEvent.click(screen.getByTestId('workflow-step-remove-s2'))
    expect(state.deleteStep).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('deactivates rather than deletes a template', () => {
    render(<WorkflowTemplatesPage />)
    fireEvent.click(screen.getByTestId('workflow-toggle-WF-02'))
    expect(state.saveTemplate).toHaveBeenCalledWith({ id: 'w1', isActive: false }, expect.anything())
  })

  it('adds a template without claiming it is a seeded one', () => {
    render(<WorkflowTemplatesPage />)
    fireEvent.change(screen.getByTestId('workflow-new-code'), { target: { value: 'wf-99' } })
    fireEvent.change(screen.getByTestId('workflow-new-name-en'), { target: { value: 'Podcast' } })
    fireEvent.submit(screen.getByTestId('workflow-add-form'))
    expect(state.createTemplate).toHaveBeenCalledWith(
      { tenantId: 't1', code: 'wf-99', nameEn: 'Podcast', nameAr: null },
      expect.anything(),
    )
    // is_system is never sent: it marks a row the seed owns, and this is not one.
    expect(Object.keys(state.createTemplate.mock.calls[0]![0] as object)).not.toContain('isSystem')
  })

  it('states the load failure rather than rendering an empty table', () => {
    state.templates = []
    render(<WorkflowTemplatesPage />)
    expect(screen.getByTestId('workflow-empty')).toBeInTheDocument()
  })
})
