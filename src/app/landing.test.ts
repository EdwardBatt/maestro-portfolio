import { describe, expect, it } from 'vitest'
import { landingRoute } from './landing'

describe('landingRoute (I66.7)', () => {
  it("lands on the role's page", () => {
    expect(landingRoute('/my-work', new Set(['my_tasks:view']))).toBe('/my-work')
    expect(landingRoute('/portal', new Set())).toBe('/portal')
    expect(landingRoute('/schedule', new Set(['schedule:view']))).toBe('/schedule')
  })
  it('sends anyone who cannot open My Work to the Dashboard', () => {
    expect(landingRoute('/my-work', new Set(['health:view']))).toBe('/dashboard')
    expect(landingRoute(null, new Set())).toBe('/dashboard')
  })
  it('My Work opens on either of its two grants, as the route asks', () => {
    expect(landingRoute('/my-work', new Set(['my_calendar:view']))).toBe('/my-work')
  })
})
