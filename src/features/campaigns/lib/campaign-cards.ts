import { campaignPulse, type CampaignPulse, isLateTask } from '../../../lib/campaigns/pulse'
import { iraqDay } from '../../../lib/time/iraq'
import type { CampaignListRow, CampaignStatus } from '../api/campaign-api'
import type { CampaignPulseSource } from '../api/campaign-pulse-api'

/**
 * The campaigns list as cards (CG-00, I57.3) — which campaigns show, in what order, and what each
 * card says. Pure, so the page stays a layout and this stays testable.
 *
 * Edward, 24 Sep: everyone sees every campaign (the 12 Sep decision stands); the list OPENS on
 * "Mine" — I am the account manager, or I own a piece, hold a task, review, or own a workstream —
 * and one press shows All. An empty Mine falls back to All (the UI never blocks) and says so in one
 * line.
 */

export type Scope = 'mine' | 'all'

export interface CardFilters {
  scope: Scope
  /** Lower-cased, trimmed. Matches name, client, brand, piece codes and names, people. */
  query: string
  client: string
  accountManager: string
  status: CampaignStatus | ''
  showClosed: boolean
  /** I61.17: only campaigns with a piece late or at risk (the badge's own count), or with a late task — what the
   *  dashboards' "Campaigns at risk" and "Late" cards open on. `taskLists` (I66.2): an approved campaign with a
   *  task list still to approve — what "Task lists not approved" opens on. */
  alert?: 'atRisk' | 'late' | 'taskLists' | ''
}

/** Where a campaign is in time, for the card's line. */
export type Timing =
  | { kind: 'job'; dueAt: string | null }
  | { kind: 'phase'; name: string; number: number; of: number }
  | { kind: 'before_phases'; name: string; startsOn: string }
  | { kind: 'after_phases'; of: number }
  | { kind: 'single'; goLiveAt: string | null }

export interface CampaignCard {
  row: CampaignListRow
  pulse: CampaignPulse | null
  timing: Timing
  mine: boolean
}

export interface CardsResult {
  cards: CampaignCard[]
  /** Mine was asked for and was empty, so All is shown. */
  mineFellBack: boolean
  closedCount: number
}

/** "Live first" (the frame): approved campaigns, then those awaiting approval, then closed. */
const ORDER: Record<CampaignStatus, number> = { approved: 0, pending_approval: 1, closed: 2, draft: 3 }

export function timingOf(row: CampaignListRow, src: CampaignPulseSource | undefined, now: number): Timing {
  if (row.kind === 'single_job') {
    const due = src?.pieces.map((p) => p.dueAt).filter((d): d is string => d != null).sort()[0] ?? null
    return { kind: 'job', dueAt: due }
  }
  const phases = src?.hasPhases ? [...src.phases].sort((a, b) => a.number - b.number) : []
  if (phases.length === 0) return { kind: 'single', goLiveAt: row.goLiveAt }
  const today = iraqDay(now)
  const i = phases.findIndex((p) => p.startsOn <= today && today <= p.endsOn)
  if (i >= 0) return { kind: 'phase', name: phases[i].name, number: i + 1, of: phases.length }
  if (today < phases[0].startsOn) return { kind: 'before_phases', name: phases[0].name, startsOn: phases[0].startsOn }
  // Between two phases, or after the last: the next one if there is one.
  const next = phases.find((p) => p.startsOn > today)
  if (next) return { kind: 'before_phases', name: next.name, startsOn: next.startsOn }
  return { kind: 'after_phases', of: phases.length }
}

export function buildCards(
  rows: readonly CampaignListRow[],
  sources: ReadonlyMap<string, CampaignPulseSource> | undefined,
  me: string | null,
  f: CardFilters,
  now: number,
): CardsResult {
  const live = rows.filter((r) => r.status !== 'draft')
  const closedCount = live.filter((r) => r.status === 'closed').length

  const all: CampaignCard[] = live.map((row) => {
    const src = sources?.get(row.id)
    const pulse = src ? campaignPulse(src.pieces, { now }) : null
    const mine = me != null && src != null && (src.accountManagerId === me || (pulse?.people.has(me) ?? false))
    return { row, pulse, timing: timingOf(row, src, now), mine }
  })

  const passes = (c: CampaignCard) => {
    const r = c.row
    if (!f.showClosed && r.status === 'closed' && f.status !== 'closed') return false
    if (f.status && r.status !== f.status) return false
    if (f.client && r.clientName !== f.client) return false
    if (f.accountManager && r.accountManagerName !== f.accountManager) return false
    if (f.alert === 'atRisk' && !((c.pulse?.atRisk ?? 0) > 0)) return false
    if (f.alert === 'taskLists' && !(r.status === 'approved' && (c.pulse?.taskListsToApprove ?? 0) > 0)) return false
    if (f.alert === 'late' && !(sources?.get(r.id)?.pieces ?? []).some((p) => p.state !== 'archived' && p.tasks.some((x) => isLateTask(x, now)))) return false
    if (f.query) {
      const hay = [r.name, r.clientName, r.brandName ?? '', r.accountManagerName ?? '', sources?.get(r.id)?.searchText ?? '']
        .join(' ')
        .toLowerCase()
      if (!hay.includes(f.query)) return false
    }
    return true
  }

  const filtered = all.filter(passes)
  const mineOnly = filtered.filter((c) => c.mine)
  const mineFellBack = f.scope === 'mine' && mineOnly.length === 0 && filtered.length > 0
  const shown = f.scope === 'mine' && !mineFellBack ? mineOnly : filtered

  // Stable within a status: the list query's own order (go-live, soonest first).
  const index = new Map(rows.map((r, i) => [r.id, i]))
  shown.sort((a, b) => ORDER[a.row.status] - ORDER[b.row.status] || index.get(a.row.id)! - index.get(b.row.id)!)

  return { cards: shown, mineFellBack, closedCount }
}

/** The distinct values a filter offers, sorted, blanks left out. */
export function optionsOf(rows: readonly CampaignListRow[], pick: (r: CampaignListRow) => string | null): string[] {
  return [...new Set(rows.filter((r) => r.status !== 'draft').map(pick).filter((v): v is string => !!v))].sort((a, b) =>
    a.localeCompare(b),
  )
}
