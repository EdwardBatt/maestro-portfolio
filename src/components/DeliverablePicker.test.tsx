import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '../lib/i18n'
import { DeliverablePicker } from './DeliverablePicker'
import { groupByCategory, rankDeliverables } from '../lib/deliverables/rank-deliverables'

/**
 * ADR-0097 d.7 / I53.3 (Edward, 20 Sep): "any field for selecting a deliverable should be a
 * searchable drop down… with more than 260 deliverables [a plain list] most certainly will cause
 * issues." And: "if we pick a deliverable a type is already mapped" — the 260 catalogue rows ARE
 * the deliverables, so the picker searches them by name, code or category and groups them by
 * category, which is the only thing that tells the two Reels apart.
 */
const ITEMS = [
  { id: 't1', code: 'SOC-004', name: 'Reel', category: 'Social Media', categoryOrder: 10 },
  { id: 't2', code: 'SOC-009', name: 'Social Advertisement', category: 'Social Media', categoryOrder: 10 },
  { id: 't3', code: 'VID-008', name: 'Reel', category: 'Video & Motion', categoryOrder: 20 },
  { id: 't4', code: 'VID-001', name: 'TVC', category: 'Video & Motion', categoryOrder: 20 },
  { id: 't5', code: 'PRT-016', name: 'Print Advertisement', category: 'Print', categoryOrder: 30 },
]

const names = (els: HTMLElement[]) => els.map((e) => e.querySelector('.person-picker-name')?.textContent)

describe('rankDeliverables', () => {
  it('ranks a name or code prefix first, then a substring, then the category', () => {
    expect(rankDeliverables(ITEMS, 're').map((x) => x.id)).toEqual(['t1', 't3'])
    expect(rankDeliverables(ITEMS, 'advert').map((x) => x.id)).toEqual(['t2', 't5'])
    expect(rankDeliverables(ITEMS, 'vid').map((x) => x.id)).toEqual(['t3', 't4'])
    expect(rankDeliverables(ITEMS, 'print').map((x) => x.id)).toEqual(['t5'])
    expect(rankDeliverables(ITEMS, 'motion').map((x) => x.id)).toEqual(['t3', 't4'])
  })

  it('groups the matches by category in catalogue order', () => {
    const groups = groupByCategory(rankDeliverables(ITEMS, 'advert'))
    expect(groups.map((g) => g.category)).toEqual(['Social Media', 'Print'])
  })
})

describe('DeliverablePicker', () => {
  it('filters as you type and groups by category, so the two Reels read apart', () => {
    render(<DeliverablePicker items={ITEMS} value="" onChange={vi.fn()} testId="dlv" />)
    fireEvent.change(screen.getByTestId('dlv'), { target: { value: 'reel' } })
    const list = screen.getByTestId('dlv-list')
    expect(within(list).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Social Media', 'Video & Motion'])
    expect(names(within(list).getAllByRole('option'))).toEqual(['Reel', 'Reel'])
    expect(screen.getByTestId('dlv-option-t3')).toHaveTextContent('VID-008')
  })

  it('finds by code and by category', () => {
    render(<DeliverablePicker items={ITEMS} value="" onChange={vi.fn()} testId="dlv" />)
    fireEvent.change(screen.getByTestId('dlv'), { target: { value: 'PRT' } })
    expect(names(within(screen.getByTestId('dlv-list')).getAllByRole('option'))).toEqual(['Print Advertisement'])
    fireEvent.change(screen.getByTestId('dlv'), { target: { value: 'social' } })
    expect(names(within(screen.getByTestId('dlv-list')).getAllByRole('option'))).toEqual(['Social Advertisement', 'Reel'])
  })

  it('selects on click and shows the code and category as a chip', () => {
    const onChange = vi.fn()
    const { rerender } = render(<DeliverablePicker items={ITEMS} value="" onChange={onChange} testId="dlv" />)
    fireEvent.click(screen.getByTestId('dlv'))
    fireEvent.mouseDown(screen.getByTestId('dlv-option-t3'))
    expect(onChange).toHaveBeenCalledWith('t3')
    rerender(<DeliverablePicker items={ITEMS} value="t3" onChange={onChange} testId="dlv" />)
    expect((screen.getByTestId('dlv') as HTMLInputElement).value).toBe('Reel')
    expect(screen.getByTestId('dlv-chip')).toHaveTextContent('VID-008 · Video & Motion')
  })

  it('selects with the keyboard alone, walking the groups in drawn order', () => {
    const onChange = vi.fn()
    render(<DeliverablePicker items={ITEMS} value="" onChange={onChange} testId="dlv" />)
    const input = screen.getByTestId('dlv')
    fireEvent.change(input, { target: { value: 'reel' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })   // SOC Reel → VID Reel
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('t3')
  })

  it('never half-selects: text that names nothing clears the choice, a whole code selects', () => {
    const onChange = vi.fn()
    render(<DeliverablePicker items={ITEMS} value="t1" onChange={onChange} testId="dlv" />)
    const input = screen.getByTestId('dlv')
    fireEvent.change(input, { target: { value: 'hologram' } })
    fireEvent.blur(input, { target: { value: 'hologram' } })
    expect(onChange).toHaveBeenLastCalledWith('')
    expect(screen.getByTestId('dlv-none')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'vid-001' } })
    fireEvent.blur(input, { target: { value: 'vid-001' } })
    expect(onChange).toHaveBeenLastCalledWith('t4')
  })

  it('a blur with nothing typed changes nothing — even where two entries share the name', () => {
    const onChange = vi.fn()
    render(<DeliverablePicker items={ITEMS} value="t3" onChange={onChange} testId="dlv" />)
    const input = screen.getByTestId('dlv')
    fireEvent.click(input)
    fireEvent.blur(input, { target: { value: 'Reel' } })
    expect(onChange).not.toHaveBeenCalled()
  })
})
