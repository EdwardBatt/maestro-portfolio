// booking-transition — the authoritative booking lifecycle (M4, §4.2).
// Flexible states live here; the DB holds the one hard invariant (exclusion
// constraint). Runs the SAME capacity engine the UI previews with — but this
// verdict is the one that counts (AGENTS.md §2).
//
// Actions: create (single or weekly series) · approve · reject · cancel ·
// expire_holds (system/cron only).
//
// Client rule: runs as the CALLER (user-scoped client) so RLS keeps enforcing
// tenant + role scope end-to-end. No service-role usage except expire_holds,
// which authenticates by cron secret and only flips soft_hold→expired.

import { z } from 'npm:zod@4'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { hasPermission } from '../_shared/authz.ts'
import { assessCandidate } from '../../../src/lib/capacity/engine.ts'
import type { CapacityResource, OfficeCalendar } from '../../../src/lib/capacity/types.ts'
import { officeCalendarFromRow, type OfficeRowWithClosures } from '../../../src/lib/capacity/closures.ts'
import { checkTransition, deriveInitialState } from '../../../src/lib/bookings/state-machine.ts'
import { expandSeries } from '../../../src/lib/bookings/recurrence.ts'
import { hoursToLoadPct } from '../../../src/lib/capacity/day-hours.ts'
import { guarded } from '../_shared/http.ts'
import { allRowsResult } from '../_shared/all-pages.ts'

const CreateInput = z.object({
  action: z.literal('create'),
  resourceId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  requested: z.enum(['soft_hold', 'tentative', 'confirmed']).default('tentative'),
  loadPct: z.number().positive().max(200).optional(),
  /** ADR-0006: hours are the input; load is derived server-side */
  hoursPerDay: z.number().positive().max(24).optional(),
  // Project-task mode: a sub-task. The project link is DERIVED from the task, never trusted
  // separately.
  //
  // ADR-0060 d.7/d.8 removed two inputs that used to sit here, and removed them from the SCHEMA
  // rather than only from the caller, so a second caller cannot reintroduce either:
  //
  //   * `deliverableId` — booking a whole deliverable with no task. Edward, 30 Aug: *"it will not
  //     work… it could assign 14 steps to one person."* A deliverable is a container (ADR-0058);
  //     the task is the unit of work, and it is what gets assigned.
  //   * `campaignId` + `taskName` — which created a new DELIVERABLE in a stream literally named
  //     `General`, invented on first use. ADR-0050 gives a campaign ONE stream named for the
  //     campaign, so that manufactured a second one and the row surfaced on the campaign page as
  //     its own section rather than under the deliverable the person was looking at. New work now
  //     goes through `public.save_sub_task` as a SUB-TASK of the selected deliverable.
  //
  // `bookings.deliverable_id` the COLUMN is untouched and still written — `subtask-schedule` fills
  // it, and it is what labels an ad-hoc chip on the grid. What is gone is the INSTRUCTION to book
  // against a deliverable with no task.
  subTaskId: z.string().uuid().nullish(),   // ADR-0029: sub-task this booking assigns (implies its deliverable)
  jobId: z.string().uuid().nullish(),
  // Ad-hoc mode: free text, no project (§8.1 — both-null is normal)
  notes: z.string().max(2000).nullish(),
  title: z.string().trim().min(1).max(200).nullish(),   // ADR-0029: ad-hoc booking label
  series: z
    .object({
      freq: z.enum(['weekly', 'daily']),
      repeatCount: z.number().int().min(2).max(52),
      intervalWeeks: z.number().int().min(1).max(8).default(1),
    })
    .nullish(),
})

const TransitionInput = z.object({
  action: z.enum(['approve', 'reject', 'cancel']),
  bookingId: z.string().uuid(),
  /** optimistic concurrency: the state the caller believes the booking is in */
  expectedState: z.enum(['soft_hold', 'tentative', 'confirmed']),
})

// Drag-to-move / drag-to-resize (M5.1): a span change, not a state change.
// Re-assessed against everything EXCEPT the booking itself; the DB re-checks
// the exclusion constraint on UPDATE, so a confirmed+exclusive collision is
// still physically impossible.
const RescheduleInput = z.object({
  action: z.literal('reschedule'),
  bookingId: z.string().uuid(),
  expectedState: z.enum(['soft_hold', 'tentative', 'confirmed']),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  /** ADR-0006: dragging a chip to another row moves the booking */
  resourceId: z.string().uuid().optional(),
})

const ExpireInput = z.object({ action: z.literal('expire_holds') })

const Input = z.discriminatedUnion('action', [CreateInput, TransitionInput, RescheduleInput, ExpireInput])

// Browser calls require CORS: answer preflight and stamp every response.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...corsHeaders } })
const err = (status: number, code: string, message: string) =>
  json(status, { error: { code, message } })

const SOFT_HOLD_TTL_MS = 30 * 60 * 1000

/**
 * The capacity-relevant shape of a resource row. PostgREST's generated types model a to-one embed
 * (`offices(...)`) as an ARRAY, while `maybeSingle()` hands back a single object — so the inferred
 * type and the runtime value genuinely disagree. Cast through `unknown` once at each query
 * boundary rather than at every use, and work with the real shape from there.
 */
type ResourceRow = {
  capacity_model: string
  pool_size: number | null
  load_ceiling_pct: number | null
  warn_at_pct: number | null
  offices: OfficeRowWithClosures | null
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

  // --- system path: expire_holds (cron) --------------------------------
  if (input.action === 'expire_holds') {
    if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
      return err(403, 'forbidden', 'Cron secret required')
    }
    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data, error } = await service
      .from('bookings')
      .update({ state: 'expired' })
      .eq('state', 'soft_hold')
      .lt('soft_hold_expires_at', new Date().toISOString())
      .select('id')
    if (error) return err(500, 'expire_failed', 'Could not expire holds')
    return json(200, { expired: data.length })
  }

  // --- user paths: authenticate + grants (ADR-0008) ---------------------
  const authHeader = req.headers.get('authorization') ?? ''
  const db = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userErr } = await db.auth.getUser()
  if (userErr || !userData.user) return err(401, 'unauthenticated', 'Sign in required')
  const meta = (userData.user.app_metadata ?? {}) as Record<string, unknown>
  const tenantId = typeof meta.tenant_id === 'string' ? meta.tenant_id : null
  const roleId = typeof meta.app_role_id === 'string' ? meta.app_role_id : null
  if (!tenantId || !roleId) return err(403, 'forbidden', 'No role claim')

  // The caller's booking grants, resolved through THE primitive (ADR-0037) so a per-user allow
  // counts and a per-user deny bites, exactly as they do in RLS. Kept as the same Set the rest of
  // this function expects: checkTransition() consumes it for cancel/approve/reject, and
  // deriveInitialState() reads bookings:approve out of it.
  const BOOKING_ACTIONS = ['create', 'update', 'delete', 'approve'] as const
  const held = new Set(
    (await Promise.all(
      BOOKING_ACTIONS.map(async (a) => ((await hasPermission(db, 'bookings', a)) ? `bookings:${a}` : null)),
    )).filter((g): g is string => g !== null),
  )
  if (held.size === 0) return err(403, 'forbidden', 'No booking grants')

  // Explicit pre-check for the two non-transition actions (RLS would refuse
  // anyway — this returns a clean envelope instead of a policy error).
  if (input.action === 'create' && !held.has('bookings:create')) {
    return err(403, 'permission_denied', 'bookings:create grant required')
  }
  if (input.action === 'reschedule' && !held.has('bookings:update')) {
    return err(403, 'permission_denied', 'bookings:update grant required')
  }

  // --- reschedule (drag move/resize) ------------------------------------
  if (input.action === 'reschedule') {
    const newStart = Date.parse(input.startsAt)
    const newEnd = Date.parse(input.endsAt)
    if (!(newEnd > newStart)) return err(400, 'invalid_span', 'endsAt must be after startsAt')

    const { data: booking } = await db
      .from('bookings')
      .select('id, state, resource_id, load_pct, resources(capacity_model, pool_size, load_ceiling_pct, warn_at_pct, offices(timezone, working_days, office_closures(starts_on, ends_on)))')
      .eq('id', input.bookingId)
      .maybeSingle()
    if (!booking) return err(404, 'not_found', 'Booking not found')
    if (booking.state !== input.expectedState) {
      return err(409, 'state_changed', `Booking is ${booking.state}, not ${input.expectedState}`)
    }

    // target resource: same unless a row-move was requested
    let targetResourceId = booking.resource_id as string
    let targetRes = booking.resources as unknown as ResourceRow
    if (input.resourceId && input.resourceId !== booking.resource_id) {
      const { data: moved } = await db
        .from('resources')
        .select('id, capacity_model, pool_size, load_ceiling_pct, warn_at_pct, offices(timezone, working_days, office_closures(starts_on, ends_on))')
        .eq('id', input.resourceId)
        .maybeSingle()
      if (!moved) return err(404, 'not_found', 'Target resource not found')
      targetResourceId = moved.id
      targetRes = moved as unknown as ResourceRow
    }
    const res = targetRes
    const cap: CapacityResource =
      res.capacity_model === 'exclusive'
        ? { model: 'exclusive' }
        : res.capacity_model === 'pooled'
          ? { model: 'pooled', poolSize: res.pool_size ?? 1 }
          : { model: 'load_based', ceilingPct: Number(res.load_ceiling_pct ?? 100), warnAtPct: Number(res.warn_at_pct ?? 100) }
    const off: OfficeCalendar | undefined = res.offices ? officeCalendarFromRow(res.offices) : undefined

    // I59.39: paged — a busy pooled or load-based resource can hold more than PostgREST's 1,000
    // confirmed bookings in the window, and the ones past the cut would never be assessed.
    const { data: others } = await allRowsResult<{ id: string; starts_at: string; ends_at: string; load_pct: number | null }>((from, to) => db
      .from('bookings')
      .select('id, starts_at, ends_at, load_pct')
      .eq('resource_id', targetResourceId)
      .eq('state', 'confirmed')
      .neq('id', booking.id) // exclude self — moving out of your own way is fine
      .lt('starts_at', new Date(newEnd).toISOString())
      .gt('ends_at', new Date(newStart).toISOString())
      .order('starts_at').order('id')
      .range(from, to))
    const { data: blk } = await allRowsResult<{ id: string; starts_at: string; ends_at: string }>((from, to) => db
      .from('resource_unavailability')
      .select('id, starts_at, ends_at')
      .eq('resource_id', targetResourceId)
      .lt('starts_at', new Date(newEnd).toISOString())
      .gt('ends_at', new Date(newStart).toISOString())
      .order('starts_at').order('id')
      .range(from, to))

    const assessment = assessCandidate({
      resource: cap,
      candidate: { start: newStart, end: newEnd },
      candidateLoadPct: booking.load_pct == null ? undefined : Number(booking.load_pct),
      existing: (others ?? []).map((b) => ({
        id: b.id as string,
        start: Date.parse(b.starts_at as string),
        end: Date.parse(b.ends_at as string),
        loadPct: b.load_pct == null ? undefined : Number(b.load_pct),
      })),
      blackouts: (blk ?? []).map((b) => ({
        start: Date.parse(b.starts_at as string),
        end: Date.parse(b.ends_at as string),
      })),
      office: off,
    })

    const { data: updated, error: updErr } = await db
      .from('bookings')
      .update({ starts_at: new Date(newStart).toISOString(), ends_at: new Date(newEnd).toISOString(), resource_id: targetResourceId })
      .eq('id', input.bookingId)
      .eq('state', input.expectedState)
      .select('id, state, starts_at, ends_at')
    if (updErr) {
      return String(updErr.code) === '23P01'
        ? json(409, { error: { code: 'exclusive_conflict', message: 'Target slot is confirmed for this exclusive resource' }, assessment })
        : err(500, 'reschedule_failed', 'Could not reschedule booking')
    }
    if (!updated?.length) return err(409, 'state_changed', 'Booking changed concurrently; re-check and retry')

    await db.from('audit_events').insert({
      tenant_id: tenantId,
      actor_user_id: userData.user.id,
      action: 'booking_rescheduled',
      entity: 'bookings',
      entity_id: input.bookingId,
      payload: { startsAt: input.startsAt, endsAt: input.endsAt, resourceId: targetResourceId, assessment: assessment.level },
    })
    return json(200, { booking: updated[0], assessment })
  }

  // --- approve / reject / cancel ---------------------------------------
  if (input.action !== 'create') {
    const { data: booking } = await db
      .from('bookings')
      .select('id, state, resource_id, deliverable_id, job_id')
      .eq('id', input.bookingId)
      .maybeSingle()
    if (!booking) return err(404, 'not_found', 'Booking not found')
    if (booking.state !== input.expectedState) {
      return err(409, 'state_changed', `Booking is ${booking.state}, not ${input.expectedState}`)
    }
    const check = checkTransition(input.action, booking.state, held)
    if (!check.ok) {
      return err(check.error === 'permission_denied' ? 403 : 409, check.error!, 'Transition not allowed')
    }
    const { data: updated, error: updErr } = await db
      .from('bookings')
      .update({ state: check.to! })
      .eq('id', input.bookingId)
      .eq('state', input.expectedState) // optimistic guard against races
      .select('id, state')
    if (updErr) return err(500, 'transition_failed', 'Could not update booking')
    if (!updated?.length) return err(409, 'state_changed', 'Booking changed concurrently; re-check and retry')

    await db.from('audit_events').insert({
      tenant_id: tenantId,
      actor_user_id: userData.user.id,
      action: `booking_${input.action}`,
      entity: 'bookings',
      entity_id: input.bookingId,
      payload: { from: input.expectedState, to: check.to },
    })
    if (input.action === 'approve') {
      await db.from('sla_events').insert({
        tenant_id: tenantId,
        booking_id: input.bookingId,
        event_type: 'approved',
        attributed_to: 'approver',
        actor_user_id: userData.user.id,
        payload: {},
      })
    }
    return json(200, { booking: updated[0] })
  }

  // --- create (single or series) ----------------------------------------
  const startsAt = Date.parse(input.startsAt)
  const endsAt = Date.parse(input.endsAt)
  if (!(endsAt > startsAt)) return err(400, 'invalid_span', 'endsAt must be after startsAt')

  const { data: resource } = await db
    .from('resources')
    .select('id, capacity_model, pool_size, load_ceiling_pct, warn_at_pct, requires_approval, office_id, offices(timezone, working_days, office_closures(starts_on, ends_on))')
    .eq('id', input.resourceId)
    .maybeSingle()
  if (!resource) return err(404, 'not_found', 'Resource not found')

  const capacity: CapacityResource =
    resource.capacity_model === 'exclusive'
      ? { model: 'exclusive' }
      : resource.capacity_model === 'pooled'
        ? { model: 'pooled', poolSize: resource.pool_size ?? 1 }
        : {
            model: 'load_based',
            ceilingPct: Number(resource.load_ceiling_pct ?? 100),
            warnAtPct: Number(resource.warn_at_pct ?? 100),
          }

  const officeRow = resource.offices as unknown as OfficeRowWithClosures | null
  const office: OfficeCalendar | undefined = officeRow ? officeCalendarFromRow(officeRow) : undefined

  const effectiveLoadPct =
    input.hoursPerDay != null ? hoursToLoadPct(input.hoursPerDay) : input.loadPct

  const spans = input.series
    ? expandSeries({
        first: { start: startsAt, end: endsAt },
        repeatCount: input.series.repeatCount,
        stepDays: input.series.freq === 'daily' ? 1 : 7 * input.series.intervalWeeks,
        timezone: office?.timezone ?? 'UTC',
        // I41.2 — a daily run steps over the office's days off, so "2 days" is two days of work
        // and not two calendar days one of which nobody works. Weekly is left alone deliberately:
        // stepping would break the same-weekday-every-week contract that is the point of it.
        workingDays: input.series.freq === 'daily' ? office?.workingDays : undefined,
        closures: input.series.freq === 'daily' ? office?.closures : undefined,
      })
    : [{ start: startsAt, end: endsAt }]

  // window covering all instances, one fetch
  const windowStart = new Date(Math.min(...spans.map((s) => s.start))).toISOString()
  const windowEnd = new Date(Math.max(...spans.map((s) => s.end))).toISOString()
  // I59.39: paged — a weekly series spans up to 52 weeks, and a year of a busy resource's confirmed
  // bookings passes PostgREST's 1,000-row cut; an unseen booking is a capacity check that passes a
  // full slot.
  const { data: existing } = await allRowsResult<{ id: string; starts_at: string; ends_at: string; load_pct: number | null }>((from, to) => db
    .from('bookings')
    .select('id, starts_at, ends_at, load_pct')
    .eq('resource_id', input.resourceId)
    .eq('state', 'confirmed')
    .lt('starts_at', windowEnd)
    .gt('ends_at', windowStart)
    .order('starts_at').order('id')
    .range(from, to))
  const { data: blackoutRows } = await allRowsResult<{ id: string; starts_at: string; ends_at: string }>((from, to) => db
    .from('resource_unavailability')
    .select('id, starts_at, ends_at')
    .eq('resource_id', input.resourceId)
    .lt('starts_at', windowEnd)
    .gt('ends_at', windowStart)
    .order('starts_at').order('id')
    .range(from, to))

  const existingSpans = (existing ?? []).map((b) => ({
    id: b.id as string,
    start: Date.parse(b.starts_at as string),
    end: Date.parse(b.ends_at as string),
    loadPct: b.load_pct == null ? undefined : Number(b.load_pct),
  }))
  const blackouts = (blackoutRows ?? []).map((b) => ({
    start: Date.parse(b.starts_at as string),
    end: Date.parse(b.ends_at as string),
  }))

  const assessments = spans.map((candidate) =>
    assessCandidate({
      resource: capacity,
      candidate,
      candidateLoadPct: effectiveLoadPct,
      existing: existingSpans,
      blackouts,
      office,
    }),
  )
  const worst = assessments.reduce(
    (acc, a) => (['ok', 'warn', 'over_ceiling', 'conflict'].indexOf(a.level) >
      ['ok', 'warn', 'over_ceiling', 'conflict'].indexOf(acc) ? a.level : acc),
    'ok' as (typeof assessments)[number]['level'],
  )

  const initial = deriveInitialState({
    requested: input.requested,
    requiresApproval: resource.requires_approval as boolean,
    assessment: worst,
    canApprove: held.has('bookings:approve'),
  })
  if (initial.refused) {
    return json(409, { error: { code: 'exclusive_conflict', message: 'Exclusive resource already confirmed in this window' }, assessments })
  }

  // --- resolve the task linkage (ADR-0006 rev, narrowed by ADR-0060) ----
  // A booking links to a SUB-TASK or to nothing. The deliverable and the campaign are DERIVED from
  // that task, never sent — they are facts about it, and taking them from the caller was how a
  // booking could point at a deliverable while claiming a different campaign.
  let deliverableId: string | null = null
  let campaignId: string | null = null
  if (input.subTaskId) {
    // sub-task booking (ADR-0029): the deliverable is implied by the sub-task
    const { data: st } = await db.from('sub_tasks').select('deliverable_id').eq('id', input.subTaskId).maybeSingle()
    if (!st) return err(404, 'not_found', 'Sub-task not found')
    deliverableId = st.deliverable_id as string | null
  }
  if (deliverableId) {
    // derive the campaign through the stream
    const { data: deliv } = await db
      .from('deliverables')
      .select('id, name, streams(campaign_id)')
      .eq('id', deliverableId)
      .maybeSingle()
    if (!deliv) return err(404, 'not_found', 'Task not found')
    campaignId = (deliv.streams as unknown as { campaign_id: string } | null)?.campaign_id ?? null
  }
  // else: ad-hoc — notes only, no links (normal case)

  // series row first (if any)
  let seriesId: string | null = null
  if (input.series) {
    const { data: seriesRow, error: seriesErr } = await db
      .from('booking_series')
      .insert({
        tenant_id: tenantId,
        resource_id: input.resourceId,
        created_by: userData.user.id,
        freq: input.series.freq,
        interval_weeks: input.series.intervalWeeks,
        repeat_count: input.series.repeatCount,
        first_starts_at: new Date(startsAt).toISOString(),
        first_ends_at: new Date(endsAt).toISOString(),
      })
      .select('id')
      .single()
    if (seriesErr) return err(500, 'series_failed', 'Could not create series')
    seriesId = seriesRow.id
  }

  const rows = spans.map((s) => ({
    tenant_id: tenantId,
    resource_id: input.resourceId,
    booked_by: userData.user.id,
    deliverable_id: deliverableId,
    sub_task_id: input.subTaskId ?? null,
    job_id: input.jobId ?? null,
    campaign_id: campaignId,
    state: initial.state,
    starts_at: new Date(s.start).toISOString(),
    ends_at: new Date(s.end).toISOString(),
    load_pct: effectiveLoadPct ?? null,
    soft_hold_expires_at:
      initial.state === 'soft_hold' ? new Date(Date.now() + SOFT_HOLD_TTL_MS).toISOString() : null,
    notes: input.notes ?? null,
    title: input.title ?? null,
    series_id: seriesId,
  }))

  const { data: created, error: createErr } = await db
    .from('bookings')
    .insert(rows)
    .select('id, state, starts_at, ends_at, series_id')
  if (createErr) {
    const code = String(createErr.code)
    // 23P01 = exclusion constraint: someone confirmed the slot between our
    // assessment and the insert. The DB wins — report cleanly.
    if (code === '23P01') {
      return json(409, { error: { code: 'exclusive_conflict', message: 'Slot was taken concurrently' }, assessments })
    }
    // 42501 = RLS denial. The caller holds bookings:create (checked above) but
    // the resource is outside their write scope (ADR-0009/0010: team/department/
    // assignment). Surface it as a clean 403 instead of an opaque 500.
    if (code === '42501') {
      return err(403, 'out_of_scope', 'That resource is outside your write scope — you can only book resources within your team, department, or assigned campaigns.')
    }
    return err(500, 'create_failed', 'Could not create booking')
  }

  await db.from('audit_events').insert({
    tenant_id: tenantId,
    actor_user_id: userData.user.id,
    action: 'booking_created',
    entity: 'bookings',
    entity_id: created[0]!.id,
    payload: {
      state: initial.state,
      needsApproval: initial.needsApproval,
      worstAssessment: worst,
      instances: created.length,
      seriesId,
    },
  })

  return json(201, { bookings: created, assessments, needsApproval: initial.needsApproval })
}))
