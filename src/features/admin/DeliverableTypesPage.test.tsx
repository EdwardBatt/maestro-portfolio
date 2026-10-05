import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../lib/i18n'
import type { AttributeValue, DeliverableCategory, DeliverableType } from './api/deliverable-types-api'
import type { WorkflowTemplate } from './api/workflow-templates-api'

/**
 * Admin → Deliverable types (ADR-0051 I18.4, extended by ADR-0052 I19.11).
 *
 * This suite starts at the gap it was written for. `deliverable_types.default_workflow_template_id`
 * is the field `app.materialise_deliverable_workflow` reads to decide which task list a type
 * implies — and from 28 Aug until I19.11 **nothing could write it**. All 240 seeded types held
 * null, so choosing a type on a deliverable created no tasks, and the whole of I19 was inert.
 *
 * pgTAP `065` passed throughout, because its own fixture set that field before exercising the
 * engine. The test that would have caught this is the one below: can a type be given a template
 * from the interface at all.
 */
const state = vi.hoisted(() => ({
  types: [] as DeliverableType[],
  categories: [] as DeliverableCategory[],
  attributes: [] as AttributeValue[],
  templates: [] as WorkflowTemplate[],
  setTemplate: vi.fn(),
  saveType: vi.fn(),
}))

vi.mock('./api/deliverable-types-api', () => ({
  useDeliverableTypes: () => ({ data: state.types, isLoading: false, isError: false }),
  useDeliverableCategories: () => ({ data: state.categories, isLoading: false, isError: false }),
  useAttributeValues: () => ({ data: state.attributes, isLoading: false, isError: false }),
  useSaveDeliverableType: () => ({ mutate: state.saveType, isPending: false }),
  useCreateDeliverableType: () => ({ mutate: vi.fn(), isPending: false }),
  useSaveAttributeValue: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateAttributeValue: () => ({ mutate: vi.fn(), isPending: false }),
  taxonomyKeys: { types: ['deliverable-types'], categories: ['x'], attributes: ['y'] },
}))

vi.mock('./api/workflow-templates-api', () => ({
  useWorkflowTemplates: () => ({ data: state.templates, isLoading: false, isError: false }),
  useSetTypeWorkflowTemplate: () => ({ mutate: state.setTemplate, isPending: false }),
}))

vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ claims: { tenantId: 't1' } }) }))

import { DeliverableTypesPage } from './DeliverableTypesPage'

const TYPE = (o: Partial<DeliverableType> & { id: string; code: string }): DeliverableType => ({
  categoryCode: 'SOC', nameEn: 'Reel', nameAr: null, isActive: true,
  leadTimeHours: null, defaultLoadPct: null, revisionLimit: null,
  defaultWorkflowTemplateId: null, ...o,
})

const render_ = () => render(<MemoryRouter><DeliverableTypesPage /></MemoryRouter>)

describe('DeliverableTypesPage — the workflow join (I19.11)', () => {
  beforeEach(() => {
    state.types = [TYPE({ id: 't-soc-004', code: 'SOC-004' })]
    state.categories = [
      { id: 'c-soc', code: 'SOC', nameEn: 'Social Media', nameAr: null, sortOrder: 10, isActive: true },
    ]
    state.attributes = []
    state.templates = [
      { id: 'w1', code: 'WF-02', nameEn: 'Social Content', nameAr: null, descriptionEn: null, descriptionAr: null, isSystem: true, isActive: true },
      { id: 'w9', code: 'WF-09', nameEn: 'Retired', nameAr: null, descriptionEn: null, descriptionAr: null, isSystem: true, isActive: false },
    ]
    state.setTemplate = vi.fn()
    state.saveType = vi.fn()
  })

  it('offers a workflow template on every type', () => {
    render_()
    expect(screen.getByTestId('type-workflow-SOC-004')).toBeInTheDocument()
  })

  it('sets the template that decides the task list — the field nothing could write', () => {
    render_()
    fireEvent.change(screen.getByTestId('type-workflow-SOC-004'), { target: { value: 'w1' } })
    expect(state.setTemplate).toHaveBeenCalledWith(
      { typeId: 't-soc-004', templateId: 'w1' },
      expect.anything(),
    )
  })

  it('clears it back to no task list, which is a legal and permanent state', () => {
    state.types = [TYPE({ id: 't-soc-004', code: 'SOC-004', defaultWorkflowTemplateId: 'w1' })]
    render_()
    fireEvent.change(screen.getByTestId('type-workflow-SOC-004'), { target: { value: '' } })
    expect(state.setTemplate).toHaveBeenCalledWith(
      { typeId: 't-soc-004', templateId: null },
      expect.anything(),
    )
  })

  it('offers only ACTIVE templates — a switched-off one is not a choice', () => {
    render_()
    const opts = Array.from(screen.getByTestId('type-workflow-SOC-004').querySelectorAll('option'))
    expect(opts.map((o) => o.textContent)).toEqual([
      expect.stringMatching(/No task list/i),
      expect.stringContaining('WF-02'),
    ])
  })

  // The number that would have made the gap visible on day one: 0 of 240.
  it('states how many types actually produce a task list', () => {
    state.types = [
      TYPE({ id: 'a', code: 'SOC-004', defaultWorkflowTemplateId: 'w1' }),
      TYPE({ id: 'b', code: 'SOC-005' }),
      TYPE({ id: 'c', code: 'VID-008' }),
    ]
    render_()
    expect(screen.getByTestId('type-template-coverage')).toHaveTextContent('1 of 3')
  })

  it('counts across the whole taxonomy, not the filtered view', () => {
    // Otherwise searching for one row would report "1 of 1" and hide that the rest are unset.
    state.types = [
      TYPE({ id: 'a', code: 'SOC-004', defaultWorkflowTemplateId: 'w1' }),
      TYPE({ id: 'b', code: 'VID-008', categoryCode: 'VID' }),
    ]
    render_()
    fireEvent.change(screen.getByTestId('type-search'), { target: { value: 'SOC' } })
    expect(screen.getByTestId('type-template-coverage')).toHaveTextContent('1 of 2')
  })
})
