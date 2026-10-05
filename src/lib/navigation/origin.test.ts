import { beforeEach, describe, expect, it } from 'vitest'
import { backTarget, labelFor, previousPath, recordVisit, resetOrigin, withOrigin } from './origin'

const FALLBACK = { path: '/campaigns', labelKey: 'back.campaignsBare' as const }
const here = (pathname: string, state: unknown = null) => ({ pathname, state })

/** ADR-0132 d.7 (I68.9): Back names and returns to the page a person came from, as they left it. */
describe('origin', () => {
  beforeEach(() => resetOrigin())

  it('names the page by where it is', () => {
    expect(labelFor('/team?tab=timeline&on=2026-09-27')).toBe('back.team')
    expect(labelFor('/my-work')).toBe('back.myWork')
    expect(labelFor('/my-work/task/t1')).toBe('back.task')
    expect(labelFor('/schedule?days=14')).toBe('back.schedule')
    expect(labelFor('/dashboard')).toBe('back.dashboard')
    expect(labelFor('/campaigns?scope=all&client=Kite')).toBe('back.campaigns')
    expect(labelFor('/deliverables?campaign=c1')).toBe('back.deliverables')
    expect(labelFor('/library')).toBe('back.generic')
  })

  it('returns to the page before, with the query it was left on', () => {
    recordVisit('/team?tab=timeline&on=2026-09-27')
    // The campaign page's first render: the shell has not recorded it yet.
    expect(backTarget(here('/campaigns/c1'), FALLBACK, previousPath('/campaigns/c1')))
      .toEqual({ path: '/team?tab=timeline&on=2026-09-27', labelKey: 'back.team' })
    // After the shell records it, the answer is the same.
    recordVisit('/campaigns/c1?piece=d1&task=t1')
    expect(backTarget(here('/campaigns/c1'), FALLBACK, previousPath('/campaigns/c1')).path).toBe('/team?tab=timeline&on=2026-09-27')
  })

  it('does not make a page its own origin when only its query changes', () => {
    recordVisit('/my-work')
    recordVisit('/campaigns/c1?piece=d1')
    recordVisit('/campaigns/c1?piece=d2')
    recordVisit('/campaigns/c1?tab=board&piece=d2')
    expect(backTarget(here('/campaigns/c1'), FALLBACK, previousPath('/campaigns/c1'))).toEqual({ path: '/my-work', labelKey: 'back.myWork' })
  })

  it('prefers an origin a link names itself', () => {
    recordVisit('/team')
    const state = withOrigin('/schedule?days=14')
    expect(backTarget(here('/campaigns/c1', state), FALLBACK, previousPath('/campaigns/c1'))).toEqual({ path: '/schedule?days=14', labelKey: 'back.schedule' })
  })

  it('skips the form a job was created on, back to the page the form was opened from (I68.18)', () => {
    recordVisit('/my-work')
    recordVisit('/campaigns/new-job')
    // The new job's first render, then after the shell records it.
    expect(backTarget(here('/campaigns/j1'), FALLBACK, previousPath('/campaigns/j1'))).toEqual({ path: '/my-work', labelKey: 'back.myWork' })
    recordVisit('/campaigns/j1')
    expect(backTarget(here('/campaigns/j1'), FALLBACK, previousPath('/campaigns/j1'))).toEqual({ path: '/my-work', labelKey: 'back.myWork' })
  })

  it('falls back when the creation form was the first page (a new tab)', () => {
    recordVisit('/campaigns/new')
    recordVisit('/campaigns/c1')
    expect(backTarget(here('/campaigns/c1'), FALLBACK, previousPath('/campaigns/c1'))).toEqual(FALLBACK)
  })

  it('falls back when there is no page before (an email link, a new tab)', () => {
    expect(backTarget(here('/campaigns/c1'), FALLBACK, previousPath('/campaigns/c1'))).toEqual(FALLBACK)
  })
})
