import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { liveOptions } from '../../../lib/query/live'
import { allRows } from '../../../lib/query/all-pages'

/**
 * Task-list views (L3): the tabular, queryable face of the same bookings the
 * grid shows. Reads are tenant-wide (RLS select policy); this module never
 * writes — mutations stay on the authoritative Edge Function path (schedule).
 *
 * Module 1 books AD-HOC: the free-text task name lives in `bookings.notes` and
 * there is no campaign/deliverable link (the campaign builder is V1.7). So the
 * task label falls back notes → deliverable, and the project falls back
 * campaign → job → null ("Ad-hoc" in the UI). Everything degrades cleanly until
 * projects exist.
 */

export type BookingListState = 'soft_hold' | 'tentative' | 'confirmed'

export interface BookingListRow {
  id: string
  startsAt: string
  endsAt: string
  /** YYYY-MM-DD of the start, for the Date column + grouping */
  date: string
  resourceId: string
  resourceName: string
  resourceNickname: string | null
  /** deliverable name, else the ad-hoc free-text task (notes), else '' */
  task: string
  /** campaign name, else job name, else null (⇒ "Ad-hoc") */
  project: string | null
  /** work type name, else null */
  type: string | null
  state: BookingListState
  hours: number
  /** false when the resource has been deactivated (ADR-0014) — flagged for attention */
  resourceActive: boolean
}

export interface BookingsRange {
  /** ISO start of the window (inclusive) */
  start: string
  /** ISO end of the window (exclusive) */
  end: string
}

// The campaign comes through the deliverable's stream, not `bookings.campaign_id` — that column
// is NULL on every row (I49.71). `campaigns(name)` here read it and named nothing.
const SELECT =
  'id, resource_id, state, starts_at, ends_at, notes, ' +
  'resources!inner(name, nickname, user_id, is_active), deliverables(name, departments(name), streams(campaigns(name))), jobs(name)'
/** The same, narrowed to one campaign: inner joins, so a booking outside it is not a row. */
const SELECT_IN_CAMPAIGN =
  'id, resource_id, state, starts_at, ends_at, notes, ' +
  'resources!inner(name, nickname, user_id, is_active), deliverables!inner(name, departments(name), streams!inner(campaign_id, campaigns(name))), jobs(name)'

type RawResource = { name: string; nickname: string | null; user_id: string | null; is_active: boolean }

interface RawBookingRow {
  id: string
  resource_id: string
  state: BookingListState
  starts_at: string
  ends_at: string
  notes: string | null
  resources: RawResource | RawResource[] | null
  deliverables: RawDeliverable | RawDeliverable[] | null
  jobs: { name: string } | { name: string }[] | null
}
type RawCampaign = { name: string }
type RawStream = { campaigns: RawCampaign | RawCampaign[] | null }
type RawDeliverable = {
  name: string
  departments: { name: string } | { name: string }[] | null
  streams: RawStream | RawStream[] | null
}

const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)
const hoursBetween = (a: string, b: string) => Math.round(((Date.parse(b) - Date.parse(a)) / 3_600_000) * 10) / 10

function mapRow(r: RawBookingRow): BookingListRow {
  const res = one(r.resources)
  const job = one(r.jobs)
  const deliverable = one(r.deliverables)
  const campaign = deliverable ? one(one(deliverable.streams)?.campaigns ?? null) : null
  // I21 (ADR-0056 d.14): the Type column is the deliverable's DEPARTMENT now. `work_types(name)`
  // was null on every row, so this column has only ever rendered a dash.
  const department = deliverable ? one(deliverable.departments) : null
  return {
    id: r.id,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    date: r.starts_at.slice(0, 10),
    resourceId: r.resource_id,
    resourceName: res?.name ?? '',
    resourceNickname: res?.nickname ?? null,
    task: deliverable?.name ?? r.notes ?? '',
    project: campaign?.name ?? job?.name ?? null,
    type: department?.name ?? null,
    state: r.state,
    hours: hoursBetween(r.starts_at, r.ends_at),
    resourceActive: res?.is_active ?? true,
  }
}

const ACTIVE_STATES = ['soft_hold', 'tentative', 'confirmed']

export const bookingsKeys = {
  all: ['bookings-list'] as const,
  list: (range: BookingsRange) => [...bookingsKeys.all, 'list', range.start, range.end] as const,
  mine: (range: BookingsRange, userId: string | null) =>
    [...bookingsKeys.all, 'mine', userId ?? 'none', range.start, range.end] as const,
  campaigns: () => [...bookingsKeys.all, 'campaigns'] as const,
  project: (campaignId: string | null) => [...bookingsKeys.all, 'project', campaignId ?? 'none'] as const,
}

/** All active bookings overlapping the window (tenant-wide). */
export function useBookingsList(range: BookingsRange, opts?: { live?: boolean }) {
  return useQuery({
    // ADR-0105 d.5: the team view reads its load through this and refreshes every 20 s.
    ...liveOptions(opts?.live),
    queryKey: bookingsKeys.list(range),
    queryFn: async (): Promise<BookingListRow[]> => {
      // Every page (I59.35): the range is the viewer's to widen, and a busy month is over 1,000 rows.
      const data = await allRows<RawBookingRow>((a, b) =>
        supabaseUntyped
          .from('bookings')
          .select(SELECT)
          .in('state', ACTIVE_STATES)
          .lt('starts_at', range.end)
          .gt('ends_at', range.start)
          .order('starts_at', { ascending: false })
          .order('id', { ascending: true })
          .range(a, b))
      return data.map(mapRow)
    },
  })
}

/** The signed-in user's own bookings (their linked resource — ADR-0011). */
export function useMyBookingsList(range: BookingsRange, userId: string | null) {
  return useQuery({
    queryKey: bookingsKeys.mine(range, userId),
    enabled: userId != null,
    queryFn: async (): Promise<BookingListRow[]> => {
      const data = await allRows<RawBookingRow>((a, b) =>
        supabaseUntyped
          .from('bookings')
          .select(SELECT)
          .eq('resources.user_id', userId!)
          .in('state', ACTIVE_STATES)
          .lt('starts_at', range.end)
          .gt('ends_at', range.start)
          .order('starts_at', { ascending: false })
          .order('id', { ascending: true })
          .range(a, b))
      return data.map(mapRow)
    },
  })
}

export interface CampaignOption {
  id: string
  name: string
}

/**
 * Projects (campaigns) that exist — empty until the campaign builder (V1.7).
 *
 * ADR-0067: `draft` is excluded. A draft is a wizard somebody walked away from — it has no
 * stream, no deliverables and no brief — so offering one here would let a person pick a campaign
 * and then find nothing inside it. Excluded rather than narrowed to `approved`, because that is
 * the change ADR-0067 requires and nothing more; what a `pending_approval` campaign may do is
 * ADR-0048 d.8's question, already answered elsewhere.
 */
export function useBookingCampaigns() {
  return useQuery({
    queryKey: bookingsKeys.campaigns(),
    queryFn: async (): Promise<CampaignOption[]> => {
      // Every page (I59.35): 882 non-draft campaigns locally on 25 Sep.
      return allRows<CampaignOption>((a, b) =>
        supabaseUntyped.from('campaigns').select('id, name').neq('status', 'draft').order('name').order('id').range(a, b))
    },
  })
}

/** Every booking linked to a campaign (all states of interest), for the rollup. */
export function useProjectBookings(campaignId: string | null) {
  return useQuery({
    queryKey: bookingsKeys.project(campaignId),
    enabled: campaignId != null && campaignId !== '',
    queryFn: async (): Promise<BookingListRow[]> => {
      const data = await allRows<RawBookingRow>((a, b) =>
        supabaseUntyped
          .from('bookings')
          .select(SELECT_IN_CAMPAIGN)
          .eq('deliverables.streams.campaign_id', campaignId!)
          .in('state', ACTIVE_STATES)
          .order('starts_at', { ascending: false })
          .order('id', { ascending: true })
          .range(a, b))
      return data.map(mapRow)
    },
  })
}
