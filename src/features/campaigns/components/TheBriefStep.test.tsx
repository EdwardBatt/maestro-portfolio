import { describe, expect, it, vi, beforeAll } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import i18n from '../../../lib/i18n'
import { TheBriefStep, type BriefPart, type BriefRule } from './TheBriefStep'

/**
 * `I56.5` — Figma `CB-v3-02`.
 *
 * What is asserted here is the decisions, not the markup:
 *
 *  - **the counts are derived**, so the rail and the chip cannot disagree with the boxes;
 *  - **a client rule offers no remove at all** — not a disabled one (ADR-0098: a campaign rule
 *    sits on top of the client's, it can never cancel one);
 *  - **the Arabic label ships beside the English one**, in the English locale too, because the pair
 *    is the field name rather than a translation of it;
 *  - **a filled field is legible as filled**, which is what the frame's violet border means and
 *    what the "2 still empty" reading of the screen depends on.
 *
 * The strings are registered here rather than read from `src/locales` because this component's keys
 * are added to the locale files in the same change set by their owner; the bundle below is the
 * copy those keys carry, so the assertions read as the screen reads.
 */
beforeAll(() => {
  // jsdom has no layout, so the rail's scroll-to-part is a no-op it does not implement.
  Element.prototype.scrollIntoView = vi.fn()
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      brief: {
        title: 'The campaign brief',
        lede: 'The Creative Brief, in four parts.',
        railLabel: 'Parts of the brief',
        partCount: '{{filled}} of {{total}}',
        partCountChip: '{{filled}} OF {{total}}',
        ruleCount_one: '{{count}} rule',
        ruleCount_other: '{{count}} rules',
        ruleCountChip_one: '{{count}} RULE',
        ruleCountChip_other: '{{count}} RULES',
        clientLocked: "CLIENT'S {{count}} LOCKED UNDERNEATH",
        nextStep: 'Concept deliverables',
        nextStepHint: 'next step',
        addRule: 'Add a rule',
        removeRule: 'Remove this rule',
        lockedRule: "The client's rule. It cannot be cancelled here.",
        lockedBy: 'Locked · {{source}}',
        source: { client: 'client', campaign: 'campaign' },
        do: 'DO',
        dont: "DON'T",
      },
    },
    true,
    true,
  )
})

const CONTEXT: BriefPart = {
  key: 'context',
  number: '1',
  name: 'Context',
  fields: [
    {
      key: 'background',
      labelEn: 'Background',
      labelAr: 'الخلفية',
      value: 'Season 1 proved the mechanic works.',
      placeholder: 'What has happened so far.',
      multiline: true,
    },
    {
      key: 'task',
      labelEn: 'The task',
      labelAr: 'المهمة',
      value: 'Make the mechanic obvious in three beats.',
      placeholder: 'What this campaign has to do.',
    },
    {
      key: 'problem',
      labelEn: 'The beautiful problem',
      labelAr: 'المشكلة الجوهرية',
      value: '',
      placeholder: 'The one tension worth solving.',
    },
  ],
}

const RULES_PART: BriefPart = {
  key: 'rules',
  number: '5',
  name: "Dos and don'ts",
  fields: [],
  isRules: true,
}

const rule = (over: Partial<BriefRule> & { id: string }): BriefRule => ({
  kind: 'dont',
  text: 'Never "lottery".',
  textAr: null,
  locked: false,
  from: 'campaign',
  ...over,
})

function step(props: Partial<Parameters<typeof TheBriefStep>[0]> = {}) {
  const handlers = {
    onFieldChange: vi.fn(),
    onAddRule: vi.fn(),
    onRemoveRule: vi.fn(),
  }
  render(
    <TheBriefStep parts={[CONTEXT]} rules={[]} testId="brief" {...handlers} {...props} />,
  )
  return handlers
}

describe('TheBriefStep', () => {
  // ADR-0111 addendum / E10 (I59.27): every field with text is checked; a warning, not a refusal.
  it('warns beside any field holding only filler, and says nothing on real text or a blank field', () => {
    step({
      parts: [
        {
          ...CONTEXT,
          fields: CONTEXT.fields.map((f) => ({ ...f, value: f.key === 'background' ? 'TBD' : f.value })),
        },
      ],
      fillerWords: ['coming soon'],
    })
    expect(screen.getByTestId('brief-background-filler')).toHaveTextContent('“TBD” is placeholder text')
    expect(screen.queryByTestId('brief-task-filler')).toBeNull()
    expect(screen.queryByTestId('brief-problem-filler')).toBeNull()
  })

  it("counts the tenant's own filler words", () => {
    step({
      parts: [{ ...CONTEXT, fields: CONTEXT.fields.map((f) => ({ ...f, value: f.key === 'task' ? 'Coming soon' : f.value })) }],
      fillerWords: ['coming soon'],
    })
    expect(screen.getByTestId('brief-task-filler')).toBeInTheDocument()
  })

  it('derives the part count from the fields that actually hold something', () => {
    step()
    // Two of the three carry text, so the rail and the card chip must both say two — neither is
    // told the number.
    expect(screen.getByTestId('brief-rail-count-context')).toHaveTextContent('2 of 3')
    expect(screen.getByTestId('brief-chip-context')).toHaveTextContent('2 OF 3')
  })

  it('counts a field of whitespace as empty', () => {
    step({
      parts: [
        {
          ...CONTEXT,
          fields: CONTEXT.fields.map((f) => ({ ...f, value: f.key === 'task' ? '   ' : f.value })),
        },
      ],
    })
    expect(screen.getByTestId('brief-rail-count-context')).toHaveTextContent('1 of 3')
  })

  it('marks a filled field as filled and an empty one as not', () => {
    step()
    expect(screen.getByTestId('brief-task')).toHaveAttribute('data-filled', 'true')
    expect(screen.getByTestId('brief-problem')).toHaveAttribute('data-filled', 'false')
  })

  it('shows the Arabic label beside the English one in the English locale', () => {
    step()
    const card = screen.getByTestId('brief-card-context')
    expect(within(card).getByText('Background')).toBeInTheDocument()
    expect(within(card).getByText('الخلفية')).toBeInTheDocument()
    expect(within(card).getByText('المهمة')).toBeInTheDocument()
  })

  it('hands a field edit up with its part and field', () => {
    const { onFieldChange } = step()
    fireEvent.change(screen.getByTestId('brief-problem'), {
      target: { value: 'People trust the prize.' },
    })
    expect(onFieldChange).toHaveBeenCalledWith('context', 'problem', 'People trust the prize.')
  })

  it('will not offer to remove a client rule, and does offer for a campaign one', () => {
    const { onRemoveRule } = step({
      parts: [RULES_PART],
      rules: [
        rule({ id: 'r-client', from: 'client', locked: true, text: 'Numbers stay in [brackets].' }),
        rule({ id: 'r-own', kind: 'do', text: 'Tickets are earned.' }),
      ],
    })

    expect(screen.queryByTestId('brief-rule-remove-r-client')).not.toBeInTheDocument()
    expect(screen.getByTestId('brief-rule-locked-r-client')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('brief-rule-remove-r-own'))
    expect(onRemoveRule).toHaveBeenCalledWith('r-own')
  })

  it("counts the campaign's rules and says how many of the client's sit locked underneath", () => {
    step({
      parts: [RULES_PART],
      rules: [
        rule({ id: 'a' }),
        rule({ id: 'b' }),
        rule({ id: 'c', from: 'client', locked: true }),
      ],
    })
    const chip = screen.getByTestId('brief-chip-rules')
    expect(chip).toHaveTextContent('2 RULES')
    expect(chip).toHaveTextContent("CLIENT'S 1 LOCKED UNDERNEATH")
    // The rail counts every rule in force, which is not the same number.
    expect(screen.getByTestId('brief-rail-count-rules')).toHaveTextContent('3 rules')
  })

  it('renders the Arabic wording of a rule when it has one', () => {
    step({
      parts: [RULES_PART],
      rules: [rule({ id: 'a', text: 'The draw.', textAr: 'السحب' })],
    })
    expect(screen.getByText('السحب')).toBeInTheDocument()
  })

  it('asks for a rule without inventing one', () => {
    const { onAddRule } = step({ parts: [RULES_PART], rules: [] })
    fireEvent.click(screen.getByTestId('brief-add-rule'))
    expect(onAddRule).toHaveBeenCalledOnce()
  })

  it('puts the caller’s drop zone above the parts — it draws none of its own', () => {
    // Until 24 Sep this screen drew a drop zone wired to nothing. The one that reads is the caller's.
    step({ top: <div data-testid="the-real-drop" /> })
    expect(screen.getByTestId('the-real-drop')).toBeInTheDocument()
    expect(screen.queryByTestId('brief-drop')).not.toBeInTheDocument()
  })

  it('writes the note under the last part only when given one', () => {
    step()
    expect(screen.queryByTestId('brief-note')).not.toBeInTheDocument()
    cleanup()
    step({ note: 'Budget is on the template and not shown.' })
    expect(screen.getByTestId('brief-note')).toHaveTextContent('Budget is on the template')
  })

  it('moves the rail marker to the part the reader is in', () => {
    step({ parts: [CONTEXT, RULES_PART] })
    expect(screen.getByTestId('brief-rail-context')).toHaveAttribute('aria-current', 'true')

    fireEvent.click(screen.getByTestId('brief-rail-rules'))
    expect(screen.getByTestId('brief-rail-rules')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('brief-rail-context')).not.toHaveAttribute('aria-current')

    // Typing somewhere else moves it back — the rail says where you are, not where you last clicked.
    fireEvent.focus(screen.getByTestId('brief-task'))
    expect(screen.getByTestId('brief-rail-context')).toHaveAttribute('aria-current', 'true')
  })
})
