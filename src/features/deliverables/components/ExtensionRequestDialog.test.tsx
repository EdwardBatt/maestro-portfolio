import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import i18n from '../../../lib/i18n'

/** The ask dialog's opening line (25 Sep): a task with no committed date says so in words, never "—". */

vi.mock('../api/extensions-api', () => ({
  useRequestExtension: () => ({ mutate: vi.fn(), isPending: false }),
  isRefused: () => false,
}))
vi.mock('../../../lib/deadlines/use-extension-context', () => ({
  useExtensionContext: () => ({ reviewBufferWorkingDays: 1, workingDays: [7, 1, 2, 3, 4], closures: [] }),
}))

import { ExtensionRequestDialog } from './ExtensionRequestDialog'

const renderDialog = (committedDueAt: string | null, approverName: string | null) =>
  render(
    <ExtensionRequestDialog
      subTaskId="t1"
      taskTitle="Hero banner"
      committedDueAt={committedDueAt}
      deliverableDueAt={null}
      goLiveAt={null}
      approverName={approverName}
      onClose={() => {}}
    />,
  )

afterEach(() => { void i18n.changeLanguage('en') })

describe('ExtensionRequestDialog — the committed date, in words', () => {
  // I66.8: a date shows its year only when it is not this year, so pin "today" (the date only).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-29T09:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('says there is no committed date yet, with and without an approver', () => {
    const { unmount } = renderDialog(null, 'Dev Dept Lead')
    const intro = screen.getByTestId('extension-request-intro')
    expect(intro).toHaveTextContent('There is no committed date yet. Asking changes nothing until Dev Dept Lead answers')
    expect(intro).not.toHaveTextContent('—')
    unmount()
    renderDialog(null, null)
    expect(screen.getByTestId('extension-request-intro')).toHaveTextContent('There is no committed date yet. Asking changes nothing until it is answered')
  })

  it('names the committed date when there is one', () => {
    renderDialog('2026-10-01T14:00:00Z', 'Dev Dept Lead')
    expect(screen.getByTestId('extension-request-intro')).toHaveTextContent(/^The committed deadline is Thu, 1 Oct \(Iraq time\)\. /)
  })

  it('says it in Arabic too', async () => {
    await i18n.changeLanguage('ar')
    renderDialog(null, null)
    expect(screen.getByTestId('extension-request-intro')).toHaveTextContent('لا يوجد موعد ملتزَم به بعد')
  })
})
