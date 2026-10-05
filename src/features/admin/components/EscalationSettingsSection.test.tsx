import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '../../../lib/i18n'
import type { EscalationRule, EscalationTimings } from '../api/escalation-settings-api'

/**
 * Admin → Escalations (ADR-0108 + addendum; I59.24). The api modules reach lib/env in CI → mocked with
 * self-contained factories; the pure helpers (`changedRules`, `sortRules`) are exercised in
 * escalation-settings-api.test.ts.
 */
const state = vi.hoisted(() => ({
  rules: [] as EscalationRule[],
  timings: { overCapacityPct: 110, untimedThresholdMinutes: 15 } as EscalationTimings,
  nobody: [] as string[],
  rulesError: false,
  words: [] as { id: string; word: string }[],
  save: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('../api/escalation-settings-api', async () => {
  const RELATIVE_RECIPIENTS = ['owner', 'account_manager', 'owner_department_lead', 'assignee_team_lead', 'reviewers'] as const
  return {
    RELATIVE_RECIPIENTS,
    DEFAULT_TIMINGS: { overCapacityPct: 110, untimedThresholdMinutes: 15 },
    changedRules: (before: EscalationRule[], after: EscalationRule[]) =>
      after.filter((r) => JSON.stringify(before.find((b) => b.id === r.id)) !== JSON.stringify(r)),
    useEscalationRules: () => ({ data: state.rules, isLoading: false, isError: state.rulesError }),
    useEscalationTimings: () => ({ data: state.timings, isLoading: false, isError: false }),
    useEscalationsReachingNobody: () => ({ data: state.nobody }),
    useSaveEscalationSettings: () => ({ mutate: state.save, isPending: false }),
  }
})
vi.mock('../api/admin-api', () => ({
  useAssignableRoles: () => ({
    data: [
      { id: 'r-traffic', key: 'scheduler', name: 'Traffic Manager', isSystem: true },
      { id: 'r-ad', key: 'account_director', name: 'Account Director', isSystem: true },
      { id: 'r-own', key: 'studio_boss', name: 'Studio boss', isSystem: false },
    ],
  }),
}))
vi.mock('../../../lib/brief/filler-words-api', () => ({
  normalizeFillerWord: (s: string) => s.trim().toLowerCase(),
  useFillerWords: () => ({ data: state.words }),
  useAddFillerWord: () => ({ mutate: state.add, isPending: false }),
  useRemoveFillerWord: () => ({ mutate: state.remove, isPending: false }),
}))

import { EscalationSettingsSection } from './EscalationSettingsSection'

const RULES: EscalationRule[] = [
  { id: 'e1', kind: 'unassigned', hours: 24, roleIds: ['r-traffic'], relative: ['owner'] },
  { id: 'e2', kind: 'campaign_brief', hours: 24, roleIds: ['r-traffic', 'r-ad'], relative: [] },
  { id: 'e3', kind: 'extension_owner', hours: 8, roleIds: [], relative: ['owner_department_lead'] },
]

function renderIt() {
  const onSaved = vi.fn()
  const onError = vi.fn()
  render(<EscalationSettingsSection onSaved={onSaved} onError={onError} />)
  return { onSaved, onError }
}

describe('EscalationSettingsSection (ADR-0108)', () => {
  beforeEach(() => {
    state.rules = RULES.map((r) => ({ ...r, roleIds: [...r.roleIds], relative: [...r.relative] }))
    state.timings = { overCapacityPct: 110, untimedThresholdMinutes: 15 }
    state.nobody = []
    state.rulesError = false
    state.words = []
    state.save.mockReset()
    state.add.mockReset()
    state.remove.mockReset()
  })

  it('shows one row per kind — campaign_brief included — with hours, roles and people', () => {
    renderIt()
    expect(screen.getByTestId('escalation-row-unassigned')).toHaveTextContent('Nobody assigned')
    expect(screen.getByTestId('escalation-row-campaign_brief')).toHaveTextContent('Campaign or brief not approved')
    expect(screen.getByTestId('escalation-hours-extension_owner')).toHaveValue(8)
    expect(screen.getByTestId('escalation-role-campaign_brief-r-ad')).toHaveTextContent('Account Director')
    expect(screen.getByTestId('escalation-person-unassigned-owner')).toBeChecked()
    expect(screen.getByTestId('escalation-person-unassigned-reviewers')).not.toBeChecked()
    expect(screen.getByTestId('escalation-over-capacity')).toHaveValue(110)
    expect(screen.getByTestId('escalation-untimed-minutes')).toHaveValue(15)
    // Save is off until something changes.
    expect(screen.getByTestId('escalation-settings-save')).toBeDisabled()
  })

  it('says "reaches nobody" on exactly the rows the database lists (E9)', () => {
    state.nobody = ['extension_owner']
    renderIt()
    expect(screen.getByTestId('escalation-nobody-extension_owner')).toHaveTextContent(
      'Reaches nobody — escalated to Traffic instead',
    )
    expect(screen.queryByTestId('escalation-nobody-unassigned')).toBeNull()
  })

  it('saves only the rows that changed, with the numbers, in one press', () => {
    const { onSaved } = renderIt()
    fireEvent.change(screen.getByTestId('escalation-hours-unassigned'), { target: { value: '12' } })
    fireEvent.change(screen.getByTestId('escalation-role-add-extension_owner'), { target: { value: 'r-own' } })
    fireEvent.click(screen.getByTestId('escalation-person-extension_owner-assignee_team_lead'))
    fireEvent.click(screen.getByTestId('escalation-role-remove-campaign_brief-r-traffic'))
    fireEvent.change(screen.getByTestId('escalation-over-capacity'), { target: { value: '120' } })
    fireEvent.click(screen.getByTestId('escalation-settings-save'))

    expect(state.save).toHaveBeenCalledTimes(1)
    const [args, handlers] = state.save.mock.calls[0]!
    expect(args.rules).toEqual([
      { id: 'e1', kind: 'unassigned', hours: 12, roleIds: ['r-traffic'], relative: ['owner'] },
      { id: 'e2', kind: 'campaign_brief', hours: 24, roleIds: ['r-ad'], relative: [] },
      { id: 'e3', kind: 'extension_owner', hours: 8, roleIds: ['r-own'], relative: ['owner_department_lead', 'assignee_team_lead'] },
    ])
    expect(args.timings).toEqual({ overCapacityPct: 120, untimedThresholdMinutes: 15 })
    handlers.onSuccess()
    expect(onSaved).toHaveBeenCalledWith('escalations.settings.saved')
  })

  it('an hour that is not a positive whole number is ignored, not saved', () => {
    renderIt()
    fireEvent.change(screen.getByTestId('escalation-hours-unassigned'), { target: { value: '0' } })
    expect(screen.getByTestId('escalation-hours-unassigned')).toHaveValue(24)
  })

  it('a refusal is said as the refusal, anything else as a failure', () => {
    const { onError } = renderIt()
    fireEvent.change(screen.getByTestId('escalation-untimed-minutes'), { target: { value: '20' } })
    fireEvent.click(screen.getByTestId('escalation-settings-save'))
    const handlers = state.save.mock.calls[0]![1]
    handlers.onError({ code: '42501' })
    expect(onError).toHaveBeenLastCalledWith({ code: '42501' }, 'escalations.settings.refused')
    handlers.onError(new Error('boom'))
    expect(onError).toHaveBeenLastCalledWith(expect.any(Error), 'escalations.settings.saveFailed')
  })

  it('a failed read says so rather than showing empty rows', () => {
    state.rulesError = true
    renderIt()
    expect(screen.getByTestId('escalation-settings-failed')).toBeInTheDocument()
    expect(screen.queryByTestId('escalation-settings-form')).toBeNull()
  })

  it('filler words: the built-ins are listed and cannot be removed; the tenant adds and removes its own', () => {
    state.words = [{ id: 'w1', word: 'coming soon' }]
    renderIt()
    const builtIn = screen.getByTestId('filler-words-built-in')
    expect(within(builtIn).getByText('tbd')).toBeInTheDocument()
    expect(within(builtIn).queryAllByRole('button')).toHaveLength(0)

    fireEvent.change(screen.getByTestId('filler-word-input'), { target: { value: '  Placeholder ' } })
    fireEvent.click(screen.getByTestId('filler-word-add'))
    expect(state.add).toHaveBeenCalledWith('placeholder', expect.anything())

    // Remove arms first, then removes.
    fireEvent.click(screen.getByTestId('filler-word-remove-w1'))
    expect(state.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('filler-word-remove-w1'))
    expect(state.remove).toHaveBeenCalledWith('w1', expect.anything())
  })

  it('a duplicate word is said as one', () => {
    const { onError } = renderIt()
    fireEvent.change(screen.getByTestId('filler-word-input'), { target: { value: 'tbd' } })
    fireEvent.click(screen.getByTestId('filler-word-add'))
    state.add.mock.calls[0]![1].onError({ code: '23505' })
    expect(onError).toHaveBeenCalledWith({ code: '23505' }, 'escalations.filler.duplicate')
  })
})
