import { useState } from 'react'
import { describe, expect, it, vi, beforeAll } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import i18n from '../../../lib/i18n'
import { BRIEF_FIELD_KEYS, type BriefFieldKey } from '../../../lib/brief/fields'
import { BriefStepContainer } from './BriefStepContainer'
import type { BriefRule } from './TheBriefStep'

/**
 * `I56.5` / `I56.6` — the adapter, not the screen. `TheBriefStep.test.tsx` already holds the
 * frame's own decisions; what is asserted here is the mapping between the wizard's flat brief
 * state and those parts:
 *
 *  - **the fourteen fields land in the frame's five rows**, with the performance flight as its own
 *    part and never gated (ADR-0050 d.5);
 *  - **both labels are read from the locale files**, so the Arabic label is the one shipped beside
 *    the English one rather than a string in a component;
 *  - **the machine-filled marker survives the move** — a field the ingest filled is still marked,
 *    Keep still drops the mark, and typing still drops it (ADR-0044 §5);
 *  - **the rule dialog belongs to this file**, so the wizard is handed a finished rule rather than
 *    a request to open something.
 *
 * `brief.*` and `campaigns.strategy.*` come from the real locale files, which is the point of the
 * Arabic-label assertion. Only the keys this adapter ADDS are registered here; they are merged
 * into `src/locales` in the same change set by their owner.
 */
beforeAll(() => {
  // jsdom has no layout, so the rail's scroll-to-part is a no-op it does not implement.
  Element.prototype.scrollIntoView = vi.fn()
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      brief: {
        part: {
          context: 'Context',
          audience: 'Audience and brand',
          idea: 'The idea',
          journey: 'Journey and measures',
          rules: "Dos and don'ts",
        },
        rule: { locale: { en: 'English', ar: 'Arabic' } },
      },
      campaigns: {
        briefPlaceholder: {
          background: 'What has happened so far.',
          proposition: 'The one thing the work must say.',
          perfObjective: 'What this flight has to achieve.',
        },
      },
    },
    true,
    true,
  )
})

const blank = (): Record<BriefFieldKey, string> =>
  Object.fromEntries(BRIEF_FIELD_KEYS.map((k) => [k, ''])) as Record<BriefFieldKey, string>

const rule = (over: Partial<BriefRule> & { id: string }): BriefRule => ({
  kind: 'dont',
  text: 'Never "lottery".',
  textAr: null,
  locked: false,
  from: 'campaign',
  ...over,
})

function view(props: Partial<Parameters<typeof BriefStepContainer>[0]> = {}) {
  const handlers = {
    onFieldChange: vi.fn(),
    onConfirmField: vi.fn(),
    onAddRule: vi.fn(),
    onRemoveRule: vi.fn(),
  }
  render(
    <BriefStepContainer
      values={blank()}
      machineFilled={[]}
      rules={[]}
      testId="brief"
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

describe('BriefStepContainer', () => {
  it("lays the wizard's fields out in the frame's parts", () => {
    view()
    for (const part of ['context', 'audience', 'idea', 'journey', 'rules']) {
      expect(screen.getByTestId(`brief-rail-${part}`)).toBeInTheDocument()
    }
    // Part 1 is the three context questions, in the brief's own order.
    const context = screen.getByTestId('brief-card-context')
    expect(within(context).getByTestId('brief-background')).toBeInTheDocument()
    expect(within(context).getByTestId('brief-task')).toBeInTheDocument()
    expect(within(context).getByTestId('brief-beautifulProblem')).toBeInTheDocument()
    // …and it does not reach into the next one.
    expect(within(context).queryByTestId('brief-insight')).not.toBeInTheDocument()
  })

  it('keeps the strategy fields and the performance flight apart', () => {
    view()
    const thought = screen.getByTestId('brief-card-idea')
    expect(within(thought).getByTestId('brief-insight')).toBeInTheDocument()
    expect(within(thought).getByTestId('brief-proposition')).toBeInTheDocument()

    const flight = screen.getByTestId('brief-card-journey')
    expect(within(flight).getByTestId('brief-perfObjective')).toBeInTheDocument()
    expect(within(flight).getByTestId('brief-perfPlatforms')).toBeInTheDocument()
  })

  it('puts every one of the fourteen fields on screen exactly once for someone who may see the budget', () => {
    view({ showBudget: true })
    for (const key of BRIEF_FIELD_KEYS) {
      expect(screen.getAllByTestId(new RegExp(`^brief-${key}$`)).length).toBe(1)
    }
    expect(screen.getByTestId('brief-rail-count-journey')).toHaveTextContent('0 of 5')
    expect(screen.queryByTestId('brief-note')).not.toBeInTheDocument()
  })

  it('hides the budget — field, count and filled-marker — from everyone else (I56.18)', () => {
    view({ values: { ...blank(), perfBudget: '$40,000' }, machineFilled: ['perfBudget', 'insight'] })
    expect(screen.queryByTestId('brief-perfBudget')).not.toBeInTheDocument()
    expect(screen.getByTestId('brief-rail-count-journey')).toHaveTextContent('0 of 4')
    expect(screen.queryByTestId('brief-perfBudget-suggested')).not.toBeInTheDocument()
    expect(screen.getByTestId('brief-insight-suggested')).toBeInTheDocument()
    expect(screen.getByTestId('brief-note')).toBeInTheDocument()
  })

  it('shows the performance flight with nothing gating it', () => {
    // ADR-0050 d.5: no campaign-level brief type decides whether the flight appears. It is a part
    // like any other, and there is no prop that can hide it.
    view()
    expect(screen.getByTestId('brief-rail-journey')).toBeInTheDocument()
    expect(screen.getByTestId('brief-rail-count-journey')).toHaveTextContent('0 of 4')
  })

  it("carries each field's value through, and its count with it", () => {
    view({ values: { ...blank(), background: 'Season 1 proved the mechanic works.' } })
    expect(screen.getByTestId('brief-background')).toHaveValue(
      'Season 1 proved the mechanic works.',
    )
    expect(screen.getByTestId('brief-rail-count-context')).toHaveTextContent('1 of 3')
  })

  it('shows the Arabic label beside the English one in the English locale', () => {
    view()
    const context = screen.getByTestId('brief-card-context')
    // Both read from `campaigns.strategy.background` in the real locale files — the pair is the
    // field name, not a translation of it.
    expect(within(context).getByText('Background')).toBeInTheDocument()
    expect(within(context).getByText('الخلفية')).toBeInTheDocument()

    const flight = screen.getByTestId('brief-card-journey')
    expect(within(flight).getByText('Campaign objective')).toBeInTheDocument()
    expect(within(flight).getByText('هدف الحملة')).toBeInTheDocument()
  })

  it('hands an edit up by field key alone — the part is this file’s business, not the wizard’s', () => {
    const { onFieldChange } = view()
    fireEvent.change(screen.getByTestId('brief-proposition'), {
      target: { value: 'Tickets are earned, never drawn.' },
    })
    expect(onFieldChange).toHaveBeenCalledWith('proposition', 'Tickets are earned, never drawn.')
  })

  it('marks a field the ingest filled, and only that field', () => {
    view({
      values: { ...blank(), background: 'From the document.', task: 'Typed by hand.' },
      machineFilled: ['background'],
    })
    expect(screen.getByTestId('brief-background-suggested')).toHaveTextContent(
      'from the brief',
    )
    // On the field itself (Edward, 24 Sep): the mark sits in the Background card, not in a strip.
    expect(within(screen.getByTestId('brief-card-context')).getByTestId('brief-background-keep')).toBeInTheDocument()
    expect(screen.queryByTestId('brief-task-suggested')).not.toBeInTheDocument()
  })

  it('says nothing at all when the ingest filled nothing', () => {
    view()
    expect(screen.queryAllByTestId(/-suggested$/)).toHaveLength(0)
  })

  it('hands Keep up as a confirmation of that one field', () => {
    const { onConfirmField, onFieldChange } = view({
      values: { ...blank(), insight: 'People trust the prize.' },
      machineFilled: ['insight'],
    })
    fireEvent.click(screen.getByTestId('brief-insight-keep'))
    expect(onConfirmField).toHaveBeenCalledWith('insight')
    // Keep confirms; it never rewrites what it confirms.
    expect(onFieldChange).not.toHaveBeenCalled()
  })

  it('drops the marker the moment the field is edited', () => {
    // The wizard's reducer clears `machineFilled` on `setField` (ADR-0044 §5). Stood up here so
    // the adapter is proved to pass the edit on in a shape that can actually clear it.
    function Harness() {
      const [values, setValues] = useState(() => ({
        ...blank(),
        perfBudget: '$40,000',
      }))
      const [marked, setMarked] = useState<readonly BriefFieldKey[]>(['perfBudget'])
      return (
        <BriefStepContainer
          values={values}
          machineFilled={marked}
          rules={[]}
          onFieldChange={(key, value) => {
            setValues((prev) => ({ ...prev, [key]: value }))
            setMarked((prev) => prev.filter((k) => k !== key))
          }}
          onConfirmField={(key) => setMarked((prev) => prev.filter((k) => k !== key))}
          onAddRule={vi.fn()}
          onRemoveRule={vi.fn()}
          showBudget
          testId="brief"
        />
      )
    }
    render(<Harness />)

    expect(screen.getByTestId('brief-perfBudget-suggested')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('brief-perfBudget'), {
      target: { value: '$40,000 — signed off 12 Sep' },
    })
    expect(screen.queryByTestId('brief-perfBudget-suggested')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId(/-suggested$/)).toHaveLength(0)
  })

  it('opens the rule dialog and hands the finished rule back', () => {
    const { onAddRule } = view({
      ruleLocales: [
        { value: 'ar', label: 'Arabic' },
        { value: 'en', label: 'English' },
      ],
    })
    expect(screen.queryByTestId('brief-rule-dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('brief-add-rule'))
    fireEvent.click(screen.getByTestId('brief-rule-dialog-kind-dont'))
    fireEvent.change(screen.getByTestId('brief-rule-dialog-text'), {
      target: { value: 'Never "lottery".' },
    })
    fireEvent.click(screen.getByTestId('brief-rule-dialog-submit'))

    expect(onAddRule).toHaveBeenCalledWith({
      kind: 'dont',
      text: 'Never "lottery".',
      locales: ['ar', 'en'],
      because: '',
    })
    // It closes on the way out — the wizard is not asked to close something it did not open.
    expect(screen.queryByTestId('brief-rule-dialog')).not.toBeInTheDocument()
  })

  it('closes the rule dialog without inventing a rule', () => {
    const { onAddRule } = view()
    fireEvent.click(screen.getByTestId('brief-add-rule'))
    fireEvent.click(screen.getByTestId('brief-rule-dialog-cancel'))
    expect(screen.queryByTestId('brief-rule-dialog')).not.toBeInTheDocument()
    expect(onAddRule).not.toHaveBeenCalled()
  })

  it('offers the languages the app speaks when the campaign names none', () => {
    // An empty set would leave "Applies in" with nothing pressed and the dialog unsubmittable.
    view({ ruleLocales: [] })
    fireEvent.click(screen.getByTestId('brief-add-rule'))
    expect(screen.getByTestId('brief-rule-dialog-locale-en')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByTestId('brief-rule-dialog-locale-ar')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('passes the rules straight through, client rules and all', () => {
    const { onRemoveRule } = view({
      rules: [
        rule({ id: 'r-client', from: 'client', locked: true, text: 'Numbers stay in [brackets].' }),
        rule({ id: 'r-own', kind: 'do', text: 'Tickets are earned.' }),
      ],
    })
    expect(screen.queryByTestId('brief-rule-remove-r-client')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('brief-rule-remove-r-own'))
    expect(onRemoveRule).toHaveBeenCalledWith('r-own')
  })
})
