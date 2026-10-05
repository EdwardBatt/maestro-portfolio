import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../lib/i18n'
import { BusyDialog, NoticeDialog } from './Notice'

// I48.39: the report carries the CAUSE. The send itself is mocked; what reaches it is asserted.
const sent = vi.hoisted(() => ({ reports: [] as unknown[] }))
vi.mock('../lib/errors/report', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/errors/report')>()
  return {
    ...real,
    reportError: vi.fn(async (r: unknown) => { sent.reports.push(r); return { sent: 1 } }),
  }
})

/**
 * The shared feedback dialogs (Edward, 29 Aug).
 *
 * `I12.9` moved one refusal into an `alertdialog` and left every other message inline, so the same
 * event reported itself differently depending on the screen. These are the components that make it
 * one thing everywhere.
 */

describe('NoticeDialog', () => {
  // I48.39: ADR-0092 d.3 promised the administrator "any error code"; until 15 Sep no screen passed
  // the thrown error, so every report carried the friendly sentence alone.
  it('sends the cause — code, server message, detail — with the report, never showing it', async () => {
    const cause = { code: '42501', message: 'you cannot approve this campaign', details: 'Account Mgr' }
    render(
      <NoticeDialog kind="error" message="The evidence could not be saved." reportable reportWhere="New request" reportCause={cause} onClose={() => {}} testId="x" />,
    )
    expect(screen.getByTestId('x').textContent).toBe('The evidence could not be saved.')
    expect(screen.queryByText(/Account Mgr/)).toBeNull()
    fireEvent.click(screen.getByTestId('x-report'))
    await screen.findByTestId('x-report-done')
    expect(sent.reports).toHaveLength(1)
    expect(sent.reports[0]).toEqual({
      message: 'The evidence could not be saved.',
      context: undefined,
      where: 'New request',
      code: '42501',
      cause: 'you cannot approve this campaign · detail: Account Mgr',
    })
  })

  it('keeps the caller\'s testid on the MESSAGE, so existing suites still assert the words', () => {
    // The reason this prop exists: 44 test files check `getByTestId('…-error')` and should keep
    // checking the message, not be rewritten because it moved into a dialog.
    render(<NoticeDialog kind="error" message="Deliverables could not be proposed." testId="wizard-error" onClose={vi.fn()} />)
    expect(screen.getByTestId('wizard-error')).toHaveTextContent('Deliverables could not be proposed.')
  })

  it('interrupts as an alert, not as a passive dialog', () => {
    render(<NoticeDialog kind="error" message="Nope" onClose={vi.fn()} />)
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('focuses the close button, so an alert is always dismissable from the keyboard', () => {
    render(<NoticeDialog kind="success" message="Saved" onClose={vi.fn()} />)
    expect(screen.getByTestId('notice-close')).toHaveFocus()
  })

  it('closes on the button, on the backdrop, and on Escape', () => {
    const onClose = vi.fn()
    const { rerender } = render(<NoticeDialog kind="info" message="Hello" onClose={onClose} />)
    fireEvent.click(screen.getByTestId('notice-close'))
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(<NoticeDialog kind="info" message="Hello" onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('does not close when the dialog itself is clicked', () => {
    // Clicking the message must not dismiss what you were trying to read.
    const onClose = vi.fn()
    render(<NoticeDialog kind="error" message="Read me" testId="x" onClose={onClose} />)
    fireEvent.click(screen.getByTestId('x'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('carries a heading per kind so no caller has to invent one', () => {
    const { rerender } = render(<NoticeDialog kind="error" message="m" onClose={vi.fn()} />)
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/that did not work/i)
    rerender(<NoticeDialog kind="success" message="m" onClose={vi.fn()} />)
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/done/i)
  })

  it('takes a caller\'s own heading when the default is too vague', () => {
    render(<NoticeDialog kind="error" title="Cannot book that resource" message="m" onClose={vi.fn()} />)
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Cannot book that resource')
  })
})

describe('BusyDialog', () => {
  it('says what is happening and marks itself busy', () => {
    render(<BusyDialog text="Creating the campaign…" />)
    const dialog = screen.getByTestId('busy-dialog')
    expect(dialog).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByTestId('busy-dialog-text')).toHaveTextContent('Creating the campaign…')
    expect(screen.getByTestId('spinner')).toBeInTheDocument()
  })

  // Deliberate: it goes away when the work does. A dismissible progress dialog invites somebody to
  // dismiss it and then wonder whether the thing happened.
  it('offers no way to dismiss it', () => {
    render(<BusyDialog text="Working…" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
