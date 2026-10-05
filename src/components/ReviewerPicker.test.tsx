import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../lib/i18n'
import { ReviewerPicker } from './ReviewerPicker'
import type { ReviewerAppointment } from '../lib/reviewers/task-reviewers'

/**
 * ADR-0043: the reviewer picker becomes a multi-select with a mandatory toggle per person.
 * ADR-0089 d.3: one of them is always required, and the picker is what makes "several with none
 * marked" unreachable from a screen.
 *
 * The things worth pinning are the ones the ADRs turn on: that several people can be appointed
 * to one task at all, that mandatory-ness is per APPOINTMENT rather than per person, that the first
 * person added is the required one, and that the last required mark cannot be unticked.
 *
 * Dumb component, so no mocks: the caller supplies the eligible people and the database refuses
 * anything else regardless of what this renders.
 */

const OPTIONS = [
  { id: 'u1', name: 'Amir' },
  { id: 'u2', name: 'Yara' },
  { id: 'u3', name: 'Zoe' },
]

function setup(value: ReviewerAppointment[] = [], excludeUserId: string | null = null) {
  const onChange = vi.fn()
  render(
    <ReviewerPicker options={OPTIONS} value={value} onChange={onChange} excludeUserId={excludeUserId} />,
  )
  return onChange
}

describe('ReviewerPicker (ADR-0043)', () => {
  it('starts empty and says so, rather than implying somebody is already appointed', () => {
    setup()
    expect(screen.getByTestId('reviewer-picker-empty')).toBeInTheDocument()
  })

  it('appoints several reviewers, one at a time — the second is optional', () => {
    const onChange = setup([{ userId: 'u1', isMandatory: true }])
    fireEvent.change(screen.getByTestId('reviewer-picker-add'), { target: { value: 'u2' } })
    expect(onChange).toHaveBeenCalledWith([
      { userId: 'u1', isMandatory: true },
      { userId: 'u2', isMandatory: false },
    ])
  })

  it('toggles mandatory on ONE appointment without touching the others', () => {
    const onChange = setup([
      { userId: 'u1', isMandatory: true },
      { userId: 'u2', isMandatory: false },
    ])
    fireEvent.click(screen.getByTestId('reviewer-picker-mandatory-u2'))
    expect(onChange).toHaveBeenCalledWith([
      { userId: 'u1', isMandatory: true },
      { userId: 'u2', isMandatory: true },
    ])
  })

  it('removes an appointment', () => {
    const onChange = setup([
      { userId: 'u1', isMandatory: true },
      { userId: 'u2', isMandatory: false },
    ])
    fireEvent.click(screen.getByTestId('reviewer-picker-remove-u1'))
    expect(onChange).toHaveBeenCalledWith([{ userId: 'u2', isMandatory: false }])
  })

  it('never offers the assignee — nobody reviews their own work (ADR-0043 d.3)', () => {
    setup([], 'u2')
    const options = Array.from(
      screen.getByTestId('reviewer-picker-add').querySelectorAll('option'),
    ).map((o) => o.getAttribute('value'))
    expect(options).not.toContain('u2')
    expect(options).toContain('u1')
  })

  it('does not offer somebody already appointed', () => {
    setup([{ userId: 'u1', isMandatory: true }])
    const options = Array.from(
      screen.getByTestId('reviewer-picker-add').querySelectorAll('option'),
    ).map((o) => o.getAttribute('value'))
    expect(options).not.toContain('u1')
    expect(screen.getByTestId('reviewer-picker-row-u1')).toBeInTheDocument()
  })
})

describe('ReviewerPicker — one reviewer is required (ADR-0089 d.3)', () => {
  it('marks the FIRST person added as required', () => {
    const onChange = setup()
    fireEvent.change(screen.getByTestId('reviewer-picker-add'), { target: { value: 'u3' } })
    expect(onChange).toHaveBeenCalledWith([{ userId: 'u3', isMandatory: true }])
  })

  it('marks the person added as required when the existing list has nobody marked', () => {
    // A list read back from an unassigned task, or one that predates the rule.
    const onChange = setup([{ userId: 'u1', isMandatory: false }])
    fireEvent.change(screen.getByTestId('reviewer-picker-add'), { target: { value: 'u2' } })
    expect(onChange).toHaveBeenCalledWith([
      { userId: 'u1', isMandatory: false },
      { userId: 'u2', isMandatory: true },
    ])
  })

  it('will not untick the last required reviewer', () => {
    const onChange = setup([
      { userId: 'u1', isMandatory: true },
      { userId: 'u2', isMandatory: false },
    ])
    const box = screen.getByTestId('reviewer-picker-mandatory-u1')
    expect(box).toBeDisabled()
    fireEvent.click(box)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('lets the mark move: with two required, either can be unticked', () => {
    const onChange = setup([
      { userId: 'u1', isMandatory: true },
      { userId: 'u2', isMandatory: true },
    ])
    expect(screen.getByTestId('reviewer-picker-mandatory-u1')).not.toBeDisabled()
    fireEvent.click(screen.getByTestId('reviewer-picker-mandatory-u1'))
    expect(onChange).toHaveBeenCalledWith([
      { userId: 'u1', isMandatory: false },
      { userId: 'u2', isMandatory: true },
    ])
  })
})
