import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../lib/i18n'
import { Modal } from './Modal'
import { PersonPicker } from './PersonPicker'

const PEOPLE = [
  { id: 'u1', name: 'Lina Haddad' },
  { id: 'u2', name: 'Omar Al-Rawi' },
]

describe('Modal — where focus lands when it opens', () => {
  it('on the first control', () => {
    render(
      <Modal onClose={vi.fn()}>
        <input data-testid="first" />
        <textarea data-testid="second" />
      </Modal>,
    )
    expect(screen.getByTestId('first')).toHaveFocus()
  })

  // Nudge, 25 Sep: the picker was focused on open, its list opened over the message box and Send,
  // and a click on the message box picked somebody else.
  it('never on a person picker, whose list would open over the dialog — on the next control instead', () => {
    render(
      <Modal onClose={vi.fn()}>
        <PersonPicker people={PEOPLE} value="u1" onChange={vi.fn()} testId="to" />
        <textarea data-testid="message" />
      </Modal>,
    )
    expect(screen.getByTestId('message')).toHaveFocus()
    expect(screen.getByTestId('to')).not.toHaveFocus()
    expect(screen.queryByTestId('to-list')).toBeNull()
  })
})
