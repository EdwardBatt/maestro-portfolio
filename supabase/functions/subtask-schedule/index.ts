// subtask-schedule — materialise a sub-task as a daily series of bookings (ADR-0024, I1.3).
//
// A sub-task with an assignee + total hours (sla_hours) + start/due dates becomes one booking
// per office working day between start and due, on the assignee's linked resource, so it shows
// on the schedule grid and consumes capacity. Total effort is spread evenly across working days
// (src/lib/bookings/subtask-spread), each day anchored 09:00 office-local (day-span) — identical
// to how the grid stores manual day bookings.
//
// Runs as the CALLER (user-scoped client): RLS enforces sub-task visibility and — crucially —
// booking create/delete scope (bookings:create/delete + resource_in_write_scope), so you can
// only schedule people within your team/department. No service-role.
//
// Idempotent regenerate: DELETE the sub-task's existing bookings, then INSERT the fresh series.
// It never UPDATEs a booking, so the override trigger never fires for the materialiser — only a
// human edit trips schedule_overridden, and while that flag is set this function leaves the
// sub-task's schedule untouched. Releasing (unassigned / no dates / done|cancelled) just deletes.
//
//
// ADR-0042: the same pass also books the resources the task REQUIRES (sub_task_resources) — a
// camera, an edit suite, or a second person. Each is booked for its OWN hours from its own start,
// never the task's span, on its own office calendar. A clash raises and never blocks: an exclusive
// resource already taken is written `tentative`, a person over their ceiling is written `confirmed`,
// and both notify the assigner and the account manager. Placement failures degrade to a report.
//
// Deploy: `supabase functions deploy subtask-schedule`
import { z } from 'npm:zod@4'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { spreadHours } from '../../../src/lib/bookings/subtask-spread.ts'
import { daySpan } from '../../../src/lib/bookings/day-span.ts'
import { allocatedHours, requirementAllocations } from '../../../src/lib/bookings/requirement-allocation.ts'
import { allRowsResult } from '../_shared/all-pages.ts'
import { officeCalendarFromRow, type OfficeRowWithClosures } from '../../../src/lib/capacity/closures.ts'
import { hasPermission } from '../_shared/authz.ts'
import { guarded } from '../_shared/http.ts'

const Input = z.object({ subTaskId: z.string().uuid() })

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...corsHeaders } })
const err = (status: number, code: string, message: string) => json(status, { error: { code, message } })

const TERMINAL = new Set(['done', 'cancelled'])

type Office = { timezone: string; workingDays: number[]; closures?: readonly string[] }
interface RequirementReport {
  /** bookings written for required resources */
  placed: number
  /** resources whose booking had to be written `tentative` because the day was already taken */
  contested: string[]
  /** load-based resources pushed past their ceiling by this task */
  overCapacity: string[]
  /** requirements that could not be booked at all, and why — never silently dropped */
  unplaced: { resource: string; reason: string }[]
}

/**
 * ADR-0042 d.4/d.6 — book the resources this task REQUIRES, and report honestly.
 *
 * The governing rule is d.6: **a clash raises, it never blocks and it never moves a date.**
 * Assignment has already succeeded by the time this runs, and nothing here may undo it. A contested
 * camera or an overloaded colleague is surfaced for a human to resolve — "conflict raised, discussed
 * and resolved" — because rescheduling committed work has consequences outside this system that the
 * scheduler cannot see.
 *
 * So every failure path below degrades to a REPORT, never to an error. The caller gets back exactly
 * what happened, and the two clash shapes are recorded where they are already visible: an exclusive
 * clash as a `tentative` booking on the grid, an over-ceiling person as the cell's overload badge.
 */
async function placeRequirements(
  // deno-lint-ignore no-explicit-any -- the supabase-js client type is not worth importing here
  db: any,
  ctx: {
    subTaskId: string
    tenantId: string
    deliverableId: string | null
    title: string
    bookedBy: string
    firstIsoDate: string
    assigneeOffice: Office
  },
): Promise<RequirementReport> {
  const report: RequirementReport = { placed: 0, contested: [], overCapacity: [], unplaced: [] }

  const { data: reqs } = await db
    .from('sub_task_resources')
    .select('resource_id, hours, starts_on')
    .eq('sub_task_id', ctx.subTaskId)
  if (!reqs || reqs.length === 0) return report

  // Deliberately NOT a PostgREST embed. sub_task_resources → resources is a COMPOSITE foreign key
  // ((tenant_id, resource_id)), and an embed that PostgREST cannot resolve comes back empty rather
  // than as an error — which on this project has twice read as "no data" and cost a day. A second
  // query is cheap and cannot fail silently.
  const ids = reqs.map((r: { resource_id: string }) => r.resource_id)
  const { data: resources } = await db
    .from('resources')
    .select('id, name, kind, capacity_model, load_ceiling_pct, is_active, offices(timezone, working_days, office_closures(starts_on, ends_on))')
    .in('id', ids)
  const byId = new Map<string, Record<string, unknown>>()
  for (const r of resources ?? []) byId.set(String(r.id), r)

  for (const req of reqs) {
    const resource = byId.get(String(req.resource_id))
    const name = String(resource?.name ?? req.resource_id)

    if (!resource || resource.is_active === false) {
      report.unplaced.push({ resource: name, reason: 'resource_inactive' })
      continue
    }

    // The resource's OWN office decides its working days — an office that does not work Friday does
    // not lend its camera on Friday. Falls back to the assignee's calendar when it has no office.
    const officeRow = resource.offices as unknown as OfficeRowWithClosures | null
    const office: Office = officeRow ? officeCalendarFromRow(officeRow) : ctx.assigneeOffice

    // starts_on pins the requirement; null means the task's first booked day (d.3). HOURS, not days:
    // a camera wanted for three hours occupies three hours, not the whole day.
    const wanted = Number(req.hours)
    const allocations = requirementAllocations(String(req.starts_on ?? ctx.firstIsoDate), wanted, office)
    if (allocations.length === 0) {
      report.unplaced.push({ resource: name, reason: 'no_working_days_available' })
      continue
    }
    const placedHours = allocatedHours(allocations)
    if (placedHours < wanted) {
      // Never silently book less than was asked for — that is the schedule lying by another route.
      report.unplaced.push({ resource: name, reason: `only_${placedHours}h_of_${wanted}h_could_be_placed` })
    }

    const loadBased = resource.capacity_model === 'load_based'
    let contested = false

    for (const alloc of allocations) {
      const isoDate = alloc.isoDate
      const span = daySpan(isoDate, alloc.hours, office.timezone)
      const row = {
        tenant_id: ctx.tenantId,
        resource_id: resource.id,
        booked_by: ctx.bookedBy,
        deliverable_id: ctx.deliverableId,
        sub_task_id: ctx.subTaskId,
        state: 'confirmed',
        starts_at: new Date(span.start).toISOString(),
        ends_at: new Date(span.end).toISOString(),
        // Set for every kind, not just people: load_pct is how a booking carries its HOURS on
        // this schema, and the grid renders `${loadPctToHours(load_pct)}h` on the chip. A camera
        // booked for 3h should say so; only load-based resources accumulate it toward a ceiling.
        load_pct: alloc.loadPct,
        notes: ctx.title,
      }

      // One row at a time on purpose: a batch insert fails wholesale on the first conflict, which
      // would lose the days that WOULD have fitted.
      const { error } = await db.from('bookings').insert(row)
      if (!error) {
        report.placed++
        continue
      }

      // 23P01 = excl_bookings_confirmed_exclusive_overlap. The resource is already taken that day.
      // d.6: write it tentative rather than refusing — the requirement is real and must stay visible.
      if (String(error.code) === '23P01') {
        const { error: tentativeErr } = await db.from('bookings').insert({ ...row, state: 'tentative' })
        if (tentativeErr) {
          report.unplaced.push({ resource: name, reason: 'contested_and_could_not_hold' })
          continue
        }
        report.placed++
        contested = true
        continue
      }

      // 42501 = the caller cannot book this resource. Their own assignment stands; this asset does not.
      report.unplaced.push({
        resource: name,
        reason: String(error.code) === '42501' ? 'out_of_your_booking_scope' : 'insert_failed',
      })
    }

    if (contested) report.contested.push(name)

    // The other clash shape: a person does not collide, they go over their ceiling.
    if (loadBased && resource.load_ceiling_pct != null &&
        (await isOverCeiling(db, resource, allocations.map((a) => a.isoDate), office))) {
      report.overCapacity.push(name)
    }

    // Best-effort alert to the assigner and the account manager (ADR-0042 d.6). The RECORD is the
    // booking; if this fails the clash is still on the grid and still in the response.
    if (contested || report.overCapacity.includes(name)) {
      await db.rpc('notify_resource_clash', { p_sub_task: ctx.subTaskId, p_resource: resource.id })
    }
  }

  return report
}

/** Has this task's requirement pushed a load-based resource past its ceiling on any required day? */
async function isOverCeiling(
  // deno-lint-ignore no-explicit-any
  db: any,
  resource: Record<string, unknown>,
  dates: string[],
  office: Office,
): Promise<boolean> {
  const first = daySpan(dates[0], 8, office.timezone)
  const last = daySpan(dates[dates.length - 1], 8, office.timezone)
  // I59.39: paged — a load-based resource's confirmed bookings across a long requirement can pass
  // PostgREST's 1,000-row cut, and a day summed from part of its bookings reads as under the ceiling.
  const { data } = await allRowsResult<{ starts_at: string; load_pct: number | null }>((from: number, to: number) => db
    .from('bookings')
    .select('starts_at, load_pct')
    .eq('resource_id', resource.id)
    .eq('state', 'confirmed')
    .gte('starts_at', new Date(first.start).toISOString())
    .lte('starts_at', new Date(last.end).toISOString())
    .order('starts_at').order('id')
    .range(from, to))
  if (!data) return false

  const perDay = new Map<string, number>()
  for (const b of data) {
    const day = String(b.starts_at).slice(0, 10)
    perDay.set(day, (perDay.get(day) ?? 0) + Number(b.load_pct ?? 0))
  }
  const ceiling = Number(resource.load_ceiling_pct)
  return [...perDay.values()].some((total) => total > ceiling)
}

Deno.serve(guarded(corsHeaders, async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return err(405, 'method_not_allowed', 'POST only')

  let input: z.infer<typeof Input>
  try {
    input = Input.parse(await req.json())
  } catch {
    return err(400, 'invalid_input', 'Request body failed validation')
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const authHeader = req.headers.get('authorization') ?? ''
  const db = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })

  const { data: userData, error: userErr } = await db.auth.getUser()
  if (userErr || !userData.user) return err(401, 'unauthenticated', 'Sign in required')
  const meta = (userData.user.app_metadata ?? {}) as Record<string, unknown>
  const tenantId = typeof meta.tenant_id === 'string' ? meta.tenant_id : null
  const roleId = typeof meta.app_role_id === 'string' ? meta.app_role_id : null
  if (!tenantId || !roleId) return err(403, 'forbidden', 'No role claim')

  // ADR-0037: THE primitive, so a per-user grant counts here exactly as it does in RLS.
  if (!(await hasPermission(db, 'bookings', 'create'))) {
    return err(403, 'permission_denied', 'bookings:create grant required to schedule a sub-task')
  }

  // Load the sub-task (RLS: tenant-scoped read).
  const { data: st } = await db
    .from('sub_tasks')
    .select('id, deliverable_id, assignee_id, title, sla_hours, starts_at, due_at, status, schedule_overridden')
    .eq('id', input.subTaskId)
    .maybeSingle()
  if (!st) return err(404, 'not_found', 'Sub-task not found')

  // A human hand-adjusted the schedule → it's theirs; don't touch it.
  if (st.schedule_overridden) return json(200, { skipped: 'overridden', scheduled: 0 })

  // Release any existing materialised bookings (delete never trips the override trigger). If the
  // caller lacks delete scope over the resource, RLS makes this a no-op (0 rows) and the old
  // bookings simply remain — the insert below then 403s, so nothing is lost.
  const { error: delErr } = await db.from('bookings').delete().eq('sub_task_id', input.subTaskId)
  if (delErr) return err(500, 'release_failed', 'Could not clear existing sub-task bookings')

  // Not schedulable yet → released only (unassigned, no hours/dates, or terminal status).
  if (!st.assignee_id || st.sla_hours == null || !st.starts_at || !st.due_at || TERMINAL.has(String(st.status))) {
    return json(200, { scheduled: 0, released: true, reason: 'not_schedulable' })
  }

  // The assignee's bookable resource + its office calendar.
  const { data: resource } = await db
    .from('resources')
    .select('id, is_active, offices(timezone, working_days, office_closures(starts_on, ends_on))')
    .eq('user_id', st.assignee_id)
    .eq('kind', 'human')
    .maybeSingle()
  if (!resource || resource.is_active === false) {
    return json(200, { scheduled: 0, released: true, reason: 'assignee_no_active_resource' })
  }
  // PostgREST types the to-one `offices(...)` embed as an array; maybeSingle() returns the
  // object. The types and the runtime disagree — cast through unknown at the boundary.
  const officeRow = resource.offices as unknown as OfficeRowWithClosures | null
  if (!officeRow) return json(200, { scheduled: 0, released: true, reason: 'assignee_no_office' })
  // ADR-0079 d.4: closures ride on the office row, so the spread steps over Eid like a weekend.
  const office = officeCalendarFromRow(officeRow)

  const allocations = spreadHours(
    Number(st.sla_hours),
    Date.parse(st.starts_at as string),
    Date.parse(st.due_at as string),
    office,
  )
  // ADR-0061 d.2: `no_working_days_in_range` is GONE. `spreadHours` now falls back to the span's
  // calendar days when it holds no working day, so a deliberately-chosen Sunday is booked on the
  // Sunday. This can still be empty — non-positive hours, or an inverted range — and that is a
  // different fact, so it says a different thing.
  if (allocations.length === 0) {
    return json(200, { scheduled: 0, released: true, reason: 'nothing_to_place' })
  }

  const rows = allocations.map((a) => {
    const span = daySpan(a.isoDate, a.hours, office.timezone)
    return {
      tenant_id: tenantId,
      resource_id: resource.id,
      booked_by: userData.user.id,
      deliverable_id: st.deliverable_id,
      sub_task_id: st.id,
      state: 'confirmed',
      starts_at: new Date(span.start).toISOString(),
      ends_at: new Date(span.end).toISOString(),
      load_pct: a.loadPct,
      notes: st.title,
    }
  })

  const { data: created, error: insErr } = await db
    .from('bookings')
    .insert(rows)
    .select('id, starts_at, ends_at, load_pct')
  if (insErr) {
    // 42501 = RLS denial: the assignee's resource is outside the caller's booking write scope.
    if (String(insErr.code) === '42501') {
      return err(403, 'out_of_scope', 'That assignee is outside your scheduling scope — you can only schedule people within your team or department.')
    }
    return err(500, 'schedule_failed', 'Could not create the sub-task bookings')
  }

  // ADR-0042 d.4: the assignee's days and the task's REQUIRED resources are materialised in the
  // same pass. Placement failures never fail the request — see placeRequirements.
  const requirements = await placeRequirements(db, {
    subTaskId: st.id,
    tenantId,
    deliverableId: st.deliverable_id as string | null,
    title: String(st.title ?? ''),
    bookedBy: userData.user.id,
    firstIsoDate: allocations[0].isoDate,
    assigneeOffice: office,
  })

  return json(201, { scheduled: created.length, bookings: created, requirements })
}))
