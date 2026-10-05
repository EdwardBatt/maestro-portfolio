import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TemplateCard } from './TemplateCard'

describe('TemplateCard (SJ-v3-01)', () => {
  it('is a toggle button that carries its hue and reports the press', () => {
    const onClick = vi.fn()
    render(
      <TemplateCard
        icon={<svg data-testid="icon" />}
        title="Execution Brief"
        alt="بريف تنفيذي"
        description="One asset, already agreed."
        badge="Creative"
        count="6 fields"
        note="Ramadan 2026 · 3 briefs"
        hue={1}
        selected
        onClick={onClick}
        testId="card"
      />,
    )
    const card = screen.getByTestId('card')
    expect(card).toHaveAttribute('aria-pressed', 'true')
    expect(card).toHaveAttribute('data-hue', '1')
    expect(card).toHaveTextContent('Execution Brief')
    expect(card).toHaveTextContent('بريف تنفيذي')
    expect(card).toHaveTextContent('One asset, already agreed.')
    expect(card).toHaveTextContent('Creative')
    expect(card).toHaveTextContent('6 fields')
    expect(card).toHaveTextContent('Ramadan 2026 · 3 briefs')
    fireEvent.click(card)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('leaves out what it is not given, and a quiet note is marked so', () => {
    render(<TemplateCard icon={<span />} title="House Style" note="Not used yet" noteQuiet onClick={() => {}} testId="card" />)
    const card = screen.getByTestId('card')
    expect(card).toHaveAttribute('aria-pressed', 'false')
    expect(card.querySelector('.template-card-alt')).toBeNull()
    expect(card.querySelector('.template-card-meta')).toBeNull()
    expect(card.querySelector('.template-card-note')).toHaveClass('is-quiet')
  })
})
