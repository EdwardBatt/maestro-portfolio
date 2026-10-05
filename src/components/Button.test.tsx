import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../lib/i18n'
import { Button } from './Button'

describe('Button — the arrow variant (Figma "C · Arrow", I59)', () => {
  it('is a button with the label, then the arrow, which is hidden from a screen reader', () => {
    const onClick = vi.fn()
    render(<Button variant="arrow" onClick={onClick}>Open the pins</Button>)
    const b = screen.getByRole('button', { name: 'Open the pins' })
    expect(b).toHaveClass('btn', 'btn-arrow')
    const mark = b.querySelector('.btn-arrow-mark')
    expect(mark).not.toBeNull()
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    expect(b.lastElementChild).toBe(mark)
    fireEvent.click(b)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('carries the arrow as a link too', () => {
    render(
      <MemoryRouter>
        <Button variant="arrow" to="/my-work">Open it</Button>
      </MemoryRouter>,
    )
    const a = screen.getByRole('link', { name: 'Open it' })
    expect(a).toHaveClass('btn-arrow')
    expect(a.querySelector('.btn-arrow-mark')).not.toBeNull()
  })

  it('no other variant draws the arrow', () => {
    render(<Button variant="primary">Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' }).querySelector('.btn-arrow-mark')).toBeNull()
  })
})

describe('Button — the action tone (E17, I59: colour by what it does, never by role)', () => {
  it('no tone is the plain violet primary: no tone class at all', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' }).className).not.toMatch(/btn-tone-/)
  })

  it.each([
    ['approve', 'primary'],
    ['change', 'arrow'],
    ['caution', 'secondary'],
  ] as const)('tone %s on %s adds btn-tone-%s and keeps the variant', (tone, variant) => {
    render(<Button variant={variant} tone={tone}>Go</Button>)
    const b = screen.getByRole('button', { name: 'Go' })
    expect(b).toHaveClass('btn', `btn-${variant}`, `btn-tone-${tone}`)
  })

  it('the arrow keeps its ▶ under a tone', () => {
    render(<Button variant="arrow" tone="approve">Approve it</Button>)
    expect(screen.getByRole('button', { name: 'Approve it' }).querySelector('.btn-arrow-mark')).not.toBeNull()
  })

  it('carries the tone on a link too, and leaves the test id and the handler alone', () => {
    const onClick = vi.fn()
    render(
      <MemoryRouter>
        <Button to="/x" variant="primary" tone="change" data-testid="t-link">Accept</Button>
        <Button tone="caution" variant="secondary" onClick={onClick} data-testid="t-btn">Refuse</Button>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('t-link')).toHaveClass('btn-tone-change')
    fireEvent.click(screen.getByTestId('t-btn'))
    expect(onClick).toHaveBeenCalledOnce()
  })
})
