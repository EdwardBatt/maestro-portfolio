import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { InfoTip } from './InfoTip'

/**
 * The (i) that holds standing advice app-wide (Edward, 24 Sep). What is worth holding: a press pins
 * it open and Escape closes it, and a tip low on the screen opens ABOVE its (i) — opened below, it
 * ran off the bottom of the window (24 Sep walkthrough).
 */
function at(bottom: number) {
  render(<InfoTip label="About this" lines={['One line of advice.']} testId="tip" />)
  const wrap = screen.getByTestId('tip')
  wrap.getBoundingClientRect = () => ({ bottom, top: bottom - 16, left: 0, right: 16, width: 16, height: 16, x: 0, y: bottom - 16, toJSON: () => ({}) })
  return wrap
}

describe('InfoTip', () => {
  it('pins open on a press and closes on Escape', () => {
    const wrap = at(100)
    fireEvent.click(screen.getByTestId('tip-button'))
    expect(wrap).toHaveClass('is-open')
    fireEvent.keyDown(screen.getByTestId('tip-button'), { key: 'Escape' })
    expect(wrap).not.toHaveClass('is-open')
    expect(screen.getByTestId('tip-body')).toHaveTextContent('One line of advice.')
  })

  it('opens below its (i) near the top of the window', () => {
    const wrap = at(100)
    fireEvent.mouseEnter(wrap)
    expect(wrap).not.toHaveClass('is-above')
  })

  it('opens above its (i) near the bottom of the window, so it never runs off the screen', () => {
    const wrap = at(window.innerHeight - 20)
    fireEvent.mouseEnter(wrap)
    expect(wrap).toHaveClass('is-above')
    fireEvent.focus(screen.getByTestId('tip-button'))
    expect(wrap).toHaveClass('is-above')
  })
})
