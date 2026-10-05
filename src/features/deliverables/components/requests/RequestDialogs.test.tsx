import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '../../../../lib/i18n'

/**
 * The task page's own dialogs (I59 Track 6, plan View 6): Ask someone — anyone, the piece's people
 * first with their part, the account manager ticked, several allowed; I'm blocked — the three fields;
 * Too much — the maker's week. Each ends with who is told. The writes are spies.
 */
const spy = vi.hoisted(() => ({ ask: vi.fn(), raise: vi.fn(), tooMuch: vi.fn() }))
const state = vi.hoisted(() => ({ load: null as unknown }))

vi.mock('../../api/requests-api', () => ({
  usePiecePeople: () => ({
    data: {
      people: [
        { id: 'am1', name: 'Inas', parts: ['account_manager'] },
        { id: 'own', name: 'Fadia', parts: ['owner', 'assigner'] },
        { id: 'me', name: 'Zubaida', parts: ['maker'] },
      ],
      ownerId: 'own', ownerName: 'Fadia', accountManagerId: 'am1', accountManagerName: 'Inas',
    },
  }),
  useEveryone: () => ({ data: [{ id: 'am1', name: 'Inas' }, { id: 'own', name: 'Fadia' }, { id: 'me', name: 'Zubaida' }, { id: 'abeer', name: 'Abeer' }] }),
  useAskQuestion: () => ({ mutate: spy.ask, isPending: false }),
  useRaiseBlock: () => ({ mutate: spy.raise, isPending: false }),
  useSayTooMuch: () => ({ mutate: spy.tooMuch, isPending: false }),
  BLOCK_KINDS: ['copy', 'client', 'file', 'decision', 'other'],
}))
vi.mock('../../../team/api/team-api', () => ({ useMyLoad: () => ({ data: state.load, isLoading: false, isError: false }) }))

import { AskDialog } from './AskDialog'
import { BlockDialog } from './BlockDialog'
import { TooMuchDialog } from './TooMuchDialog'
import { RequestEyebrowContext } from './request-eyebrow'

beforeEach(() => {
  for (const f of Object.values(spy)) f.mockReset()
  state.load = null
})

describe('Ask someone (ADR-0113 d.2)', () => {
  it("lists the piece's people first with their part, never me, the AM ticked; everyone else after", () => {
    render(<AskDialog deliverableId="d1" subTaskId="st1" pieceLabel="Post 2" meId="me" onClose={() => {}} />)
    const first = screen.getByTestId('ask-piece-people')
    expect(within(first).getByText('Inas')).toBeInTheDocument()
    expect(within(first).getByText('Owner · Gave out the work')).toBeInTheDocument()
    expect(screen.queryByTestId('ask-person-me')).not.toBeInTheDocument()
    expect(screen.getByTestId('ask-person-am1')).toBeChecked()
    expect(screen.getByTestId('ask-person-abeer')).not.toBeChecked()
    expect(screen.getByTestId('ask-told')).toHaveTextContent('Inas')
  })

  it('asks several at once, and needs the question written', () => {
    const close = vi.fn()
    render(<AskDialog deliverableId="d1" subTaskId="st1" pieceLabel="Post 2" meId="me" onClose={close} />)
    fireEvent.click(screen.getByTestId('ask-person-abeer'))
    expect(screen.getByTestId('ask-told')).toHaveTextContent('Inas and Abeer')
    expect(screen.getByTestId('ask-send')).toBeDisabled()
    fireEvent.change(screen.getByTestId('ask-body'), { target: { value: 'Is the headline final?' } })
    fireEvent.click(screen.getByTestId('ask-send'))
    expect(spy.ask).toHaveBeenCalledWith(
      { deliverableId: 'd1', subTaskId: 'st1', recipients: ['am1', 'abeer'], body: 'Is the headline final?' },
      expect.anything(),
    )
  })

  it('searches anyone by name', () => {
    render(<AskDialog deliverableId="d1" subTaskId="st1" pieceLabel="Post 2" meId="me" onClose={() => {}} />)
    fireEvent.change(screen.getByTestId('ask-search'), { target: { value: 'abe' } })
    expect(screen.getByTestId('ask-person-abeer')).toBeInTheDocument()
    expect(screen.queryByTestId('ask-person-own')).not.toBeInTheDocument()
  })

  it('can untick the account manager — nobody picked cannot be sent', () => {
    render(<AskDialog deliverableId="d1" subTaskId="st1" pieceLabel="Post 2" meId="me" onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('ask-person-am1'))
    fireEvent.change(screen.getByTestId('ask-body'), { target: { value: 'x' } })
    expect(screen.getByTestId('ask-send')).toBeDisabled()
    expect(screen.getByTestId('ask-told')).toHaveTextContent('nobody')
  })
})

describe("I'm blocked (ADR-0107 d.2)", () => {
  it('needs a kind, who has it and what you need, then raises it on this task', () => {
    render(<BlockDialog deliverableId="d1" subTaskId="st1" taskTitle="Cards" ownerName="Fadia" accountManagerName="Inas" onClose={() => {}} />)
    expect(screen.getByTestId('block-told')).toHaveTextContent('Fadia and Inas')
    fireEvent.click(screen.getByTestId('block-kind-client'))
    fireEvent.change(screen.getByTestId('block-who'), { target: { value: 'Kite' } })
    expect(screen.getByTestId('block-send')).toBeDisabled()
    fireEvent.change(screen.getByTestId('block-need'), { target: { value: 'the offer terms' } })
    fireEvent.click(screen.getByTestId('block-send'))
    expect(spy.raise).toHaveBeenCalledWith(
      { deliverableId: 'd1', subTaskId: 'st1', kind: 'client', awaitedFrom: 'Kite', description: 'the offer terms' },
      expect.anything(),
    )
  })
})

describe('Too much (ADR-0113 d.3)', () => {
  it("shows the maker's week and sends with an optional note to whoever assigned it", () => {
    state.load = {
      hasResource: true, week: { start: '', end: '', label: '' }, bookedHours: 40, bookingCount: 4, utilPct: 100, level: 'warn',
      days: [{ date: '2026-09-20', weekday: 0, hours: 8, working: true }], dayHours: 8, warnPct: 100,
    }
    render(<TooMuchDialog subTaskId="st1" taskTitle="Explainer" assignerName="Fadia" meId="me" onClose={() => {}} />)
    expect(screen.getByTestId('too-much-week-total')).toHaveTextContent('40h booked · 100%')
    expect(screen.getByTestId('too-much-day-2026-09-20')).toHaveTextContent('8h')
    expect(screen.getByTestId('too-much-told')).toHaveTextContent('Fadia')
    fireEvent.click(screen.getByTestId('too-much-send'))
    expect(spy.tooMuch).toHaveBeenCalledWith({ subTaskId: 'st1', note: '' }, expect.anything())
  })

  it('still sends when the week cannot be read', () => {
    render(<TooMuchDialog subTaskId="st1" taskTitle="Explainer" assignerName={null} meId="me" onClose={() => {}} />)
    expect(screen.getByTestId('too-much-no-week')).toBeInTheDocument()
    expect(screen.getByTestId('too-much-send')).not.toBeDisabled()
  })
})

describe("the frames' shell (NY-*)", () => {
  it("shows the card's kind as an eyebrow in its group's colour, the main button first, and who is told in the foot", () => {
    render(
      <RequestEyebrowContext.Provider value={{ text: 'Someone is blocked', tone: 'today' }}>
        <BlockDialog deliverableId="d1" subTaskId="st1" taskTitle="Winner cards" ownerName="Fadia" accountManagerName="Inas" onClose={() => {}} />
      </RequestEyebrowContext.Provider>,
    )
    const eyebrow = screen.getByTestId('block-eyebrow')
    expect(eyebrow).toHaveTextContent('Someone is blocked')
    expect(eyebrow).toHaveClass('rq-eyebrow-today')
    const buttons = within(screen.getByTestId('block-dialog').querySelector('.dialog-actions') as HTMLElement).getAllByRole('button')
    expect(buttons[0]).toBe(screen.getByTestId('block-send'))
    expect(buttons.at(-1)).toBe(screen.getByTestId('block-cancel'))
    expect(screen.getByTestId('block-told').closest('.rq-foot')).not.toBeNull()
  })

  it('has no eyebrow when opened outside Needs you (the task page)', () => {
    render(<BlockDialog deliverableId="d1" subTaskId="st1" taskTitle="Winner cards" ownerName="Fadia" accountManagerName="Inas" onClose={() => {}} />)
    expect(screen.queryByTestId('block-eyebrow')).not.toBeInTheDocument()
  })
})
