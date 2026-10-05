import { describe, expect, it } from 'vitest'
import { ADHOC, ARCHIVED, buildRail, matches, totalUnread } from './rail'
import type { RailRow } from '../api/chat-api'

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

describe('chat rail (ADR-0063 d.3)', () => {
  it('groups deliverable threads under their campaign', () => {
    const rail = buildRail([
      row({ contextType: 'campaign', contextId: 'cam1', title: 'Ramadan', campaignId: 'cam1', campaignName: 'Ramadan' }),
      row({ contextId: 'd1', title: 'Hero KV', campaignId: 'cam1', campaignName: 'Ramadan' }),
      row({ contextId: 'd2', title: 'Social', campaignId: 'cam1', campaignName: 'Ramadan' }),
    ])
    expect(rail).toHaveLength(1)
    expect(rail[0]!.name).toBe('Ramadan')
    expect(rail[0]!.room?.contextId).toBe('cam1')
    expect(rail[0]!.threads.map((t) => t.contextId)).toEqual(['Hero KV', 'Social'].map((_, i) => ['d1', 'd2'][i]))
  })

  it('puts work with no campaign in its own group, LAST', () => {
    // A campaign-first tree would hide ad-hoc work entirely — most of the alpha's work, and the
    // exact failure ADR-0062 exists to end.
    const rail = buildRail([
      row({ contextId: 'a1', title: 'Logo tweak' }),
      row({ contextType: 'campaign', contextId: 'cam1', title: 'Ramadan', campaignId: 'cam1', campaignName: 'Ramadan' }),
    ])
    expect(rail.map((g) => g.key)).toEqual(['cam1', ADHOC])
    expect(rail[1]!.threads.map((t) => t.title)).toEqual(['Logo tweak'])
    // The ad-hoc bucket has no room of its own: there is no campaign to talk about.
    expect(rail[1]!.room).toBeNull()
  })

  it('keeps ad-hoc last even when it is the busiest thing on the screen', () => {
    const rail = buildRail([
      row({ contextId: 'a1', title: 'Logo tweak', unread: 99 }),
      row({ contextType: 'campaign', contextId: 'cam1', title: 'Ramadan', campaignId: 'cam1', campaignName: 'Ramadan' }),
    ])
    expect(rail.map((g) => g.key)).toEqual(['cam1', ADHOC])
  })

  it('sorts threads unread first, then most recently active, then by name', () => {
    const rail = buildRail([
      row({ contextId: 'quiet', title: 'Quiet', campaignId: 'c', campaignName: 'C' }),
      row({ contextId: 'old', title: 'Old', campaignId: 'c', campaignName: 'C', lastMessageAt: '2026-08-01T00:00:00Z' }),
      row({ contextId: 'recent', title: 'Recent', campaignId: 'c', campaignName: 'C', lastMessageAt: '2026-08-30T00:00:00Z' }),
      row({ contextId: 'unread', title: 'Unread', campaignId: 'c', campaignName: 'C', unread: 2, lastMessageAt: '2026-08-02T00:00:00Z' }),
    ])
    expect(rail[0]!.threads.map((t) => t.contextId)).toEqual(['unread', 'recent', 'old', 'quiet'])
  })

  it('rolls unread up to the group, room included', () => {
    const rail = buildRail([
      row({ contextType: 'campaign', contextId: 'cam1', title: 'C', campaignId: 'cam1', campaignName: 'C', unread: 1 }),
      row({ contextId: 'd1', title: 'D1', campaignId: 'cam1', campaignName: 'C', unread: 3 }),
    ])
    expect(rail[0]!.unread).toBe(4)
  })

  it('shows a campaign the caller reaches only ONE thread inside', () => {
    // ADR-0063 d.7: somebody invited to a single thread gets the campaign as a header for context,
    // and nothing else of its contents. It falls out of grouping only the rows they may see.
    const rail = buildRail([
      row({ contextId: 'd1', title: 'Hero KV', campaignId: 'cam1', campaignName: 'Ramadan' }),
    ])
    expect(rail).toHaveLength(1)
    expect(rail[0]!.name).toBe('Ramadan')
    expect(rail[0]!.room).toBeNull() // they cannot open the campaign room itself
    expect(rail[0]!.threads).toHaveLength(1)
  })

  it('orders campaigns unread first, then by name', () => {
    const rail = buildRail([
      row({ contextType: 'campaign', contextId: 'b', title: 'Beta', campaignId: 'b', campaignName: 'Beta' }),
      row({ contextType: 'campaign', contextId: 'a', title: 'Alpha', campaignId: 'a', campaignName: 'Alpha' }),
      row({ contextType: 'campaign', contextId: 'z', title: 'Zulu', campaignId: 'z', campaignName: 'Zulu', unread: 1 }),
    ])
    expect(rail.map((g) => g.name)).toEqual(['Zulu', 'Alpha', 'Beta'])
  })

  it('totals unread for the nav badge', () => {
    expect(totalUnread([row({ contextId: 'a', title: 'A', unread: 2 }), row({ contextId: 'b', title: 'B', unread: 3 })])).toBe(5)
    expect(totalUnread([])).toBe(0)
  })
})

describe('rail search and archived (Edward, 31 Aug)', () => {
  it('matches on the thread title AND on its campaign', () => {
    const r = row({ contextId: 'd1', title: 'Post 6', campaignId: 'c', campaignName: 'Zeta Ramadan' })
    // Most threads here are called things like "Post 6"; the campaign is how a person actually
    // remembers which one they meant.
    expect(matches(r, 'post')).toBe(true)
    expect(matches(r, 'zeta')).toBe(true)
    expect(matches(r, 'nope')).toBe(false)
  })

  it('is case-insensitive, ignores accents, and takes terms in any order', () => {
    const r = row({ contextId: 'd1', title: 'Héro KV', campaignId: 'c', campaignName: 'Zeta' })
    expect(matches(r, 'HERO')).toBe(true)
    expect(matches(r, 'hero')).toBe(true)
    expect(matches(r, 'kv zeta')).toBe(true) // reversed order still finds it
    expect(matches(r, 'kv missing')).toBe(false) // every term must land
  })

  it('an empty query matches everything', () => {
    expect(matches(row({ contextId: 'd', title: 'Anything' }), '   ')).toBe(true)
  })

  it('puts archived work in its own group, after ad-hoc', () => {
    const rail = buildRail([
      row({ contextId: 'old', title: 'Finished', campaignId: 'c', campaignName: 'C', isArchived: true }),
      row({ contextId: 'a1', title: 'Logo tweak' }),
      row({ contextType: 'campaign', contextId: 'c', title: 'C', campaignId: 'c', campaignName: 'C' }),
    ])
    expect(rail.map((g) => g.key)).toEqual(['c', ADHOC, ARCHIVED])
    // Archived rows leave their campaign: a record, not part of the live list.
    expect(rail[0]!.threads).toHaveLength(0)
    expect(rail[2]!.threads.map((t) => t.contextId)).toEqual(['old'])
  })
})
