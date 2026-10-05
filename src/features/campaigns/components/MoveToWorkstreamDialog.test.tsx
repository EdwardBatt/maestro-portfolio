import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import { MoveToWorkstreamDialog, type MoveWorkstreamOption } from './MoveToWorkstreamDialog'

/**
 * Moving a piece between workstreams (ADR-0099 d.3/d.4/d.9, `I56.3`).
 *
 * The dialog is presentational, so what is worth pinning is what it SAYS. Moving a piece between
 * groups changes its department and takes its unassigned tasks with it, and none of that is
 * visible in a list of group names — so the tests here are mostly about the sentence underneath.
 */
const GROUPS: MoveWorkstreamOption[] = [
  { id: 'ws1', name: 'Design & Creative', departmentName: 'Creative', pieceCount: 4 },
  { id: 'ws2', name: 'Short-form video', departmentName: 'Content', pieceCount: 1 },
  { id: 'ws3', name: 'Stills', departmentName: 'Creative', pieceCount: 2 },
]

function view(over: Partial<React.ComponentProps<typeof MoveToWorkstreamDialog>> = {}) {
  const props = {
    pieceName: 'Post 2 — the payment-chime carousel',
    currentWorkstreamId: 'ws1',
    currentDepartmentName: 'Creative',
    options: GROUPS,
    onMove: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  }
  render(<MoveToWorkstreamDialog {...props} />)
  return props
}

describe('MoveToWorkstreamDialog', () => {
  it('opens on the group the piece is already in, and cannot be submitted there', () => {
    view()
    expect(screen.getByTestId('move-workstream-option-ws1')).toHaveAttribute('aria-checked', 'true')
    // Nothing to do is not an error, it is just not a move — so the button is quiet, not angry.
    expect(screen.getByTestId('move-workstream-submit')).toBeDisabled()
  })

  it('says which group it is in now, so the list does not have to be read twice', () => {
    view()
    expect(screen.getByTestId('move-workstream-option-ws1')).toHaveTextContent(/where it is now/i)
    expect(screen.getByTestId('move-workstream-option-ws2')).not.toHaveTextContent(/where it is now/i)
  })

  it('counts what is already in each group', () => {
    view()
    expect(screen.getByTestId('move-workstream-option-ws1')).toHaveTextContent('Creative · 4 deliverables')
    // One is "1 piece", not "1 pieces" — the plural is the copy's job, not the caller's.
    expect(screen.getByTestId('move-workstream-option-ws2')).toHaveTextContent('Content · 1 deliverable')
  })

  it('warns before the press when the move changes the department (d.3)', () => {
    view()
    expect(screen.queryByTestId('move-workstream-department-note')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('move-workstream-option-ws2'))
    const note = screen.getByTestId('move-workstream-department-note')
    expect(note).toHaveTextContent(/from Creative to Content/i)
    // d.9, and the half of it people do not expect: committed work does NOT follow.
    expect(note).toHaveTextContent(/already picked up stays where it is/i)
  })

  it('does not warn about a department that is not changing', () => {
    // ws3 is another group in the SAME department, so the move is a regrouping and nothing more.
    view()
    fireEvent.click(screen.getByTestId('move-workstream-option-ws3'))
    expect(screen.queryByTestId('move-workstream-department-note')).not.toBeInTheDocument()
    expect(screen.getByTestId('move-workstream-submit')).toBeEnabled()
  })

  it('offers no way out of a group unless the caller allows one', () => {
    view()
    expect(screen.queryByTestId('move-workstream-option-none')).not.toBeInTheDocument()
  })

  it('taking it out says the department is kept, which is the opposite of the move (d.4)', () => {
    view({ allowUngrouped: true })
    fireEvent.click(screen.getByTestId('move-workstream-option-none'))
    expect(screen.getByTestId('move-workstream-out-note')).toHaveTextContent(/keeps its department/i)
    expect(screen.queryByTestId('move-workstream-department-note')).not.toBeInTheDocument()
  })

  it('hands back the chosen group, and null for out of any group', () => {
    const a = view()
    fireEvent.click(screen.getByTestId('move-workstream-option-ws2'))
    fireEvent.click(screen.getByTestId('move-workstream-submit'))
    expect(a.onMove).toHaveBeenCalledWith('ws2')

    cleanup()
    const b = view({ allowUngrouped: true })
    fireEvent.click(screen.getByTestId('move-workstream-option-none'))
    fireEvent.click(screen.getByTestId('move-workstream-submit'))
    expect(b.onMove).toHaveBeenCalledWith(null)
  })

  it('names the destination on the button, so the press is not a guess', () => {
    view()
    fireEvent.click(screen.getByTestId('move-workstream-option-ws2'))
    expect(screen.getByTestId('move-workstream-submit')).toHaveTextContent('Move to Short-form video')
  })

  it('a piece with no group at all can be put into one', () => {
    const p = view({ currentWorkstreamId: null, currentDepartmentName: null })
    expect(screen.getByTestId('move-workstream-submit')).toBeDisabled()
    fireEvent.click(screen.getByTestId('move-workstream-option-ws1'))
    // No department to change FROM, so no warning — but the move is allowed.
    expect(screen.queryByTestId('move-workstream-department-note')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('move-workstream-submit'))
    expect(p.onMove).toHaveBeenCalledWith('ws1')
  })

  it('closes without moving anything', () => {
    const p = view()
    fireEvent.click(screen.getByTestId('move-workstream-cancel'))
    expect(p.onCancel).toHaveBeenCalled()
    expect(p.onMove).not.toHaveBeenCalled()
  })
})
