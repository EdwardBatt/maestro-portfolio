import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../lib/i18n'
import { NAV_SECTIONS } from './nav-config'

/**
 * The side menu (ADR-0105 d.6, I59.15) — restyled, every item kept. `nav-config.test.ts` proves which
 * items each role holds; this proves the shell renders exactly those, in that order, under the
 * section labels, marks the current page, and carries the person's name and role at the foot.
 */

const perms = vi.hoisted(() => ({ held: new Set<string>(), defaultRoute: '/my-work' }))

vi.mock('./permissions', () => ({
  usePermissions: () => ({ can: (k: string) => perms.held.has(k), roleName: 'Team member', defaultRoute: perms.defaultRoute }),
}))
vi.mock('./dev-preview', () => ({ useDevPreview: () => ({ active: false, clear: vi.fn(), canUseDevPanel: false }) }))
vi.mock('./useCurrentUser', () => ({
  useCurrentUser: () => ({ data: { displayName: 'Zubaida Jamil', roleName: 'Team member', roleKey: null, email: 'z@example.com', locale: null } }),
}))
vi.mock('./auth-context', () => ({ useAuth: () => ({ signOut: vi.fn(), session: { user: { id: 'me' } } }) }))
vi.mock('./use-remembered-locale', () => ({ useRememberedLocale: () => vi.fn() }))
vi.mock('./DevPanel', () => ({ DevPanel: () => null }))
vi.mock('./ViewAsBanner', () => ({ ViewAsBanner: () => null }))
vi.mock('./EnvironmentBanner', () => ({ EnvironmentBanner: () => null }))
vi.mock('./UpdateBar', () => ({ UpdateBar: () => null }))
vi.mock('../features/notifications/NotificationInbox', () => ({ NotificationInbox: () => null }))
vi.mock('./work-channel', () => ({ useWorkChannel: () => undefined }))
vi.mock('../features/feedback/components/SendFeedbackDialog', () => ({ SendFeedbackDialog: () => null }))
vi.mock('../features/intake/components/NewRequestDoor', () => ({ NewRequestDoor: () => null }))

import { AppShell } from './AppShell'

const renderShell = (at: string) =>
  render(
    <MemoryRouter initialEntries={[at]}>
      <AppShell />
    </MemoryRouter>,
  )

const navTestId = (to: string) => `nav-${to.slice(1).replace(/\//g, '-')}`

describe('the side menu (I59.15)', () => {
  it('renders every item the role holds, in the configured order, and nothing else', () => {
    perms.held = new Set(['my_tasks:view', 'my_calendar:view', 'projects:view', 'project_tasks:manage', 'directory:view', 'team:view'])
    renderShell('/my-work')
    const nav = screen.getByRole('navigation', { name: 'primary' })
    const shown = within(nav).getAllByRole('link').map((a) => a.getAttribute('data-testid'))
    const expected = [
      'nav-dashboard',
      ...NAV_SECTIONS.flatMap((s) => s.items).filter((i) => i.perms.some((p) => perms.held.has(p))).map((i) => navTestId(i.to)),
    ]
    expect(shown).toEqual(expected)
    expect(shown).not.toContain('nav-admin-users')
  })

  it('labels the sections ("MAIN") and marks the current page, including a task page under My Work', () => {
    perms.held = new Set(['my_tasks:view', 'schedule:view'])
    const { unmount } = renderShell('/schedule')
    expect(screen.getByText('Main')).toHaveClass('nav-section-title')
    expect(screen.getByTestId('nav-schedule')).toHaveClass('active')
    expect(screen.getByTestId('nav-my-work')).not.toHaveClass('active')
    unmount()
    renderShell('/my-work/task/t1')
    expect(screen.getByTestId('nav-my-work')).toHaveClass('active')
  })

  it('Dashboard is one page for everyone and is marked only on it (ADR-0122, I61)', () => {
    perms.held = new Set(['my_tasks:view', 'team:view'])
    perms.defaultRoute = '/team'
    const { unmount } = renderShell('/team')
    expect(screen.getByTestId('nav-team')).toHaveClass('active')
    expect(screen.getByTestId('nav-dashboard')).not.toHaveClass('active')
    expect(screen.getByTestId('nav-dashboard')).toHaveAttribute('href', '/dashboard')
    expect(screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page')).toHaveLength(1)
    unmount()
    renderShell('/dashboard')
    expect(screen.getByTestId('nav-dashboard')).toHaveClass('active')
    perms.defaultRoute = '/my-work'
  })

  it('carries the person\'s name and role at the foot', () => {
    perms.held = new Set(['my_tasks:view'])
    renderShell('/my-work')
    const menu = screen.getByTestId('user-menu')
    expect(menu).toHaveTextContent('Zubaida Jamil')
    expect(menu).toHaveTextContent('Team member')
    expect(menu.closest('.sidebar-user')).not.toBeNull()
  })
})
