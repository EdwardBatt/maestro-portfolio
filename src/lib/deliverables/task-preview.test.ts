import { describe, expect, it } from 'vitest'
import { composeTaskTitle, previewTasks, type PreviewStep } from './task-preview'

// The template the seed gives a Static Post, in shape: three ordinary steps and one creation step.
const STEPS: PreviewStep[] = [
  { templateId: 'tpl-static', sortOrder: 30, titleEn: 'Develop Concept', titleAr: 'تطوير المفهوم', isActive: true },
  { templateId: 'tpl-static', sortOrder: 10, titleEn: 'Creative Direction', isActive: true },
  { templateId: 'tpl-static', sortOrder: 40, titleEn: 'Create Asset', repeatsPerUnit: true, isActive: true },
  { templateId: 'tpl-static', sortOrder: 20, titleEn: 'Write Strategy', isActive: true },
  { templateId: 'tpl-static', sortOrder: 50, titleEn: 'Retired step', isActive: false },
  { templateId: 'tpl-other', sortOrder: 10, titleEn: 'Storyboard', isActive: true },
]
const NW = 'Northwind Summer Launch'

describe('previewTasks — what the materialiser will write, before it does (ADR-0071 addendum, 4 Oct)', () => {
  it('names the campaign on every task, and the type and unit on the creation step', () => {
    expect(previewTasks(STEPS, { templateId: 'tpl-static', campaign: NW, typeName: 'Static Post', quantity: 3 })).toEqual([
      'Creative Direction — Northwind Summer Launch',
      'Write Strategy — Northwind Summer Launch',
      'Develop Concept — Northwind Summer Launch',
      'Create Asset — Northwind Summer Launch · Static Post 1',
      'Create Asset — Northwind Summer Launch · Static Post 2',
      'Create Asset — Northwind Summer Launch · Static Post 3',
    ])
  })

  it('a quantity of one puts no number on the creation step', () => {
    const list = previewTasks(STEPS, { templateId: 'tpl-static', campaign: NW, typeName: 'Billboard', quantity: 1 })
    expect(list).toContain('Create Asset — Northwind Summer Launch · Billboard')
    expect(list).toHaveLength(4)
  })

  it('leaves out retired steps and other templates\' steps', () => {
    const list = previewTasks(STEPS, { templateId: 'tpl-static', campaign: 'X', typeName: null, quantity: 1 })
    expect(list.some((t) => t.startsWith('Retired'))).toBe(false)
    expect(list.some((t) => t.startsWith('Storyboard'))).toBe(false)
  })

  it('a type with no template previews nothing, and a blank campaign name gets no dash', () => {
    expect(previewTasks(STEPS, { templateId: null, campaign: 'X', typeName: null, quantity: 2 })).toEqual([])
    expect(previewTasks(STEPS, { templateId: 'tpl-static', campaign: '  ', typeName: null, quantity: 1 })[0]).toBe('Creative Direction')
  })

  it('reads the Arabic step title where there is one', () => {
    const list = previewTasks(STEPS, { templateId: 'tpl-static', campaign: 'حملة', typeName: null, quantity: 1 }, 'ar')
    expect(list).toContain('تطوير المفهوم — حملة')
    expect(list).toContain('Creative Direction — حملة')   // no Arabic title: the English stands
  })
})

describe('composeTaskTitle — app.compose_task_title, exactly', () => {
  it('the three shapes', () => {
    expect(composeTaskTitle('Creative Direction', NW, 'Static Post', null, 6)).toBe('Creative Direction — Northwind Summer Launch')
    expect(composeTaskTitle('Create Artwork', NW, 'Static Post', 6, 6)).toBe('Create Artwork — Northwind Summer Launch · Static Post 6')
    expect(composeTaskTitle('Create Artwork', NW, 'Billboard', 1, 1)).toBe('Create Artwork — Northwind Summer Launch · Billboard')
  })
  it('no type: the number alone; at quantity 1 nothing after the campaign', () => {
    expect(composeTaskTitle('Create Artwork', NW, null, 2, 3)).toBe('Create Artwork — Northwind Summer Launch · 2')
    expect(composeTaskTitle('Create Artwork', NW, null, 1, 1)).toBe('Create Artwork — Northwind Summer Launch')
  })
})
