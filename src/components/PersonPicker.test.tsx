import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '../lib/i18n'
import { PersonPicker } from './PersonPicker'

/**
 * Edward, 29 Aug: "is it a true smart filter… so if I typed L would it filter to all names
 * starting with L?"
 *
 * The first version used `<datalist>` and the answer was "sort of, and differently in every
 * browser" — Chrome matches a substring anywhere, so "L" also surfaced "Omar Al-Rawi". The match
 * is ours now, and these are the promise: prefix first, substring after, nothing half-selected.
 */
const PEOPLE = [
  { id: 'u1', name: 'Lina Haddad', hint: 'Creative' },
  { id: 'u2', name: 'Omar Al-Rawi', hint: 'Production' },
  { id: 'u3', name: 'Fadia Kadri', hint: 'Content' },
  { id: 'u4', name: 'Laith Saeed', hint: 'Performance' },
]

const names = (els: HTMLElement[]) =>
  els.map((e) => e.querySelector('.person-picker-name')?.textContent)

describe('PersonPicker', () => {
  it('filters the visible list as you type', () => {
    render(<PersonPicker people={PEOPLE} value="" onChange={vi.fn()} testId="owner" />)
    fireEvent.change(screen.getByTestId('owner'), { target: { value: 'L' } })
    const opts = within(screen.getByTestId('owner-list')).getAllByRole('option')
    expect(names(opts)).toEqual(['Lina Haddad', 'Laith Saeed', 'Omar Al-Rawi'])
  })

  it('shows the department beside the name, because that becomes the Discipline', () => {
    render(<PersonPicker people={PEOPLE} value="" onChange={vi.fn()} testId="owner" />)
    fireEvent.focus(screen.getByTestId('owner'))
    expect(screen.getByTestId('owner-option-u1')).toHaveTextContent('Creative')
  })

  it('selects on click', () => {
    const onChange = vi.fn()
    render(<PersonPicker people={PEOPLE} value="" onChange={onChange} testId="owner" />)
    fireEvent.focus(screen.getByTestId('owner'))
    fireEvent.mouseDown(screen.getByTestId('owner-option-u4'))
    expect(onChange).toHaveBeenCalledWith('u4')
  })

  it('selects with the keyboard alone', () => {
    const onChange = vi.fn()
    render(<PersonPicker people={PEOPLE} value="" onChange={onChange} testId="owner" />)
    const input = screen.getByTestId('owner')
    fireEvent.change(input, { target: { value: 'L' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })   // Lina → Laith
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('u4')
  })

  it('wraps around the ends rather than sticking', () => {
    const onChange = vi.fn()
    render(<PersonPicker people={PEOPLE} value="" onChange={onChange} testId="owner" />)
    const input = screen.getByTestId('owner')
    fireEvent.change(input, { target: { value: 'Lina' } })
    fireEvent.keyDown(input, { key: 'ArrowUp' })     // one option, wraps to itself
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('u1')
  })

  it('shows the chosen person by name, not by id', () => {
    render(<PersonPicker people={PEOPLE} value="u2" onChange={vi.fn()} testId="owner" />)
    expect(screen.getByTestId('owner')).toHaveValue('Omar Al-Rawi')
  })

  it('still offers everyone when a selection is untouched', () => {
    // The box holds the full name, which would match only them and make the list look broken.
    render(<PersonPicker people={PEOPLE} value="u2" onChange={vi.fn()} testId="owner" />)
    fireEvent.focus(screen.getByTestId('owner'))
    expect(within(screen.getByTestId('owner-list')).getAllByRole('option')).toHaveLength(4)
  })

  it('says so when nothing matches, rather than showing an empty box', () => {
    render(<PersonPicker people={PEOPLE} value="" onChange={vi.fn()} testId="owner" />)
    fireEvent.change(screen.getByTestId('owner'), { target: { value: 'zzz' } })
    expect(screen.getByTestId('owner-none')).toBeInTheDocument()
  })

  // THE property. A half-selection is a form that submits somebody nobody picked.
  it('clears the selection when the text names nobody', () => {
    const onChange = vi.fn()
    render(<PersonPicker people={PEOPLE} value="u1" onChange={onChange} testId="owner" />)
    fireEvent.blur(screen.getByTestId('owner'), { target: { value: 'Lin' } })
    expect(onChange).toHaveBeenCalledWith('')
    // …and keeps what was typed, so it can be corrected rather than silently vanishing.
    expect(screen.getByTestId('owner')).toHaveValue('Lin')
  })

  it('accepts a full name typed by hand, case and spacing forgiven', () => {
    const onChange = vi.fn()
    render(<PersonPicker people={PEOPLE} value="" onChange={onChange} testId="owner" />)
    fireEvent.blur(screen.getByTestId('owner'), { target: { value: '  lina haddad ' } })
    expect(onChange).toHaveBeenCalledWith('u1')
  })

  it('abandons the typing on Escape, not the choice', () => {
    render(<PersonPicker people={PEOPLE} value="u1" onChange={vi.fn()} testId="owner" />)
    const input = screen.getByTestId('owner')
    fireEvent.change(input, { target: { value: 'Far' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveValue('Lina Haddad')
    expect(screen.queryByTestId('owner-list')).not.toBeInTheDocument()
  })

  it('carries a hint rather than an empty box', () => {
    render(<PersonPicker people={PEOPLE} value="" onChange={vi.fn()} placeholder="Select deliverable owner" testId="owner" />)
    expect(screen.getByTestId('owner')).toHaveAttribute('placeholder', 'Select deliverable owner')
  })

  it('is a combobox to a screen reader, and says what is highlighted', () => {
    render(<PersonPicker people={PEOPLE} value="" onChange={vi.fn()} testId="owner" />)
    const input = screen.getByTestId('owner')
    expect(input).toHaveAttribute('role', 'combobox')
    fireEvent.change(input, { target: { value: 'Lina' } })
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(input.getAttribute('aria-activedescendant')).toBeTruthy()
  })
})
