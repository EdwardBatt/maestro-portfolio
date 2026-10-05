import { describe, expect, it } from 'vitest'
import { assignmentRoute, bookingRefusal, isPmBypassEligible, resourceInSchedulingScope, resourceInWriteScope, type WriteScopeContext } from './write-scope.ts'
import en from '../../../locales/en.json'

const DEPT = 'dept-1'
const OTHER_DEPT = 'dept-2'
const TEAM = 'team-1'
const OTHER_TEAM = 'team-2'

function ctx(over: Partial<WriteScopeContext> = {}): WriteScopeContext {
  return {
    scope: null,
    departmentId: null,
    teamId: null,
    scopeGrantDepartmentIds: new Set<string>(),
    scopeGrantTeamIds: new Set<string>(),
    ...over,
  }
}

const inDept = { departmentId: DEPT, teamId: null }
const inOtherDept = { departmentId: OTHER_DEPT, teamId: null }
const inTeam = { departmentId: DEPT, teamId: TEAM }
const teamOnly = { departmentId: null, teamId: TEAM }

describe('resourceInWriteScope — the client mirror of app.resource_in_write_scope', () => {
  it('denies everything before permissions load (scope null): fail-closed', () => {
    expect(resourceInWriteScope(inDept, ctx())).toBe(false)
    expect(resourceInWriteScope(teamOnly, ctx())).toBe(false)
  })

  it('tenant scope reaches every resource', () => {
    expect(resourceInWriteScope(inOtherDept, ctx({ scope: 'tenant' }))).toBe(true)
  })

  it('department scope reaches its own department and not another', () => {
    const c = ctx({ scope: 'department', departmentId: DEPT })
    expect(resourceInWriteScope(inDept, c)).toBe(true)
    expect(resourceInWriteScope(inOtherDept, c)).toBe(false)
  })

  it('team scope reaches its own team, and a team-less colleague in its own department (ADR-0070 d.3)', () => {
    const c = ctx({ scope: 'team', departmentId: DEPT, teamId: TEAM })
    expect(resourceInWriteScope(inTeam, c)).toBe(true)
    // a sibling team is still out of reach — the server's team branch requires the named team
    expect(resourceInWriteScope({ departmentId: DEPT, teamId: OTHER_TEAM }, c)).toBe(false)
    // a question that names no team is answered by the department the team sits in
    expect(resourceInWriteScope(inDept, c)).toBe(true)
    expect(resourceInWriteScope(inOtherDept, c)).toBe(false)
  })

  it('an additive per-user grant reaches a department the role does not (ADR-0036)', () => {
    const c = ctx({ scope: 'team', teamId: TEAM, scopeGrantDepartmentIds: new Set([OTHER_DEPT]) })
    expect(resourceInWriteScope(inOtherDept, c)).toBe(true)
  })

  it('an additive per-user grant reaches a team the role does not (ADR-0036)', () => {
    const c = ctx({ scope: 'team', teamId: TEAM, scopeGrantTeamIds: new Set([OTHER_TEAM]) })
    expect(resourceInWriteScope({ departmentId: OTHER_DEPT, teamId: OTHER_TEAM }, c)).toBe(true)
  })

  // The 'account' branch of app.in_write_scope compares against the account manager, and
  // resource_in_write_scope passes NULL for it — so an Account Manager reaches a resource ONLY
  // through an explicit scope grant, never through the accounts they own.
  it('account scope alone reaches nothing; a scope grant is what opens it', () => {
    expect(resourceInWriteScope(inDept, ctx({ scope: 'account' }))).toBe(false)
    expect(
      resourceInWriteScope(inDept, ctx({ scope: 'account', scopeGrantDepartmentIds: new Set([DEPT]) })),
    ).toBe(true)
  })

  // Deliberate lean-ALLOW: the team's parent department is not resolvable client-side, so we let
  // the attempt through rather than wrongly block a legitimately-scoped user.
  it('leans allow on a team-only resource for anyone holding department reach', () => {
    expect(resourceInWriteScope(teamOnly, ctx({ scope: 'department', departmentId: DEPT }))).toBe(true)
    expect(
      resourceInWriteScope(teamOnly, ctx({ scope: 'team', scopeGrantDepartmentIds: new Set([DEPT]) })),
    ).toBe(true)
  })

  it('does not lean allow on a team-only resource for a plain team-scoped user', () => {
    expect(resourceInWriteScope(teamOnly, ctx({ scope: 'team', teamId: OTHER_TEAM }))).toBe(false)
  })
})

describe('isPmBypassEligible — ADR-0029', () => {
  const none = { subTaskId: null, deliverableId: null, campaignId: null }

  it('a plain ad-hoc reservation has no PM, so the scope mirror is exact', () => {
    expect(isPmBypassEligible(none)).toBe(false)
  })

  it('any project link makes a PM possible, so the caller must lean allow', () => {
    expect(isPmBypassEligible({ ...none, subTaskId: 's' })).toBe(true)
    expect(isPmBypassEligible({ ...none, deliverableId: 'd' })).toBe(true)
    expect(isPmBypassEligible({ ...none, campaignId: 'c' })).toBe(true)
  })
})

// The grid used to answer every refusal with one sentence about teams. It was wrong for most
// people, and a wrong reason sends them to ask for the wrong thing.
describe('bookingRefusal — the reason has to be true for THIS person', () => {
  const shamous = { name: 'Shamous Saddam Ali', departmentId: DEPT, teamId: TEAM }
  const base = { hasPermission: true, ...ctx() }

  it('names the missing permission first — reach is beside the point without it', () => {
    expect(bookingRefusal(shamous, { ...base, hasPermission: false, scope: 'tenant' }, 'create').key)
      .toBe('schedule.refusal.noPermission.create')
    expect(bookingRefusal(shamous, { ...base, hasPermission: false, scope: 'tenant' }, 'update').key)
      .toBe('schedule.refusal.noPermission.update')
  })

  it('tells a team member to ask their team leader — NOT "your own team"', () => {
    const r = bookingRefusal(shamous, { ...base, scope: 'self' })
    expect(r.key).toBe('schedule.refusal.self')
    // And it must not offer self-booking as the consolation: they cannot do that either.
    expect(en.schedule.refusal.self).toContain('team leader')
    expect(en.schedule.refusal.self).not.toContain('your own calendar')
  })

  // ADR-0098: a team, department or account scope reaches every calendar for scheduling, so none
  // of them is ever refused by reach — a refusal is the server's and the mirror says so.
  it('does not blame the reach of a lead or an account manager — they have all of it (ADR-0098)', () => {
    expect(bookingRefusal(shamous, { ...base, scope: 'team' }).key).toBe('schedule.refusal.unknown')
    expect(bookingRefusal(shamous, { ...base, scope: 'department' }).key).toBe('schedule.refusal.unknown')
    expect(bookingRefusal(shamous, { ...base, scope: 'account' }).key).toBe('schedule.refusal.unknown')
  })

  // An unplaced resource is unreachable by ANY scope grant, so widening the person cannot fix it.
  it('blames the unplaced resource, not the person, when it has no department or team', () => {
    const nowhere = { name: 'Nobody', departmentId: null, teamId: null }
    expect(bookingRefusal(nowhere, { ...base, scope: 'self', scopeGrantDepartmentIds: new Set([DEPT]) }).key).toBe('schedule.refusal.unplaced')
  })

  it('does not invent a reason when a tenant-wide user is somehow refused', () => {
    expect(bookingRefusal(shamous, { ...base, scope: 'tenant' }).key).toBe('schedule.refusal.unknown')
  })

  it('always carries the name the message needs', () => {
    expect(bookingRefusal(shamous, { ...base, scope: 'self' }).params).toEqual({ name: 'Shamous Saddam Ali' })
  })
})

// A self-scoped person books NOTHING — not even their own calendar. Edward's decision, 25 Aug:
// team members who need time blocked out ask a team leader, so no owner predicate is being added to
// the bookings policies. The server already behaves this way (app.in_write_scope returns false for
// 'self'), so these tests pin the client to the same answer and stop anyone "fixing" it as a bug.
describe('self scope cannot reach any calendar, including its own (deliberate)', () => {
  it('is refused for the holder’s own department and team', () => {
    const own = { departmentId: DEPT, teamId: TEAM }
    const c = ctx({ scope: 'self', departmentId: DEPT, teamId: TEAM })
    expect(resourceInWriteScope(own, c)).toBe(false)
  })

  it('and a scope grant is currently the only thing that opens it', () => {
    const own = { departmentId: DEPT, teamId: TEAM }
    const c = ctx({ scope: 'self', scopeGrantDepartmentIds: new Set([DEPT]) })
    expect(resourceInWriteScope(own, c)).toBe(true)
  })
})

/**
 * ADR-0139 d.1 (I74.6): the scheduling reach, mirrored from `app.resource_in_scheduling_scope`
 * (`20261003110000`). A team lead her own team; a department lead his department (the person's own
 * placement first, the calendar's otherwise, and any team that sits in it); Traffic and the Power Admin
 * everyone; an account manager, the account director and a team member nobody.
 */
describe('resourceInSchedulingScope — ADR-0139 d.1', () => {
  it('reaches every calendar for a tenant-wide role', () => {
    expect(resourceInSchedulingScope(inOtherDept, ctx({ scope: 'tenant' }))).toBe(true)
    expect(resourceInSchedulingScope({ departmentId: null, teamId: null }, ctx({ scope: 'tenant' }))).toBe(true)
  })

  it('a department lead reaches his department, by the person first and the calendar otherwise', () => {
    const c = ctx({ scope: 'department', departmentId: DEPT })
    expect(resourceInSchedulingScope(inDept, c)).toBe(true)
    expect(resourceInSchedulingScope(inOtherDept, c)).toBe(false)
    // the person moved departments; the calendar still says the old one — the person wins
    expect(resourceInSchedulingScope({ ...inOtherDept, personDepartmentId: DEPT }, c)).toBe(true)
    expect(resourceInSchedulingScope({ ...inDept, personDepartmentId: OTHER_DEPT }, c)).toBe(false)
    // a team-only calendar is reached through the department its team sits in
    expect(resourceInSchedulingScope({ ...teamOnly, teamDepartmentId: DEPT }, c)).toBe(true)
    expect(resourceInSchedulingScope({ ...teamOnly, teamDepartmentId: OTHER_DEPT }, c)).toBe(false)
  })

  it('a team lead reaches her own team only — a sibling team in her department is a request', () => {
    const c = ctx({ scope: 'team', departmentId: DEPT, teamId: TEAM })
    expect(resourceInSchedulingScope(inTeam, c)).toBe(true)
    expect(resourceInSchedulingScope({ departmentId: DEPT, teamId: OTHER_TEAM }, c)).toBe(false)
    // a team-less colleague in her department is not her team either
    expect(resourceInSchedulingScope(inDept, c)).toBe(false)
    // the person's own team decides over the calendar's
    expect(resourceInSchedulingScope({ ...inTeam, personTeamId: OTHER_TEAM }, c)).toBe(false)
    expect(resourceInSchedulingScope({ departmentId: DEPT, teamId: OTHER_TEAM, personTeamId: TEAM }, c)).toBe(true)
  })

  it('an account manager, the account director and a team member reach nobody', () => {
    expect(resourceInSchedulingScope(inDept, ctx({ scope: 'account' }))).toBe(false)
    expect(resourceInSchedulingScope(inDept, ctx({ scope: 'all_accounts' }))).toBe(false)
    expect(resourceInSchedulingScope(inDept, ctx({ scope: 'self' }))).toBe(false)
  })

  it('a per-user scope grant still widens it (ADR-0036)', () => {
    expect(resourceInSchedulingScope(inTeam, ctx({ scope: 'self', scopeGrantTeamIds: new Set([TEAM]) }))).toBe(true)
    expect(resourceInSchedulingScope(inOtherDept, ctx({ scope: 'account', scopeGrantDepartmentIds: new Set([OTHER_DEPT]) }))).toBe(true)
    expect(resourceInSchedulingScope({ ...teamOnly, teamDepartmentId: OTHER_DEPT }, ctx({ scope: 'self', scopeGrantDepartmentIds: new Set([OTHER_DEPT]) }))).toBe(true)
    expect(resourceInSchedulingScope(inOtherDept, ctx({ scope: 'self', scopeGrantTeamIds: new Set([TEAM]) }))).toBe(false)
  })
})

/** ADR-0139 d.2: within reach books, outside it asks, and a person placed nowhere has nobody to ask. */
describe('assignmentRoute — direct, request, or unplaced (ADR-0139)', () => {
  it('is direct within reach', () => {
    expect(assignmentRoute(inTeam, ctx({ scope: 'team', teamId: TEAM }))).toBe('direct')
    expect(assignmentRoute(inDept, ctx({ scope: 'department', departmentId: DEPT }))).toBe('direct')
    expect(assignmentRoute(inOtherDept, ctx({ scope: 'tenant' }))).toBe('direct')
  })

  it('is a request for another team, another department, and every pick of an account manager', () => {
    expect(assignmentRoute({ departmentId: DEPT, teamId: OTHER_TEAM }, ctx({ scope: 'team', departmentId: DEPT, teamId: TEAM }))).toBe('request')
    expect(assignmentRoute(inOtherDept, ctx({ scope: 'department', departmentId: DEPT }))).toBe('request')
    expect(assignmentRoute(inTeam, ctx({ scope: 'account' }))).toBe('request')
    expect(assignmentRoute(inTeam, ctx({ scope: 'all_accounts' }))).toBe('request')
  })

  it('is unplaced for a person in no department and no team, unless the caller reaches everyone', () => {
    const nowhere = { departmentId: null, teamId: null }
    expect(assignmentRoute(nowhere, ctx({ scope: 'account' }))).toBe('unplaced')
    expect(assignmentRoute(nowhere, ctx({ scope: 'team', teamId: TEAM }))).toBe('unplaced')
    expect(assignmentRoute(nowhere, ctx({ scope: 'tenant' }))).toBe('direct')
    // the person's own placement counts even when the calendar has none
    expect(assignmentRoute({ ...nowhere, personTeamId: OTHER_TEAM }, ctx({ scope: 'account' }))).toBe('request')
  })
})
