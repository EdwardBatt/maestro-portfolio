// ADR-0066 (I35.5) — the model proposes, a person confirms, and a partial reading is normal.
//
// Four properties carry this panel, and each is one the feature is worthless without:
//
//   d.4  the three fields are EDITABLE and MARKED. Read-only would make an unchecked machine
//        reading the origin of an accountability measure; unmarked would hide that a machine
//        produced it.
//   d.5  confirmation is what starts the clock, so an edit must UN-confirm — otherwise somebody
//        agrees to one set of values and a different set is what gets measured.
//   d.13 a screenshot showing `14:32` and no date is the commonest case there is. The panel asks
//        for the missing half rather than reporting a failure, and cannot be confirmed until it
//        has both.
//   d.3  a pasted image has no filename, and the panel must still accept it.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import '../../../lib/i18n'

const readMutate = vi.hoisted(() => vi.fn())
vi.mock('../api/brief-receipt-api', () => ({
  ReceiptReadRefusedError: class ReceiptReadRefusedError extends Error {
    code: string
    constructor(code: string) {
      super(code)
      this.code = code
    }
  },
  useReadBriefReceipt: () => ({ mutate: readMutate, isPending: false }),
  useReceiptTimeZones: () => ({ data: { mine: 'Asia/Dubai', options: ['Asia/Dubai', 'Europe/London'] } }),
}))

import { BriefReceiptPanel, EMPTY_RECEIPT, type ReceiptDraft } from './BriefReceiptPanel'

/** jsdom has no real FileReader result for a Blob, so give it one. */
beforeEach(() => {
  readMutate.mockReset()
  vi.spyOn(globalThis.URL, 'createObjectURL').mockReturnValue('blob:preview')
  vi.spyOn(globalThis.URL, 'revokeObjectURL').mockImplementation(() => {})
})

const shot = (name = 'shot.png') => new File(['bytes'], name, { type: 'image/png' })

/**
 * Renders with REAL state, so `onChange` round-trips the way the wizard makes it.
 *
 * A `vi.fn()` for `onChange` would let every test pass while the panel silently dropped one of
 * the fields it patches — the point of several assertions below is what the NEXT value contains.
 */
function renderPanel(initial: ReceiptDraft = EMPTY_RECEIPT, filedUrl: string | null = null) {
  const seen: ReceiptDraft[] = [initial]
  function Harness() {
    const [value, setValue] = useState(initial)
    seen[0] = value
    return <BriefReceiptPanel value={value} onChange={setValue} filedUrl={filedUrl} />
  }
  return { seen, ...render(<Harness />) }
}

async function choose(file: File) {
  const input = screen.getByTestId('receipt-file') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
  await waitFor(() => expect(readMutate).toHaveBeenCalled())
}

describe('BriefReceiptPanel (ADR-0066)', () => {
  it('asks for a cropped capture — an inbox screenshot carries other people\'s messages', () => {
    renderPanel()
    expect(screen.getByTestId('receipt-crop-hint')).toHaveTextContent('crop')
  })

  it('shows no fields until there is a screenshot', () => {
    renderPanel()
    expect(screen.queryByTestId('receipt-subject')).not.toBeInTheDocument()
  })

  it('marks what the model read, and only what it read', async () => {
    readMutate.mockImplementation((_a, opts) =>
      opts.onSuccess({ subject: 'Ramadan brief', receivedDate: '2026-09-01', receivedTime: '', partial: true }),
    )
    renderPanel()
    await choose(shot())

    expect(screen.getByTestId('receipt-marked-subject')).toBeInTheDocument()
    expect(screen.getByTestId('receipt-marked-receivedDate')).toBeInTheDocument()
    // The time came back empty: that is a question for the person, not a machine answer.
    expect(screen.queryByTestId('receipt-marked-receivedTime')).not.toBeInTheDocument()
  })

  it('drops the marker on the field a person edits, and leaves the others marked', async () => {
    readMutate.mockImplementation((_a, opts) =>
      opts.onSuccess({ subject: 'Ramadan brief', receivedDate: '2026-09-01', receivedTime: '14:32', partial: false }),
    )
    renderPanel()
    await choose(shot())

    fireEvent.change(screen.getByTestId('receipt-subject'), { target: { value: 'Ramadan 2027 brief' } })
    expect(screen.queryByTestId('receipt-marked-subject')).not.toBeInTheDocument()
    expect(screen.getByTestId('receipt-marked-receivedDate')).toBeInTheDocument()
  })

  // d.13 — the commonest screenshot there is.
  it('asks for the missing half rather than reporting a failure', async () => {
    readMutate.mockImplementation((_a, opts) =>
      opts.onSuccess({ subject: 'Need artwork', receivedDate: '', receivedTime: '14:32', partial: true }),
    )
    renderPanel()
    await choose(shot())

    expect(screen.getByTestId('receipt-partial')).toBeInTheDocument()
    expect(screen.queryByTestId('receipt-error')).not.toBeInTheDocument()
    // And it cannot be confirmed while a half is missing: a clock with no origin is not a clock.
    expect(screen.getByTestId('receipt-confirm')).toBeDisabled()
  })

  it('allows confirmation once both halves are there', async () => {
    readMutate.mockImplementation((_a, opts) =>
      opts.onSuccess({ subject: 'x', receivedDate: '2026-09-01', receivedTime: '14:32', partial: false }),
    )
    const { seen } = renderPanel()
    await choose(shot())

    const box = screen.getByTestId('receipt-confirm')
    expect(box).not.toBeDisabled()
    fireEvent.click(box)
    expect(seen[0].confirmed).toBe(true)
  })

  // d.5 — the one that stops a confirmation meaning something other than what is on screen.
  it('un-confirms when a value is edited afterwards', async () => {
    readMutate.mockImplementation((_a, opts) =>
      opts.onSuccess({ subject: 'x', receivedDate: '2026-09-01', receivedTime: '14:32', partial: false }),
    )
    const { seen } = renderPanel()
    await choose(shot())
    fireEvent.click(screen.getByTestId('receipt-confirm'))
    expect(seen[0].confirmed).toBe(true)

    fireEvent.change(screen.getByTestId('receipt-time'), { target: { value: '15:00' } })
    expect(seen[0].confirmed).toBe(false)
  })

  it('defaults the zone to the confirming person\'s office, and lets it be corrected', async () => {
    readMutate.mockImplementation((_a, opts) =>
      opts.onSuccess({ subject: 'x', receivedDate: '2026-09-01', receivedTime: '14:32', partial: false }),
    )
    const { seen } = renderPanel()
    await choose(shot())

    expect(screen.getByTestId('receipt-timezone')).toHaveValue('Asia/Dubai')
    fireEvent.change(screen.getByTestId('receipt-timezone'), { target: { value: 'Europe/London' } })
    expect(seen[0].timeZone).toBe('Europe/London')
  })

  it('keeps the screenshot when the reading fails — it is still the evidence', async () => {
    readMutate.mockImplementation((_a, opts) => opts.onError(new Error('down')))
    const { seen } = renderPanel()
    await choose(shot())

    expect(screen.getByTestId('receipt-error')).toBeInTheDocument()
    expect(seen[0].image).not.toBeNull()
    // Typing the three fields is a supported record (d.10), so they are on screen and editable.
    expect(screen.getByTestId('receipt-subject')).toBeInTheDocument()
  })

  it('refuses a file that is not an image, without calling the model', async () => {
    renderPanel()
    const input = screen.getByTestId('receipt-file') as HTMLInputElement
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'brief.pdf', { type: 'application/pdf' })],
      configurable: true,
    })
    fireEvent.change(input)
    await waitFor(() => expect(screen.getByTestId('receipt-error')).toBeInTheDocument())
    expect(readMutate).not.toHaveBeenCalled()
  })

  it('accepts a pasted image, which is how a screenshot actually arrives (d.3)', async () => {
    readMutate.mockImplementation((_a, opts) =>
      opts.onSuccess({ subject: 'Pasted', receivedDate: '2026-09-01', receivedTime: '09:00', partial: false }),
    )
    const { seen } = renderPanel()
    fireEvent.paste(screen.getByTestId('brief-receipt'), {
      clipboardData: { files: [shot('image.png')] },
    })
    await waitFor(() => expect(readMutate).toHaveBeenCalled())
    expect(seen[0].image).not.toBeNull()
    expect(seen[0].source).toBe('model')
  })
})

/**
 * I40 — the screenshot comes back.
 *
 * A `File` cannot be serialised into the wizard's draft, so one chosen on a previous visit is gone
 * from state the moment the form is resumed — while the image itself is filed in the Library and
 * the receipt row points straight at it. Nothing read that back until 5 Sep, so the panel showed an
 * empty picker over evidence captured weeks earlier, and the obvious response to an empty picker is
 * to upload the same screenshot again.
 */
describe('BriefReceiptPanel — evidence already filed', () => {
  it('shows the filed screenshot when no new file has been chosen', () => {
    renderPanel(EMPTY_RECEIPT, 'https://example.test/filed.png')
    expect(screen.getByTestId('receipt-preview')).toHaveAttribute(
      'src',
      'https://example.test/filed.png',
    )
  })

  it('shows nothing when none was ever filed', () => {
    renderPanel(EMPTY_RECEIPT, null)
    expect(screen.queryByTestId('receipt-preview')).toBeNull()
  })

  // A file just chosen is what the person is looking at, and it is what replaces the filed one on
  // the next Next — so it must win, or they would appear to have changed nothing.
  it('prefers a newly chosen file over the one already filed', async () => {
    renderPanel(EMPTY_RECEIPT, 'https://example.test/filed.png')
    await choose(new File(['x'], 'new.png', { type: 'image/png' }))
    const src = screen.getByTestId('receipt-preview').getAttribute('src') ?? ''
    expect(src).not.toBe('https://example.test/filed.png')
  })
})
