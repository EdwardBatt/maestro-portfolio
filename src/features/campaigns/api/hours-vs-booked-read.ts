import { supabaseUntyped } from '../../../lib/supabase'
import { inChunks } from '../../../lib/query/in-chunks'
import { inChunksPaged } from '../../../lib/query/all-pages'
import { bookedHoursBetween, hoursRemaining, type BookedSpan, type LoggedEntry } from '../../../lib/deadlines/booked-hours'

/**
 * The inputs of ADR-0075 d.4's first clause (I57.12): for each assigned task not yet handed in that
 * has a committed date, its hours left and its assignee's hours booked on it before that date.
 *
 * ONE read, used by every screen that judges "at risk" — the campaigns list's card and Where is
 * everything (I57.20: the two disagreed, 3 at risk against 1, because only the card read bookings).
 * A task never scheduled gets nothing back, and the date checks judge it alone.
 */
export interface JudgeTask {
  id: string
  status: 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled'
  assignee_id: string | null
  committed_due_at: string | null
  revision_number: number | null
  hours: number | null
}

export interface HoursVsBooked {
  hoursRemaining: number | null
  bookedHoursLeft: number | null
}

/** Bookings that still hold time — the schedule's own set (`schedule-api`). */
const LIVE_BOOKING = ['soft_hold', 'tentative', 'confirmed']

// `inChunksPaged` (lib/query/all-pages.ts): each batch PAGED too — a hundred tasks on daily bookings
// is thousands of rows.

interface BookingRaw { sub_task_id: string; resource_id: string; starts_at: string; ends_at: string; load_pct: number | string | null }
interface EntryRaw { sub_task_id: string; round: number; minutes: number | string | null; started_at: string | null; submitted_at: string | null }

export async function readHoursVsBooked(tasks: readonly JudgeTask[], now: number): Promise<Map<string, HoursVsBooked>> {
  const judged = tasks.filter((t) => (t.status === 'todo' || t.status === 'in_progress') && t.assignee_id && t.committed_due_at)
  const out = new Map<string, HoursVsBooked>()
  if (judged.length === 0) return out
  const ids = judged.map((t) => t.id)
  const [entries, bookings, resources] = await Promise.all([
    inChunksPaged<EntryRaw>(ids, (chunk, a, b) =>
      supabaseUntyped.from('task_time_entries').select('sub_task_id, round, minutes, started_at, submitted_at')
        .in('sub_task_id', chunk).order('id').range(a, b)),
    inChunksPaged<BookingRaw>(ids, (chunk, a, b) =>
      supabaseUntyped.from('bookings').select('sub_task_id, resource_id, starts_at, ends_at, load_pct')
        .in('state', LIVE_BOOKING).in('sub_task_id', chunk).order('id').range(a, b)),
    // Whose resource each booking is on — only the assignee's own bookings are time for the task
    // (ADR-0042 d.5, as `app.sync_subtask_span` reads them).
    inChunks<{ id: string; user_id: string | null }>(judged.map((t) => t.assignee_id!), (chunk) =>
      supabaseUntyped.from('resources').select('id, user_id').in('user_id', chunk)),
  ])

  const userOfResource = new Map(resources.map((r) => [r.id, r.user_id]))
  const byId = new Map(judged.map((t) => [t.id, t]))
  const bookingsOf = new Map<string, BookedSpan[]>()
  for (const b of bookings) {
    if (userOfResource.get(b.resource_id) !== byId.get(b.sub_task_id)?.assignee_id) continue
    bookingsOf.set(b.sub_task_id, [...(bookingsOf.get(b.sub_task_id) ?? []), {
      start: Date.parse(b.starts_at), end: Date.parse(b.ends_at), loadPct: b.load_pct == null ? null : Number(b.load_pct),
    }])
  }
  const loggedOf = new Map<string, LoggedEntry[]>()
  for (const e of entries) {
    if (e.round !== (byId.get(e.sub_task_id)?.revision_number ?? 0)) continue
    loggedOf.set(e.sub_task_id, [...(loggedOf.get(e.sub_task_id) ?? []), {
      minutes: e.minutes == null ? null : Number(e.minutes), startedAt: e.started_at, submittedAt: e.submitted_at,
    }])
  }
  for (const t of judged) {
    const booked = bookingsOf.get(t.id)
    if (!booked || booked.length === 0) continue
    out.set(t.id, {
      hoursRemaining: hoursRemaining(t.hours, loggedOf.get(t.id) ?? [], now),
      bookedHoursLeft: bookedHoursBetween(booked, now, Date.parse(t.committed_due_at!)),
    })
  }
  return out
}
