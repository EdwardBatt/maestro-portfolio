import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../lib/i18n'

const saveMutate = vi.hoisted(() => vi.fn())
const createMutate = vi.hoisted(() => vi.fn())
const assignMutate = vi.hoisted(() => vi.fn())
const defaultMutate = vi.hoisted(() => vi.fn())
const templates = vi.hoisted(() => ({ data: [] as unknown[], isError: false, error: null as unknown }))
const departments = vi.hoisted(() => ({ data: [] as { id: string; name: string }[] }))

// Self-contained factory: the real module reaches lib/supabase → lib/env, which Zod-parses
// import.meta.env at import time and throws when the VITE_ vars are absent. They are absent
// in CI (docs/memory/traps.md).
vi.mock('./api/brief-templates-api', () => ({
  useBriefTemplates: () => templates,
  useSaveBriefTemplate: () => ({ mutate: saveMutate, isPending: false }),
  useCreateBriefTemplate: () => ({ mutate: createMutate, isPending: false }),
  useSetDepartmentTemplate: () => ({ mutate: assignMutate, isPending: false }),
  useSetDefaultDepartmentBrief: () => ({ mutate: defaultMutate, isPending: false }),
  // Pure; reproduced rather than re-imported for the reason above.
  slugForBriefType: (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60),
}))
vi.mock('./api/admin-api', () => ({ useDepartments: () => departments }))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ claims: { tenantId: 't1' } }) }))

import { BriefTemplatesPage } from './BriefTemplatesPage'

const TEMPLATE = {
  id: 't1',
  briefType: '360',
  nameEn: 'Creative Brief',
  nameAr: 'بريف إبداعي — حملات ٣٦٠',
  descriptionEn: 'The campaign brief — the season in one line.',
  descriptionAr: 'بريف الحملة — الموسم في سطر واحد.',
  departments: [{ id: 'dep-creative', name: 'Creative', isDefault: false }],
  isActive: true,
  fields: [
    { key: 'background', en: 'Background', ar: 'الخلفية', guidance: 'Where is the brand today?', multiline: true },
    { key: 'task', en: 'The Task', ar: 'المهمة', guidance: 'One sentence.', multiline: true },
  ],
}
const EMPTY_TEMPLATE = {
  id: 't2', briefType: 'custom', nameEn: 'Custom Brief', nameAr: null,
  descriptionEn: null, descriptionAr: null,
  departments: [], isActive: true, fields: [],
}

describe('Admin → Brief templates (ADR-0048 d.2)', () => {
  beforeEach(() => {
    saveMutate.mockReset()
    createMutate.mockReset()
    assignMutate.mockReset()
    defaultMutate.mockReset()
    templates.data = [TEMPLATE, EMPTY_TEMPLATE]
    templates.isError = false
    templates.error = null
    departments.data = [{ id: 'dep-creative', name: 'Creative' }, { id: 'dep-finance', name: 'Finance' }]
  })

  it('no longer offers a discipline → template mapping', () => {
    // ADR-0053 d.9: the mapping read and wrote `work_types.brief_type`, which never existed, so
    // the table on this screen could only ever fail. The brief type is chosen per department on
    // the campaign now. The table must be gone, not merely empty.
    render(<BriefTemplatesPage />)
    expect(screen.queryByTestId('brief-template-mappings')).not.toBeInTheDocument()
  })

  it('marks a template with no fields as unselectable in the wizard', () => {
    // ADR-0048 d.2: Edward's four new types are seeded empty and must be authored. A type that
    // silently generated an empty brief would look broken, so absence is made visible.
    render(<BriefTemplatesPage />)
    expect(screen.getByTestId('brief-template-empty-custom')).toBeInTheDocument()
    expect(screen.queryByTestId('brief-template-empty-360')).not.toBeInTheDocument()
  })

  it('warns that guidance is instruction to the model, not copy', () => {
    render(<BriefTemplatesPage />)
    expect(screen.getByText(/read by the model/i)).toBeInTheDocument()
  })

  it('edits a field and saves the whole ordered list', () => {
    render(<BriefTemplatesPage />)
    fireEvent.click(screen.getByTestId('brief-template-edit-360'))
    fireEvent.change(screen.getByTestId('brief-template-field-guidance-background'), {
      target: { value: 'Where is the brand RIGHT NOW?' },
    })
    fireEvent.click(screen.getByTestId('brief-template-save'))

    expect(saveMutate).toHaveBeenCalledTimes(1)
    const [arg] = saveMutate.mock.calls[0]!
    expect(arg.id).toBe('t1')
    // Order is the form order (d.2), so the whole list goes back, not a patch.
    expect(arg.fields.map((f: { key: string }) => f.key)).toEqual(['background', 'task'])
    expect(arg.fields[0].guidance).toBe('Where is the brand RIGHT NOW?')
  })

  // I49.81 (A): the editor could relabel and remove and nothing else, so a template created on
  // this screen stayed at zero fields for ever. Now a field is added by its labels; the key it is
  // stored under comes from the English label and is shown before it is added.
  it('adds a field, keyed from its English label, and saves it with the rest', () => {
    render(<BriefTemplatesPage />)
    fireEvent.click(screen.getByTestId('brief-template-edit-360'))
    fireEvent.change(screen.getByTestId('brief-template-field-new-en'), { target: { value: 'Target audience' } })
    expect(screen.getByTestId('brief-template-field-new-key').textContent).toBe('target_audience')
    fireEvent.change(screen.getByTestId('brief-template-field-new-ar'), { target: { value: 'الجمهور المستهدف' } })
    fireEvent.change(screen.getByTestId('brief-template-field-new-guidance'), { target: { value: 'Who, in one line.' } })
    fireEvent.click(screen.getByTestId('brief-template-field-add'))
    expect(screen.getByTestId('brief-template-field-en-target_audience')).toHaveValue('Target audience')
    expect(screen.getByTestId('brief-template-field-new-en')).toHaveValue('')
    fireEvent.click(screen.getByTestId('brief-template-save'))
    const [arg] = saveMutate.mock.calls[0]!
    expect(arg.fields.map((f: { key: string }) => f.key)).toEqual(['background', 'task', 'target_audience'])
    expect(arg.fields[2]).toMatchObject({ en: 'Target audience', ar: 'الجمهور المستهدف', guidance: 'Who, in one line.' })
  })

  it('refuses a second field with the same key, in words', () => {
    render(<BriefTemplatesPage />)
    fireEvent.click(screen.getByTestId('brief-template-edit-360'))
    fireEvent.change(screen.getByTestId('brief-template-field-new-en'), { target: { value: 'Background' } })
    fireEvent.click(screen.getByTestId('brief-template-field-add'))
    expect(screen.getByTestId('brief-template-field-add-error').textContent).toMatch(/background/)
    expect(screen.getAllByTestId(/^brief-template-field-en-/)).toHaveLength(2)
  })

  it('cannot add a field with no English label', () => {
    render(<BriefTemplatesPage />)
    fireEvent.click(screen.getByTestId('brief-template-edit-360'))
    expect(screen.getByTestId('brief-template-field-add')).toBeDisabled()
  })

  it('removes a field without disturbing the rest of the order', () => {
    render(<BriefTemplatesPage />)
    fireEvent.click(screen.getByTestId('brief-template-edit-360'))
    fireEvent.click(screen.getByTestId('brief-template-field-remove-background'))
    fireEvent.click(screen.getByTestId('brief-template-save'))

    const [arg] = saveMutate.mock.calls[0]!
    expect(arg.fields.map((f: { key: string }) => f.key)).toEqual(['task'])
  })
})

/**
 * The three things this screen could not do until 30 Aug (I16.2/I16.4).
 *
 * A template had no NAME of its own — the titles were i18n keys, which cannot exist for a template
 * a tenant creates, and read "360 Campaign" where the agency's own deck says **Creative Brief**.
 * There was no way to create one. And nothing said which department writes from which, so
 * `generate-brief` had no field list to work from and had never been called at all.
 *
 * Edward: *"this is a multitenant system… not everyone uses the same org structure and names their
 * departments differently."* So the assignment is data the tenant sets, never inferred from a name.
 */
describe('Admin → Brief templates — naming, creating, assigning (30 Aug)', () => {
  // The name appears in the list AND in the assignment dropdown, which is the point — one name for
  // the thing, wherever it is read.
  it('shows each template’s own name, not a translation key', () => {
    render(<BriefTemplatesPage />)
    expect(screen.getAllByText('Creative Brief').length).toBeGreaterThan(0)
    expect(screen.queryByText('campaigns.briefType.360')).toBeNull()
  })

  it('lists the departments that write from a template', () => {
    render(<BriefTemplatesPage />)
    expect(screen.getByTestId('brief-template-departments-360').textContent).toContain('Creative')
  })

  // A template nobody writes from is a normal state, and says so rather than showing a blank cell.
  it('says so when nobody writes from one', () => {
    render(<BriefTemplatesPage />)
    expect(screen.getByTestId('brief-template-departments-custom').textContent).toMatch(/none/i)
  })

  it('creates a template from a name', () => {
    render(<BriefTemplatesPage />)
    fireEvent.change(screen.getByTestId('brief-template-new-name'), { target: { value: 'Event Brief' } })
    fireEvent.click(screen.getByTestId('brief-template-new-submit'))
    expect(createMutate.mock.calls[0][0]).toMatchObject({ nameEn: 'Event Brief', tenantId: 't1' })
  })

  // I49.81 (B): a new template may start from another one's fields.
  it("creates a template from another template's fields when asked", () => {
    render(<BriefTemplatesPage />)
    fireEvent.change(screen.getByTestId('brief-template-new-name'), { target: { value: 'Event Brief' } })
    fireEvent.change(screen.getByTestId('brief-template-new-copy'), { target: { value: 't1' } })
    fireEvent.click(screen.getByTestId('brief-template-new-submit'))
    const [arg] = createMutate.mock.calls.at(-1)!
    expect(arg.fields.map((f: { key: string }) => f.key)).toEqual(['background', 'task'])
  })

  it('offers only templates that have fields to start from', () => {
    render(<BriefTemplatesPage />)
    const options = Array.from(screen.getByTestId('brief-template-new-copy').querySelectorAll('option')).map((o) => o.value)
    expect(options).toContain('t1')
    expect(options).not.toContain('t-custom')
  })

  it('will not create one with no name', () => {
    render(<BriefTemplatesPage />)
    expect(screen.getByTestId('brief-template-new-submit')).toBeDisabled()
  })

  // The question is asked from the TEMPLATE's side — "who writes from the Production brief?" —
  // because that is how somebody thinks about it, and because several departments can share one.
  it('lists every department as a checklist under a template', () => {
    render(<BriefTemplatesPage />)
    fireEvent.click(screen.getByTestId('brief-template-assign-open-360'))
    expect(screen.getByTestId('brief-template-assign-360-dep-creative')).toBeChecked()
    expect(screen.getByTestId('brief-template-assign-360-dep-finance')).not.toBeChecked()
  })

  // THE assertion. Two departments on ONE template is the case that a single dropdown per
  // department could express but a single choice per template could not.
  it('lets a second department share the same template', () => {
    assignMutate.mockReset()
    render(<BriefTemplatesPage />)
    fireEvent.click(screen.getByTestId('brief-template-assign-open-360'))
    fireEvent.click(screen.getByTestId('brief-template-assign-360-dep-finance'))
    expect(assignMutate.mock.calls[0][0]).toMatchObject({
      departmentId: 'dep-finance', briefTemplateId: 't1', allowed: true,
    })
  })

  // Unticking is a real action: a department that should no longer generate briefs says so.
  it('clears a department back to no template', () => {
    assignMutate.mockReset()
    render(<BriefTemplatesPage />)
    fireEvent.click(screen.getByTestId('brief-template-assign-open-360'))
    fireEvent.click(screen.getByTestId('brief-template-assign-360-dep-creative'))
    expect(assignMutate.mock.calls[0][0]).toMatchObject({
      departmentId: 'dep-creative', briefTemplateId: 't1', allowed: false,
    })
  })

  // THE case the first attempt could not express. Creative may use the Creative Brief AND the
  // Execution Brief; adding the second must not take the first away, so ticking here is additive
  // and the row simply notes how many others that department already uses.
  it('adds a brief to a department that already has one, rather than replacing it', () => {
    assignMutate.mockReset()
    render(<BriefTemplatesPage />)
    fireEvent.click(screen.getByTestId('brief-template-assign-open-custom'))
    fireEvent.click(screen.getByTestId('brief-template-assign-custom-dep-creative'))
    expect(assignMutate.mock.calls[0][0]).toMatchObject({
      departmentId: 'dep-creative', briefTemplateId: 't2', allowed: true,
    })
  })

  it('notes how many other briefs a department already uses', () => {
    render(<BriefTemplatesPage />)
    fireEvent.click(screen.getByTestId('brief-template-assign-open-custom'))
    expect(screen.getByTestId('brief-template-assign-row-custom').textContent).toMatch(/also uses/i)
  })
})

/**
 * A failed read is not an empty list (30 Aug).
 *
 * An ambiguous embed made PostgREST reject the whole select, `data` came back undefined, and the
 * screen rendered a table with no rows — eleven templates apparently gone, with nothing said. The
 * two states must never look alike.
 */
describe('Admin → Brief templates — a failed read says so', () => {
  it('reports the failure instead of showing an empty list', () => {
    templates.isError = true
    templates.error = new Error('could not embed departments')
    render(<BriefTemplatesPage />)
    expect(screen.getByTestId('brief-templates-load-failed')).toBeInTheDocument()
    expect(screen.getByTestId('brief-templates-load-failed-reason').textContent)
      .toContain('could not embed departments')
    expect(screen.queryByTestId('brief-templates')).toBeNull()
  })

  // A PostgREST failure is a plain object with a `message`, not an Error. `String(e)` on one
  // renders "[object Object]", which is how this screen reported its own outage and said nothing.
  it('reads the message off a PostgREST error object, which is not an Error', () => {
    templates.isError = true
    templates.error = { code: 'PGRST201', message: 'could not embed because more than one relationship was found' }
    render(<BriefTemplatesPage />)
    expect(screen.getByTestId('brief-templates-load-failed-reason').textContent)
      .toContain('more than one relationship')
  })

  it('shows the list normally when the read worked', () => {
    templates.isError = false
    templates.error = null
    render(<BriefTemplatesPage />)
    expect(screen.queryByTestId('brief-templates-load-failed')).toBeNull()
    expect(screen.getByTestId('brief-templates')).toBeInTheDocument()
  })
})

/**
 * A department's DEFAULT brief (I40.19).
 *
 * Edward, 6 Sep: *"before all these changes were made, selecting a campaign was automatic… why is
 * it asking me to select?"* It was automatic because a department had exactly one template, on a
 * column dropped the same day it was added so Creative could hold a second brief. This is that
 * answer restored as a setting: the department writes its default without being asked, and the
 * campaign page's picker goes back to being the override it was meant to be.
 */
describe('Admin → Brief templates — a department’s default brief (6 Sep)', () => {
  // Creative may write BOTH, which is the only situation where a default means anything.
  const CREATIVE_ON_BOTH = {
    ...TEMPLATE,
    departments: [{ id: 'dep-creative', name: 'Creative', isDefault: true }],
  }
  const SECOND_FOR_CREATIVE = {
    id: 't2', briefType: 'custom', nameEn: 'Custom Brief', nameAr: null,
    departments: [{ id: 'dep-creative', name: 'Creative', isDefault: false }],
    isActive: true, fields: [],
  }

  beforeEach(() => {
    defaultMutate.mockReset()
    templates.data = [CREATIVE_ON_BOTH, SECOND_FOR_CREATIVE]
    departments.data = [{ id: 'dep-creative', name: 'Creative' }, { id: 'dep-finance', name: 'Finance' }]
  })

  // "Which brief does Creative actually use?" is what this screen is opened to answer, and a bare
  // list of department names never answered it.
  it('says which department writes this brief by default', () => {
    render(<BriefTemplatesPage />)
    expect(screen.getByTestId('brief-template-departments-360')).toHaveTextContent(/Creative \(Default\)/i)
    expect(screen.getByTestId('brief-template-departments-custom')).not.toHaveTextContent(/Default/i)
  })

  it('sets the default from the template the department should normally write', () => {
    render(<BriefTemplatesPage />)
    fireEvent.click(screen.getByTestId('brief-template-assign-open-custom'))
    fireEvent.click(screen.getByTestId('brief-template-default-custom-dep-creative'))
    expect(defaultMutate).toHaveBeenCalledWith(
      { departmentId: 'dep-creative', briefTemplateId: 't2' },
      expect.anything(),
    )
  })

  // Clearing is a real request: a department may go back to being asked on every campaign.
  it('clears the default from the template that currently holds it', () => {
    render(<BriefTemplatesPage />)
    fireEvent.click(screen.getByTestId('brief-template-assign-open-360'))
    expect(screen.getByTestId('brief-template-is-default-360-dep-creative')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('brief-template-default-360-dep-creative'))
    expect(defaultMutate).toHaveBeenCalledWith(
      { departmentId: 'dep-creative', briefTemplateId: null },
      expect.anything(),
    )
  })

  // A department with one brief already writes it without being asked, so offering to make it the
  // default would be offering to change nothing.
  it('offers no default where the department has nothing to choose between', () => {
    templates.data = [
      { ...TEMPLATE, departments: [{ id: 'dep-finance', name: 'Finance', isDefault: false }] },
    ]
    render(<BriefTemplatesPage />)
    fireEvent.click(screen.getByTestId('brief-template-assign-open-360'))
    expect(screen.queryByTestId('brief-template-default-360-dep-finance')).toBeNull()
  })
})


describe('Admin → Brief templates — a template is renamed and described (I54.3, 23 Sep)', () => {
  beforeEach(() => {
    saveMutate.mockReset()
    createMutate.mockReset()
    templates.data = [TEMPLATE, EMPTY_TEMPLATE]
    templates.isError = false
    templates.error = null
    departments.data = [{ id: 'dep-creative', name: 'Creative' }]
  })

  // ---- I54.3: a template's NAME and DESCRIPTION, both languages -----------------
  // Until 23 Sep this screen wrote `fields` alone: a template took its English name at creation
  // and could never be renamed, had no Arabic name, and no description ever — and the description
  // is the line each card shows on the first screen of the single-job flow.

  it('renames a template in both languages and saves the description with it', () => {
    render(<BriefTemplatesPage />)
    fireEvent.click(screen.getByTestId('brief-template-edit-360'))
    fireEvent.change(screen.getByTestId('brief-template-name-en'), { target: { value: 'Campaign Brief' } })
    fireEvent.change(screen.getByTestId('brief-template-name-ar'), { target: { value: 'بريف الحملة' } })
    fireEvent.change(screen.getByTestId('brief-template-description-en'), { target: { value: 'The whole season.' } })
    fireEvent.change(screen.getByTestId('brief-template-description-ar'), { target: { value: 'الموسم كله.' } })
    fireEvent.click(screen.getByTestId('brief-template-save'))

    const [arg] = saveMutate.mock.calls[0]!
    expect(arg).toMatchObject({
      id: 't1',
      nameEn: 'Campaign Brief',
      nameAr: 'بريف الحملة',
      descriptionEn: 'The whole season.',
      descriptionAr: 'الموسم كله.',
    })
    // The field list still rides along — renaming must not drop the edit beside it.
    expect(arg.fields.map((f: { key: string }) => f.key)).toEqual(['background', 'task'])
  })

  // Edward, 23 Sep: "all templates can be renamed" — the twelve seeded ones included. It is safe
  // because `brief_type`, the key a written brief stores itself under, is derived once at creation
  // and is not touched here.
  it('offers the rename on a seeded template, and never sends its key', () => {
    render(<BriefTemplatesPage />)
    fireEvent.click(screen.getByTestId('brief-template-edit-360'))
    expect(screen.getByTestId('brief-template-name-en')).toHaveValue('Creative Brief')
    fireEvent.change(screen.getByTestId('brief-template-name-en'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByTestId('brief-template-save'))
    const [arg] = saveMutate.mock.calls[0]!
    expect(arg).not.toHaveProperty('briefType')
    expect(arg).not.toHaveProperty('brief_type')
  })

  // An empty Arabic box means "there is none", which the read falls back to English for. A blank
  // string would defeat that fallback and render an empty card.
  it('sends an empty Arabic name as nothing, not as an empty string', () => {
    render(<BriefTemplatesPage />)
    fireEvent.click(screen.getByTestId('brief-template-edit-custom'))
    fireEvent.change(screen.getByTestId('brief-template-name-ar'), { target: { value: '   ' } })
    fireEvent.click(screen.getByTestId('brief-template-save'))
    expect(saveMutate.mock.calls[0]![0].nameAr).toBeNull()
  })

  it('will not save a template with its name emptied', () => {
    render(<BriefTemplatesPage />)
    fireEvent.click(screen.getByTestId('brief-template-edit-360'))
    fireEvent.change(screen.getByTestId('brief-template-name-en'), { target: { value: '  ' } })
    expect(screen.getByTestId('brief-template-save')).toBeDisabled()
  })

  // Both languages, always (Edward, 23 Sep). A template created with an English name only used to
  // show that name to an Arabic reader for ever.
  it('takes an Arabic name when a template is created', () => {
    render(<BriefTemplatesPage />)
    fireEvent.change(screen.getByTestId('brief-template-new-name'), { target: { value: 'Event Brief' } })
    fireEvent.change(screen.getByTestId('brief-template-new-name-ar'), { target: { value: 'بريف الفعاليات' } })
    fireEvent.click(screen.getByTestId('brief-template-new-submit'))
    expect(createMutate.mock.calls[0][0]).toMatchObject({ nameEn: 'Event Brief', nameAr: 'بريف الفعاليات' })
  })
})
