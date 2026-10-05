import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import '../../../lib/i18n'

const perms = vi.hoisted(() => ({ grants: new Set<string>(['projects:manage']) }))
vi.mock('../../../app/permissions', () => ({
  usePermissions: () => ({ can: (k: string) => perms.grants.has(k) }),
}))

import { NewRequestDoor } from './NewRequestDoor'
import { openNewRequest } from '../lib/new-request'

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{loc.pathname}</p>
}

function renderDoor() {
  return render(
    <MemoryRouter initialEntries={['/schedule']}>
      <NewRequestDoor />
      <input data-testid="a-field" />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

const ctrlP = (over: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(window, { code: 'KeyP', key: 'p', ctrlKey: true, ...over })

/**
 * The one door (ADR-0082). The shortcut is the door's only invisible affordance, so every way it
 * could misfire is asserted here rather than discovered by a person mid-brief.
 */
describe('NewRequestDoor (ADR-0082)', () => {
  beforeEach(() => {
    perms.grants = new Set(['projects:manage'])
  })

  it('is closed until asked', () => {
    renderDoor()
    expect(screen.queryByTestId('new-request-door')).toBeNull()
  })

  it('opens on Ctrl+P and on Cmd+P, and claims the key from the browser', () => {
    renderDoor()
    const handled = ctrlP()
    // `fireEvent` returns false when a listener called preventDefault — the browser's Print did
    // not run (d.3, accepted knowingly).
    expect(handled).toBe(false)
    expect(screen.getByTestId('new-request-door')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('new-request-door')).toBeNull()

    ctrlP({ ctrlKey: false, metaKey: true })
    expect(screen.getByTestId('new-request-door')).toBeInTheDocument()
  })

  it('opens from inside a field too, and still keeps the key from the browser', () => {
    renderDoor()
    const field = screen.getByTestId('a-field')
    field.focus()
    const handled = fireEvent.keyDown(field, { code: 'KeyP', key: 'p', ctrlKey: true })
    expect(handled).toBe(false) // preventDefault ran: no Print dialog over the form
    expect(screen.getByTestId('new-request-door')).toBeInTheDocument()
  })

  it('a second Ctrl+P while open changes nothing, and Escape closes it', () => {
    renderDoor()
    ctrlP()
    ctrlP()
    expect(screen.getAllByTestId('new-request-door')).toHaveLength(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('new-request-door')).toBeNull()
  })

  it('opens from a page that asks for it (New on /campaigns, d.7)', () => {
    renderDoor()
    act(() => openNewRequest())
    expect(screen.getByTestId('new-request-door')).toBeInTheDocument()
  })

  it('offers exactly two choices and routes each to its own flow', () => {
    renderDoor()
    ctrlP()
    expect(screen.getByTestId('new-request-single-job')).toBeInTheDocument()
    expect(screen.getByTestId('new-request-full-campaign')).toBeInTheDocument()
    // "Took it on a call" is gone (d.5): there is no third button.
    expect(screen.getByTestId('new-request-door').querySelectorAll('.choice-card')).toHaveLength(2)

    fireEvent.click(screen.getByTestId('new-request-full-campaign'))
    expect(screen.getByTestId('where')).toHaveTextContent('/campaigns/new')
    expect(screen.queryByTestId('new-request-door')).toBeNull()

    ctrlP()
    fireEvent.click(screen.getByTestId('new-request-single-job'))
    expect(screen.getByTestId('where')).toHaveTextContent('/campaigns/new-job')
  })

  // Decision, 12 Sep (revising ADR-0082 d.4): the shortcut is claimed for everyone, so Print never
  // opens on top of the app. Someone without `projects:manage` gets a message — new work comes
  // through their account manager — not the two doors.
  it('shows the no-access message, never the two doors, for somebody without projects:manage', () => {
    perms.grants = new Set(['my_tasks:view', 'project_tasks:manage'])
    renderDoor()
    const handled = ctrlP()
    expect(handled).toBe(false) // Print is taken from the key for everyone (d.3)
    expect(screen.queryByTestId('new-request-door')).toBeNull()
    expect(screen.getByTestId('new-request-no-access')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('new-request-no-access')).toBeNull()
  })
})
