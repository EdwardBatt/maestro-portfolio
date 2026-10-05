import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../lib/i18n'

/**
 * The audit log can be walked and narrowed (6 Sep).
 *
 * Edward: *"the audit log only shows me the last 200 entries, I need a means to filter to different
 * ranges or to scroll through the entries not listed."* It was a bare `.limit(200)` with no way
 * past it, so anything older than the last 200 events existed in the database and could not be
 * reached from the product at all — on a log gaining thousands of rows a month, that is most of it.
 *
 * The entity filter was worse than incomplete: a hard-coded array of fourteen table names written
 * in August, which had missed every table created since — briefs, brief templates, concepts,
 * deliverable types, workflow templates, the asset tables. The screen looked complete while doing
 * it, so a missing row read as "nothing happened to briefs" rather than "this list has not heard of
 * briefs".
 */

const state = vi.hoisted(() => ({
  pages: [[]] as unknown[][],
  hasNextPage: false,
  fetchNextPage: vi.fn(),
  entities: [] as { entity: string; eventCount: number }[],
  lastFilters: null as unknown,
}))

vi.mock('./api/roles-api', () => ({
  AUDIT_PAGE: 200,
  useAuditEvents: (filters: unknown) => {
    state.lastFilters = filters
    return {
      data: { pages: state.pages },
      isLoading: false,
      isError: false,
      hasNextPage: state.hasNextPage,
      isFetchingNextPage: false,
      fetchNextPage: state.fetchNextPage,
    }
  },
  useAuditEntities: () => ({ data: state.entities }),
  useAuditLookups: () => ({ data: undefined }),
}))

// I51.2: the work records on the page, by name and place. A named brief renders as
// "Department brief · Creative" with "Kite Travel Summer" under Where.
const names = vi.hoisted(() => ({ map: new Map<string, { name: string; where: string | null }>() }))
vi.mock('./api/audit-records-api', () => ({
  auditRecordKey: (entity: string, id: string) => `${entity}:${id}`,
  useAuditRecordNames: () => ({ data: names.map }),
}))

import { AuditPage } from './AuditPage'

const event = (over: Partial<Record<string, unknown>> = {}) => ({
  id: crypto.randomUUID(),
  createdAt: '2026-09-06T09:00:00Z',
  actorName: 'Sara Adel',
  action: 'update',
  entity: 'campaign_briefs',
  entityId: null,
  payload: {},
  ...over,
})

describe('Admin → Audit', () => {
  beforeEach(() => {
    state.pages = [[event()]]
    state.hasNextPage = false
    state.fetchNextPage.mockReset()
    state.entities = [
      { entity: 'campaign_briefs', eventCount: 12 },
      { entity: 'bookings', eventCount: 431 },
    ]
  })

  // The list comes from the LOG. A hard-coded list of a moving thing is only right on the day it
  // is written, and this one was a month stale.
  it('offers the entities that are actually in the log, with their counts', () => {
    render(<AuditPage />)
    const filter = screen.getByTestId('audit-entity-filter')
    // The label comes from the i18n bundle now that every audited entity has one — the raw table
    // name is only the fallback.
    expect(filter).toHaveTextContent('Department brief')
    expect(filter).toHaveTextContent('(431)')
  })

  it('passes the date range to the query', () => {
    render(<AuditPage />)
    fireEvent.change(screen.getByTestId('audit-from'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByTestId('audit-to'), { target: { value: '2026-09-03' } })
    expect(state.lastFilters).toMatchObject({ from: '2026-09-01', to: '2026-09-03' })
  })

  // Either end alone is a real question — "since the 1st", "up to the 3rd" — and requiring the pair
  // would make the common case harder than it is.
  it('accepts one end of the range without the other', () => {
    render(<AuditPage />)
    fireEvent.change(screen.getByTestId('audit-from'), { target: { value: '2026-09-01' } })
    expect(state.lastFilters).toMatchObject({ from: '2026-09-01', to: null })
  })

  it('walks further into the log on demand', () => {
    state.hasNextPage = true
    render(<AuditPage />)
    fireEvent.click(screen.getByTestId('audit-more'))
    expect(state.fetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('shows every page fetched so far, not just the last', () => {
    state.pages = [[event({ action: 'insert' })], [event({ action: 'delete' })]]
    render(<AuditPage />)
    expect(screen.getAllByRole('row')).toHaveLength(3) // header + two events
    expect(screen.getByTestId('audit-count')).toHaveTextContent('2')
  })

  // Silence at the bottom reads as a screen that has stopped working rather than one that has run
  // out of history.
  it('says when there is no more log rather than going quiet', () => {
    render(<AuditPage />)
    expect(screen.getByTestId('audit-end')).toBeInTheDocument()
    expect(screen.queryByTestId('audit-more')).toBeNull()
  })

  it('offers to clear the filters only once something is filtering', () => {
    render(<AuditPage />)
    expect(screen.queryByTestId('audit-clear')).toBeNull()
    fireEvent.change(screen.getByTestId('audit-from'), { target: { value: '2026-09-01' } })
    fireEvent.click(screen.getByTestId('audit-clear'))
    expect(state.lastFilters).toMatchObject({ entity: null, from: null, to: null })
  })
})
