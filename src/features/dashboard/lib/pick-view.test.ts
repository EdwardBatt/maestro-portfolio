import { describe, expect, it } from 'vitest'
import type { RoleScope } from '../../../app/permissions'
import { pickView } from './pick-view'

const viewer = (scope: RoleScope | null, grants: string[] = []) => ({ scope, can: (k: string) => grants.includes(k) })

describe('pickView (ADR-0122 d.2)', () => {
  it('the Power Admin — may change roles', () => {
    expect(pickView(viewer('tenant', ['roles:manage', 'projects:manage', 'health:view']))).toBe('admin')
  })

  it('Traffic — whole company and may run the work', () => {
    expect(pickView(viewer('tenant', ['projects:manage']))).toBe('traffic')
  })

  it('Traffic holding every permission except changing roles stays on Traffic (Edward, 28 Sep)', () => {
    expect(pickView(viewer('tenant', ['projects:manage', 'health:view', 'admin.roles:view']))).toBe('traffic')
  })

  it('C-Level — whole company, health, read-only; the CEO’s admin viewing grant does not make them the admin', () => {
    expect(pickView(viewer('tenant', ['health:view', 'admin.roles:view', 'admin.users:view']))).toBe('clevel')
  })

  it('Client Services — every account (the Director) and my accounts (the Account Manager)', () => {
    expect(pickView(viewer('all_accounts', ['projects:manage']))).toBe('director')
    expect(pickView(viewer('account', ['projects:manage']))).toBe('account')
  })

  it('Department Lead and Team Lead (a deputy is team-scoped too)', () => {
    expect(pickView(viewer('department', ['projects:manage']))).toBe('department')
    expect(pickView(viewer('team', ['project_tasks:manage']))).toBe('team')
  })

  it('everyone else — self, unknown, or a tenant role with neither grant — is a Team Member', () => {
    expect(pickView(viewer('self', ['my_tasks:view']))).toBe('member')
    expect(pickView(viewer(null))).toBe('member')
    expect(pickView(viewer('tenant', ['schedule:view']))).toBe('member')
  })
})
