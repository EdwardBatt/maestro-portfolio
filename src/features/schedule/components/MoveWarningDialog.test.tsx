import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../../lib/i18n'
import { MoveWarningDialog, type MoveWarningDialogProps } from './MoveWarningDialog'
import type { DropCheck } from '../lib/drop-check'

/**
 * The L6 / L7 move warnings (I59.13, plan View 9). One dialog on both screens; nothing moves until a
 * choice, and every path offers a way through (ADR-0061 d.2).
 */
const clean: DropCheck = { nonWorking: false, blackout: false, overload: null, pastCommitment: null }
const room = [
  { resourceId: 'fadia', name: 'Fadia', pct: 30 },
  { resourceId: 'lujain', name: 'Lujain', pct: 40 },
]

function open(over: Partial<MoveWarningDialogProps> = {}) {
  const handlers = {
    onProceed: vi.fn(), onInstead: vi.fn(), onKeepDate: vi.fn(), onAskExtension: vi.fn(), onCancel: vi.fn(),
  }
  render(
    <MoveWarningDialog
      testId="w"
      taskLabel="Post 2 · Design"
      targetName="Zubaida"
      targetIsoDate="2026-09-25"
      check={clean}
      targetWeekPct={90}
      room={room}
      keepDateIso="2026-09-24"
      canAskExtension
      {...handlers}
      {...over}
    />,
  )
  return handlers
}

describe('L6 — the move lands after its due date', () => {
  const late: DropCheck = { ...clean, pastCommitment: { committedDay: '2026-09-24', landsOn: '2026-09-27', daysLate: 3 } }

  it('says so, in days, and names who has room', () => {
    open({ check: late })
    expect(screen.getByText('That lands after its due date')).toBeInTheDocument()
    expect(screen.getByTestId('w-message')).toHaveTextContent('3 days late')
    expect(screen.getByTestId('w-detail')).toHaveTextContent('Fadia 30%')
  })

  it('"Keep the date" lists the people with room; picking one moves it to them on the kept day', () => {
    const h = open({ check: late })
    expect(screen.queryByTestId('w-room')).toBeNull()
    fireEvent.click(screen.getByTestId('w-keep-date'))
    fireEvent.click(screen.getByTestId('w-keep-date-lujain'))
    expect(h.onKeepDate).toHaveBeenCalledWith('lujain')
    expect(h.onProceed).not.toHaveBeenCalled()
  })

  it('offers the extension, and Move it anyway', () => {
    const h = open({ check: late })
    fireEvent.click(screen.getByTestId('w-extension'))
    expect(h.onAskExtension).toHaveBeenCalled()
    expect(screen.getByTestId('w-confirm')).toHaveTextContent('Move it anyway')
    fireEvent.click(screen.getByTestId('w-confirm'))
    expect(h.onProceed).toHaveBeenCalled()
  })

  it('leaves the extension out where the task cannot ask for one', () => {
    open({ check: late, canAskExtension: false })
    expect(screen.queryByTestId('w-extension')).toBeNull()
  })

  it('Cancel moves nothing', () => {
    const h = open({ check: late })
    fireEvent.click(screen.getByTestId('w-cancel'))
    expect(h.onCancel).toHaveBeenCalled()
    expect(h.onProceed).not.toHaveBeenCalled()
    expect(h.onKeepDate).not.toHaveBeenCalled()
  })
})

describe('L7 — the person is at the ceiling', () => {
  const full: DropCheck = { ...clean, overload: { level: 'breach', pct: 130 } }

  it('names the person and their week, and offers the freest person instead', () => {
    const h = open({ check: full })
    expect(screen.getByText('Zubaida is at 90% already')).toBeInTheDocument()
    expect(screen.getByTestId('w-instead')).toHaveTextContent('Give it to Fadia instead')
    fireEvent.click(screen.getByTestId('w-instead'))
    expect(h.onInstead).toHaveBeenCalledWith('fadia')
  })

  it('"Give it to Zubaida anyway" goes through', () => {
    const h = open({ check: full })
    expect(screen.getByTestId('w-confirm')).toHaveTextContent('Give it to Zubaida anyway')
    fireEvent.click(screen.getByTestId('w-confirm'))
    expect(h.onProceed).toHaveBeenCalled()
  })

  it('offers no one instead when nobody has room', () => {
    open({ check: full, room: [] })
    expect(screen.queryByTestId('w-instead')).toBeNull()
    expect(screen.getByTestId('w-detail')).toHaveTextContent('Nobody on this view has room this week.')
  })
})

describe("the Schedule's existing warnings, in the same dialog", () => {
  it('a day off: says so and offers Move it anyway', () => {
    const h = open({ check: { ...clean, nonWorking: true } })
    expect(screen.getByTestId('w-detail')).toBeInTheDocument()
    expect(screen.queryByTestId('w-instead')).toBeNull()
    expect(screen.queryByTestId('w-keep-date')).toBeNull()
    fireEvent.click(screen.getByTestId('w-confirm'))
    expect(h.onProceed).toHaveBeenCalled()
  })
})
