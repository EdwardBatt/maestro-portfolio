import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../lib/i18n'
import type { ClientRow } from './api/clients-api'

/**
 * The clients list (ADR-0123, Figma CV-01): active clients above, drafts below; the account director
 * reviews and activates a draft, anyone else who manages clients asks; an account manager's Active tab
 * is their own clients.
 */
const state = vi.hoisted(() => ({
  clients: [] as ClientRow[],
  held: new Set<string>(['clients:view', 'clients:manage']),
  scope: 'tenant' as string,
  ask: vi.fn(),
}))

// Self-contained factory (the real module reaches lib/env, which throws in CI).
vi.mock('./api/clients-api', () => ({
  useClients: () => ({ data: state.clients, isLoading: false, isError: false }),
  useCountries: () => ({ data: [{ code: 'IQ', nameEn: 'Iraq', nameAr: 'العراق', workingDays: [7, 1, 2, 3, 4] }] }),
  useContactCounts: () => ({ data: new Map() }),
  usePeopleNames: () => ({ data: new Map([['am1', 'Inas Azmi']]) }),
  useAskToActivate: () => ({ mutate: state.ask, isPending: false }),
}))
vi.mock('./api/client-work', () => ({
  useClientWork: () => ({ of: () => ({ live: 2, onTime: 9, unfinished: 12, needsYou: 3, lastActivity: null, campaigns: [] }), isLoading: false, isError: false }),
}))
vi.mock('../../app/permissions', () => ({
  usePermissions: () => ({ can: (k: string) => state.held.has(k), scope: state.scope }),
}))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ session: { user: { id: 'am1' } } }) }))

import { ClientsPage } from './ClientsPage'

const row = (over: Partial<ClientRow>): ClientRow => ({
  id: 'c1', name: 'Kite', status: 'active', countryCode: 'IQ', businessTypes: ['ecommerce'], rules: [],
  accountManagerId: 'am1', accountManagerName: 'Inas Azmi', isInternal: false, brandCount: 6, campaignCount: 4,
  createdAt: '2026-09-20T08:00:00Z', createdById: 'am1', activatedAt: '2026-09-20T09:00:00Z', activationRequestedAt: null,
  ...over,
})

const renderPage = () => render(<MemoryRouter><ClientsPage /></MemoryRouter>)

describe('the clients list (CV-01)', () => {
  beforeEach(() => {
    state.held = new Set(['clients:view', 'clients:manage'])
    state.scope = 'tenant'
    state.ask.mockReset()
    state.clients = [
      row({}),
      row({ id: 'c2', name: 'Luma', status: 'draft', activatedAt: null, brandCount: 1 }),
      row({ id: 'c3', name: 'Auracell', accountManagerId: 'someone' }),
      row({ id: 'int', name: 'Internal', isInternal: true }),
    ]
  })

  it('lists active clients with their figures and drafts beneath, never the internal container', () => {
    renderPage()
    expect(screen.getByTestId('client-row-c1')).toHaveTextContent('Kite')
    expect(screen.getByTestId('client-ontime-c1')).toHaveTextContent('9 of 12')
    expect(screen.getByTestId('client-ontime-c1')).toHaveClass('tone-amber')
    expect(screen.getByTestId('client-needs-c1')).toHaveTextContent('3')
    expect(screen.getByTestId('client-draft-c2')).toHaveTextContent('Started by you')
    expect(screen.getByTestId('client-draft-c2')).toHaveTextContent('Basics and Brands done')
    expect(screen.queryByText('Internal')).toBeNull()
  })

  /** I69.1 (Edward, 30 Sep, A): CV-01 named nobody — whose client each is, "You" on your own. */
  it('names each active client\'s account manager, and says You on your own', () => {
    state.clients = [row({}), row({ id: 'c3', name: 'Auracell', accountManagerId: 'someone', accountManagerName: 'Reem Saleh' })]
    renderPage()
    expect(screen.getByTestId('client-am-c1')).toHaveTextContent('You')
    expect(screen.getByTestId('client-am-c3')).toHaveTextContent('Reem Saleh')
  })

  it('someone who manages clients asks the director; they cannot activate', () => {
    renderPage()
    expect(screen.queryByTestId('client-draft-review-c2')).toBeNull()
    fireEvent.click(screen.getByTestId('client-draft-ask-c2'))
    expect(state.ask).toHaveBeenCalledWith('c2')
  })

  it('the account director reviews and activates instead of asking', () => {
    state.held.add('clients:approve')
    renderPage()
    expect(screen.getByTestId('client-draft-review-c2')).toBeInTheDocument()
    expect(screen.queryByTestId('client-draft-ask-c2')).toBeNull()
  })

  it("an account manager's Active tab is their own clients", () => {
    state.scope = 'account'
    renderPage()
    expect(screen.getByRole('heading', { name: 'Your clients' })).toBeInTheDocument()
    expect(screen.getByTestId('client-row-c1')).toBeInTheDocument()
    expect(screen.queryByTestId('client-row-c3')).toBeNull()
    expect(screen.getByTestId('clients-tab-active')).toHaveTextContent('Active · 1')
  })

  it('a view-only role sees no New client and no draft controls', () => {
    state.held = new Set(['clients:view'])
    renderPage()
    expect(screen.queryByTestId('client-register')).toBeNull()
    expect(screen.queryByTestId('client-draft-continue-c2')).toBeNull()
    expect(screen.queryByTestId('client-draft-ask-c2')).toBeNull()
  })
})
