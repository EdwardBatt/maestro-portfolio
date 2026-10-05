import type { RailRow } from '../api/chat-api'

/**
 * How the chat rail divides itself (ADR-0063 d.3): **two tiers, plus ad-hoc.**
 *
 * A campaign group holds its own room and its deliverable threads. Ad-hoc work has no campaign, and
 * a campaign-first tree would simply hide it — which is most of the alpha's work and precisely the
 * failure ADR-0062 exists to end. It gets a top-level group of its own.
 *
 * **No sub-task tier.** A task already carries anchored review comments (ADR-0025/0057) and the
 * manual-review thread (ADR-0059); a third box would give one task three places to type with
 * different retention and no signal which to use. `context_type='sub_task'` stays permitted by the
 * schema and unused by the product.
 *
 * A person invited to ONE thread under a campaign they otherwise have nothing to do with sees that
 * campaign as a header with only that thread beneath it (d.7) — they get the context, not the
 * contents. That falls out of building groups from the rows the caller may actually see, rather
 * than from the campaign's full membership.
 */

/** The synthetic group id for work with no campaign. Not a uuid — no campaign has one. */
export const ADHOC = 'adhoc'
/** The synthetic group id for finished work, kept as a record (ADR-0063 d.6). */
export const ARCHIVED = 'archived'

/**
 * Free-text match over a rail row.
 *
 * Deliberately matches the CAMPAIGN name as well as the thread's own title: on this tenant most
 * threads are called things like "Post 6", and the campaign is how a person actually remembers
 * which one they meant. Case- and accent-insensitive so an Arabic or accented name is findable from
 * a plain keyboard.
 */
const norm = (v: string): string =>
  v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export function matches(row: RailRow, query: string): boolean {
  const q = norm(query.trim())
  if (!q) return true
  // Every whitespace-separated term must appear somewhere — "hero zeta" finds the Zeta hero KV
  // without the person having to remember the order they are written in.
  const hay = norm(`${row.title} ${row.campaignName ?? ''}`)
  return q.split(/\s+/).every((term) => hay.includes(term))
}

export interface RailGroup {
  /** Campaign id, or `adhoc`. Stable: React keys and test ids use it. */
  key: string
  name: string | null
  /** The campaign's own room, when the caller may reach it. Null for the ad-hoc group, which has
   *  no room of its own to open — there is no campaign to talk about. */
  room: RailRow | null
  /** The deliverable threads beneath, unread first then most recently active. */
  threads: RailRow[]
  /** Unread across the room and every thread — what the group header shows collapsed. */
  unread: number
}

const activity = (r: RailRow): number => (r.lastMessageAt ? Date.parse(r.lastMessageAt) : 0)

/**
 * Unread first, then most recently active, then by name.
 *
 * A row with no conversation yet has no unread and no activity, so it sorts last on both counts and
 * lands in alphabetical order — present and quiet, which is what "nobody has spoken here" should
 * look like (ADR-0063 d.5).
 */
function byUrgency(a: RailRow, b: RailRow): number {
  if (a.unread !== b.unread) return b.unread - a.unread
  const act = activity(b) - activity(a)
  if (act !== 0) return act
  return a.title.localeCompare(b.title)
}

/**
 * Group the rail.
 *
 * Archived work goes to a group of its own rather than under its campaign: it is a record, and
 * mixing seven finished ad-hoc jobs into a live campaign's list is what "show archived" would
 * otherwise cost. The surface hides that group by default.
 */
export function buildRail(rows: readonly RailRow[]): RailGroup[] {
  const groups = new Map<string, RailGroup>()

  const groupFor = (key: string, name: string | null): RailGroup => {
    let g = groups.get(key)
    if (!g) {
      g = { key, name, room: null, threads: [], unread: 0 }
      groups.set(key, g)
    }
    // The name arrives on whichever row carries one; a null is a missing join, not a rename.
    g.name ??= name
    return g
  }

  for (const r of rows) {
    if (r.contextType === 'campaign') {
      const g = groupFor(r.contextId, r.campaignName ?? r.title)
      g.room = r
    } else if (r.isArchived) {
      groupFor(ARCHIVED, null).threads.push(r)
    } else {
      const g = groupFor(r.campaignId ?? ADHOC, r.campaignId ? r.campaignName : null)
      g.threads.push(r)
    }
  }

  for (const g of groups.values()) {
    g.threads.sort(byUrgency)
    g.unread = (g.room?.unread ?? 0) + g.threads.reduce((n, t) => n + t.unread, 0)
  }

  return [...groups.values()].sort((a, b) => {
    // Archived last of all, then ad-hoc: both are buckets, not campaigns, however busy they are.
    if (a.key === ARCHIVED) return 1
    if (b.key === ARCHIVED) return -1
    if (a.key === ADHOC) return 1
    if (b.key === ADHOC) return -1
    if (a.unread !== b.unread) return b.unread - a.unread
    return (a.name ?? '').localeCompare(b.name ?? '') || a.key.localeCompare(b.key)
  })
}

/** Total unread across everything the caller can reach — the nav badge. */
export const totalUnread = (rows: readonly RailRow[]): number =>
  rows.reduce((n, r) => n + r.unread, 0)
