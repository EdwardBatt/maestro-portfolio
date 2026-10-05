// notify-email — the email slow lane for notifications (ADR-0028, I5c).
//
// Invoked by the guarded `app.tg_notification_email` trigger (pg_net) with just { id }. The
// notifications row is already durable (ADR-0015 / I5a emission triggers); this function is the
// SECOND channel, best-effort. It loads the row, resolves the recipient's email + locale and the
// actor's name, renders subject/body in the RECIPIENT'S language, and sends via Resend directly
// (no SDK — plain fetch, ADR-0002) with `Idempotency-Key: <notification id>` so a retried trigger
// never double-sends. `due_soon` is skipped (digest concern; ADR-0028). Any failure is logged and
// swallowed — the inbox row remains the source of truth.
//
// Runs as service role. Called internally with the service-role key as bearer (from Vault); the
// bearer is verified for defence-in-depth. Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (platform),
// RESEND_API_KEY, NOTIFY_EMAIL_FROM, APP_BASE_URL (see ADR-0028 runbook).
// EMAIL_ALLOWLIST — LOCAL ONLY, unset in production (ADR-0081 d.3a): comma-separated substrings; a
// recipient matching none of them is refused. See the block at the recipient lookup for why.
//
// Deploy: `supabase functions deploy notify-email`
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { notificationDoor } from '../../../src/lib/notifications/door.ts'
import { guarded } from '../_shared/http.ts'
import { isAllowedRecipient } from '../_shared/email-allowlist.ts'
import { notificationLabel } from '../../../src/lib/notifications/label.ts'
import { formatDeadline, formatIraqDate, iraqDay } from '../../../src/lib/time/iraq.ts'
import { emailConfigured, sendEmail } from '../_shared/email-transport.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// THE SAME VALUES AS `notifications_type_check`, IN THE SAME ORDER (I30.2, 6 Sep; I52, 17 Sep).
//
// This union is a SECOND HOME for a list that lives in Postgres, and it had drifted seven values
// behind — so seven real notification types reached the map below, found nothing, and returned
// `200 {skipped:'no_copy'}`: no error, no log line anybody reads, no email. `cancelled` is raised
// from 28 places. The constraint's own comment had warned about exactly this.
//
// The `Record` type looks like it prevents that and does not: it checks the map against THIS union,
// which is the copy that was wrong. `src/test/notification-copy.test.ts` is what actually holds
// them together — it reads the constraint out of the migration and fails when either half moves.
type NotifType =
  | 'assigned' | 'review_requested' | 'changes_requested' | 'signed_off'
  | 'due_soon' | 'dependency_ready' | 'cancelled' | 'resource_clash' | 'resource_required'
  | 'campaign_approved' | 'deliverable_reassigned' | 'rescheduled' | 'chat_added'
  | 'task_reinstated' | 'feedback_collected'
  | 'assignment_requested' | 'assignment_approved' | 'assignment_refused' | 'assignment_superseded'
  | 'extension_requested' | 'extension_approved' | 'extension_refused'
  | 'deliverable_added'
  | 'deliverable_owner_removed' | 'task_reassigned_away' | 'feedback_requested'
  | 'assignment_overdue'
  | 'task_reopened' | 'deliverable_reopened'
  // I59 (ADR-0105..0113) — declared together in 20260926090000
  | 'task_blocked' | 'untimed_round' | 'extension_forwarded'
  | 'change_request_sent' | 'change_request_answered' | 'change_request_resolved'
  | 'question_asked' | 'question_replied' | 'nudged' | 'too_much' | 'too_much_answered'
  | 'escalated' | 'review_reminder' | 'over_capacity' | 'task_unblocked'
  | 'client_activation_requested'
  | 'deliverable_type_changed'
  | 'deliverable_edited'
  // ADR-0133 (I70) — declared in 20260930140000
  | 'handover_list' | 'deactivation_complete'
  // ADR-0134 d.18 / ADR-0136 d.4 (I72) — declared in 20261002120000
  | 'link_expiring' | 'file_brought_back'
  // ADR-0139..0141 (I74) — declared in 20261003110000
  | 'assignment_offered' | 'assignment_offer_taken' | 'assignment_withdrawn'
  | 'task_unassigned'
  | 'deliverable_change_asked' | 'deliverable_change_answered' | 'deliverable_change_withdrawn'
  | 'time_asked' | 'time_answered'
  | 'translation_languages_changed'
type Locale = 'en' | 'ar'

/** ADR-0133 d.3: what a leaving person still holds, in words — "2 clients, 12 open tasks and 4 reviews". */
const HANDOVER_KINDS: readonly [string, string, string, string, string][] = [
  // kind, EN one, EN many, AR one, AR many
  ['client', 'client', 'clients', 'عميل', 'عملاء'],
  ['campaign', 'campaign or job', 'campaigns and jobs', 'حملة أو مهمة', 'حملات ومهام'],
  ['deliverable', 'deliverable', 'deliverables', 'مُخرَج', 'مُخرَجات'],
  ['workstream', 'workstream', 'workstreams', 'مسار عمل', 'مسارات عمل'],
  ['task', 'open task', 'open tasks', 'مهمة مفتوحة', 'مهام مفتوحة'],
  ['review', 'review', 'reviews', 'مراجعة', 'مراجعات'],
]
function handoverParts(items: unknown, ar: boolean): string[] {
  const m = (items && typeof items === 'object' ? items : {}) as Record<string, unknown>
  return HANDOVER_KINDS.flatMap(([k, one, many, oneAr, manyAr]) => {
    const n = Number(m[k] ?? 0)
    if (!n) return []
    return [ar ? `${n} ${n === 1 ? oneAr : manyAr}` : `${n} ${n === 1 ? one : many}`]
  })
}
function handoverItemsEn(items: unknown): string {
  const p = handoverParts(items, false)
  if (p.length === 0) return 'Their items'
  return p.length === 1 ? p[0] : `${p.slice(0, -1).join(', ')} and ${p[p.length - 1]}`
}
function handoverItemsAr(items: unknown): string {
  const p = handoverParts(items, true)
  return p.length === 0 ? 'عناصره' : p.join('، ')
}

interface NotificationRow {
  id: string
  tenant_id: string
  user_id: string
  type: NotifType
  label: string | null
  context_label: string | null
  entity_type: 'deliverable' | 'sub_task' | 'campaign' | 'booking' | 'resource' | 'client' | 'user_profile' | null
  entity_id: string | null
  actor_id: string | null
  /** I52: the facts the emitter knew at the moment (see the column comment). */
  detail: Record<string, unknown> | null
}

/**
 * Everything a sentence may need, gathered ONCE before the words are chosen (I52, 17 Sep).
 *
 * Edward's rule for every message: *who* it is for, *what* happened, and *what is now required of
 * them* — with real names, dates and days, never "an item". The emitters put what they knew into
 * `notifications.detail`; what can be read back later is read here, best-effort, one query each.
 * A missing fact degrades a sentence; it never blocks the send (ADR-0028 — the inbox is the truth).
 */
interface Ctx {
  locale: Locale
  /** The work the event is about — a task title, a deliverable's name, a campaign's name. */
  work: string
  /** The campaign or job it sits in, when that is not the work itself. */
  campaign: string | null
  /** `campaign — work`, the one joined name the inbox also shows (I30.7). */
  full: string
  actor: string
  detail: Record<string, unknown>
  /** From the task or deliverable row, when the row still exists. */
  dueAt: string | null
  hours: number | null
  /** People named by the event, by role. */
  assignee: string | null
  newOwner: string | null
  person: string | null
  /** A day span the event is about (a booking, a request). */
  spanStart: string | null
  spanEnd: string | null
  /** An extension's dates and reason; a refusal's reason. */
  fromAt: string | null
  toAt: string | null
  reason: string | null
  /** Reviewer answers, for the required reviewer's "everyone has answered". */
  withFeedback: number
  noComment: number
  /** The task that was approved, releasing this one (Action 6b). */
  approvedTask: string | null
  /** Action 15: is the recipient the new deliverable's own owner? */
  forOwner: boolean
  /** Action 1 (I53.19): what the reader owns on the approved campaign — each with its phase and due date. */
  ownedCount: number
  /** `noTasks` (I66.3): the piece has no task yet — its owner defines the tasks, there is no list to approve. */
  owned: { name: string; dueAt: string | null; phaseNumber: number | null; phaseName: string | null; noTasks?: boolean }[]
  /** Action 7: the whole job was archived. */
  jobArchived: boolean
  /** The reader is the deliverable's owner rather than an assignee (Action 6b, unassigned). */
  unassigned: boolean
}

const day = (at: string | null, l: Locale) => (at ? formatIraqDate(at, l) : '')
/** `Wednesday 23 September 2026 – Thursday 24 September 2026`, or the one day. */
function span(a: string | null, b: string | null, l: Locale): string {
  if (!a && !b) return ''
  if (!a || !b || iraqDay(a) === iraqDay(b)) return day(a ?? b, l)
  return `${day(a, l)} – ${day(b, l)}`
}
const q = (s: string) => `“${s}”`
const qa = (s: string) => `«${s}»`
/** `<work> on <campaign>` / `<work> (<campaign>)` — the work first, the job it sits in after. */
const on = (c: Ctx) => (c.campaign ? `${c.work} on ${c.campaign}` : c.work)
const onAr = (c: Ctx) => (c.campaign ? `${qa(c.work)} في ${qa(c.campaign)}` : qa(c.work))
const hrs = (c: Ctx) => (c.hours != null && c.hours > 0 ? `${c.hours} hours` : '')
const hrsAr = (c: Ctx) => (c.hours != null && c.hours > 0 ? `${c.hours} ساعة` : '')

/** Action 1's list — objects since 20260921150000; the rows of earlier that day carry plain names. */
function ownedList(v: unknown): Ctx['owned'] {
  if (!Array.isArray(v)) return []
  const str = (x: unknown): string | null => (typeof x === 'string' && x ? x : null)
  const num = (x: unknown): number | null => (typeof x === 'number' ? x : null)
  return v.flatMap((e): Ctx['owned'] => {
    if (typeof e === 'string') return [{ name: e, dueAt: null, phaseNumber: null, phaseName: null }]
    if (e && typeof e === 'object') {
      const o = e as Record<string, unknown>
      const name = str(o.name)
      return name ? [{ name, dueAt: str(o.due_at), phaseNumber: num(o.phase_number), phaseName: str(o.phase_name), noTasks: o.no_tasks === true }] : []
    }
    return []
  })
}
/** "Teaser — Phase 1: Pre-Launch, due Saturday 26 September 2026", one per line (the body is HTML). */
function ownedLines(c: Ctx): string {
  const items = c.owned.map((o) => {
    const parts: string[] = []
    if (o.phaseNumber != null && o.phaseName) parts.push(c.locale === 'ar' ? `المرحلة ${o.phaseNumber}: ${o.phaseName}` : `Phase ${o.phaseNumber}: ${o.phaseName}`)
    if (o.dueAt) parts.push(c.locale === 'ar' ? `موعدها ${day(o.dueAt, c.locale)}` : `due ${day(o.dueAt, c.locale)}`)
    if (o.noTasks) parts.push(c.locale === 'ar' ? 'لم تُنشأ له مهام بعد — حدّد المهام' : 'no tasks have been created — define the tasks')
    return `• ${o.name}${parts.length ? ` — ${parts.join(c.locale === 'ar' ? '، ' : ', ')}` : ''}`
  })
  return items.length ? `<br>${items.join('<br>')}<br>` : ''
}

// ---- I59: the facts the new emitters put in `detail` ------------------------------------------
// Read straight from `c.detail` rather than widening Ctx: each is used by one or two entries only.
/** A string fact, or null. */
const ds = (c: Ctx, k: string): string | null => (typeof c.detail[k] === 'string' && c.detail[k] ? (c.detail[k] as string) : null)
/** A number fact, or null. */
const dn = (c: Ctx, k: string): number | null => (typeof c.detail[k] === 'number' ? (c.detail[k] as number) : null)
/** "18 hours" / "18 ساعة", or the agreed-time fallback — how long something has waited (ADR-0108). */
const waited = (c: Ctx) => {
  const h = dn(c, 'hours')
  if (c.locale === 'ar') return h != null ? `${h} ساعة` : 'أكثر من الوقت المتفق عليه'
  return h != null ? `${h} hours` : 'longer than the agreed time'
}
/** ADR-0110: what a change request changes — `{field: {from, to}}` for type, quantity, department, due. */
function changesText(c: Ctx): string {
  const ch = (c.detail.changes ?? {}) as Record<string, { from?: unknown; to?: unknown } | undefined>
  const s = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
  const parts: string[] = []
  const ar = c.locale === 'ar'
  if (ch.quantity) parts.push(ar ? `الكمية من ${s(ch.quantity.from)} إلى ${s(ch.quantity.to)}` : `quantity ${s(ch.quantity.from)} → ${s(ch.quantity.to)}`)
  if (ch.due && s(ch.due.to)) parts.push(ar ? `الموعد ${day(s(ch.due.to), c.locale)}` : `due ${day(s(ch.due.to), c.locale)}`)
  if (ch.type) parts.push(ar ? 'نوع آخر' : 'a different type')
  if (ch.department) parts.push(ar ? 'قسم آخر' : 'a different department')
  return parts.join(ar ? '، ' : ', ') || (ar ? 'تفاصيله' : 'its details')
}
/** ADR-0113 d.3: the maker's week, as My Work shows it. */
function weekText(c: Ctx): string {
  const w = (c.detail.week ?? null) as Record<string, unknown> | null
  if (!w || w.has_resource !== true) return ''
  const n = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN)
  const booked = n(w.booked_hours), nominal = n(w.nominal_hours), pct = n(w.util_pct)
  if (!Number.isFinite(booked) || !Number.isFinite(nominal)) return ''
  return c.locale === 'ar'
    ? ` — ${booked} من ${nominal} ساعة محجوزة هذا الأسبوع${Number.isFinite(pct) ? ` (${pct}%)` : ''}`
    : ` — ${booked} of ${nominal} hours booked this week${Number.isFinite(pct) ? ` (${pct}%)` : ''}`
}
const from = (c: Ctx) => (c.fromAt ? (c.locale === 'ar' ? ` من ${day(c.fromAt, c.locale)}` : ` from ${day(c.fromAt, c.locale)}`) : '')
const to = (c: Ctx) => (c.toAt ? (c.locale === 'ar' ? ` إلى ${day(c.toAt, c.locale)}` : ` to ${day(c.toAt, c.locale)}`) : '')

interface Copy { subject: (c: Ctx) => string; line: (c: Ctx) => string; facts?: false }

// The words Edward decided one action at a time on 17 Sep — `docs/reference/notification-email-copy.md`,
// "Decided one action at a time". Each line says what happened and what is now required of the
// reader. Kept here (not the app i18n bundle) so the function is self-contained; the inbox's
// `notifications.type.*` says the same thing shorter, and `src/test/notification-copy.test.ts`
// holds the three lists together.
const COPY: Record<Locale, Record<Exclude<NotifType, 'due_soon'>, Copy>> = {
  en: {
    // Action 1 — to the deliverable's owner. I53.19 (Edward, 21 Sep): ONE mail per owner, saying
    // how many deliverables are theirs and which, and what is required of them.
    campaign_approved: {
      subject: (c) => c.ownedCount > 0
        ? `Approved: ${c.campaign ?? c.work} — you own ${c.ownedCount} ${c.ownedCount === 1 ? 'deliverable' : 'deliverables'}`
        : `Approved: ${c.campaign ?? c.work}`,
      line: (c) => {
        const owned = c.ownedCount > 0
          ? ` You own ${c.ownedCount} ${c.ownedCount === 1 ? 'deliverable' : 'deliverables'} on it${c.owned.length ? `:${ownedLines(c)}` : '.'}`
          : ''
        // I66.3: a piece with no tasks has no list to approve — its owner defines the tasks.
        const empty = c.owned.filter((o) => o.noTasks).length
        const ask = empty > 0 && empty === c.owned.length
          ? ' No tasks have been created, so you need to define the tasks, then approve the task list so each task can be assigned.'
          : empty > 0
            ? ' You need to review the task list of each, then approve it so each task can be assigned — and define the tasks where none have been created.'
            : ' You need to review the task list of each, then approve it so each task can be assigned.'
        return `${c.actor} approved ${c.campaign ?? c.work}.${owned}${ask}`
      },
    },
    // Action 2 — the new owner, and the old owner in one line.
    deliverable_reassigned: {
      subject: (c) => `Assigned to you: ${c.full}`,
      // I57.44: what is actually owed — the task list, or nothing when it is already approved.
      line: (c) => c.detail.tasks_approved === true
        ? `${c.actor} made you the owner of ${on(c)}. Its task list is already approved, so its work can be assigned — it is yours to see through.`
        : c.detail.no_tasks === true
          ? `${c.actor} made you the owner of ${on(c)}. No tasks have been created for it, so you need to define the tasks, then approve the task list so each task can be assigned.`
          : `${c.actor} made you the owner of ${on(c)}. Review its task list and approve it so each task can be assigned.`,
    },
    deliverable_owner_removed: {
      subject: (c) => `No longer yours: ${c.full}`,
      line: (c) => `${on(c)} is now owned by ${c.newOwner ?? 'somebody else'}.`,
      facts: false,
    },
    // Action 3 — the assignee, and the person a task was taken from.
    assigned: {
      subject: (c) => `New task: ${c.work}`,
      line: (c) => {
        const due = c.dueAt ? ` It is due ${day(c.dueAt, c.locale)}` : ''
        const est = hrs(c) ? (due ? ` and estimated at ${hrs(c)}.` : ` It is estimated at ${hrs(c)}.`) : due ? '.' : ''
        return `${c.actor} assigned you ${on(c)}.${due}${est} Start it from My Work and submit it for review when it is done.`
      },
      facts: false,
    },
    task_reassigned_away: {
      subject: (c) => `No longer yours: ${c.work}`,
      line: (c) => `${on(c)} has been reassigned to ${c.assignee ?? 'somebody else'}.`,
      facts: false,
    },
    // Action 4 — the required reviewer, and the optional reviewer.
    review_requested: {
      subject: (c) => `Review needed: ${c.work}`,
      line: (c) => `${c.actor} submitted ${on(c)} for your review. Open it, review the work, and approve it or send it back with your changes.`,
    },
    feedback_requested: {
      subject: (c) => `Your feedback is needed: ${c.work}`,
      line: (c) => `${c.actor} submitted ${on(c)}. Open it and leave your feedback, or mark it “no comment” — the approval waits for your answer.`,
    },
    // SJ-v3-04 / ADR-0045 — the job has waited past the tenant's hours for an assignment. To each
    // traffic manager, and to the owner so nobody is escalated behind their back.
    assignment_overdue: {
      subject: (c) => (c.forOwner ? `Escalated to traffic: ${c.full}` : `Nobody assigned yet: ${c.full}`),
      line: (c) => {
        const who = c.newOwner ?? 'the lead'
        const waited = c.hours != null ? `${c.hours} working hours` : 'longer than the agreed time'
        return c.forOwner
          ? `${on(c)} has waited ${waited} without an assignment, so it has been escalated to the traffic manager. Assign it now, or tell traffic why it is waiting.`
          : `${on(c)} has waited ${waited} and ${who} has not assigned it. It has been escalated to you — assign it, or ask ${who} what is holding it.`
      },
      facts: false,
    },
    // Action 5 — the maker. The feedback is pointed to, never carried.
    changes_requested: {
      subject: (c) => `Changes requested: ${c.work}`,
      line: (c) => `${c.actor} sent ${on(c)} back with feedback. Open it, make the changes and resubmit for review.`,
    },
    // Action 6a — the maker; nothing more is needed.
    signed_off: {
      subject: (c) => `Approved: ${c.work}`,
      line: (c) => `${c.actor} approved ${on(c)}. Nothing more is needed from you on it.`,
      facts: false,
    },
    // Action 6b — the assignee of a task that was waiting, or the deliverable's owner when nobody is.
    dependency_ready: {
      subject: (c) => `You can start: ${c.work}`,
      line: (c) => {
        const what = c.approvedTask ? `${c.approvedTask}, which ${on(c)} was waiting for, has been approved.` : `Everything ${on(c)} was waiting for has been approved.`
        return c.unassigned
          ? `${what} It is not assigned to anyone — assign it on the Schedule.`
          : `${what} Everything it needs is now in — start it from My Work.`
      },
    },
    // Action 7 — the assignee; stop.
    cancelled: {
      subject: (c) => `Cancelled: ${c.work}`,
      line: (c) => `${c.actor} cancelled ${on(c)}${c.jobArchived && c.campaign ? ` because ${c.campaign} was archived` : ''}. Stop work on it — it has been taken off your calendar and nothing more is needed from you.`,
      facts: false,
    },
    // Action 8 — the assignee; which days.
    rescheduled: {
      subject: (c) => `Moved: ${c.work}`,
      line: (c) => {
        const to = span(c.toAt ?? c.spanStart, c.spanEnd, c.locale)
        const dueChanged = c.fromAt && c.dueAt && iraqDay(c.fromAt) !== iraqDay(c.dueAt)
        const due = c.dueAt ? (dueChanged ? ` and it is now due ${day(c.dueAt, c.locale)}.` : `. Its due date is unchanged: ${day(c.dueAt, c.locale)}.`) : '.'
        return `${c.actor} moved ${on(c)}${to ? ` to ${to}` : ' to different days'}${due}`
      },
      facts: false,
    },
    // Action 9 — the account manager asked; the requester and assignee answered.
    extension_requested: {
      subject: (c) => `Extension to answer: ${c.work}`,
      line: (c) => `${c.actor} asked to move the deadline of ${on(c)}${c.fromAt ? ` from ${day(c.fromAt, c.locale)}` : ''}${c.toAt ? ` to ${day(c.toAt, c.locale)}` : ''}.${c.reason ? ` Reason: ${q(c.reason)}.` : ''} Open it and approve or refuse.`,
      facts: false,
    },
    extension_approved: {
      subject: (c) => `Extension approved: ${c.work}`,
      line: (c) => `${c.actor} approved the extension. ${on(c)} is now due ${day(c.toAt ?? c.dueAt, c.locale) || 'the new date'}.`,
      facts: false,
    },
    extension_refused: {
      subject: (c) => `Extension refused: ${c.work}`,
      line: (c) => `${c.actor} refused the extension. ${on(c)} is still due ${day(c.dueAt ?? c.fromAt, c.locale) || 'the same date'}.${c.reason ? ` Reason: ${q(c.reason)}.` : ''}`,
      facts: false,
    },
    // Action 10 — the person's leads asked; the requester answered.
    assignment_requested: {
      subject: (c) => `Booking request: ${c.work}`,
      line: (c) => `${c.actor} asks to book ${c.person ?? 'somebody in your department'} on ${c.work}${c.campaign ? ` (${c.campaign})` : ''}${span(c.spanStart, c.spanEnd, c.locale) ? `, ${span(c.spanStart, c.spanEnd, c.locale)}` : ''}${hrs(c) ? `, ${hrs(c)}` : ''}. Nothing is booked until you approve it — open the Schedule to approve or refuse.`,
      facts: false,
    },
    assignment_approved: {
      subject: (c) => `Booking approved: ${c.work}`,
      line: (c) => `${c.actor} approved your request. ${c.person ?? 'The person'} is booked on ${c.work}${span(c.spanStart, c.spanEnd, c.locale) ? `, ${span(c.spanStart, c.spanEnd, c.locale)}` : ''}.`,
      facts: false,
    },
    assignment_refused: {
      subject: (c) => `Booking refused: ${c.work}`,
      line: (c) => `${c.actor} refused your request to book ${c.person ?? 'that person'} on ${c.work}.${c.reason ? ` Reason: ${q(c.reason)}.` : ''} The task is unchanged — ask somebody else.`,
      facts: false,
    },
    assignment_superseded: {
      subject: (c) => `Booking request closed: ${c.work}`,
      line: (c) => `${c.work} was assigned to ${c.assignee ?? 'somebody else'} by ${c.actor}, so your request for it is closed.`,
      facts: false,
    },
    // Action 11 — the required reviewer, once everyone has answered.
    feedback_collected: {
      subject: (c) => `Ready for your approval: ${c.work}`,
      line: (c) => `Every reviewer has answered on ${c.work}${c.campaign ? ` (${c.campaign})` : ''} — ${c.withFeedback} with feedback, ${c.noComment} with no comment. Open it, read the feedback, and approve it or send it back.`,
    },
    // Action 12 — added to a chat group. Not an invitation.
    chat_added: {
      subject: (c) => `Added to a chat group: ${c.full}`,
      line: (c) => `${c.actor} added you to the chat group for ${c.work}${c.campaign ? ` (${c.campaign})` : ''}. Open it to read the thread and reply.`,
      facts: false,
    },
    // Action 13 — a required person, booked for the task's days.
    resource_required: {
      subject: (c) => `You're booked on: ${c.work}`,
      line: (c) => `${c.actor} booked you on ${c.work}${c.campaign ? ` (${c.campaign})` : ''}${span(c.spanStart, c.spanEnd, c.locale) ? `, ${span(c.spanStart, c.spanEnd, c.locale)}` : ''}${hrs(c) ? `, ${hrs(c)}` : ''}. ${c.assignee ? `${c.assignee} is doing the task; you're` : 'You are'} needed on it for that time — it's on your calendar.`,
      facts: false,
    },
    // Action 14 — whoever assigned, and the account manager. The label is the RESOURCE.
    resource_clash: {
      subject: (c) => `Booking clash: ${c.work}`,
      line: (c) => `${c.work} is needed for ${c.approvedTask ?? 'a task'}${c.campaign ? ` (${c.campaign})` : ''}${span(c.spanStart, c.spanEnd, c.locale) ? ` on ${span(c.spanStart, c.spanEnd, c.locale)}` : ''} but is already booked then. Open the Schedule to move the task or pick another resource.`,
      facts: false,
    },
    // Action 15 — the new deliverable's owner first; another owner on the job in one line.
    deliverable_added: {
      subject: (c) => (c.forOwner ? `Added to ${c.campaign ?? 'your job'}: ${c.work}` : `Added to ${c.campaign ?? 'your job'}: ${c.work}`),
      line: (c) => c.forOwner
        ? `${c.actor} added ${c.work} to ${c.campaign ?? 'your job'} — a new request that belongs with that job. ${c.detail.no_tasks === true
            ? 'No tasks have been created for it, so you need to define the tasks, then approve the task list so each task can be assigned.'
            : 'Review its task list and approve it so each task can be assigned.'}`
        : `${c.work} was added to ${c.campaign ?? 'your job'}; ${c.newOwner ?? 'its owner'} owns it.`,
    },
    // I52.7, decided earlier on 17 Sep — the leads in reach and the deliverable's owner.
    task_reinstated: {
      subject: (c) => `Needs assigning: ${c.full}`,
      line: (c) => `${c.actor} reinstated ${on(c)}. It is not assigned to anyone — assign it on the Schedule to put it back on a calendar.`,
    },
    // ADR-0103 d.2 — to the re-opened task's assignee and each reviewer, with the reason.
    task_reopened: {
      subject: (c) => `Re-opened: ${c.full}`,
      line: (c) => `${c.actor} re-opened ${on(c)}${c.reason ? ` — "${c.reason}"` : ''}. ${c.detail.for_reviewer === true
        ? 'It comes back to you for review once it is done again.'
        : 'It is back on your list to do again'}${c.dueAt ? `${c.detail.for_reviewer === true ? ' It is now due' : ', due'} ${day(c.dueAt, c.locale)}.` : '.'}`,
    },
    // ADR-0103 d.3 — to the owner of a re-opened deliverable, when they did not do it themself.
    deliverable_reopened: {
      subject: (c) => `Re-opened: ${c.full}`,
      line: (c) => {
        const tasks = Array.isArray(c.detail.tasks) ? (c.detail.tasks as unknown[]).filter((t): t is string => typeof t === 'string') : []
        return `${c.actor} re-opened ${on(c)}${c.reason ? ` — "${c.reason}"` : ''}. ${tasks.length ? `To do again: ${tasks.join(', ')}.` : ''}${c.detail.campaign_reopened === true ? ' The campaign was closed and is open again.' : ''}`
      },
    },
    // ---- I59 (25 Sep, ADR-0105..0113) ----------------------------------------------------------
    // ADR-0107 d.2 — the owner and the account manager, when a maker is blocked on their own task.
    task_blocked: {
      subject: (c) => `Blocked: ${c.work}`,
      line: (c) => {
        const what = ds(c, 'what'), who = ds(c, 'who'), need = ds(c, 'need')
        return `${c.actor} is blocked on ${on(c)}${what ? ` — waiting on ${who ?? 'somebody'} for ${q(what)}` : ''}.${need ? ` What they need: ${q(need)}.` : ''} Help them get it, or clear the block once it is resolved.`
      },
      facts: false,
    },
    // ADR-0106 d.3 — the deliverable's owner, when a round was sent untimed.
    untimed_round: {
      subject: (c) => `Sent untimed: ${c.work}`,
      line: (c) => {
        const h = dn(c, 'hours') ?? c.hours
        return `${c.actor} sent ${on(c)} for review without timing it, so its full allocated time${h ? ` (${h} hours)` : ''} was recorded. A KPI penalty may apply.`
      },
      facts: false,
    },
    // ADR-0109 d.2 — the account manager, once the owner has forwarded a request.
    extension_forwarded: {
      subject: (c) => `Extension to answer: ${c.work}`,
      line: (c) => {
        const note = ds(c, 'note')
        return `${c.actor} forwarded a request to move the deadline of ${on(c)}${from(c)}${to(c)}.${c.reason ? ` Reason: ${q(c.reason)}.` : ''}${note ? ` ${c.actor}'s note: ${q(note)}.` : ''} Open it and approve, approve a shorter extension, or decline.`
      },
      facts: false,
    },
    // ADR-0110 d.1 — the deliverable's owner.
    change_request_sent: {
      subject: (c) => `Change request: ${c.work}`,
      line: (c) => `${c.actor} asks to change ${on(c)}, which is already under way: ${changesText(c)}. ${ds(c, 'asked_by') === 'client'
        ? 'The client asked for it, so it spends a revision round.'
        : 'It was our mistake, so it counts no round.'} Accept it, decline it with a reason, or push back.`,
    },
    // ADR-0110 d.2 — the requester.
    change_request_answered: {
      subject: (c) => {
        const a = ds(c, 'answer')
        return `${a === 'accept' ? 'Change accepted' : a === 'decline' ? 'Change declined' : 'Change pushed back'}: ${c.work}`
      },
      line: (c) => {
        const a = ds(c, 'answer')
        const reason = ds(c, 'reason')
        if (a === 'accept') return `${c.actor} accepted your change to ${on(c)} (${changesText(c)}). It has been applied.`
        if (a === 'decline') return `${c.actor} declined your change to ${on(c)}.${reason ? ` Reason: ${q(reason)}.` : ''} Send a new request, or close it.`
        const d = ds(c, 'counter_date')
        return `${c.actor} pushed back on your change to ${on(c)}: ${q(ds(c, 'counter_text') ?? '')}${d ? ` — by ${day(d, c.locale)}` : ''}. Accept their version, or withdraw the request.`
      },
      facts: false,
    },
    // ADR-0110 d.3 — the owner who pushed back.
    change_request_resolved: {
      subject: (c) => `${ds(c, 'resolution') === 'accept_counter' ? 'Your version accepted' : 'Change withdrawn'}: ${c.work}`,
      line: (c) => {
        const d = ds(c, 'counter_date')
        return ds(c, 'resolution') === 'accept_counter'
          ? `${c.actor} accepted your version of the change to ${on(c)}. It has been applied${d ? `, due ${day(d, c.locale)}` : ''}.`
          : `${c.actor} withdrew the change request on ${on(c)}. Nothing changes.`
      },
      facts: false,
    },
    // ADR-0113 d.2 — each person the asker picked; then the asker.
    question_asked: {
      subject: (c) => `Question: ${c.work}`,
      line: (c) => `${c.actor} asks about ${on(c)}: ${q(ds(c, 'body') ?? '')}. Open it and reply.`,
      facts: false,
    },
    question_replied: {
      subject: (c) => `Reply: ${c.work}`,
      line: (c) => `${c.actor} replied to your question about ${on(c)}: ${q(ds(c, 'body') ?? '')}.`,
      facts: false,
    },
    // ADR-0113 d.1 — the person nudged.
    nudged: {
      subject: (c) => `Nudge: ${c.work}`,
      line: (c) => {
        const body = ds(c, 'body')
        return `${c.actor} nudged you about ${on(c)}${body ? `: ${q(body)}` : ''}. They are waiting on it.`
      },
    },
    // ADR-0113 d.3 — whoever assigned the task; then the maker.
    too_much: {
      subject: (c) => `Too much: ${c.work}`,
      line: (c) => {
        const note = ds(c, 'note')
        return `${c.actor} says ${on(c)} is too much for their week${weekText(c)}.${note ? ` Their note: ${q(note)}.` : ''} Rebalance it on the Schedule, or keep it with them.`
      },
    },
    too_much_answered: {
      subject: (c) => `${ds(c, 'answer') === 'rebalance' ? 'Being rebalanced' : 'Kept with you'}: ${c.work}`,
      line: (c) => ds(c, 'answer') === 'rebalance'
        ? `${c.actor} will rebalance your week — ${on(c)} may move. Keep working on it until it does.`
        : `${c.actor} is keeping ${on(c)} with you. Carry on with it.`,
    },
    // ADR-0108 d.2 — one of the seven escalations; `detail.kind` names which, `detail.hours` how long.
    escalated: {
      subject: (c) => `Escalated: ${c.full}`,
      line: (c) => {
        const w = waited(c)
        switch (ds(c, 'kind')) {
          case 'unassigned': return `${on(c)} has waited ${w} with nobody assigned. It has been escalated to you — assign it, or find out what is holding it.`
          // I66.4: a piece with no tasks has no list to approve — its tasks were never defined.
          case 'task_list': return c.detail.all_cancelled === true
            ? `Every task on ${on(c)} was cancelled ${w} ago, and nobody has added one or closed it. It has been escalated to you — find out from its owner whether it is still needed.`
            : c.detail.no_tasks === true
            ? `${on(c)} has had no tasks defined for ${w}. It has been escalated to you — find out from its owner what is holding it, or define the tasks.`
            : `The task list of ${on(c)} has waited ${w} for approval. It has been escalated to you — approve it, or find out what is holding it.`
          case 'campaign_brief': return `The brief of ${on(c)} has waited ${w} for the account manager's approval. It has been escalated to you — follow it up with them.`
          case 'change_request': return `A change request on ${on(c)} has waited ${w} for its owner's answer. It has been escalated to you — follow it up with them.`
          case 'extension_owner': return `An extension request on ${on(c)} has waited ${w} for its owner to forward or decline it. It has been escalated to you — follow it up with them.`
          case 'extension_am': return `An extension request on ${on(c)} has waited ${w} for the account manager's answer. It has been escalated to you — answer it, or follow it up.`
          case 'blocked': return `${on(c)} has been blocked for ${w}. It has been escalated to you — help clear the block.`
          case 'review': return `${on(c)} has waited ${w} for review. It has been escalated to you — follow up with its reviewers.`
          // ADR-0133 d.5: the label is the leaving PERSON; `items` names what is still waiting.
          case 'handover': return `${c.work} started leaving ${w} ago and ${handoverItemsEn(c.detail.items)} have still not been handed over. It has been escalated to you — hand them over, or find out what is holding it.`
          // ADR-0139 d.5: a booking asked of another team, unanswered — Traffic and the department lead may answer it now.
          case 'task_request': return `A request to book ${on(c)}${ds(c, 'team') ? ` with ${ds(c, 'team')}` : ''} has waited ${w} for an answer. It has been escalated to you — answer it on the Schedule; the first answer settles it.`
          // ADR-0141 d.3: a change asked of the account manager, unanswered — to the account director.
          case 'deliverable_change': return `A change asked on ${on(c)} has waited ${w} for the account manager's answer. It has been escalated to you — answer it, or follow it up with them.`
          default: return `${on(c)} has waited ${w}. It has been escalated to you.`
        }
      },
      facts: false,
    },
    // ADR-0108 d.2 — the review row's reminder rung, to the reviewers who have not answered.
    review_reminder: {
      subject: (c) => `Reminder — review needed: ${c.work}`,
      line: (c) => `${on(c)} has waited ${waited(c)} for your review. Open it, review the work, and approve it or send it back.`,
    },
    // ADR-0108 d.6 — the person's team lead, deputy and department lead. The label is the PERSON.
    over_capacity: {
      subject: (c) => `Over capacity: ${c.work}`,
      line: (c) => {
        const pct = dn(c, 'pct') ?? dn(c, 'util_pct')
        return `${c.work} is booked${pct != null ? ` at ${pct}%` : ' over capacity'} this week. Rebalance their week on the Schedule.`
      },
      facts: false,
    },
    // ADR-0107 addendum (I59 settled) — a block was cleared; to whoever was waiting on it.
    // ADR-0123 — a draft client's starter asked for activation; to every holder of clients:approve.
    client_activation_requested: {
      subject: (c) => `Activate a client: ${c.work}`,
      line: (c) => `${c.actor} registered ${c.work} as a draft and asks you to activate it. Review it and activate it, or tell them what is missing.`,
      facts: false,
    },
    // I68.4 (ADR-0132 d.3): someone else changed the owner's deliverable's type; its task list was replaced.
    deliverable_type_changed: {
      subject: (c) => `Type changed: ${c.work}`,
      line: (c) => `${c.actor} changed the type of ${c.work}. ${Number(c.detail.cancelled ?? 0)} open task(s) from the old type were cancelled and ${Number(c.detail.added ?? 0)} added from the new one. Review its task list and approve it so each task can be assigned.`,
    },
    // I68.4 (ADR-0132 d.2-d.3): someone else corrected the owner's deliverable's quantity or due date.
    deliverable_edited: {
      subject: (c) => `Changed: ${c.work}`,
      line: (c) => {
        const q = c.detail.quantity as { from?: number; to?: number } | undefined
        const parts = [
          q ? `quantity ${q.from} → ${q.to}` : null,
          c.detail.due ? 'the due date' : null,
        ].filter(Boolean).join(' and ')
        const added = Number(c.detail.added ?? 0)
        const cancelled = Number(c.detail.cancelled ?? 0)
        return `${c.actor} changed ${parts || 'the details'} of ${c.work}.${cancelled ? ` ${cancelled} open task(s) were cancelled.` : ''}${added ? ` ${added} task(s) were added — review the task list and approve it so each can be assigned.` : ''}`
      },
    },
    // ADR-0133 d.2 (I70.3): a person is leaving; their work is listed for their department lead (or the Traffic Manager
    // and the Power Admins) to hand over. The label is the PERSON.
    handover_list: {
      subject: (c) => `Hand over ${c.work}'s work`,
      line: (c) => `${c.actor} has deactivated ${c.work}. They can no longer sign in. ${handoverItemsEn(c.detail.items)} still need someone to take them on — hand each one to a named person. The deactivation completes itself when the list is empty.`,
      facts: false,
    },
    // ADR-0133 d.4 (I70.5): the list reached empty; the person is Deactivated.
    deactivation_complete: {
      subject: (c) => `Deactivated: ${c.work}`,
      line: (c) => `${c.work}'s deactivation is complete — ${Number(c.detail.handed_over ?? 0)} item(s) handed over. They are off the Schedule.`,
      facts: false,
    },
    // ADR-0134 d.18 (I72): a link the reader added to the Library expires in two days. The label is the LINK.
    link_expiring: {
      subject: (c) => `Link expires soon: ${c.work}`,
      line: (c) => `The link ${q(c.work)} you added${c.campaign ? ` to ${c.campaign}'s files` : ''} expires on ${day(ds(c, 'expires_on'), c.locale) || 'its expiry date'}. If it is still needed, add the new address as its next version before then — after that day it reads "Link expired".`,
      facts: false,
    },
    // ADR-0136 d.4 (I72): the archived file the reader asked for is back online. The label is the FILE.
    file_brought_back: {
      subject: (c) => `Back online: ${c.work}`,
      line: (c) => `${q(c.work)}${c.campaign ? ` (${c.campaign})` : ''} is back from the office archive, as you asked. It stays online for 30 days, then returns to the archive.`,
      facts: false,
    },
    // ADR-0139 d.4 (I74): the team lead offered other days; to the asker.
    assignment_offered: {
      subject: (c) => `Other days offered: ${c.work}`,
      line: (c) => `${c.actor} cannot book ${c.work} as you asked, and offers ${ds(c, 'person') ?? 'someone'} ${span(ds(c, 'starts_at'), ds(c, 'ends_at'), c.locale) || 'other days'} instead.${ds(c, 'note') ? ` ${q(ds(c, 'note') ?? '')}.` : ''} Take the offer on the Schedule, or ask again.`,
      facts: false,
    },
    // ADR-0139 d.4 (I74): the asker took the lead's offer; to the lead who offered.
    assignment_offer_taken: {
      subject: (c) => `Offer taken: ${c.work}`,
      line: (c) => `${c.actor} took your offer for ${c.work} — it is booked on the days you offered.`,
      facts: false,
    },
    // ADR-0139 d.4 (I74): the asker took a request back; to whoever was asked.
    assignment_withdrawn: {
      subject: (c) => `Request withdrawn: ${c.work}`,
      line: (c) => `${c.actor} withdrew the request to book ${c.work}. Nothing is needed from you.`,
      facts: false,
    },
    // ADR-0140 d.5 (I74): a booking cancelled; to the assignee and their lead — not the account manager.
    task_unassigned: {
      subject: (c) => `Taken off: ${c.work}`,
      line: (c) => ds(c, 'as') === 'lead'
        ? `${c.actor} took ${ds(c, 'person') ?? 'your team member'} off ${c.work}. It is back to be booked.`
        : `${c.actor} took you off ${c.work}. It is no longer on your week.`,
      facts: false,
    },
    // ADR-0141 d.2 (I74): the one change form; to the account manager.
    deliverable_change_asked: {
      subject: (c) => `Change asked: ${c.work}`,
      line: (c) => `${c.actor} asks you to change ${c.work}${ds(c, 'due_day') ? ` — due ${day(ds(c, 'due_day'), c.locale)}` : ''}${dn(c, 'hours') != null ? `, ${dn(c, 'hours')} hours` : ''}.${ds(c, 'reason') ? ` Why: ${q(ds(c, 'reason') ?? '')}.` : ''} Accept it, change it, or keep it as it is.`,
      facts: false,
    },
    // ADR-0141 d.4 (I74): the account manager's answer; to the asker.
    deliverable_change_answered: {
      subject: (c) => `${ds(c, 'answer') === 'keep' ? 'Kept as it is' : 'Changed'}: ${c.work}`,
      line: (c) => ds(c, 'answer') === 'keep'
        ? `${c.actor} is keeping ${c.work} as it is.${ds(c, 'note') ? ` ${q(ds(c, 'note') ?? '')}.` : ''}`
        : `${c.actor} ${ds(c, 'answer') === 'accept' ? 'accepted your change to' : 'changed'} ${c.work}${ds(c, 'due_day') ? ` — now due ${day(ds(c, 'due_day'), c.locale)}` : ''}.${ds(c, 'note') ? ` ${q(ds(c, 'note') ?? '')}.` : ''}`,
      facts: false,
    },
    // ADR-0141 d.3 (I74): the asker took a change back; to the account manager.
    deliverable_change_withdrawn: {
      subject: (c) => `Change withdrawn: ${c.work}`,
      line: (c) => `${c.actor} withdrew the change asked on ${c.work}. Nothing is needed from you.`,
      facts: false,
    },
    // ADR-0141 d.5 (I74): a maker asks her lead for more time.
    time_asked: {
      subject: (c) => `More time asked: ${c.work}`,
      line: (c) => `${c.actor} asks for ${c.work} to be due ${day(ds(c, 'to_day'), c.locale) || 'later'}.${ds(c, 'note') ? ` ${q(ds(c, 'note') ?? '')}.` : ''} Give the time, or say no with a reason.`,
      facts: false,
    },
    // ADR-0141 d.5 (I74): the lead's answer; to the maker.
    time_answered: {
      subject: (c) => `${c.detail.given === true ? 'More time given' : 'More time not given'}: ${c.work}`,
      line: (c) => c.detail.given === true
        ? `${c.actor} gave you until ${day(ds(c, 'to_day'), c.locale) || 'the day you asked'} for ${c.work}.`
        : `${c.actor} cannot give more time on ${c.work}.${ds(c, 'note') ? ` ${q(ds(c, 'note') ?? '')}.` : ''}`,
      facts: false,
    },
    // ADR-0117 addendum (Q20, 4 Oct): the deliverable's languages changed; to the translation task's assignee.
    translation_languages_changed: {
      subject: (c) => `Languages changed: ${c.work}`,
      line: (c) => `${c.actor} changed the languages of ${ds(c, 'deliverable') ?? 'the deliverable'}${ds(c, 'words') ? ` to ${ds(c, 'words')}` : ''}. Your translation task is now ${q(c.work)} — translate into every language it names.`,
      facts: false,
    },
    task_unblocked: {
      subject: (c) => `Unblocked: ${c.work}`,
      line: (c) => {
        const what = ds(c, 'description')
        return `${c.actor} cleared the block on ${on(c)}${what ? ` — ${q(what)}` : ''}. You can carry on with it.`
      },
      facts: false,
    },
  },
  ar: {
    campaign_approved: {
      subject: (c) => c.ownedCount > 0
        ? `تمت الموافقة: ${c.campaign ?? c.work} — لديك ${c.ownedCount} ${c.ownedCount === 1 ? 'مُخرج' : 'مُخرجات'}`
        : `تمت الموافقة: ${c.campaign ?? c.work}`,
      line: (c) => {
        const owned = c.ownedCount > 0
          ? ` لديك ${c.ownedCount} ${c.ownedCount === 1 ? 'مُخرج' : 'مُخرجات'} فيها${c.owned.length ? `:${ownedLines(c)}` : '.'}`
          : ''
        const empty = c.owned.filter((o) => o.noTasks).length
        const ask = empty > 0 && empty === c.owned.length
          ? ' لم تُنشأ أي مهام، فعليك تحديد المهام ثم الموافقة على قائمة المهام ليتسنّى إسناد كل مهمة.'
          : empty > 0
            ? ' عليك مراجعة قائمة مهام كل مُخرج ثم الموافقة عليها ليتسنّى إسناد كل مهمة — وتحديد المهام حيث لم تُنشأ أي مهام.'
            : ' عليك مراجعة قائمة مهام كل مُخرج ثم الموافقة عليها ليتسنّى إسناد كل مهمة.'
        return `وافق ${c.actor} على ${qa(c.campaign ?? c.work)}.${owned}${ask}`
      },
    },
    deliverable_reassigned: {
      subject: (c) => `أُسند إليك: ${c.full}`,
      line: (c) => c.detail.tasks_approved === true
        ? `جعلك ${c.actor} مالكًا لـ ${onAr(c)}. قائمة مهامه معتمدة، فيمكن إسناد عمله — ومتابعته حتى النهاية عليك.`
        : c.detail.no_tasks === true
          ? `جعلك ${c.actor} مالكًا لـ ${onAr(c)}. لم تُنشأ له أي مهام، فعليك تحديد المهام ثم الموافقة على قائمة المهام ليتسنّى إسناد كل مهمة.`
          : `جعلك ${c.actor} مالكًا لـ ${onAr(c)}. راجع قائمة مهامه ووافق عليها ليتسنّى إسناد كل مهمة.`,
    },
    deliverable_owner_removed: {
      subject: (c) => `لم يعد لك: ${c.full}`,
      line: (c) => `أصبح ${onAr(c)} مملوكًا لـ ${c.newOwner ?? 'شخص آخر'}.`,
      facts: false,
    },
    assigned: {
      subject: (c) => `مهمة جديدة: ${c.work}`,
      line: (c) => {
        const due = c.dueAt ? ` موعدها ${day(c.dueAt, c.locale)}` : ''
        const est = hrsAr(c) ? `${due ? ' وتقديرها' : ' تقديرها'} ${hrsAr(c)}.` : due ? '.' : ''
        return `أسند إليك ${c.actor} ${onAr(c)}.${due}${est} ابدأها من «عملي» وأرسلها للمراجعة عند الانتهاء.`
      },
      facts: false,
    },
    task_reassigned_away: {
      subject: (c) => `لم تعد لك: ${c.work}`,
      line: (c) => `أُعيد إسناد ${onAr(c)} إلى ${c.assignee ?? 'شخص آخر'}.`,
      facts: false,
    },
    review_requested: {
      subject: (c) => `مطلوب مراجعتك: ${c.work}`,
      line: (c) => `أرسل ${c.actor} ${onAr(c)} لمراجعتك. افتحها وراجع العمل، ثم وافق عليها أو أعدها مع تعديلاتك.`,
    },
    feedback_requested: {
      subject: (c) => `مطلوب رأيك: ${c.work}`,
      line: (c) => `أرسل ${c.actor} ${onAr(c)}. افتحها واترك ملاحظاتك، أو علّمها «لا تعليق» — الموافقة بانتظار ردّك.`,
    },
    assignment_overdue: {
      subject: (c) => (c.forOwner ? `صُعّد إلى الحركة: ${c.full}` : `لم يُسند بعد: ${c.full}`),
      line: (c) => {
        const who = c.newOwner ?? 'القائد'
        const waited = c.hours != null ? `${c.hours} ساعة عمل` : 'أكثر من الوقت المتفق عليه'
        return c.forOwner
          ? `انتظر ${onAr(c)} ${waited} دون إسناد، فصُعّد إلى مدير الحركة. أسنده الآن، أو أخبر الحركة بسبب الانتظار.`
          : `انتظر ${onAr(c)} ${waited} ولم يسنده ${who}. صُعّد إليك — أسنده، أو اسأل ${who} عما يعطّله.`
      },
      facts: false,
    },
    changes_requested: {
      subject: (c) => `طُلبت تعديلات: ${c.work}`,
      line: (c) => `أعاد ${c.actor} ${onAr(c)} مع ملاحظات. افتحها ونفّذ التعديلات وأعد إرسالها للمراجعة.`,
    },
    signed_off: {
      subject: (c) => `تمت الموافقة: ${c.work}`,
      line: (c) => `وافق ${c.actor} على ${onAr(c)}. لا يُطلب منك شيء آخر بشأنها.`,
      facts: false,
    },
    dependency_ready: {
      subject: (c) => `يمكنك البدء: ${c.work}`,
      line: (c) => {
        const what = c.approvedTask ? `تمت الموافقة على ${qa(c.approvedTask)} التي كانت ${onAr(c)} بانتظارها.` : `تمت الموافقة على كل ما كانت ${onAr(c)} بانتظاره.`
        return c.unassigned
          ? `${what} وهي غير مُسندة إلى أحد — أسندها من الجدول.`
          : `${what} كل ما تحتاجه متوفر الآن — ابدأها من «عملي».`
      },
    },
    cancelled: {
      subject: (c) => `أُلغيت: ${c.work}`,
      line: (c) => `ألغى ${c.actor} ${onAr(c)}${c.jobArchived && c.campaign ? ` لأن ${qa(c.campaign)} أُرشفت` : ''}. توقّف عن العمل عليها — أُزيلت من تقويمك ولا يُطلب منك شيء آخر.`,
      facts: false,
    },
    rescheduled: {
      subject: (c) => `نُقلت: ${c.work}`,
      line: (c) => {
        const to = span(c.toAt ?? c.spanStart, c.spanEnd, c.locale)
        const dueChanged = c.fromAt && c.dueAt && iraqDay(c.fromAt) !== iraqDay(c.dueAt)
        const due = c.dueAt ? (dueChanged ? ` وأصبح موعدها ${day(c.dueAt, c.locale)}.` : `. موعدها لم يتغيّر: ${day(c.dueAt, c.locale)}.`) : '.'
        return `نقل ${c.actor} ${onAr(c)}${to ? ` إلى ${to}` : ' إلى أيام أخرى'}${due}`
      },
      facts: false,
    },
    extension_requested: {
      subject: (c) => `تمديد بانتظار ردّك: ${c.work}`,
      line: (c) => `طلب ${c.actor} نقل موعد ${onAr(c)}${c.fromAt ? ` من ${day(c.fromAt, c.locale)}` : ''}${c.toAt ? ` إلى ${day(c.toAt, c.locale)}` : ''}.${c.reason ? ` السبب: ${qa(c.reason)}.` : ''} افتحها ووافق أو ارفض.`,
      facts: false,
    },
    extension_approved: {
      subject: (c) => `تمت الموافقة على التمديد: ${c.work}`,
      line: (c) => `وافق ${c.actor} على التمديد. أصبح موعد ${onAr(c)} ${day(c.toAt ?? c.dueAt, c.locale) || 'الموعد الجديد'}.`,
      facts: false,
    },
    extension_refused: {
      subject: (c) => `رُفض التمديد: ${c.work}`,
      line: (c) => `رفض ${c.actor} التمديد. ما زال موعد ${onAr(c)} ${day(c.dueAt ?? c.fromAt, c.locale) || 'كما هو'}.${c.reason ? ` السبب: ${qa(c.reason)}.` : ''}`,
      facts: false,
    },
    assignment_requested: {
      subject: (c) => `طلب حجز: ${c.work}`,
      line: (c) => `يطلب ${c.actor} حجز ${c.person ?? 'أحد أفراد قسمك'} على ${qa(c.work)}${c.campaign ? ` (${c.campaign})` : ''}${span(c.spanStart, c.spanEnd, c.locale) ? `، ${span(c.spanStart, c.spanEnd, c.locale)}` : ''}${hrsAr(c) ? `، ${hrsAr(c)}` : ''}. لن يُحجز شيء قبل موافقتك — افتح الجدول للموافقة أو الرفض.`,
      facts: false,
    },
    assignment_approved: {
      subject: (c) => `تمت الموافقة على الحجز: ${c.work}`,
      line: (c) => `وافق ${c.actor} على طلبك. حُجز ${c.person ?? 'الشخص'} على ${qa(c.work)}${span(c.spanStart, c.spanEnd, c.locale) ? `، ${span(c.spanStart, c.spanEnd, c.locale)}` : ''}.`,
      facts: false,
    },
    assignment_refused: {
      subject: (c) => `رُفض الحجز: ${c.work}`,
      line: (c) => `رفض ${c.actor} طلبك حجز ${c.person ?? 'ذلك الشخص'} على ${qa(c.work)}.${c.reason ? ` السبب: ${qa(c.reason)}.` : ''} المهمة لم تتغيّر — اطلب شخصًا آخر.`,
      facts: false,
    },
    assignment_superseded: {
      subject: (c) => `أُغلق طلب الحجز: ${c.work}`,
      line: (c) => `أسند ${c.actor} ${qa(c.work)} إلى ${c.assignee ?? 'شخص آخر'}، لذا أُغلق طلبك.`,
      facts: false,
    },
    feedback_collected: {
      subject: (c) => `جاهزة لموافقتك: ${c.work}`,
      line: (c) => `أجاب كل المراجعين على ${qa(c.work)}${c.campaign ? ` (${c.campaign})` : ''} — ${c.withFeedback} بملاحظات، و${c.noComment} بلا تعليق. افتحها واقرأ الملاحظات، ثم وافق عليها أو أعدها.`,
    },
    chat_added: {
      subject: (c) => `أُضفت إلى مجموعة نقاش: ${c.full}`,
      line: (c) => `أضافك ${c.actor} إلى مجموعة النقاش الخاصة بـ ${qa(c.work)}${c.campaign ? ` (${c.campaign})` : ''}. افتحها لقراءة المحادثة والرد.`,
      facts: false,
    },
    resource_required: {
      subject: (c) => `حُجزت على: ${c.work}`,
      line: (c) => `حجزك ${c.actor} على ${qa(c.work)}${c.campaign ? ` (${c.campaign})` : ''}${span(c.spanStart, c.spanEnd, c.locale) ? `، ${span(c.spanStart, c.spanEnd, c.locale)}` : ''}${hrsAr(c) ? `، ${hrsAr(c)}` : ''}. ${c.assignee ? `${c.assignee} ينفّذ المهمة، وأنت` : 'أنت'} مطلوب عليها في ذلك الوقت — وهي في تقويمك.`,
      facts: false,
    },
    resource_clash: {
      subject: (c) => `تعارض حجز: ${c.work}`,
      line: (c) => `${qa(c.work)} مطلوب لـ ${c.approvedTask ? qa(c.approvedTask) : 'مهمة'}${c.campaign ? ` (${c.campaign})` : ''}${span(c.spanStart, c.spanEnd, c.locale) ? ` في ${span(c.spanStart, c.spanEnd, c.locale)}` : ''} لكنه محجوز حينها. افتح الجدول لنقل المهمة أو اختيار مورد آخر.`,
      facts: false,
    },
    deliverable_added: {
      subject: (c) => `أُضيف إلى ${c.campaign ?? 'عملك'}: ${c.work}`,
      line: (c) => c.forOwner
        ? `أضاف ${c.actor} ${qa(c.work)} إلى ${qa(c.campaign ?? 'عملك')} — طلب جديد ينتمي إلى هذا العمل. ${c.detail.no_tasks === true
            ? 'لم تُنشأ له أي مهام، فعليك تحديد المهام ثم الموافقة على قائمة المهام ليتسنّى إسناد كل مهمة.'
            : 'راجع قائمة مهامه ووافق عليها ليتسنّى إسناد كل مهمة.'}`
        : `أُضيف ${qa(c.work)} إلى ${qa(c.campaign ?? 'عملك')}؛ يملكه ${c.newOwner ?? 'مالكه'}.`,
    },
    task_reinstated: {
      subject: (c) => `تحتاج إلى إسناد: ${c.full}`,
      line: (c) => `أعاد ${c.actor} تفعيل ${onAr(c)}. وهي غير مُسنَدة إلى أحد — أسندها من الجدول لتعود إلى تقويم أحدهم.`,
    },
    task_reopened: {
      subject: (c) => `أُعيد فتحها: ${c.full}`,
      line: (c) => `أعاد ${c.actor} فتح ${onAr(c)}${c.reason ? ` — ${qa(c.reason)}` : ''}. ${c.detail.for_reviewer === true
        ? 'ستعود إليك للمراجعة حين تُنجز من جديد.'
        : 'عادت إلى قائمتك لتُنجزها من جديد'}${c.dueAt ? `${c.detail.for_reviewer === true ? ' موعدها الآن' : '، موعدها'} ${day(c.dueAt, c.locale)}.` : '.'}`,
    },
    deliverable_reopened: {
      subject: (c) => `أُعيد فتحه: ${c.full}`,
      line: (c) => {
        const tasks = Array.isArray(c.detail.tasks) ? (c.detail.tasks as unknown[]).filter((t): t is string => typeof t === 'string') : []
        return `أعاد ${c.actor} فتح ${onAr(c)}${c.reason ? ` — ${qa(c.reason)}` : ''}. ${tasks.length ? `المطلوب من جديد: ${tasks.join('، ')}.` : ''}${c.detail.campaign_reopened === true ? ' كانت الحملة مُغلقة وقد فُتحت من جديد.' : ''}`
      },
    },
    // ---- I59 ----
    task_blocked: {
      subject: (c) => `متوقّفة: ${c.work}`,
      line: (c) => {
        const what = ds(c, 'what'), who = ds(c, 'who'), need = ds(c, 'need')
        return `توقّف ${c.actor} عن ${onAr(c)}${what ? ` — بانتظار ${who ?? 'أحدهم'} من أجل ${qa(what)}` : ''}.${need ? ` ما يحتاجه: ${qa(need)}.` : ''} ساعده في الحصول عليه، أو ارفع التوقّف حين يُحلّ.`
      },
      facts: false,
    },
    untimed_round: {
      subject: (c) => `أُرسلت دون توقيت: ${c.work}`,
      line: (c) => {
        const h = dn(c, 'hours') ?? c.hours
        return `أرسل ${c.actor} ${onAr(c)} للمراجعة دون توقيتها، فسُجّل وقتها المخصّص كاملًا${h ? ` (${h} ساعة)` : ''}. قد تُطبَّق عقوبة على مؤشّر الأداء.`
      },
      facts: false,
    },
    extension_forwarded: {
      subject: (c) => `تمديد بانتظار ردّك: ${c.work}`,
      line: (c) => {
        const note = ds(c, 'note')
        return `أحال ${c.actor} طلب نقل موعد ${onAr(c)}${from(c)}${to(c)}.${c.reason ? ` السبب: ${qa(c.reason)}.` : ''}${note ? ` ملاحظة ${c.actor}: ${qa(note)}.` : ''} افتحها ووافق، أو وافق على تمديد أقصر، أو ارفض.`
      },
      facts: false,
    },
    change_request_sent: {
      subject: (c) => `طلب تعديل: ${c.work}`,
      line: (c) => `يطلب ${c.actor} تعديل ${onAr(c)}، وقد بدأ العمل عليه: ${changesText(c)}. ${ds(c, 'asked_by') === 'client'
        ? 'طلبه العميل، فتُحتسب له جولة مراجعة.'
        : 'الخطأ من جهتنا، فلا تُحتسب له جولة.'} اقبله، أو ارفضه مع ذكر السبب، أو اعترض عليه.`,
    },
    change_request_answered: {
      subject: (c) => {
        const a = ds(c, 'answer')
        return `${a === 'accept' ? 'قُبل التعديل' : a === 'decline' ? 'رُفض التعديل' : 'اعتراض على التعديل'}: ${c.work}`
      },
      line: (c) => {
        const a = ds(c, 'answer')
        const reason = ds(c, 'reason')
        if (a === 'accept') return `قبل ${c.actor} تعديلك على ${onAr(c)} (${changesText(c)})، وقد طُبّق.`
        if (a === 'decline') return `رفض ${c.actor} تعديلك على ${onAr(c)}.${reason ? ` السبب: ${qa(reason)}.` : ''} أرسل طلبًا جديدًا، أو أغلقه.`
        const d = ds(c, 'counter_date')
        return `اعترض ${c.actor} على تعديلك على ${onAr(c)}: ${qa(ds(c, 'counter_text') ?? '')}${d ? ` — بحلول ${day(d, c.locale)}` : ''}. اقبل صيغته، أو اسحب الطلب.`
      },
      facts: false,
    },
    change_request_resolved: {
      subject: (c) => `${ds(c, 'resolution') === 'accept_counter' ? 'قُبلت صيغتك' : 'سُحب طلب التعديل'}: ${c.work}`,
      line: (c) => {
        const d = ds(c, 'counter_date')
        return ds(c, 'resolution') === 'accept_counter'
          ? `قبل ${c.actor} صيغتك للتعديل على ${onAr(c)}، وقد طُبّق${d ? `، وموعده ${day(d, c.locale)}` : ''}.`
          : `سحب ${c.actor} طلب التعديل على ${onAr(c)}. لا شيء يتغيّر.`
      },
      facts: false,
    },
    question_asked: {
      subject: (c) => `سؤال: ${c.work}`,
      line: (c) => `يسأل ${c.actor} عن ${onAr(c)}: ${qa(ds(c, 'body') ?? '')}. افتحه وردّ عليه.`,
      facts: false,
    },
    question_replied: {
      subject: (c) => `ردّ: ${c.work}`,
      line: (c) => `ردّ ${c.actor} على سؤالك عن ${onAr(c)}: ${qa(ds(c, 'body') ?? '')}.`,
      facts: false,
    },
    nudged: {
      subject: (c) => `تذكير: ${c.work}`,
      line: (c) => {
        const body = ds(c, 'body')
        return `يذكّرك ${c.actor} بـ ${onAr(c)}${body ? `: ${qa(body)}` : ''}. هناك من ينتظره.`
      },
    },
    too_much: {
      subject: (c) => `عبء زائد: ${c.work}`,
      line: (c) => {
        const note = ds(c, 'note')
        return `يقول ${c.actor} إن ${onAr(c)} أكثر ممّا يتّسع له أسبوعه${weekText(c)}.${note ? ` ملاحظته: ${qa(note)}.` : ''} أعد التوزيع من الجدول، أو أبقِها معه.`
      },
    },
    too_much_answered: {
      subject: (c) => `${ds(c, 'answer') === 'rebalance' ? 'إعادة توزيع' : 'باقية معك'}: ${c.work}`,
      line: (c) => ds(c, 'answer') === 'rebalance'
        ? `سيعيد ${c.actor} توزيع أسبوعك — قد تُنقل ${onAr(c)}. واصل العمل عليها حتى ذلك الحين.`
        : `أبقى ${c.actor} ${onAr(c)} معك. واصل العمل عليها.`,
    },
    escalated: {
      subject: (c) => `صُعّد إليك: ${c.full}`,
      line: (c) => {
        const w = waited(c)
        switch (ds(c, 'kind')) {
          case 'unassigned': return `انتظر ${onAr(c)} ${w} دون إسناد. صُعّد إليك — أسنده، أو اعرف ما الذي يؤخّره.`
          case 'task_list': return c.detail.all_cancelled === true
            ? `أُلغيت كل مهام ${onAr(c)} منذ ${w}، ولم يُضف أحد مهمة ولم يُغلقه. صُعّد إليك — اعرف من مالكه إن كان لا يزال مطلوبًا.`
            : c.detail.no_tasks === true
            ? `لم تُحدَّد مهام ${onAr(c)} منذ ${w}. صُعّد إليك — اعرف من مالكه ما الذي يؤخّره، أو حدّد المهام.`
            : `انتظرت قائمة مهام ${onAr(c)} ${w} دون موافقة. صُعّدت إليك — وافق عليها، أو اعرف ما الذي يؤخّرها.`
          case 'campaign_brief': return `انتظر موجز ${onAr(c)} ${w} موافقة مدير الحساب. صُعّد إليك — تابعه معه.`
          case 'change_request': return `انتظر طلب تعديل على ${onAr(c)} ${w} دون ردّ من مالكه. صُعّد إليك — تابعه معه.`
          case 'extension_owner': return `انتظر طلب تمديد على ${onAr(c)} ${w} دون أن يحيله مالكه أو يرفضه. صُعّد إليك — تابعه معه.`
          case 'extension_am': return `انتظر طلب تمديد على ${onAr(c)} ${w} دون ردّ مدير الحساب. صُعّد إليك — أجب عنه، أو تابعه.`
          case 'blocked': return `${onAr(c)} متوقّفة منذ ${w}. صُعّدت إليك — ساعد في رفع التوقّف.`
          case 'review': return `انتظرت ${onAr(c)} ${w} للمراجعة. صُعّدت إليك — تابع المراجعين.`
          case 'handover': return `بدأ ${c.work} المغادرة منذ ${w} ولم تُسلَّم بعد ${handoverItemsAr(c.detail.items)}. صُعّد إليك — سلّمها، أو اعرف ما الذي يؤخّرها.`
          case 'task_request': return `انتظر طلب حجز ${onAr(c)}${ds(c, 'team') ? ` لدى ${ds(c, 'team')}` : ''} ${w} دون رد. صُعّد إليك — أجب عنه من الجدول؛ أول رد يحسمه.`
          case 'deliverable_change': return `انتظر طلب تعديل على ${onAr(c)} ${w} دون رد مدير الحساب. صُعّد إليك — أجب عنه، أو تابعه معه.`
          default: return `انتظر ${onAr(c)} ${w}. صُعّد إليك.`
        }
      },
      facts: false,
    },
    review_reminder: {
      subject: (c) => `تذكير — مطلوب مراجعتك: ${c.work}`,
      line: (c) => `انتظرت ${onAr(c)} ${waited(c)} لمراجعتك. افتحها وراجع العمل، ثم وافق عليها أو أعدها مع تعديلاتك.`,
    },
    over_capacity: {
      subject: (c) => `فوق الطاقة: ${c.work}`,
      line: (c) => {
        const pct = dn(c, 'pct') ?? dn(c, 'util_pct')
        return `${qa(c.work)} محجوز${pct != null ? ` بنسبة ${pct}%` : ' فوق طاقته'} هذا الأسبوع. أعد توزيع أسبوعه من الجدول.`
      },
      facts: false,
    },
    client_activation_requested: {
      subject: (c) => `تفعيل عميل: ${c.work}`,
      line: (c) => `سجّل ${c.actor} العميل ${qa(c.work)} كمسودة ويطلب منك تفعيله. راجعه وفعّله، أو أخبره بما ينقصه.`,
      facts: false,
    },
    deliverable_type_changed: {
      subject: (c) => `تغيّر النوع: ${c.work}`,
      line: (c) => `غيّر ${c.actor} نوع ${qa(c.work)}. أُلغيت ${Number(c.detail.cancelled ?? 0)} من المهام المفتوحة للنوع القديم وأُضيفت ${Number(c.detail.added ?? 0)} من النوع الجديد. راجع قائمة مهامه ووافق عليها ليتسنّى إسناد كل مهمة.`,
    },
    deliverable_edited: {
      subject: (c) => `تغيّر: ${c.work}`,
      line: (c) => {
        const q = c.detail.quantity as { from?: number; to?: number } | undefined
        const parts = [
          q ? `الكمية ${q.from} ← ${q.to}` : null,
          c.detail.due ? 'تاريخ التسليم' : null,
        ].filter(Boolean).join(' و')
        const added = Number(c.detail.added ?? 0)
        const cancelled = Number(c.detail.cancelled ?? 0)
        return `غيّر ${c.actor} ${parts || 'التفاصيل'} في ${qa(c.work)}.${cancelled ? ` أُلغيت ${cancelled} من المهام المفتوحة.` : ''}${added ? ` أُضيفت ${added} من المهام — راجع قائمة المهام ووافق عليها ليتسنّى إسناد كل مهمة.` : ''}`
      },
    },
    handover_list: {
      subject: (c) => `سلّم أعمال ${c.work}`,
      line: (c) => `أوقف ${c.actor} حساب ${c.work}، ولم يعد بإمكانه تسجيل الدخول. ${handoverItemsAr(c.detail.items)} بانتظار من يتولاها — سلّم كل عنصر لشخص محدد. يكتمل الإيقاف تلقائيًا عندما تفرغ القائمة.`,
      facts: false,
    },
    deactivation_complete: {
      subject: (c) => `أُوقف: ${c.work}`,
      line: (c) => `اكتمل إيقاف ${c.work} — سُلّم ${Number(c.detail.handed_over ?? 0)} من العناصر. لم يعد على الجدول.`,
      facts: false,
    },
    link_expiring: {
      subject: (c) => `رابط تنتهي صلاحيته قريبًا: ${c.work}`,
      line: (c) => `الرابط ${qa(c.work)} الذي أضفته${c.campaign ? ` إلى ملفات ${qa(c.campaign)}` : ''} تنتهي صلاحيته في ${day(ds(c, 'expires_on'), c.locale) || 'تاريخ انتهائه'}. إن كان لا يزال مطلوبًا، أضف العنوان الجديد كنسخته التالية قبل ذلك — بعد ذلك اليوم سيظهر «انتهت صلاحية الرابط».`,
      facts: false,
    },
    file_brought_back: {
      subject: (c) => `عاد متاحًا: ${c.work}`,
      line: (c) => `${qa(c.work)}${c.campaign ? ` (${qa(c.campaign)})` : ''} أُعيد من أرشيف المكتب كما طلبت. يبقى متاحًا 30 يومًا، ثم يعود إلى الأرشيف.`,
      facts: false,
    },
    assignment_offered: {
      subject: (c) => `عُرضت أيام أخرى: ${c.work}`,
      line: (c) => `لا يستطيع ${c.actor} حجز ${qa(c.work)} كما طلبت، ويعرض ${ds(c, 'person') ?? 'شخصًا'} ${span(ds(c, 'starts_at'), ds(c, 'ends_at'), c.locale) || 'في أيام أخرى'} بدلًا من ذلك.${ds(c, 'note') ? ` ${qa(ds(c, 'note') ?? '')}.` : ''} اقبل العرض من الجدول، أو اطلب من جديد.`,
      facts: false,
    },
    assignment_offer_taken: {
      subject: (c) => `قُبل العرض: ${c.work}`,
      line: (c) => `قبل ${c.actor} عرضك لـ ${qa(c.work)} — حُجزت في الأيام التي عرضتها.`,
      facts: false,
    },
    assignment_withdrawn: {
      subject: (c) => `سُحب الطلب: ${c.work}`,
      line: (c) => `سحب ${c.actor} طلب حجز ${qa(c.work)}. لا شيء مطلوب منك.`,
      facts: false,
    },
    task_unassigned: {
      subject: (c) => `أُزيل من المهمة: ${c.work}`,
      line: (c) => ds(c, 'as') === 'lead'
        ? `أزال ${c.actor} ${ds(c, 'person') ?? 'أحد أفراد فريقك'} عن ${qa(c.work)}. عادت لتُحجز.`
        : `أزالك ${c.actor} عن ${qa(c.work)}. لم تعد على أسبوعك.`,
      facts: false,
    },
    deliverable_change_asked: {
      subject: (c) => `طُلب تعديل: ${c.work}`,
      line: (c) => `يطلب منك ${c.actor} تعديل ${qa(c.work)}${ds(c, 'due_day') ? ` — موعده ${day(ds(c, 'due_day'), c.locale)}` : ''}${dn(c, 'hours') != null ? `، ${dn(c, 'hours')} ساعة` : ''}.${ds(c, 'reason') ? ` السبب: ${qa(ds(c, 'reason') ?? '')}.` : ''} اقبله أو عدّله أو أبقه كما هو.`,
      facts: false,
    },
    deliverable_change_answered: {
      subject: (c) => `${ds(c, 'answer') === 'keep' ? 'بقي كما هو' : 'عُدّل'}: ${c.work}`,
      line: (c) => ds(c, 'answer') === 'keep'
        ? `يُبقي ${c.actor} ${qa(c.work)} كما هو.${ds(c, 'note') ? ` ${qa(ds(c, 'note') ?? '')}.` : ''}`
        : `${ds(c, 'answer') === 'accept' ? 'قبل' : 'عدّل'} ${c.actor} ${qa(c.work)}${ds(c, 'due_day') ? ` — موعده الآن ${day(ds(c, 'due_day'), c.locale)}` : ''}.${ds(c, 'note') ? ` ${qa(ds(c, 'note') ?? '')}.` : ''}`,
      facts: false,
    },
    deliverable_change_withdrawn: {
      subject: (c) => `سُحب طلب التعديل: ${c.work}`,
      line: (c) => `سحب ${c.actor} طلب تعديل ${qa(c.work)}. لا شيء مطلوب منك.`,
      facts: false,
    },
    time_asked: {
      subject: (c) => `طُلب وقت إضافي: ${c.work}`,
      line: (c) => `يطلب ${c.actor} أن يكون موعد ${qa(c.work)} ${day(ds(c, 'to_day'), c.locale) || 'لاحقًا'}.${ds(c, 'note') ? ` ${qa(ds(c, 'note') ?? '')}.` : ''} امنح الوقت، أو ارفض مع ذكر السبب.`,
      facts: false,
    },
    time_answered: {
      subject: (c) => `${c.detail.given === true ? 'مُنح وقت إضافي' : 'لم يُمنح وقت إضافي'}: ${c.work}`,
      line: (c) => c.detail.given === true
        ? `منحك ${c.actor} حتى ${day(ds(c, 'to_day'), c.locale) || 'اليوم الذي طلبته'} لـ ${qa(c.work)}.`
        : `لا يستطيع ${c.actor} منح وقت إضافي على ${qa(c.work)}.${ds(c, 'note') ? ` ${qa(ds(c, 'note') ?? '')}.` : ''}`,
      facts: false,
    },
    translation_languages_changed: {
      subject: (c) => `تغيّرت اللغات: ${c.work}`,
      line: (c) => `غيّر ${c.actor} لغات ${qa(ds(c, 'deliverable') ?? 'التسليم')}${ds(c, 'words') ? ` إلى ${ds(c, 'words')}` : ''}. أصبحت مهمة الترجمة الخاصة بك ${qa(c.work)} — ترجم إلى كل لغة تذكرها.`,
      facts: false,
    },
    task_unblocked: {
      subject: (c) => `رُفع التوقّف: ${c.work}`,
      line: (c) => {
        const what = ds(c, 'description')
        return `رفع ${c.actor} التوقّف عن ${onAr(c)}${what ? ` — ${qa(what)}` : ''}. يمكنك مواصلة العمل عليها.`
      },
      facts: false,
    },
  },
}

/**
 * Gather the facts a sentence may need — one query each, best-effort, never blocking the send.
 */
async function gather(admin: any, locale: Locale, row: NotificationRow, actor: string): Promise<Ctx> {
  const d = (row.detail ?? {}) as Record<string, unknown>
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
  const c: Ctx = {
    locale,
    work: row.label ?? (locale === 'ar' ? 'عنصر' : 'an item'),
    campaign: row.context_label ?? null,
    full: notificationLabel(row.label, row.context_label) ?? (locale === 'ar' ? 'عنصر' : 'an item'),
    actor,
    detail: d,
    dueAt: str(d.due_at), hours: typeof d.hours === 'number' ? d.hours : null,
    assignee: str(d.new_assignee) ?? str(d.assignee), newOwner: str(d.new_owner) ?? str(d.owner), person: null,
    spanStart: str(d.starts_at), spanEnd: str(d.ends_at),
    fromAt: str(d.from_start), toAt: null, reason: null,
    withFeedback: 0, noComment: 0,
    approvedTask: str(d.approved_task),
    forOwner: d.for_owner === true,
    ownedCount: typeof d.deliverable_count === 'number' ? d.deliverable_count : Array.isArray(d.deliverables) ? d.deliverables.length : 0,
    owned: ownedList(d.deliverables),
    jobArchived: false,
    unassigned: d.unassigned === true,
  }
  if (row.type === 'rescheduled') { c.spanStart = str(d.to_start); c.spanEnd = str(d.to_end); c.fromAt = str(d.from_start) }
  // ADR-0103: a re-open carries its reason and new date in detail — the date the task had before
  // is not the one the reader needs.
  if (row.type === 'task_reopened' || row.type === 'deliverable_reopened') { c.reason = str(d.reason); c.dueAt = str(d.due_at) }
  try {
    if (row.entity_type === 'sub_task' && row.entity_id) {
      const { data } = await admin
        .from('sub_tasks')
        .select('title, due_at, sla_hours, starts_at, assignee_id, deliverable_id, deliverables(state, campaign_id:streams(campaign_id))')
        .eq('id', row.entity_id).maybeSingle()
      const t = data as { title?: string; due_at?: string | null; sla_hours?: number | null; starts_at?: string | null; assignee_id?: string | null; deliverables?: { state?: string } | null } | null
      if (t) {
        c.dueAt = c.dueAt ?? t.due_at ?? null
        c.hours = t.sla_hours ?? null
        c.jobArchived = t.deliverables?.state === 'archived'
        if (row.type === 'resource_clash') { c.approvedTask = t.title ?? null; c.spanStart = c.spanStart ?? t.starts_at ?? null; c.spanEnd = c.spanEnd ?? t.due_at ?? null }
        if ((row.type === 'assignment_superseded' || row.type === 'task_reassigned_away') && t.assignee_id && !c.assignee) {
          const { data: up } = await admin.from('user_profiles').select('display_name').eq('id', t.assignee_id).maybeSingle()
          c.assignee = (up as { display_name?: string } | null)?.display_name ?? null
        }
      }
    } else if (row.entity_type === 'deliverable' && row.entity_id) {
      const { data } = await admin.from('deliverables').select('due_at, owner_user_id').eq('id', row.entity_id).maybeSingle()
      const dl = data as { due_at?: string | null; owner_user_id?: string | null } | null
      c.dueAt = c.dueAt ?? dl?.due_at ?? null
      if (row.type === 'deliverable_owner_removed' && !c.newOwner && dl?.owner_user_id) {
        const { data: up } = await admin.from('user_profiles').select('display_name').eq('id', dl.owner_user_id).maybeSingle()
        c.newOwner = (up as { display_name?: string } | null)?.display_name ?? null
      }
    }

    // Action 9: the extension's dates and reason live on the request event (ADR-0088); the answer
    // names the request it decided.
    if (row.type.startsWith('extension_') && row.entity_id) {
      const { data } = await admin
        .from('sla_events').select('event_type, payload')
        .eq('sub_task_id', row.entity_id)
        .in('event_type', ['extension_requested', 'extension_approved', 'extension_refused'])
        .order('created_at', { ascending: false }).limit(4)
      const evs = (data ?? []) as { event_type: string; payload?: Record<string, unknown> }[]
      const req = evs.find((e) => e.event_type === 'extension_requested')?.payload ?? {}
      const dec = evs.find((e) => e.event_type !== 'extension_requested')?.payload ?? {}
      c.fromAt = str(req.from); c.toAt = str(req.to); c.reason = str(row.type === 'extension_refused' ? dec.reason ?? req.reason : req.reason)
      // ADR-0109 d.3: the row names the date GIVEN (a shorter approval), which the request does not;
      // an owner's decline carries its own reason.
      if (row.type === 'extension_approved' && str(d.to)) c.toAt = str(d.to)
      if (row.type === 'extension_refused' && str(d.reason)) c.reason = str(d.reason)
    }

    // Action 10: the request row carries the person, the days and the hours; a refusal its reason.
    if (row.type.startsWith('assignment_') && row.entity_id) {
      const { data } = await admin
        .from('sub_task_assignment_requests')
        .select('starts_at, due_at, hours, reason, assignee:user_profiles!sub_task_assignment_requests_assignee_id_fkey(display_name)')
        .eq('sub_task_id', row.entity_id)
        .order('requested_at', { ascending: false }).limit(1).maybeSingle()
      const r = data as { starts_at?: string | null; due_at?: string | null; hours?: number | null; reason?: string | null; assignee?: { display_name?: string } | null } | null
      if (r) {
        c.spanStart = r.starts_at ?? null; c.spanEnd = r.due_at ?? null
        c.hours = r.hours ?? c.hours; c.reason = r.reason ?? null
        c.person = r.assignee?.display_name ?? null
      }
    }

    // Action 11: how the optional reviewers answered.
    if (row.type === 'feedback_collected' && row.entity_id) {
      const { data } = await admin.from('sub_task_reviewers').select('is_mandatory, response').eq('sub_task_id', row.entity_id)
      for (const r of (data ?? []) as { is_mandatory: boolean; response?: string | null }[]) {
        if (r.is_mandatory) continue
        if (r.response === 'no_comment') c.noComment += 1
        else if (r.response) c.withFeedback += 1
      }
    }
  } catch (e) {
    console.warn('notify-email: gather', e)   // a missing fact is never worth a missing email
  }
  return c
}

const CTA = { en: 'Open in Maestro', ar: 'افتح في مايسترو' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function deepLink(admin: any, base: string, row: NotificationRow, ctx: Ctx): Promise<string> {
  const b = base.replace(/\/+$/, '')

  // I30.7 — the ONE place the button is chosen by TYPE rather than by entity. A clash is recorded
  // against the task, so the entity rule sent the reader to My Work: their own task list, which
  // says nothing about the camera that could not be booked and offers nothing to fix it with. A
  // clash is fixed on the Schedule. `label` is the resource's name and `who` is the grid's name
  // search, so the row is already narrowed; `on` opens the week the task actually falls in, since
  // the clash is rarely in the week you happen to be looking at.
  if (row.type === 'resource_clash') {
    const q = new URLSearchParams()
    if (row.label) q.set('who', row.label)
    if (row.entity_type === 'sub_task' && row.entity_id) {
      const { data } = await admin.from('sub_tasks').select('starts_at').eq('id', row.entity_id).maybeSingle()
      const startsAt = (data as { starts_at?: string | null } | null)?.starts_at
      if (startsAt) q.set('on', startsAt.slice(0, 10))
    }
    const qs = q.toString()
    return qs ? `${b}/schedule?${qs}` : `${b}/schedule`
  }

  // ADR-0087: a booking request is answered on the schedule, and its outcome is read there too —
  // the requester's My Work says nothing about somebody else's task. `on` opens the week the
  // request asks for, because the answer is taken with that week in view (d.10).
  // `assignment_overdue` is not a booking request — "nobody assigned yet" — so it takes the assign door below.
  if (row.type.startsWith('assignment_') && row.type !== 'assignment_overdue') {
    const q = new URLSearchParams()
    if (row.entity_type === 'sub_task' && row.entity_id) {
      const { data } = await admin
        .from('sub_task_assignment_requests')
        .select('starts_at, resources(name)')
        .eq('sub_task_id', row.entity_id)
        .order('requested_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const req = data as { starts_at?: string | null; resources?: { name?: string } | null } | null
      if (req?.starts_at) q.set('on', req.starts_at.slice(0, 10))
      if (req?.resources?.name) q.set('who', req.resources.name)
    }
    const qs = q.toString()
    return qs ? `${b}/schedule?${qs}` : `${b}/schedule`
  }

  //  * Action 13 — a required person's booking lives on the Schedule, in the week booked, with
  //    the person (the recipient) searched. `who` is the grid's name search.
  if (row.type === 'resource_required') {
    const q = new URLSearchParams()
    if (ctx.spanStart) q.set('on', iraqDay(ctx.spanStart))
    const { data } = await admin.from('user_profiles').select('display_name').eq('id', row.user_id).maybeSingle()
    const me = (data as { display_name?: string } | null)?.display_name
    if (me) q.set('who', me)
    const qs = q.toString()
    return qs ? `${b}/schedule?${qs}` : `${b}/schedule`
  }
  //  * Action 8 — a moved booking: the Schedule on the week it moved TO.
  if (row.type === 'rescheduled') {
    return ctx.spanStart ? `${b}/schedule?on=${iraqDay(ctx.spanStart)}` : `${b}/schedule`
  }
  // I52.7 (Edward, 17 Sep, option A): a reinstated task is ASSIGNED on the Schedule — the `+` on a
  // person's day, then campaign → deliverable → the unassigned task — and nowhere else. The
  // deliverables page can edit a task's title and dates but not who does it, so a button that
  // landed there contradicted the sentence above it. `on` opens the week the task is due in.
  if (row.type === 'task_reinstated' && row.entity_type === 'sub_task' && row.entity_id) {
    const { data } = await admin.from('sub_tasks').select('due_at').eq('id', row.entity_id).maybeSingle()
    const dueAt = (data as { due_at?: string | null } | null)?.due_at
    return dueAt ? `${b}/schedule?on=${dueAt.slice(0, 10)}` : `${b}/schedule`
  }

  // I59.45 (Edward, 26 Sep: "all emails sent must provide accurate links to the action required"):
  // every other door comes from ONE table shared with the in-app bell — `src/lib/notifications/door.ts`.
  // Here we add what only the server knows cheaply: the campaign (so a deliverable's door is its campaign
  // page, where its task list is approved) and the department (the Schedule's assign door).
  const facts: { campaignId?: string | null; departmentId?: string | null } = {}
  try {
    let deliverableId: string | null = row.entity_type === 'deliverable' ? row.entity_id : null
    if (!deliverableId && row.entity_type === 'sub_task' && row.entity_id && row.type === 'dependency_ready') {
      const { data } = await admin.from('sub_tasks').select('deliverable_id').eq('id', row.entity_id).maybeSingle()
      deliverableId = (data as { deliverable_id?: string | null } | null)?.deliverable_id ?? null
    }
    if (deliverableId) {
      const { data } = await admin.from('deliverables').select('department_id, streams(campaign_id)').eq('id', deliverableId).maybeSingle()
      const dl = data as { department_id?: string | null; streams?: { campaign_id?: string | null } | { campaign_id?: string | null }[] | null } | null
      const s = Array.isArray(dl?.streams) ? dl?.streams[0] : dl?.streams
      facts.campaignId = s?.campaign_id ?? null
      facts.departmentId = dl?.department_id ?? null
    }
  } catch (e) {
    console.warn('notify-email: door facts', e)   // the lookup door still works without them
  }
  const door = notificationDoor(
    { id: row.id, type: row.type, entityType: row.entity_type, entityId: row.entity_id, detail: row.detail },
    facts,
  )
  return `${b}${door ?? '/schedule'}`
}

/**
 * The second line: FACTS, not directions (Edward, 8 Sep).
 *
 * The first draft of this line said "it's on your My Work page" — navigation the button underneath
 * it already performs. What earns a second line is enough to decide whether to act now without
 * opening anything: when it is due, and how long it is expected to take.
 *
 * One query, and it never blocks the send. Every branch here is best-effort: this whole function is
 * the SECOND channel (ADR-0028) and the inbox is the truth, so an email with no facts line is a
 * lesser email, never a failed one.
 */
async function factsLine(admin: any, locale: Locale, row: NotificationRow): Promise<string | null> {
  try {
    let dueAt: string | null = null
    let hours: number | null = null
    let phaseId: string | null = null

    if (row.entity_type === 'sub_task' && row.entity_id) {
      const { data } = await admin.from('sub_tasks').select('due_at, sla_hours, deliverables(phase_id)').eq('id', row.entity_id).maybeSingle()
      dueAt = (data as { due_at?: string | null } | null)?.due_at ?? null
      hours = (data as { sla_hours?: number | null } | null)?.sla_hours ?? null
      const dl = (data as { deliverables?: { phase_id?: string | null } | { phase_id?: string | null }[] | null } | null)?.deliverables
      phaseId = (Array.isArray(dl) ? dl[0] : dl)?.phase_id ?? null
    } else if (row.entity_type === 'deliverable' && row.entity_id) {
      const { data } = await admin.from('deliverables').select('due_at, phase_id').eq('id', row.entity_id).maybeSingle()
      dueAt = (data as { due_at?: string | null } | null)?.due_at ?? null
      phaseId = (data as { phase_id?: string | null } | null)?.phase_id ?? null
    } else if (row.entity_type === 'campaign') {
      // I53.19: one row per owner — the emitter put the EARLIEST due date of theirs in detail.
      const d = (row.detail ?? {}) as { due_at?: unknown }
      dueAt = typeof d.due_at === 'string' ? d.due_at : null
    }

    const parts: string[] = []
    // ADR-0096 d.11: a deliverable on a phased campaign names its phase, read at send time so a
    // move between phases is reflected. A task inherits it through its deliverable.
    if (phaseId) {
      const { data: ph } = await admin.from('campaign_phases').select('number, name').eq('id', phaseId).maybeSingle()
      const p = ph as { number?: number; name?: string } | null
      if (p?.name) parts.push(locale === 'ar' ? `المرحلة ${p.number}: ${p.name}` : `Phase ${p.number}: ${p.name}`)
    }
    if (dueAt) {
      // ADR-0076 — through the SAME helper the screens use (d.7), so an email and a page cannot
      // disagree about when something is due. It names the clock, which is d.2: a reader in Dubai
      // seeing "18:00" needs to know whose 18:00 that is. This block previously read the UTC date
      // deliberately, which was correct only because the value was midnight UTC; it no longer is.
      parts.push(formatDeadline(dueAt, locale))
    }
    if (hours != null && hours > 0) {
      parts.push(locale === 'ar' ? `${hours} ساعة` : `${hours} hours`)
    }
    return parts.length > 0 ? parts.join(' · ') : null
  } catch {
    return null   // a missing facts line is never worth a missing email
  }
}

/**
 * The email itself (I30.7, 8 Sep — "cleanly and professionally formatted").
 *
 * Written as a table, inline styles only, no external CSS and no web fonts: Outlook renders tables,
 * ignores <style> blocks, and is where an email built like a web page falls apart. The palette is
 * Maestro's own — $violet #614cff, $sidebar #0a0d14, $text-secondary #667085, $border #e2e4e9 —
 * transcribed from the design system in `src/index.css`, not invented here.
 *
 * `dir` flips with the locale and every horizontal value is symmetric (centred content, equal
 * padding), so the Arabic email mirrors without a second template.
 *
 * `preheader` is the grey line a client shows beside the subject in the inbox list. Unset, it leaks
 * whatever text comes first — usually the greeting. It carries the facts instead, so the inbox row
 * itself says when the thing is due.
 */
function renderHtml(
  locale: Locale,
  opts: { line: string; facts: string | null; url: string },
): string {
  const dir = locale === 'ar' ? 'rtl' : 'ltr'
  const cta = CTA[locale]
  const foot = locale === 'ar'
    ? 'أُرسلت من مايسترو. تُدار التنبيهات داخل التطبيق.'
    : 'Sent by Maestro. Notification settings live in the app.'
  const preheader = opts.facts ?? opts.line

  return `<!doctype html>
<html dir="${dir}" lang="${locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:#f6f8fa;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fa;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:520px;background:#ffffff;border:1px solid #e2e4e9;border-radius:12px;">
        <tr><td style="padding:28px 32px 0;">
          <span style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#0a0d14;">Maestro</span>
        </td></tr>
        <tr><td style="padding:18px 32px 0;">
          <p style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;color:#0a0d14;">${opts.line}</p>
        </td></tr>
        ${opts.facts ? `<tr><td style="padding:14px 32px 0;">
          <p style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#667085;">${opts.facts}</p>
        </td></tr>` : ''}
        <tr><td style="padding:24px 32px 32px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="background:#614cff;border-radius:8px;">
              <a href="${opts.url}" style="display:inline-block;padding:12px 22px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${cta}</a>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:0 32px 26px;border-top:1px solid #e2e4e9;">
          <p style="margin:18px 0 0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#667085;">${foot}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

Deno.serve(guarded({}, async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' })

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const from = Deno.env.get('NOTIFY_EMAIL_FROM')
  const appBase = Deno.env.get('APP_BASE_URL') ?? ''

  // defence-in-depth: this endpoint is internal (called by the pg_net trigger with the service key)
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (bearer !== serviceKey) return json(401, { error: 'unauthorized' })

  // Resend by default; Mailpit locally (`EMAIL_TRANSPORT=mailpit`, _shared/email-transport.ts).
  if (!from || !emailConfigured()) {
    console.error('notify-email: NOTIFY_EMAIL_FROM / RESEND_API_KEY (or MAILPIT_URL) not configured')
    return json(200, { skipped: 'not_configured' }) // don't error the queue; inbox is the truth
  }

  let id: string | undefined
  try { id = (await req.json())?.id } catch { return json(400, { error: 'bad_json' }) }
  if (!id) return json(400, { error: 'id required' })

  const admin = createClient(url, serviceKey)

  const { data: n } = await admin
    .from('notifications')
    .select('id, tenant_id, user_id, type, label, context_label, entity_type, entity_id, actor_id, detail')
    .eq('id', id)
    .maybeSingle()
  const row = n as NotificationRow | null
  if (!row) return json(200, { skipped: 'not_found' })
  if (row.type === 'due_soon') return json(200, { skipped: 'due_soon' })

  // recipient email (auth.users) + display name / locale (user_profiles)
  const { data: recipientAuth } = await admin.auth.admin.getUserById(row.user_id)
  const email = recipientAuth?.user?.email
  if (!email) return json(200, { skipped: 'no_email' })

  // ADR-0081 d.3a — the local-only recipient fence. Unset in production, so this is inert there;
  // set locally, it is what stops a real address that reached the local database from being emailed.
  // The predicate lives in `_shared/email-allowlist.ts` so it can be unit-tested, including the
  // branch that matters most: a MISCONFIGURED list refuses everybody rather than reopening the fence.
  if (!isAllowedRecipient(email, Deno.env.get('EMAIL_ALLOWLIST'))) {
    // Logged, not silent: somebody expecting an email needs to know why it did not arrive, and the
    // reason must name the fence rather than looking like the send having failed.
    console.warn(`notify-email: EMAIL_ALLOWLIST blocked a recipient (notification ${row.id})`)
    return json(200, { skipped: 'not_allowlisted' })
  }

  const { data: rp } = await admin.from('user_profiles').select('display_name, locale').eq('id', row.user_id).maybeSingle()
  const locale: Locale = (rp as { locale?: string } | null)?.locale === 'ar' ? 'ar' : 'en'

  let actorName = locale === 'ar' ? 'زميل' : 'A teammate'
  if (row.actor_id) {
    const { data: ap } = await admin.from('user_profiles').select('display_name').eq('id', row.actor_id).maybeSingle()
    const dn = (ap as { display_name?: string } | null)?.display_name
    if (dn) actorName = dn
  }

  const copy = COPY[locale][row.type as Exclude<NotifType, 'due_soon'>]
  if (!copy) return json(200, { skipped: 'no_copy' })
  // I52: the facts first, the words second. `ctx.full` is the campaign-in-front name the in-app
  // inbox also shows (I30.7), so the two cannot word one event differently.
  const ctx = await gather(admin, locale, row, actorName)
  const subject = copy.subject(ctx)
  const html = renderHtml(locale, {
    line: copy.line(ctx),
    // A due date on finished or cancelled work is noise; those entries opt out.
    facts: copy.facts === false ? null : await factsLine(admin, locale, row),
    url: await deepLink(admin, appBase, row, ctx),
  })

  // Idempotency-Key = notification id so a retried trigger never double-sends (Resend honours it).
  try {
    const res = await sendEmail({ from: from!, to: email, subject, html, idempotencyKey: row.id })
    if (!res.ok) {
      console.error('notify-email: send', res.status, res.body)
      return json(200, { sent: false }) // swallow — best-effort (ADR-0015)
    }
    return json(200, { sent: true, resendId: res.id })
  } catch (e) {
    console.error('notify-email: send failed', e)
    return json(200, { sent: false })
  }
}))
