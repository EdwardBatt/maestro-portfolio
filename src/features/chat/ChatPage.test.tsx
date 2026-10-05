import { describe, expect, it, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../lib/i18n'
import type { RailRow } from './api/chat-api'

/**
 * The chat surface (I32, ADR-0063).
 *
 * Chat had no home: a thread was reachable only from the foot of the deliverable it hung on. These
 * cases hold the three decisions that make the rail worth having — it lists ENTITLED WORK rather
 * than existing conversations, ad-hoc work is not hidden by a campaign-first tree, and the panel
 * shown here is the SAME conversation as the one on the deliverable, never a copy.
 */
const state = vi.hoisted(() => ({
  rows: [] as RailRow[],
  isLoading: false,
  isError: false,
}))

vi.mock('./api/chat-api', () => ({
  useMyConversations: () => ({ data: state.rows, isLoading: state.isLoading, isError: state.isError }),
}))

// The panel has its own suite; stubbed here because it reaches chat-api → lib/supabase → lib/env,
// which throws where no VITE_* exists (docs/memory/traps.md).
// The header reaches two other features' api modules (and through them lib/env), so it is stubbed
// here exactly as ChatPanel is; its own behaviour is the campaign page's suite.
vi.mock('./CampaignRoomHeader', () => ({
  CampaignRoomHeader: ({ campaignId }: { campaignId: string }) => (
    <div data-testid={`chat-campaign-status-stub-${campaignId}`} />
  ),
}))

vi.mock('./ChatPanel', () => ({
  ChatPanel: ({ contextType, contextId, readOnly }: { contextType: string; contextId: string; readOnly?: boolean }) => (
    <div data-testid={`chat-panel-stub-${contextType}-${contextId}`} data-readonly={String(!!readOnly)} />
  ),
}))

import { ChatPage } from './ChatPage'

const row = (o: Partial<RailRow> & { contextId: string; title: string }): RailRow => ({
  contextType: 'deliverable',
  campaignId: null,
  campaignName: null,
  conversationId: null,
  lastMessageAt: null,
  unread: 0,
  isArchived: false,
  ...o,
})

const renderPage = () => render(<MemoryRouter><ChatPage /></MemoryRouter>)

describe('ChatPage (ADR-0063)', () => {
  beforeEach(() => {
    state.rows = []
    state.isLoading = false
    state.isError = false
  })

  it('lists entitled work grouped by campaign, with ad-hoc in its own group', () => {
    state.rows = [
      row({ contextType: 'campaign', contextId: 'cam1', title: 'Ramadan', campaignId: 'cam1', campaignName: 'Ramadan' }),
      row({ contextId: 'd1', title: 'Hero KV', campaignId: 'cam1', campaignName: 'Ramadan' }),
      row({ contextId: 'a1', title: 'Logo tweak' }),
    ]
    renderPage()
    expect(screen.getByTestId('chat-group-cam1')).toBeInTheDocument()
    expect(screen.getByTestId('chat-group-adhoc')).toBeInTheDocument()
    expect(screen.getByTestId('chat-rail-a1')).toHaveTextContent('Logo tweak')
  })

  it('lists work that has no conversation yet — the room appears when somebody opens it', () => {
    // A list of `conversations` would show four rows and no campaigns on a month-old tenant, and
    // read as a broken screen. `conversationId: null` is the normal case, not an empty state.
    state.rows = [row({ contextId: 'd1', title: 'Hero KV', campaignId: 'c', campaignName: 'C', conversationId: null })]
    renderPage()
    expect(screen.getByTestId('chat-rail-d1')).toBeInTheDocument()
  })

  it('opens a conversation into the panel, anchored to the row that was clicked', () => {
    state.rows = [row({ contextId: 'd1', title: 'Hero KV', campaignId: 'c', campaignName: 'C' })]
    renderPage()
    expect(screen.getByTestId('chat-none-open')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('chat-rail-d1'))
    // ADR-0063 d.4: the same conversation as the deliverable's own footer, never a copy.
    expect(screen.getByTestId('chat-panel-stub-deliverable-d1')).toBeInTheDocument()
  })

  it('shows unread on the row and rolled up on its group', () => {
    state.rows = [
      row({ contextType: 'campaign', contextId: 'cam1', title: 'C', campaignId: 'cam1', campaignName: 'C', unread: 1 }),
      row({ contextId: 'd1', title: 'D1', campaignId: 'cam1', campaignName: 'C', unread: 3 }),
    ]
    renderPage()
    expect(screen.getByTestId('chat-unread-d1')).toHaveTextContent('3')
    expect(screen.getByTestId('chat-group-unread-cam1')).toHaveTextContent('4')
  })

  it('collapses a group, and keeps its count visible while collapsed', () => {
    state.rows = [row({ contextId: 'd1', title: 'D1', campaignId: 'cam1', campaignName: 'C', unread: 2 })]
    renderPage()
    fireEvent.click(screen.getByTestId('chat-group-toggle-cam1'))
    expect(screen.queryByTestId('chat-rail-d1')).toBeNull()
    // Collapsed, the count is the only thing saying there is something in there.
    expect(screen.getByTestId('chat-group-unread-cam1')).toHaveTextContent('2')
  })

  it('shows a campaign header for somebody invited to ONE thread inside it', () => {
    // ADR-0063 d.7: they get the campaign name for context and nothing else of its contents.
    state.rows = [row({ contextId: 'd1', title: 'Hero KV', campaignId: 'cam1', campaignName: 'Ramadan' })]
    renderPage()
    expect(screen.getByTestId('chat-group-cam1')).toHaveTextContent('Ramadan')
    expect(screen.getAllByTestId(/^chat-rail-/)).toHaveLength(1)
  })

  it('says nothing is here yet rather than showing an empty box', () => {
    renderPage()
    expect(screen.getByTestId('chat-rail-empty')).toBeInTheDocument()
  })

  it('renders a failed read as a failure, not as "no conversations"', () => {
    // The 27 Aug rule, verbatim from Edward: anywhere an error could occur it should not fail
    // silently. An empty rail and an unread one are different facts.
    state.isError = true
    renderPage()
    expect(screen.getByTestId('chat-rail-failed')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-rail-empty')).toBeNull()
  })
})

describe('ChatPage — finding things (Edward, 31 Aug)', () => {
  beforeEach(() => {
    state.rows = []
    state.isLoading = false
    state.isError = false
  })

  it('filters the rail as you type, and says so when nothing matches', () => {
    state.rows = [
      row({ contextId: 'd1', title: 'Post 6', campaignId: 'c', campaignName: 'Zeta Ramadan' }),
      row({ contextId: 'd2', title: 'Hero KV', campaignId: 'c', campaignName: 'Zeta Ramadan' }),
    ]
    renderPage()
    fireEvent.change(screen.getByTestId('chat-search'), { target: { value: 'hero' } })
    expect(screen.queryByTestId('chat-rail-d1')).toBeNull()
    expect(screen.getByTestId('chat-rail-d2')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('chat-search'), { target: { value: 'zzz' } })
    // "Nothing matches" and "nothing here yet" are different facts.
    expect(screen.getByTestId('chat-search-none')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-rail-empty')).toBeNull()
  })

  it('searches a collapsed group rather than hiding its hits', () => {
    state.rows = [row({ contextId: 'd1', title: 'Hero KV', campaignId: 'c', campaignName: 'C' })]
    renderPage()
    fireEvent.click(screen.getByTestId('chat-group-toggle-c'))
    expect(screen.queryByTestId('chat-rail-d1')).toBeNull()
    fireEvent.change(screen.getByTestId('chat-search'), { target: { value: 'hero' } })
    expect(screen.getByTestId('chat-rail-d1')).toBeInTheDocument()
  })

  it('hides archived work until asked, then shows it in its own group', () => {
    state.rows = [
      row({ contextId: 'live', title: 'Live', campaignId: 'c', campaignName: 'C' }),
      row({ contextId: 'old', title: 'Finished', campaignId: 'c', campaignName: 'C', isArchived: true }),
    ]
    renderPage()
    expect(screen.queryByTestId('chat-rail-old')).toBeNull()
    fireEvent.click(screen.getByTestId('chat-archived-toggle'))
    expect(screen.getByTestId('chat-group-archived')).toBeInTheDocument()
    expect(screen.getByTestId('chat-rail-old')).toBeInTheDocument()
  })

  it('offers no archived toggle when there is nothing archived', () => {
    state.rows = [row({ contextId: 'live', title: 'Live', campaignId: 'c', campaignName: 'C' })]
    renderPage()
    expect(screen.queryByTestId('chat-archived-toggle')).toBeNull()
  })

  it('opens an archived thread read-only — a record, not a live conversation', () => {
    state.rows = [row({ contextId: 'old', title: 'Finished', campaignId: 'c', campaignName: 'C', isArchived: true })]
    renderPage()
    fireEvent.click(screen.getByTestId('chat-archived-toggle'))
    fireEvent.click(screen.getByTestId('chat-rail-old'))
    expect(screen.getByTestId('chat-panel-stub-deliverable-old')).toHaveAttribute('data-readonly', 'true')
  })
})

describe('ChatPage — the campaign room header (Edward, 31 Aug)', () => {
  beforeEach(() => {
    state.rows = []
    state.isLoading = false
    state.isError = false
  })

  const campaignRow = row({
    contextType: 'campaign', contextId: 'cam1', title: 'Test Campaign',
    campaignId: 'cam1', campaignName: 'Test Campaign',
  })

  it('heads a CAMPAIGN room with the delivery gauges', () => {
    // The two questions a person arrives with — how much is done, is anybody on it — answered
    // above the conversation rather than a screen away on /campaigns/:id.
    state.rows = [campaignRow]
    renderPage()
    fireEvent.click(screen.getByTestId('chat-rail-cam1'))
    expect(screen.getByTestId('chat-campaign-status-stub-cam1')).toBeInTheDocument()
  })

  it('does NOT head a deliverable thread with them', () => {
    // A deliverable's own progress is on the deliverable; repeating a campaign rollup over one
    // thread would be answering a question nobody asked there.
    state.rows = [row({ contextId: 'd1', title: 'Hero KV', campaignId: 'cam1', campaignName: 'Test Campaign' })]
    renderPage()
    fireEvent.click(screen.getByTestId('chat-rail-d1'))
    expect(screen.queryByTestId(/^chat-campaign-status-stub/)).toBeNull()
  })
})
