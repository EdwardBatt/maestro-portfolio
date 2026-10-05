import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../../lib/i18n'

/**
 * The promised-date dialog (ADR-0088 d.7a, relaxed by I59 E5): the client's agreement is ASKED for,
 * never required. Save opens on a date alone and changes it naming no evidence; an attachment given
 * is filed in the campaign's References first and then named to the change.
 */
const m = vi.hoisted(() => ({
  change: vi.fn(),
  override: vi.fn(),
  folder: vi.fn(),
  file: vi.fn(),
}))

// ADR-0123 d.3: the client's working week — Iraq's here.
vi.mock('../../../lib/calendar/client-calendar', () => ({
  useClientCalendar: () => ({ calendar: { workingDays: [7, 1, 2, 3, 4] }, isLoading: false }),
  useWorkCalendar: () => ({ calendar: { workingDays: [7, 1, 2, 3, 4] }, isLoading: false }),
}))
vi.mock('../../deliverables/api/extensions-api', () => ({
  isRefused: (err: unknown) => (err as { code?: string })?.code === '42501',
  useChangeDeliverableDueAt: () => ({ mutateAsync: m.change }),
  useRecordDueDateOverride: () => ({ mutateAsync: m.override }),
  useOutstandingHours: () => ({ data: null }),
}))
vi.mock('../../../lib/calendar/office-calendars-api', async () => {
  const { IRAQ_WORKING_CALENDAR } = await import('../../../lib/campaigns/go-live-dates')
  return { usePlanningCalendar: () => ({ calendar: IRAQ_WORKING_CALENDAR, office: null, isLoading: false }) }
})
vi.mock('../../../lib/settings/scheduling-settings-api', async () => {
  const { DEFAULT_GO_LIVE_RULE } = await import('../../../lib/campaigns/go-live-dates')
  const settings = { rule: DEFAULT_GO_LIVE_RULE, reviewBufferWorkingDays: 1 }
  return { DEFAULT_SCHEDULING_SETTINGS: settings, useSchedulingSettings: () => ({ data: settings }) }
})
vi.mock('../api/document-filing-api', () => ({
  fetchCampaignReferencesFolder: (id: string) => m.folder(id),
  useFileDocuments: () => ({ mutateAsync: m.file }),
}))

import { DeliverableDueAtDialog } from './DeliverableDueAtDialog'

function view() {
  const onClose = vi.fn()
  render(
    <DeliverableDueAtDialog
      deliverableId="del-1"
      deliverableName="Opener"
      campaignId="cam"
      clientId="client"
      currentDueAt="2099-09-20T20:59:59Z"
      goLiveAt={null}
      onClose={onClose}
    />,
  )
  return onClose
}

describe('DeliverableDueAtDialog — evidence asked for, never required (E5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.change.mockResolvedValue(undefined)
    m.folder.mockResolvedValue('refs')
    m.file.mockResolvedValue([{ ok: true, assetId: 'asset-1' }])
  })

  it('says the attachment is optional, and Save is open on a date alone', () => {
    view()
    expect(screen.getByTestId('deliverable-due-change-evidence-hint')).toHaveTextContent(
      "Attach the client's agreement if you have it — the change is logged either way.",
    )
    expect(screen.getByTestId('deliverable-due-change-save')).toBeEnabled()
  })

  it('without an attachment the date changes naming no evidence, and nothing is filed', async () => {
    const onClose = view()
    fireEvent.change(screen.getByTestId('deliverable-due-change-day'), { target: { value: '2099-09-30' } })
    fireEvent.click(screen.getByTestId('deliverable-due-change-save'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(m.folder).not.toHaveBeenCalled()
    expect(m.file).not.toHaveBeenCalled()
    expect(m.change).toHaveBeenCalledWith({ deliverableId: 'del-1', dueDay: '2099-09-30', evidenceAssetId: null, note: null })
  })

  it('an attachment given is filed in the References first, then named to the change', async () => {
    const onClose = view()
    fireEvent.change(screen.getByTestId('deliverable-due-change-day'), { target: { value: '2099-09-30' } })
    const f = new File(['ok'], 'client-email.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByTestId('deliverable-due-change-evidence'), { target: { files: [f] } })
    fireEvent.click(screen.getByTestId('deliverable-due-change-save'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(m.folder).toHaveBeenCalledWith('cam')
    expect(m.file).toHaveBeenCalledWith({ folderId: 'refs', clientId: 'client', files: [f] })
    expect(m.change).toHaveBeenCalledWith(expect.objectContaining({ evidenceAssetId: 'asset-1' }))
  })

  it('an attachment that cannot be filed stops the change and says so', async () => {
    m.file.mockResolvedValue([{ ok: false }])
    const onClose = view()
    fireEvent.change(screen.getByTestId('deliverable-due-change-day'), { target: { value: '2099-09-30' } })
    fireEvent.change(screen.getByTestId('deliverable-due-change-evidence'), {
      target: { files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] },
    })
    fireEvent.click(screen.getByTestId('deliverable-due-change-save'))
    expect(await screen.findByTestId('deliverable-due-change-error')).toBeInTheDocument()
    expect(m.change).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
