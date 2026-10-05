import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../lib/i18n'
import {
  ReviewStepContainer,
  type ReviewPiece,
  type ReviewWorkstreamInput,
} from './ReviewStepContainer'

/**
 * `I56.12` — the adapter between `BriefWizard`'s state and the `CB-v3-05` frame.
 *
 * `ReviewStepV3.test.tsx` proves the frame prints what it is handed. This proves the arithmetic
 * in front of it: that the strip and the table are counted off the SAME list of pieces and cannot
 * disagree; that a piece in no workstream (ADR-0099 d.1) is still counted and still shown; that
 * Launch is never guessed from a due date; and that somebody who may not approve is told who can
 * rather than left with a grey button.
 *
 * The strings the container itself adds are registered here, the way the frame's test registers
 * the frame's: they are landing ahead of `en.json`, and asserting on a raw key name proves
 * nothing. The `approve.*` strings the frame already ships with are restated at their `en.json`
 * wording so this file does not depend on the order test files happen to run in.
 */
i18n.addResourceBundle(
  'en',
  'translation',
  {
    approve: {
      // Already in en.json — repeated so the assertions below are independent of load order.
      pieces_one: '{{count}} piece',
      pieces_other: '{{count}} pieces',
      noAssigner: 'nobody assigns it yet',
      notYours: '{{name}} approves this campaign. Ask them to open it.',
      chip: { workstreams_one: '{{count}} workstream', workstreams_other: '{{count}} workstreams' },
      does: {
        leads_one: '{{count}} lead gets their workstream in their queue',
        leads_other: '{{count}} leads get their workstream in their queue',
        clocks_one: '{{count}} clock starts',
        clocks_other: '{{count}} clocks start',
        library: "The campaign's folders are filed under {{path}}",
      },
      // New with the adapter.
      roleLine: 'Account manager on {{client}}',
      noApprover: 'The account manager',
      noSummary: 'No proposition written yet — edit the brief to add one.',
      severalDepartments: 'Several departments',
      rulesPlusClient: '{{rules}} + client',
      rulesClientOnly: "The client's only",
    },
  },
  true,
  true,
)

const WORKSTREAMS: ReviewWorkstreamInput[] = [
  { id: 'w1', name: 'Design & Animation', departmentName: 'Creative', assignerName: 'Fadia' },
  { id: 'w2', name: 'In-App', departmentName: 'Creative', assignerName: 'Fadia' },
  { id: 'w3', name: 'Influencers', departmentName: 'Influencers', assignerName: 'Abeer' },
]

/** `n` pieces in one workstream, each with a language and a due day, so counts are unambiguous. */
function piecesIn(
  workstreamId: string | null,
  n: number,
  over: Partial<ReviewPiece> = {},
): ReviewPiece[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${workstreamId ?? 'loose'}-${i}`,
    workstreamId,
    language: 'en',
    dueAt: '2026-10-02',
    departmentName: 'Creative',
    ...over,
  }))
}

function view(over: Partial<React.ComponentProps<typeof ReviewStepContainer>> = {}) {
  const props: React.ComponentProps<typeof ReviewStepContainer> = {
    campaignName: 'LUMA Season 2',
    clientName: 'Kite',
    brandName: 'LUMA',
    briefSummary: 'Every qualifying purchase gives visible tickets into a live draw every Friday.',
    approverName: 'Inas Mohamed Azmi',
    pieces: [...piecesIn('w1', 3), ...piecesIn('w2', 2), ...piecesIn('w3', 4)],
    workstreams: WORKSTREAMS,
    phases: [
      { startsOn: '', endsOn: '2026-09-18' },
      { startsOn: '2026-09-19', endsOn: '2026-10-16' },
    ],
    rules: [{ from: 'campaign' }, { from: 'campaign' }, { from: 'client' }],
    goLiveAt: '2026-09-18',
    escalationHours: 24,
    canApprove: true,
    onApprove: vi.fn(),
    onSaveDraft: vi.fn(),
    onBack: vi.fn(),
    onEditStep: vi.fn(),
    ...over,
  }
  render(<ReviewStepContainer {...props} />)
  return props
}

describe('ReviewStepContainer (I56.12)', () => {
  // I66.8: a date shows its year only when it is not this year, so pin "today" (the date only).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-29T09:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('counts the pieces off the one list, so the strip and the table cannot disagree', () => {
    view()
    expect(screen.getByTestId('approve-fact-pieces')).toHaveTextContent('9')
    expect(screen.getByTestId('approve-row-w1-pieces')).toHaveTextContent('3 pieces')
    expect(screen.getByTestId('approve-row-w2-pieces')).toHaveTextContent('2 pieces')
    expect(screen.getByTestId('approve-row-w3-pieces')).toHaveTextContent('4 pieces')
  })

  it('takes Launch from the go-live and Finale from the last phase', () => {
    view()
    expect(screen.getByTestId('approve-fact-launch')).toHaveTextContent('Fri, 18 Sep')
    expect(screen.getByTestId('approve-fact-finale')).toHaveTextContent('16 Oct')
  })

  it('never guesses Launch from a due date, but falls back to the first phase', () => {
    // No go-live: the first phase opens the campaign. Its own first phase has no start of its own
    // (CB-v3-P1), so the day comes from the phase that does.
    view({ goLiveAt: null })
    expect(screen.getByTestId('approve-fact-launch')).toHaveTextContent('19 Sep')
    // Nothing to read at all — blank, rather than the earliest due date dressed up as a launch.
    cleanup()
    view({ goLiveAt: null, phases: [] })
    expect(screen.getByTestId('approve-fact-launch')).toHaveTextContent('—')
    // …while the finale still falls back to the last thing that lands, which it genuinely is.
    expect(screen.getByTestId('approve-fact-finale')).toHaveTextContent('2 Oct')
  })

  it('lists the campaign languages once each, in order', () => {
    view({
      pieces: [
        ...piecesIn('w1', 2, { language: 'en' }),
        ...piecesIn('w2', 1, { language: 'ar' }),
        ...piecesIn('w3', 1, { language: 'ku' }),
      ],
    })
    expect(screen.getByTestId('approve-fact-languages')).toHaveTextContent('AR · EN · KU')
  })

  it('names languages the way the tenant does when it is told how', () => {
    view({
      pieces: piecesIn('w1', 1, { language: 'ar' }),
      languageLabel: (code) => (code === 'ar' ? 'Arabic' : code),
    })
    expect(screen.getByTestId('approve-fact-languages')).toHaveTextContent('Arabic')
  })

  it('counts the campaign rules and says when the client has its own underneath', () => {
    view()
    expect(screen.getByTestId('approve-fact-rules')).toHaveTextContent('2 + client')
    cleanup()
    view({ rules: [] })
    // No rules is blank, not "0" — the campaign has nothing to say here, which is not a zero.
    expect(screen.getByTestId('approve-fact-rules')).toHaveTextContent('—')
  })

  it('shows work in no workstream as its own row, counted (ADR-0099 d.1)', () => {
    view({ pieces: [...piecesIn('w1', 3), ...piecesIn(null, 2)] })
    expect(screen.getByTestId('approve-fact-pieces')).toHaveTextContent('5')
    const loose = screen.getByTestId('approve-row-ungrouped')
    expect(loose).toHaveTextContent('Not in a workstream')
    expect(screen.getByTestId('approve-row-ungrouped-pieces')).toHaveTextContent('2 pieces')
    // Nobody hands out work that is in nobody's group, and the row says so rather than leaving a gap.
    expect(screen.getByTestId('approve-row-ungrouped-assigner')).toHaveTextContent(
      'nobody assigns it yet',
    )
  })

  it('adds no loose row when every piece is in a workstream', () => {
    view()
    expect(screen.queryByTestId('approve-row-ungrouped')).not.toBeInTheDocument()
  })

  it('keeps a piece whose workstream has gone, rather than losing it from the count', () => {
    view({ pieces: [...piecesIn('w1', 1), ...piecesIn('deleted-ws', 2)] })
    expect(screen.getByTestId('approve-fact-pieces')).toHaveTextContent('3')
    expect(screen.getByTestId('approve-row-ungrouped-pieces')).toHaveTextContent('2 pieces')
  })

  it('still shows the work when the campaign has no workstreams at all', () => {
    // The narrowed list is empty, so it falls back to the full one. An empty table would be a
    // dead end on the last screen of the wizard.
    view({ workstreams: [], pieces: piecesIn(null, 6) })
    expect(screen.getByTestId('approve-row-ungrouped-pieces')).toHaveTextContent('6 pieces')
    expect(screen.getByTestId('approve-fact-pieces')).toHaveTextContent('6')
  })

  it('names the loose row by its department, or says there are several', () => {
    view({ pieces: piecesIn(null, 2, { departmentName: 'Creative' }) })
    expect(screen.getByTestId('approve-row-ungrouped')).toHaveTextContent('Creative')
    cleanup()
    view({
      pieces: [
        ...piecesIn(null, 1, { departmentName: 'Creative' }),
        ...piecesIn(null, 1, { departmentName: 'Influencers' }),
      ],
    })
    expect(screen.getByTestId('approve-row-ungrouped')).toHaveTextContent('Several departments')
  })

  it('counts the leads who are actually told, not the rows', () => {
    // Fadia owns two of the three workstreams, and the loose row has no lead at all.
    view({ pieces: [...piecesIn('w1', 1), ...piecesIn('w2', 1), ...piecesIn('w3', 1), ...piecesIn(null, 1)] })
    expect(screen.getByTestId('approve-consequences')).toHaveTextContent(
      '2 leads get their workstream in their queue',
    )
  })

  it('files the campaign under the client, the brand and the campaign folder', () => {
    view({ campaignFolderName: 'Season 2' })
    expect(screen.getByTestId('approve-consequences')).toHaveTextContent('Kite / LUMA / Season 2')
  })

  it('falls back to the campaign name before its folder has been read', () => {
    view({ campaignFolderName: null, brandName: null })
    expect(screen.getByTestId('approve-consequences')).toHaveTextContent('Kite / LUMA Season 2')
  })

  it('drops no chip on a campaign without phases, and chips the ones it has', () => {
    view({ phases: [] })
    expect(screen.queryByTestId('approve-chip-phases')).not.toBeInTheDocument()
    expect(screen.getByTestId('approve-chip-workstreams')).toHaveTextContent('3 workstreams')
  })

  it('names the approver and the client they hold the account on', () => {
    view()
    expect(screen.getByTestId('approve-approver')).toHaveTextContent('Inas Mohamed Azmi')
    expect(screen.getByTestId('approve-approver')).toHaveTextContent('Account manager on Kite')
  })

  it('names who CAN approve when the reader may not (Edward, 22 Sep)', () => {
    const props = view({ canApprove: false })
    expect(screen.getByTestId('approve-approve')).toBeDisabled()
    expect(screen.getByTestId('approve-not-yours')).toHaveTextContent(
      'Inas Mohamed Azmi approves this campaign. Ask them to open it.',
    )
    // And the way out stays open — a refusal is never a dead end.
    fireEvent.click(screen.getByTestId('approve-draft'))
    expect(props.onSaveDraft).toHaveBeenCalledTimes(1)
  })

  it('still names a role rather than an empty avatar when nobody is set', () => {
    // Step 1 will not pass without an account manager, so this is belt and braces — but a blank
    // name would make the refusal read "  approves this campaign", which names nobody.
    view({ canApprove: false, approverName: '  ' })
    expect(screen.getByTestId('approve-not-yours')).toHaveTextContent(
      'The account manager approves this campaign.',
    )
  })

  it('says a brief has no proposition rather than printing an empty paragraph', () => {
    view({ briefSummary: '   ' })
    expect(screen.getByTestId('approve-brief')).toHaveTextContent('No proposition written yet')
  })

  it('hands the press straight through, once', () => {
    const props = view()
    fireEvent.click(screen.getByTestId('approve-approve'))
    expect(props.onApprove).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('approve-back'))
    expect(props.onBack).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('approve-edit'))
    expect(props.onEditStep).toHaveBeenCalledTimes(1)
  })

  it('without workstreams, "who gets what" is one row per owner, each told to approve their task lists', () => {
    view({
      grouping: false,
      workstreams: [],
      pieces: [
        { id: 'a', workstreamId: null, language: null, dueAt: null, departmentName: 'Creative', ownerName: 'Fadia' },
        { id: 'b', workstreamId: null, language: null, dueAt: null, departmentName: 'Creative', ownerName: 'Fadia' },
        { id: 'c', workstreamId: null, language: null, dueAt: null, departmentName: 'Content', ownerName: 'Jaafar' },
      ],
    })
    expect(screen.getByTestId('approve-row-owner-Fadia')).toHaveTextContent('Fadia')
    expect(screen.getByTestId('approve-row-owner-Fadia-pieces')).toHaveTextContent('2 pieces')
    expect(screen.getByTestId('approve-row-owner-Jaafar-assigner')).toHaveTextContent('Approves the task lists')
    expect(screen.getByTestId('approve-does-owners')).toHaveTextContent('2 owners are told the work is theirs')
    expect(screen.queryByTestId('approve-chip-workstreams')).not.toBeInTheDocument()
  })

  it('never shows a finale before the launch — without phases the go-live closes the season too', () => {
    view({
      phases: [],
      goLiveAt: '2026-10-22',
      pieces: [{ id: 'a', workstreamId: 'w1', language: null, dueAt: '2026-10-20', departmentName: 'Creative' }],
    })
    expect(screen.getByTestId('approve-fact-launch')).toHaveTextContent('Thu, 22 Oct')
    expect(screen.getByTestId('approve-fact-finale')).toHaveTextContent('Thu, 22 Oct')
  })
})
