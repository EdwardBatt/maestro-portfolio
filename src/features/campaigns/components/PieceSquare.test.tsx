import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import { PieceSquare, SquareLegend } from './PieceSquare'

describe('PieceSquare — one piece, one colour (I57.6, I57.7)', () => {
  it('names the piece and where it is, and opens it', () => {
    const onOpen = vi.fn()
    render(<PieceSquare piece={{ id: 'd1', code: 'DA-005', name: 'Opener' }} status="late" onOpen={onOpen} />)
    const sq = screen.getByTestId('season-square-d1')
    expect(sq).toHaveAccessibleName('DA-005 Opener — Late')
    expect(sq).toHaveClass('piece-square', 'is-late')
    fireEvent.click(sq)
    expect(onOpen).toHaveBeenCalledWith('d1')
  })

  it('the legend lists the five colours, Approved and Blocked (I67.4: "Waiting" retired)', () => {
    render(<SquareLegend testId="legend" />)
    expect(screen.getByTestId('legend').querySelectorAll('li')).toHaveLength(7)
    expect(screen.getByTestId('legend')).toHaveTextContent('DeliveredApprovedIn progressIn reviewBlockedNot startedLate')
  })
})
