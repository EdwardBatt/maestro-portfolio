import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../lib/i18n'
import type { DirectoryGroup } from './api/directory-api'

const GROUPS: DirectoryGroup[] = [
  {
    departmentId: 'd1',
    departmentName: 'Creative',
    people: [
      { id: 'p1', fullName: 'Alice Hassan', jobTitle: 'Art Director', roleName: 'Team Leader', roleKey: null, officeName: 'Baghdad', nickname: 'Turbo Koshari', email: 'alice@example.test', departmentId: 'd1', departmentName: 'Creative' },
      { id: 'p2', fullName: 'Bilal Nasr', jobTitle: null, roleName: 'Team Member', roleKey: null, officeName: null, nickname: null, email: 'bilal@example.test', departmentId: 'd1', departmentName: 'Creative' },
    ],
  },
  {
    departmentId: null,
    departmentName: null,
    people: [
      { id: 'p3', fullName: 'Omar Zaid', jobTitle: 'Editor', roleName: 'Scheduler', roleKey: null, officeName: 'Cairo', nickname: 'Falcon', email: null, departmentId: null, departmentName: null },
    ],
  },
]

// Self-contained factory — must NOT import the real module (it reaches
// lib/env → lib/supabase, which throws in CI without VITE_SUPABASE_* set).
// The DirectoryGroup type is a type-only import above, erased at transform,
// so it never loads the module. Only useDirectory is consumed by the page.
vi.mock('./api/directory-api', () => ({
  useDirectory: () => ({ data: GROUPS, isLoading: false, isError: false }),
}))

import { DirectoryPage } from './DirectoryPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <DirectoryPage />
    </MemoryRouter>,
  )
}

describe('DirectoryPage — company directory (L1.20)', () => {
  it('groups people by department and shows name, job title, role, office, nickname, email', () => {
    renderPage()
    const row = screen.getByTestId('directory-row-p1')
    expect(row).toHaveTextContent('Alice Hassan')
    expect(row).toHaveTextContent('Art Director')
    expect(row).toHaveTextContent('Team Leader')
    expect(row).toHaveTextContent('Baghdad')
    expect(row).toHaveTextContent('Turbo Koshari')
    expect(row).toHaveTextContent('alice@example.test')
    // Missing job title / office / nickname / email render as an em dash, not blank.
    expect(screen.getByTestId('directory-row-p2')).toHaveTextContent('—')
  })

  it('filters on job title, role, and office', () => {
    renderPage()
    fireEvent.change(screen.getByTestId('directory-search'), { target: { value: 'editor' } })
    expect(screen.getByTestId('directory-row-p3')).toBeInTheDocument()
    expect(screen.queryByTestId('directory-row-p1')).not.toBeInTheDocument()

    fireEvent.change(screen.getByTestId('directory-search'), { target: { value: 'baghdad' } })
    expect(screen.getByTestId('directory-row-p1')).toBeInTheDocument()
    expect(screen.queryByTestId('directory-row-p3')).not.toBeInTheDocument()
  })

  it('puts department-less people under an Unassigned group', () => {
    renderPage()
    expect(screen.getByTestId('directory-group-none')).toHaveTextContent('Omar Zaid')
  })

  it('filters across name / nickname / email', () => {
    renderPage()
    fireEvent.change(screen.getByTestId('directory-search'), { target: { value: 'falcon' } })
    expect(screen.getByTestId('directory-row-p3')).toBeInTheDocument()
    expect(screen.queryByTestId('directory-row-p1')).not.toBeInTheDocument()
  })

  it('shows a no-matches note when the filter excludes everyone', () => {
    renderPage()
    fireEvent.change(screen.getByTestId('directory-search'), { target: { value: 'zzznobody' } })
    expect(screen.getByTestId('directory-empty')).toBeInTheDocument()
  })
})
