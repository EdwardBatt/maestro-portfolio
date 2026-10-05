import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../../lib/i18n'
import { ConversationMembers } from './ConversationMembers'
import type { ConversationPerson } from './api/chat-api'

/**
 * The member list (ADR-0063 d.8).
 *
 * Two things are under test. First, that a reason NAMES the work: three bare labels reading
 * "owner", "assigner", "account_manager" on a campaign room told you the shape of somebody's
 * involvement and nothing about which work (Edward, 31 Aug). Second — and this is a regression
 * test — that the component survives a `chat` function that has not been redeployed yet.
 */
const person = (o: Partial<ConversationPerson> & { userId: string }): ConversationPerson => ({
  displayName: 'Someone',
  reason: 'assignee',
  subjects: [],
  total: 0,
  ...o,
})

const renderList = (people: ConversationPerson[]) =>
  render(
    <ConversationMembers
      people={people}
      canManage={false}
      addable={[]}
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      busy={false}
      lastRemoval={null}
    />,
  )

describe('ConversationMembers', () => {
  it('names the single thing a person is here for', () => {
    renderList([
      person({ userId: 'u1', displayName: 'Fadia', reason: 'owner', subjects: ['Hero KV'], total: 1 }),
      person({ userId: 'u2', displayName: 'Ismail', reason: 'reviewer', subjects: ['Draft the KV'], total: 1 }),
      person({ userId: 'u3', displayName: 'Maya', reason: 'account_manager', subjects: ['Zeta Ramadan'], total: 1 }),
    ])
    expect(screen.getByTestId('chat-member-u1-owner')).toHaveTextContent('owns Hero KV')
    // A reviewer's subject is a TASK, and task titles are workflow-step names nobody recognises —
    // so they are counted, never read out. One of them is "this task".
    expect(screen.getByTestId('chat-member-u2-reviewer')).toHaveTextContent('reviewing this task')
    expect(screen.getByTestId('chat-member-u3-account_manager')).toHaveTextContent('account manager, Zeta Ramadan')
  })

  it('summarises somebody on several things by count, not by a list of names', () => {
    // A campaign room spans every deliverable beneath it; a dozen names in a header is not a header.
    renderList([person({ userId: 'u1', displayName: 'Sara', reason: 'reviewer', subjects: ['A', 'B', 'C'], total: 26 })])
    // The COUNT is the server's row count, never the length of the capped, deduplicated array —
    // counting the array reported "17 tasks" for 26 (Edward, 31 Aug).
    expect(screen.getByTestId('chat-member-u1-reviewer')).toHaveTextContent('reviewing 26 tasks')
  })

  it('names WHO asked for an invitation — that is the whole content of the fact', () => {
    renderList([person({ userId: 'u1', displayName: 'Zubaida', reason: 'invited', subjects: ['Edward'], total: 1 })])
    expect(screen.getByTestId('chat-member-u1-invited')).toHaveTextContent('added by Edward')
  })

  it('degrades to a bare label when the Edge Function has not been redeployed', () => {
    // REGRESSION, 31 Aug: `subjects` was added to the function's response and to this component in
    // one change set, but they deploy SEPARATELY — a browser holding new client code against the
    // old function got `undefined` and the page died with "Cannot read properties of undefined".
    // Version skew across a deploy boundary is normal; it must degrade, never crash.
    const stale = { userId: 'u1', displayName: 'Fadia', reason: 'owner' } as unknown as ConversationPerson
    renderList([stale])
    expect(screen.getByTestId('chat-member-u1-owner')).toHaveTextContent('Fadia')
    expect(screen.getByTestId('chat-member-u1-owner')).toHaveTextContent('owns this deliverable')
  })

  it('says so plainly when nobody is on the work yet', () => {
    renderList([])
    expect(screen.getByTestId('chat-members-empty')).toBeInTheDocument()
  })
})

describe('ConversationMembers — the Test Campaign regressions (31 Aug)', () => {
  it('NAMES two deliverables rather than counting them', () => {
    // "Edward Video owning 2 deliverables… but not named". Two names read far better than a count.
    renderList([
      person({ userId: 'u1', displayName: 'Edward Video', reason: 'owner', total: 2,
               subjects: ['60-second hero film', '15-second cutdowns'] }),
    ])
    const el = screen.getByTestId('chat-member-u1-owner')
    expect(el).toHaveTextContent('60-second hero film')
    expect(el).toHaveTextContent('15-second cutdowns')
    expect(el).not.toHaveTextContent('2 deliverables')
  })

  it('says CREATED, not assigned — they are opposite facts on a template-built campaign', () => {
    // Test Campaign has 26 live tasks, all created by one person, and NONE assigned to anybody.
    // Rendering `created_by` as "assigned" claimed 17 assignments that do not exist.
    renderList([
      person({ userId: 'u1', displayName: 'Edward', reason: 'creator', total: 26, subjects: ['A', 'B', 'C'] }),
    ])
    const el = screen.getByTestId('chat-member-u1-creator')
    expect(el).toHaveTextContent('created 26 tasks')
    expect(el).not.toHaveTextContent('assigned')
  })
})
