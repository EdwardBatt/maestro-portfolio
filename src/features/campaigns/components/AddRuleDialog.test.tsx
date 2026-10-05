import { describe, expect, it, vi, beforeAll } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../../lib/i18n'
import { AddRuleDialog } from './AddRuleDialog'

/**
 * `I56.6` — Figma `CB-v3-P2`.
 *
 * The decisions worth holding: a rule is nothing without its text, every language starts on
 * because a wording rule usually holds everywhere, and the modal can only ever *add* — there is no
 * control here that cancels a client rule, and there must never be one (ADR-0098).
 */
beforeAll(() => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      brief: {
        rule: {
          eyebrow: 'A CAMPAIGN RULE',
          title: "Add a do or a don't",
          intro: 'It travels with every deliverable in this campaign.',
          kindLabel: "Do or don't",
          do: 'Do',
          dont: "Don't",
          text: 'The rule',
          textPlaceholder: 'What to always do, or never do.',
          appliesIn: 'Applies in',
          because: 'Because',
          becausePlaceholder: 'Who asked for it, and when.',
          becauseHint: 'optional, but the next person will thank you',
          lockedNote: "The client's rules stay locked underneath.",
          submit: 'Add the rule',
        },
      },
    },
    true,
    true,
  )
})

const LOCALES = [
  { value: 'ar', label: 'Arabic' },
  { value: 'en', label: 'English' },
  { value: 'ku', label: 'Kurdish' },
] as const

function dialog(props: Partial<Parameters<typeof AddRuleDialog>[0]> = {}) {
  const onAdd = vi.fn()
  const onCancel = vi.fn()
  render(<AddRuleDialog locales={LOCALES} onAdd={onAdd} onCancel={onCancel} {...props} />)
  return { onAdd, onCancel }
}

describe('AddRuleDialog', () => {
  it('starts on every language the campaign runs in', () => {
    dialog()
    for (const l of LOCALES) {
      expect(screen.getByTestId(`add-rule-locale-${l.value}`)).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    }
  })

  it('will not add a rule with no words in it', () => {
    const { onAdd } = dialog()
    expect(screen.getByTestId('add-rule-submit')).toBeDisabled()
    fireEvent.click(screen.getByTestId('add-rule-submit'))
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('treats a rule of whitespace as no rule', () => {
    dialog()
    fireEvent.change(screen.getByTestId('add-rule-text'), { target: { value: '   ' } })
    expect(screen.getByTestId('add-rule-submit')).toBeDisabled()
  })

  it('hands up the kind, the trimmed text, the languages and the reason', () => {
    const { onAdd } = dialog()
    fireEvent.click(screen.getByTestId('add-rule-kind-dont'))
    fireEvent.change(screen.getByTestId('add-rule-text'), {
      target: { value: '  Never "lottery". Never قرعة.  ' },
    })
    fireEvent.click(screen.getByTestId('add-rule-locale-ku'))
    fireEvent.change(screen.getByTestId('add-rule-because'), {
      target: { value: 'Regulatory. Kite legal, 12 Sep.' },
    })
    fireEvent.click(screen.getByTestId('add-rule-submit'))

    expect(onAdd).toHaveBeenCalledWith({
      kind: 'dont',
      text: 'Never "lottery". Never قرعة.',
      locales: ['ar', 'en'],
      because: 'Regulatory. Kite legal, 12 Sep.',
    })
  })

  it('defaults to a do, and marks the chosen kind for a screen reader', () => {
    const { onAdd } = dialog()
    expect(screen.getByTestId('add-rule-kind-do')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('add-rule-kind-dont')).toHaveAttribute('aria-checked', 'false')

    fireEvent.change(screen.getByTestId('add-rule-text'), { target: { value: 'Tickets are earned.' } })
    fireEvent.click(screen.getByTestId('add-rule-submit'))
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'do', because: '' }),
    )
  })

  it('refuses a rule that applies nowhere', () => {
    dialog()
    fireEvent.change(screen.getByTestId('add-rule-text'), { target: { value: 'Tickets are earned.' } })
    for (const l of LOCALES) fireEvent.click(screen.getByTestId(`add-rule-locale-${l.value}`))
    expect(screen.getByTestId('add-rule-submit')).toBeDisabled()
  })

  it('says twice that a client rule cannot be cancelled here, and offers no way to try', () => {
    dialog()
    expect(screen.getByText(/travels with every deliverable/i)).toBeInTheDocument()
    expect(screen.getByText(/locked underneath/i)).toBeInTheDocument()
    expect(screen.queryByText(/override/i)).not.toBeInTheDocument()
  })

  it('closes without adding anything', () => {
    const { onAdd, onCancel } = dialog()
    fireEvent.click(screen.getByTestId('add-rule-cancel'))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('closes on Escape', () => {
    const { onCancel } = dialog()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
