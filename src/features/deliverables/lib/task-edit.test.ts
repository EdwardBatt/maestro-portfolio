import { describe, expect, it } from 'vitest'
import { draftProblem, isSuggestedTask, mayEditTasks, planTaskSave, rebaseDraft, stepHours, taskRefusal, type TaskDraft } from './task-edit'

const base: TaskDraft = {
  title: 'Create artwork',
  notes: '',
  hours: 6,
  assigneeId: null,
  from: null,
  to: null,
  waitsFor: [],
  reviewers: [],
  reviewMode: 'digital',
}
const held: TaskDraft = { ...base, assigneeId: 'zubaida', from: '2026-09-29', to: '2026-09-29', reviewers: [{ userId: 'inas', isMandatory: true }] }

describe('planTaskSave (ADR-0140 d.1–d.5)', () => {
  it('nothing changed is nothing to send', () => {
    expect(planTaskSave(held, { ...held }).nothing).toBe(true)
  })

  it('a rename of an unheld task goes through save_sub_task alone', () => {
    const p = planTaskSave(base, { ...base, title: 'Create artwork — chime' })
    expect(p).toMatchObject({ unassign: false, assign: false, rematerialise: false })
    expect(p.plain.title).toBe(true)
  })

  it('days of an unheld task are a plan, saved directly', () => {
    const p = planTaskSave(base, { ...base, from: '2026-10-01', to: '2026-10-01' })
    expect(p.assign).toBe(false)
    expect(p.plain.days).toBe(true)
  })

  it('a person picked goes the assignment way, with the title and hours riding along', () => {
    const p = planTaskSave(base, { ...held, title: 'New name', hours: 8 })
    expect(p.assign).toBe(true)
    expect(p.plain).toMatchObject({ title: false, hours: false, days: false })
  })

  it('moving the days of a held task goes the assignment way (it may become a request)', () => {
    const p = planTaskSave(held, { ...held, to: '2026-10-01' })
    expect(p.assign).toBe(true)
  })

  it('the notes always go through save_sub_task — the assignment path has none', () => {
    const p = planTaskSave(held, { ...held, notes: 'Arabic leads', from: '2026-09-30', to: '2026-09-30' })
    expect(p.assign).toBe(true)
    expect(p.plain.notes).toBe(true)
  })

  it('hours alone on a held task save directly and are placed again', () => {
    const p = planTaskSave(held, { ...held, hours: 4 })
    expect(p).toMatchObject({ assign: false, rematerialise: true })
    expect(p.plain.hours).toBe(true)
  })

  it('clearing the person unassigns first', () => {
    const p = planTaskSave(held, { ...held, assigneeId: null })
    expect(p.unassign).toBe(true)
    expect(p.assign).toBe(false)
  })

  it('waits-for is diffed edge by edge', () => {
    const p = planTaskSave({ ...base, waitsFor: ['a', 'b'] }, { ...base, waitsFor: ['b', 'c'] })
    expect(p.addDeps).toEqual(['c'])
    expect(p.removeDeps).toEqual(['a'])
    expect(p.nothing).toBe(false)
  })
})

describe('draftProblem', () => {
  it('a name is required', () => {
    expect(draftProblem(base, { ...base, title: '  ' }, true)).toBe('title')
  })
  it('a held task needs its days and a reviewer', () => {
    expect(draftProblem(base, { ...held, from: null }, true)).toBe('dates')
    expect(draftProblem(base, { ...held, reviewers: [] }, true)).toBe('reviewer')
    expect(draftProblem(base, { ...held, reviewers: [{ userId: 'inas', isMandatory: false }, { userId: 'f', isMandatory: false }] }, true)).toBe('reviewerRequired')
  })
  it('nobody is given out before the list is approved', () => {
    expect(draftProblem(base, held, false)).toBe('notApproved')
    expect(draftProblem(held, { ...held, hours: 3 }, false)).toBeNull()
  })
  it('a good draft passes', () => {
    expect(draftProblem(base, held, true)).toBeNull()
  })
})

describe('taskRefusal', () => {
  it('reads the started hint with the person in DETAIL', () => {
    expect(taskRefusal({ hint: 'task_started', details: 'Zubaida Jamil' })).toEqual({ kind: 'started', name: 'Zubaida Jamil' })
  })
  it('reads not_assigned and unassign_task', () => {
    expect(taskRefusal({ hint: 'not_assigned' })).toEqual({ kind: 'notAssigned' })
    expect(taskRefusal({ hint: 'unassign_task' })).toEqual({ kind: 'notYours' })
  })
  it('anything else is not the editor’s to answer', () => {
    expect(taskRefusal({ hint: 'remove_task' })).toBeNull()
    expect(taskRefusal(null)).toBeNull()
  })
})

describe('stepHours', () => {
  it('never goes under half an hour', () => {
    expect(stepHours(1, -1)).toBe(0.5)
    expect(stepHours(null, 1)).toBe(1)
  })
})

describe('rebaseDraft (test script step 14)', () => {
  it('takes the fresh task and keeps only what the user changed from what was loaded', () => {
    const loaded = base
    const draft = { ...base, hours: 8 }
    const next = rebaseDraft(loaded, draft, { ...held, hours: 2 })
    expect(next).toEqual({ ...held, hours: 8 })
    // measured against the fresh task, nothing is taken off
    expect(planTaskSave({ ...held, hours: 2 }, next).unassign).toBe(false)
  })
  it('a stale draft measured against the fresh task would have taken the person off', () => {
    expect(planTaskSave(held, base).unassign).toBe(true)
  })
  it('keeps the user’s person and days together', () => {
    const draft = { ...base, assigneeId: 'fadia', from: '2026-10-01', to: '2026-10-01' }
    expect(rebaseDraft(base, draft, held)).toMatchObject({ assigneeId: 'fadia', from: '2026-10-01', to: '2026-10-01', reviewers: held.reviewers })
  })
})

describe('isSuggestedTask (test script step 1)', () => {
  it('a workflow step is suggested', () => {
    expect(isSuggestedTask({ workflowStepId: 'ws1', title: 'Write Copy — Northwind' })).toBe(true)
  })
  it('so is the translation task the languages rule adds, though it has no workflow step', () => {
    expect(isSuggestedTask({ workflowStepId: null, title: 'Translation — Northwind Summer Launch (Arabic, English)' })).toBe(true)
  })
  it('a task somebody added is not', () => {
    expect(isSuggestedTask({ workflowStepId: null, title: 'Extra retouch' })).toBe(false)
  })
})

describe('mayEditTasks (I74.53, ADR-0140 d.2)', () => {
  const grants = (...g: string[]) => (k: string) => g.includes(k)
  const lead = grants('project_tasks:manage', 'bookings:create')
  it('the owner edits, whatever her role', () => {
    expect(mayEditTasks({ isOwner: true, scope: 'self', can: grants() })).toBe(true)
  })
  it('Traffic and the Power Admin edit (tenant reach)', () => {
    expect(mayEditTasks({ isOwner: false, scope: 'tenant', can: lead })).toBe(true)
  })
  it('a lead who books edits (the server decides her reach)', () => {
    expect(mayEditTasks({ isOwner: false, scope: 'team', can: lead })).toBe(true)
    expect(mayEditTasks({ isOwner: false, scope: 'department', can: lead })).toBe(true)
  })
  it('the account manager does not, though she holds both grants', () => {
    expect(mayEditTasks({ isOwner: false, scope: 'account', can: lead })).toBe(false)
  })
  it('a team member (no booking) does not', () => {
    expect(mayEditTasks({ isOwner: false, scope: 'self', can: grants('project_tasks:manage') })).toBe(false)
  })
})
