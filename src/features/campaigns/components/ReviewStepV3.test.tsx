import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import i18n from '../../../lib/i18n'
import { ReviewStepV3, type ReviewWorkstream } from './ReviewStepV3'

/**
 * `I56.12` — Figma `CB-v3-05`.
 *
 * The English strings are registered here rather than read from `src/locales/en.json`, because
 * this component is landing ahead of its strings and a test that asserts on a raw key name proves
 * nothing. What is asserted below is the behaviour the frame and the ADRs fix — the facts strip
 * reads from props and never from a clock of its own; a lead who owns two workstreams is one
 * notification, not two; the campaign chip disappears on a campaign without phases (ADR-0096 d.1);
 * approving reaches the caller exactly once; and a person who may not approve is told who can
 * rather than left with a grey button.
 */
i18n.addResourceBundle(
  'en',
  'translation',
  {
    approve: {
      title: 'This one is yours to approve',
      lede: 'You are the account manager on {{client}}. Approving starts {{pieces}} clocks and sends {{workstreams}} workstreams to their leads.',
      editAnyStep: 'Edit any step',
      whoGetsWhat: 'Who gets what',
      pieces_one: '{{count}} piece',
      pieces_other: '{{count}} pieces',
      assigns: '{{name}} assigns',
      noAssigner: 'Nobody assigns this yet',
      yours: 'This one is yours',
      noDirector: 'No director signs this. The account manager who owns the client approves its campaigns.',
      whatItDoes: 'What approving does',
      notReady: 'Not ready?',
      notReadyBody: 'It stays a draft in Unfinished briefs. Nothing is sent and no clock starts.',
      go: 'Approve and start the work',
      saveDraft: 'Save as a draft',
      back: 'Back',
      onTheRecord: 'Your name and the time go on the record.',
      notYours: 'Only {{name}} can approve this campaign.',
      chip: {
        clientBrand: '{{client}} · {{brand}}',
        phases_one: '{{count}} phase',
        phases_other: '{{count}} phases',
        workstreams_one: '{{count}} workstream',
        workstreams_other: '{{count}} workstreams',
      },
      facts: {
        pieces: 'Pieces',
        launch: 'Launch',
        finale: 'Finale',
        languages: 'Languages',
        rules: 'Rules',
      },
      does: {
        clocks_one: '{{count}} piece gets its own clock',
        clocks_other: '{{count}} pieces get their own clock',
        leads_one: '{{count}} lead gets their workstream in their queue',
        leads_other: '{{count}} leads get their workstream in their queue',
        grid: 'The campaign grid goes live',
        library: 'The library folders are created under {{path}}',
        escalation_one: 'Unassigned work starts escalating after {{count}} hour',
        escalation_other: 'Unassigned work starts escalating after {{count}} hours',
      },
    },
  },
  true,
  true,
)

const WORKSTREAMS: ReviewWorkstream[] = [
  { id: 'w1', name: 'Design & Animation', departmentName: 'Creative', pieceCount: 21, assignerName: 'Fadia' },
  { id: 'w2', name: 'In-App', departmentName: 'Creative', pieceCount: 8, assignerName: 'Fadia' },
  { id: 'w3', name: 'Influencers', departmentName: 'Influencers', pieceCount: 40, assignerName: 'Abeer' },
]

function view(over: Partial<React.ComponentProps<typeof ReviewStepV3>> = {}) {
  const props: React.ComponentProps<typeof ReviewStepV3> = {
    campaignName: 'LUMA Season 2',
    clientName: 'Kite',
    brandName: 'LUMA',
    briefSummary: 'Every qualifying purchase gives visible tickets into a live draw every Friday night.',
    facts: {
      pieces: 99,
      launch: 'Fri 18 Sep',
      finale: 'Fri 16 Oct',
      languages: 'AR · EN · KU',
      rules: '7 + client',
    },
    phaseCount: 6,
    workstreams: WORKSTREAMS,
    ownerCount: 6,
    approver: { name: 'Inas Mohamed Azmi', roleLine: 'Account manager on Kite' },
    libraryPath: 'Kite → LUMA → Season 2',
    escalationHours: 24,
    canApprove: true,
    onApprove: vi.fn(),
    onSaveDraft: vi.fn(),
    onBack: vi.fn(),
    onEditStep: vi.fn(),
    ...over,
  }
  render(<ReviewStepV3 {...props} />)
  return props
}

describe('ReviewStepV3 (I56.12, CB-v3-05)', () => {
  it('reads every fact off the props — it owns no clock and no arithmetic of its own', () => {
    view()
    expect(screen.getByTestId('approve-fact-pieces')).toHaveTextContent('99')
    expect(screen.getByTestId('approve-fact-launch')).toHaveTextContent('Fri 18 Sep')
    expect(screen.getByTestId('approve-fact-finale')).toHaveTextContent('Fri 16 Oct')
    expect(screen.getByTestId('approve-fact-languages')).toHaveTextContent('AR · EN · KU')
    expect(screen.getByTestId('approve-fact-rules')).toHaveTextContent('7 + client')
  })

  it('shows a missing fact as blank rather than inventing one', () => {
    // A campaign with no finale date yet is ordinary. The strip keeps its shape.
    view({ facts: { pieces: 4, launch: null, finale: null, languages: null, rules: null } })
    expect(screen.getByTestId('approve-fact-finale')).toHaveTextContent('—')
    expect(screen.getByTestId('approve-fact-pieces')).toHaveTextContent('4')
  })

  it('does not chip a campaign that has no phases (ADR-0096 d.1)', () => {
    view({ phaseCount: 0 })
    expect(screen.queryByTestId('approve-chip-phases')).not.toBeInTheDocument()
    // The workstream chip still stands — every campaign has work, phases are the optional part.
    expect(screen.getByTestId('approve-chip-workstreams')).toHaveTextContent('3 workstreams')
  })

  it('counts LEADS, not workstreams, in what approving does', () => {
    // Fadia owns two of the three. She is told once — counting rows would promise four
    // notifications where three are sent, and this list is read as a promise.
    view()
    expect(screen.getByTestId('approve-consequences')).toHaveTextContent(
      '2 leads get their workstream in their queue',
    )
    expect(screen.getByTestId('approve-consequences')).toHaveTextContent(
      '99 pieces get their own clock',
    )
    expect(screen.getByTestId('approve-consequences')).toHaveTextContent('Kite → LUMA → Season 2')
    expect(screen.getByTestId('approve-consequences')).toHaveTextContent('after 24 hours')
  })

  it('says who hands out each workstream, and says so when nobody does yet', () => {
    view({
      workstreams: [
        WORKSTREAMS[0],
        { id: 'w9', name: 'Live Streams', departmentName: 'Creative', pieceCount: 4, assignerName: null },
      ],
    })
    expect(screen.getByTestId('approve-row-w1-pieces')).toHaveTextContent('21 pieces')
    expect(screen.getByTestId('approve-row-w1-assigner')).toHaveTextContent('Fadia assigns')
    expect(screen.getByTestId('approve-row-w9-assigner')).toHaveTextContent('Nobody assigns this yet')
  })

  it('gives a workstream a categorical hue that does not move when the list is re-ordered', () => {
    view()
    const first = screen.getByTestId('approve-row-w1').getAttribute('data-hue')
    expect(Number(first)).toBeGreaterThanOrEqual(1)
    expect(Number(first)).toBeLessThanOrEqual(12)
    cleanup()
    // The bar belongs to the workstream, not to the row's position — so it survives a re-order.
    view({ workstreams: [WORKSTREAMS[2], WORKSTREAMS[0]] })
    expect(screen.getByTestId('approve-row-w1')).toHaveAttribute('data-hue', first!)
  })

  it('takes the hue the caller gives it, when the data already has one', () => {
    view({ workstreams: [{ ...WORKSTREAMS[0], hue: 4 }] })
    expect(screen.getByTestId('approve-row-w1')).toHaveAttribute('data-hue', '4')
  })

  it('approves once per press', () => {
    const props = view()
    fireEvent.click(screen.getByTestId('approve-approve'))
    expect(props.onApprove).toHaveBeenCalledTimes(1)
  })

  it('will not approve twice while the press is in flight', () => {
    const props = view({ approving: true })
    fireEvent.click(screen.getByTestId('approve-approve'))
    expect(props.onApprove).not.toHaveBeenCalled()
  })

  it('names who CAN approve instead of leaving a grey button (Edward, 22 Sep)', () => {
    const props = view({ canApprove: false })
    expect(screen.getByTestId('approve-approve')).toBeDisabled()
    expect(screen.getByTestId('approve-not-yours')).toHaveTextContent('Inas Mohamed Azmi')
    // Saving a draft and going back stay open — not approving is never a dead end.
    fireEvent.click(screen.getByTestId('approve-draft'))
    expect(props.onSaveDraft).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('approve-back'))
    expect(props.onBack).toHaveBeenCalledTimes(1)
  })

  it('says the owners are told and approve their task lists before anything is assigned (ADR-0100 d.2)', () => {
    view()
    expect(screen.getByTestId('approve-does-owners')).toHaveTextContent(
      '6 owners are told the work is theirs, and each approves their task lists before anyone is assigned',
    )
  })

  it('without workstreams: no workstream chip, no leads line, and each row says what its owner does', () => {
    view({
      grouping: false,
      ownerCount: 1,
      workstreams: [{ id: 'owner-Fadia', name: 'Fadia', departmentName: 'Creative', pieceCount: 3, assignerName: null, tail: 'Approves the task lists' }],
    })
    expect(screen.queryByTestId('approve-chip-workstreams')).not.toBeInTheDocument()
    expect(screen.getByTestId('approve-consequences')).not.toHaveTextContent('leads get their workstream')
    expect(screen.getByTestId('approve-does-owners')).toHaveTextContent('1 owner is told the work is theirs')
    expect(screen.getByTestId('approve-row-owner-Fadia-assigner')).toHaveTextContent('Approves the task lists')
  })

  it("reads the frame's own words on the button", () => {
    view()
    expect(screen.getByTestId('approve-approve')).toHaveTextContent('Approve and start the work')
  })

  it('sends the reader back to any step from the campaign card', () => {
    const props = view()
    fireEvent.click(screen.getByTestId('approve-edit'))
    expect(props.onEditStep).toHaveBeenCalledTimes(1)
  })
})
