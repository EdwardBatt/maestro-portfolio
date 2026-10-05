import { localDay, today } from './my-work'

/**
 * "Needs you" (ADR-0105 d.2, I59.10) — everything asking the signed-in person to act, in ONE list,
 * grouped by the clock.
 *
 * THE SHAPE. Every source is turned into the same item: a kind, a title, one line of context, when
 * it started waiting (`since`), a clock (`escalatesAt` / `dueAt`), a primary action and at most one
 * secondary action. The panel renders any item from those fields alone plus a kind-specific `ref`
 * for the few kinds that carry a bigger control (the review card keeps everything the old Awaiting
 * review panel showed; a booking request keeps its Approve / Refuse in place).
 *
 * ADDING A SOURCE (I59 Track 6 added the database tracks' twelve in `needs-you-requests.ts`):
 *   1. add its kind to `NeedsYouKind` and, if it needs a bespoke control, a `ref` variant;
 *   2. write one pure `from…(rows)` mapper, returning `NeedsYouItem[]` with its real clock —
 *      `escalatesAt` is when the sweep escalates it: the moment it started waiting plus the hours
 *      of its rule in `tenant_escalation_rules` (ADR-0108 d.2 — the SAME hours the sweep reads, in
 *      real time: `escalatesAtFor`), or the escalation's own instant once it has escalated;
 *      `dueAt` the task's deadline. A source with no rule has no escalation clock;
 *   3. read it with ONE query in `api/needs-you-api.ts` (ADR-0105 Consequences: one query per
 *      source, not a new table) and concatenate its items in `NeedsYouPanel`;
 *   4. add the kind's label under `needsYou.kind.*` in both locales.
 * Grouping, ordering and the empty state need no change.
 *
 * Pure: no React, no Supabase — the grouping is unit-tested on its own (`needs-you.test.ts`).
 */

/** Where the kinds come from. The first six are `my_pending_approvals` (ADR-0037), verbatim. */
export type NeedsYouKind =
  | 'department_brief'
  | 'department_brief_unwritten'
  | 'task_list'
  /** I66.3: a piece with no live task — nothing to approve yet; its owner defines the tasks. */
  | 'task_list_undefined'
  /** I66.11: every task cancelled — the owner adds one or closes the piece. */
  | 'tasks_all_cancelled'
  | 'booking_request'
  | 'extension_request'
  | 'campaign'
  /** ADR-0133 (I70.3): a leaving person's work, for me to hand over. */
  | 'handover'
  /** A task naming me as reviewer, not yet acted on by me (ADR-0043 d.7). */
  | 'review'
  /** A deliverable I own with tasks nobody has (ADR-0105 d.2: the owner's list only). */
  | 'assign'
  /** My task whose latest round came back with changes (Q38). */
  | 'changes_back'
  /** A task given to me recently that I have not started (Q38). */
  | 'new_on_you'
  // ---- I59 Track 6: the database tracks' sources (ADR-0107 – 0113), mapped in needs-you-requests.ts
  /** A maker is blocked on a task of a deliverable I own (ADR-0107, `needs_me_blocks`). */
  | 'blocked'
  /** An extension request at the OWNER's step — forward or decline (ADR-0109 d.1). */
  | 'extension_owner'
  /** An extension request at the account manager's step — decide (ADR-0109 d.2, d.3). */
  | 'extension_am'
  /** A change request on a deliverable I own, to answer (ADR-0110 d.2). */
  | 'change_request'
  /** A change request I asked that the owner pushed back (ADR-0110 d.3). */
  | 'change_pushed_back'
  /** A change request I asked that the owner declined, not yet closed (ADR-0110 d.3, D3). */
  | 'change_declined'
  /** A maker says a task I assigned is too much (ADR-0113 d.3). */
  | 'too_much'
  /** Somebody I lead is booked over the tenant's percentage this week (ADR-0108 d.6). */
  | 'over_capacity'
  /** An escalation addressed to me whose stall is still there (ADR-0108 d.3). */
  | 'escalated'
  /** An input awaited from the client on a campaign I manage (Q16). */
  | 'client_waiting'
  /** A single job of mine released as reduced scope with no acknowledgement recorded (Q33). */
  | 'scope_unacknowledged'
  /** A question sent to me that I have not replied to (ADR-0113 d.2). */
  | 'question'
  /** A change asked of me, the piece's account manager, through the one form (ADR-0141 d.2–d.4). */
  | 'deliverable_change'

export interface NeedsYouClock {
  /** When the server will escalate it. Read, never derived here (ADR-0108). */
  escalatesAt?: string | null
  /** The deadline of the work behind it. */
  dueAt?: string | null
}

/** What a button on the card does. The panel turns each into a control; the label is a locale key. */
export type NeedsYouAction =
  /** `name`, when set, builds the test id `needs-you-<name>-<id>` (a second link on a card). */
  | { type: 'link'; to: string; labelKey: string; name?: string }
  /** Opens the review modal for `ref.review` (the one the old panel opened). */
  | { type: 'review' }
  /** The inbox's own Approve / Refuse, answered in place (ADR-0087 d.11). */
  | { type: 'booking' }
  /**
   * Opens one of the Needs-you dialogs (View 6) on this item. `name` builds the button's test id
   * (`needs-you-<name>-<id>`); `mode` pre-selects a choice inside the dialog (Forward / Decline).
   */
  | { type: 'dialog'; dialog: NeedsYouDialog; name: string; labelKey: string; mode?: string }
  /** Acts in place with one press — then, when `to` is set, goes there (Rebalance → the Schedule). */
  | { type: 'act'; act: NeedsYouAct; name: string; labelKey: string; to?: string }

export type NeedsYouDialog =
  | 'nudge'
  | 'reply'
  | 'too_much'
  | 'extension_owner'
  | 'extension_am'
  | 'change_decide'
  | 'change_cost'
  | 'change_counter'
  | 'mark_received'
  | 'scope_ack'
  | 'change_ask_answer'

export type NeedsYouAct = 'change_close' | 'too_much_rebalance' | 'too_much_keep'

export interface NeedsYouItem<Ref = unknown> {
  kind: NeedsYouKind
  /** The id the card's test ids and keys are built from (the task, the deliverable, the row). */
  id: string
  title: string
  /** One line, already joined by the source; empty when there is nothing to say. */
  context: string
  /** When it started waiting on me — shown as "since …"; also the tie-break (oldest first). */
  since: string | null
  clock: NeedsYouClock
  primary: NeedsYouAction | null
  secondary?: NeedsYouAction | null
  /** The source row, for the kinds whose card shows more than the common fields. */
  ref?: Ref
}

export type NeedsYouGroup = 'today' | 'week' | 'quiet'

export const NEEDS_YOU_GROUPS: readonly NeedsYouGroup[] = ['today', 'week', 'quiet']

/** "Escalates within 8h" (ADR-0105 d.2). */
export const SLIP_WINDOW_MS = 8 * 60 * 60 * 1000

function instant(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/**
 * Which group an item sits in (ADR-0105 d.2, D1):
 * - **today** — it escalates within 8h, has already escalated, or its task is due today / overdue;
 * - **week** — any other clock;
 * - **quiet** — no clock at all.
 * "Today" is the viewer's calendar day — the same `today()` My Work's lists and counts read.
 */
export function groupOf(clock: NeedsYouClock, now: number = Date.now()): NeedsYouGroup {
  const esc = instant(clock.escalatesAt)
  const due = instant(clock.dueAt)
  if (esc != null && esc - now <= SLIP_WINDOW_MS) return 'today'
  if (due != null && clock.dueAt && localDay(clock.dueAt) <= today(now)) return 'today'
  if (esc != null || due != null) return 'week'
  return 'quiet'
}

/** The first moment the clock bites — the sooner, the more urgent. Infinity with no clock. */
export function urgencyOf(clock: NeedsYouClock): number {
  const esc = instant(clock.escalatesAt)
  const due = instant(clock.dueAt)
  return Math.min(esc ?? Infinity, due ?? Infinity)
}

/** Most urgent first; then the one waiting longest; then by title so the order never shuffles. */
export function byUrgency(a: NeedsYouItem, b: NeedsYouItem): number {
  const ua = urgencyOf(a.clock)
  const ub = urgencyOf(b.clock)
  if (ua !== ub) return ua < ub ? -1 : 1
  const sa = instant(a.since) ?? Infinity
  const sb = instant(b.since) ?? Infinity
  if (sa !== sb) return sa < sb ? -1 : 1
  return a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
}

// ------------------------------------------------------------- the clock, in words ----

/**
 * The hours of each escalation, by rule kind — `tenant_escalation_rules` (ADR-0108 d.2), read in
 * `api/needs-you-api`. A kind with no row has no escalation clock here, as it has none in the sweep.
 */
export type EscalationRules = ReadonlyMap<string, number>

/**
 * When an item escalates: the moment it started waiting plus its rule's hours, in REAL time
 * (ADR-0108 d.1 — weekends and closed days count). The same arithmetic as `app.escalation_due`
 * (`elapsed_hours(since, now) >= hours`), so the clock on the card and the sweep agree. Null when
 * either is missing.
 */
export function escalatesAtFor(
  since: string | null | undefined,
  rules: EscalationRules | null | undefined,
  kind: string,
): string | null {
  const at = instant(since)
  const hours = rules?.get(kind)
  if (at == null || hours == null || !(hours > 0)) return null
  return new Date(at + hours * 3_600_000).toISOString()
}

/** A length of time as the card says it (Settled, 25 Sep): minutes under an hour, hours under 48, days after. */
export interface Span {
  n: number
  unit: 'minute' | 'hour' | 'day'
}

export function spanOf(ms: number): Span {
  const m = Math.max(0, ms) / 60_000
  if (m < 60) return { n: Math.max(1, Math.floor(m)), unit: 'minute' }
  const h = m / 60
  if (h < 48) return { n: Math.floor(h), unit: 'hour' }
  return { n: Math.floor(h / 24), unit: 'day' }
}

/**
 * What the card's clock line says: how long it has waited ("waiting 26 hours") and when it
 * escalates ("escalates in 4 hours"), or how long ago it did ("escalated 2 hours ago"). Each part
 * is null when the item has no such clock.
 */
export function clockOf(
  it: Pick<NeedsYouItem, 'since' | 'clock'>,
  now: number = Date.now(),
): { waited: Span | null; escalatesIn: Span | null; escalatedAgo: Span | null } {
  const since = instant(it.since)
  const esc = instant(it.clock.escalatesAt)
  return {
    waited: since != null && since <= now ? spanOf(now - since) : null,
    escalatesIn: esc != null && esc > now ? spanOf(esc - now) : null,
    escalatedAgo: esc != null && esc <= now ? spanOf(now - esc) : null,
  }
}

export interface NeedsYouSection {
  group: NeedsYouGroup
  items: NeedsYouItem[]
}

/** The groups that have something in them, in reading order, each sorted most urgent first. */
export function groupNeedsYou(items: readonly NeedsYouItem[], now: number = Date.now()): NeedsYouSection[] {
  const by = new Map<NeedsYouGroup, NeedsYouItem[]>()
  for (const it of items) {
    const g = groupOf(it.clock, now)
    by.set(g, [...(by.get(g) ?? []), it])
  }
  return NEEDS_YOU_GROUPS.filter((g) => by.has(g)).map((g) => ({ group: g, items: [...by.get(g)!].sort(byUrgency) }))
}

// ------------------------------------------------------------------------------ sources ----

/** A `my_pending_approvals` row, as `api/pending-approvals-api` maps it. */
export interface PendingApprovalRow {
  kind: 'department_brief' | 'department_brief_unwritten' | 'task_list' | 'task_list_undefined' | 'tasks_all_cancelled' | 'booking_request' | 'extension_request' | 'campaign' | 'handover'
  id: string
  title: string
  campaignId: string | null
  campaignName: string | null
  department: string | null
  since: string | null
  targetId: string
  deliverableId: string | null
  /** ADR-0133: for a `handover` row, how many items the leaving person still holds. */
  itemsLeft?: number | null
}

/**
 * Which escalation rule times each approval kind (ADR-0108 d.2 and its addendum): a task list
 * waits on its owner (`task_list`); a campaign waits on its approver (`campaign_brief` — the
 * addendum's split — and, while the tenant has no such row, `task_list`, which is the rule the
 * sweep times a campaign's approval by today, `20260926122000`); an extension at the account
 * manager's step (`extension_am`). A booking request and a department brief have no rule, so no
 * escalation clock.
 */
export const APPROVAL_RULE: Partial<Record<PendingApprovalRow['kind'], readonly string[]>> = {
  task_list: ['task_list'],
  // The same clock: the sweep still times a piece with no tasks by its task-list rung.
  task_list_undefined: ['task_list'],
  tasks_all_cancelled: ['task_list'],
  campaign: ['campaign_brief', 'task_list'],
  extension_request: ['extension_am'],
  // ADR-0133 d.5: "Hand-over not finished", counted from the day the person started leaving.
  handover: ['handover'],
}

function firstRule(rules: EscalationRules | null | undefined, kinds: readonly string[] | undefined): string | null {
  for (const k of kinds ?? []) if (rules?.has(k)) return k
  return null
}

/**
 * Every approval the RPC returns, kept as the old "Waiting for you" row showed it, with the clock
 * its escalation rule gives it (`APPROVAL_RULE`), counted from when it started waiting (`since`).
 * `link` is `pendingApprovalLink` — passed in so this file stays free of the api module.
 */
export function fromPendingApprovals(
  rows: readonly PendingApprovalRow[],
  link: (row: PendingApprovalRow) => string | null,
  writeBriefTitle: (department: string, campaign: string) => string,
  rules?: EscalationRules | null,
  /** I66.3/I66.5: a task-list card says what is required of the reader — approve the list, or define the tasks. */
  listTitles: {
    approve: (deliverable: string) => string
    define: (deliverable: string) => string
    allCancelled?: (deliverable: string) => string
    /** ADR-0133: "Hand over Mira Adel Mansour's work" — the row's title is the leaving person's name. */
    handover?: (person: string, itemsLeft: number | null) => string
  } = { approve: (d) => d, define: (d) => d },
): NeedsYouItem<PendingApprovalRow>[] {
  return rows.map((a) => {
    // I53.22: the unwritten brief is said as the thing to do; its department is in the sentence.
    // I66.3: so is a piece with no tasks — "no tasks have been created … define the tasks".
    const unwritten = a.kind === 'department_brief_unwritten'
    const title = unwritten ? writeBriefTitle(a.department ?? '', a.title)
      : a.kind === 'task_list_undefined' ? listTitles.define(a.title)
        : a.kind === 'tasks_all_cancelled' ? (listTitles.allCancelled ?? ((d: string) => d))(a.title)
        : a.kind === 'task_list' ? listTitles.approve(a.title)
        : a.kind === 'handover' ? (listTitles.handover ?? ((p: string) => p))(a.title, a.itemsLeft ?? null) : a.title
    const context = (unwritten ? [a.campaignName] : [a.campaignName, a.department]).filter(Boolean).join(' · ')
    const to = link(a)
    const rule = firstRule(rules, APPROVAL_RULE[a.kind])
    return {
      kind: a.kind,
      id: a.id,
      title,
      context,
      since: a.since,
      clock: rule ? { escalatesAt: escalatesAtFor(a.since, rules, rule) } : {},
      primary: a.kind === 'booking_request' ? { type: 'booking' } : to ? { type: 'link', to, labelKey: `waitingForYou.action.${a.kind}` } : null,
      ref: a,
    }
  })
}

/** What a review card needs from `useAwaitingMyReview` (the fields the old panel read). */
export interface ReviewRow {
  subTaskId: string
  title: string
  dueAt: string | null
  deliverableName: string | null
  campaignName?: string | null
}

/**
 * A review waits from when its round was sent (`sentAt`: the round's `task_time_entries.submitted_at`,
 * the sweep's own clock) and escalates after the `review_escalate` hours (ADR-0108 d.2: remind 24h,
 * escalate 48h). The reminder is not an escalation, so it is not the card's clock.
 */
export function fromReviews<R extends ReviewRow>(
  rows: readonly R[],
  sentAt?: ReadonlyMap<string, string> | null,
  rules?: EscalationRules | null,
): NeedsYouItem<R>[] {
  return rows.map((r) => ({
    kind: 'review' as const,
    id: r.subTaskId,
    title: r.deliverableName ?? r.title,
    // I53.15: WHICH task, and which project.
    context: [r.title, r.campaignName].filter(Boolean).join(' · '),
    since: sentAt?.get(r.subTaskId) ?? null,
    clock: { dueAt: r.dueAt, escalatesAt: escalatesAtFor(sentAt?.get(r.subTaskId), rules, 'review_escalate') },
    primary: { type: 'review' as const },
    ref: r,
  }))
}

/** A deliverable I own with tasks nobody has (read in `api/needs-you-api`). */
export interface UnassignedPiece {
  deliverableId: string
  name: string
  campaignId: string
  campaignName: string | null
  departmentId: string | null
  department: string | null
  unassignedCount: number
  /** When the owner could first assign: the task list's approval, else the oldest open task. */
  since: string | null
  /** The earliest deadline among the unassigned tasks. */
  dueAt: string | null
}

/** Where Assign goes: the Schedule, narrowed to the campaign and the department (Q31). */
export function assignHref(p: Pick<UnassignedPiece, 'campaignId' | 'departmentId'>): string {
  const q = new URLSearchParams()
  q.set('campaign', p.campaignId)
  if (p.departmentId) q.set('dept', p.departmentId)
  return `/schedule?${q.toString()}`
}

/** Nobody assigned escalates after the `unassigned` rule's hours from the task list's approval (ADR-0108 d.4). */
export function fromUnassigned(rows: readonly UnassignedPiece[], rules?: EscalationRules | null): NeedsYouItem<UnassignedPiece>[] {
  return rows
    .filter((p) => p.unassignedCount > 0)
    .map((p) => ({
      kind: 'assign' as const,
      id: p.deliverableId,
      title: p.name,
      context: [p.campaignName, p.department].filter(Boolean).join(' · '),
      since: p.since,
      clock: { dueAt: p.dueAt, escalatesAt: escalatesAtFor(p.since, rules, 'unassigned') },
      primary: { type: 'link' as const, to: assignHref(p), labelKey: 'needsYou.action.assign' },
      ref: p,
    }))
}

/** The fields of an `AssignedWorkItem` the maker's sources read. */
export interface MyTaskRow {
  subTaskId: string
  title: string
  status: string
  dueAt: string | null
  revisionRound: number
  deliverableId: string | null
  deliverableName: string | null
  deliverableState: string | null
  campaignName: string | null
  assignerName: string | null
  assignedAt?: string | null
  /** When the assignee first opened it or pressed Later (`sub_tasks.assignee_seen_at`). */
  seenAt?: string | null
}

/** A sent-back task (the same test the row's "Changes requested" badge uses). */
export function isChangesRequested(it: Pick<MyTaskRow, 'revisionRound' | 'status' | 'deliverableState'>): boolean {
  return it.revisionRound >= 1 && (it.status === 'todo' || it.status === 'in_progress') && it.deliverableState !== 'approved'
}

export const taskPageHref = (subTaskId: string) => `/my-work/task/${subTaskId}`

/**
 * `cameBackAt` — when the changes were asked for: the `changes_requested` notification the
 * send-back writes to the maker (`app.sub_task_request_changes`), read in `api/needs-you-api`. The
 * card says "came back 2 hours ago" from it.
 */
export function fromChangesBack<R extends MyTaskRow>(
  rows: readonly R[],
  cameBackAt?: ReadonlyMap<string, string> | null,
): NeedsYouItem<R>[] {
  return rows.filter(isChangesRequested).map((r) => ({
    kind: 'changes_back' as const,
    id: r.subTaskId,
    title: r.title,
    context: [r.deliverableName, r.campaignName].filter(Boolean).join(' · '),
    since: cameBackAt?.get(r.subTaskId) ?? null,
    clock: { dueAt: r.dueAt },
    primary: { type: 'link' as const, to: taskPageHref(r.subTaskId), labelKey: 'needsYou.action.open' },
    ref: r,
  }))
}

/**
 * "New on you": given within the last day, not started, and not seen yet. Seen — the maker opening
 * the task page (Edward, 26 Sep: no Later button) — is the SERVER's (I59, settled 25 Sep): `sub_tasks.assignee_seen_at`,
 * stamped by `mark_task_seen` and reset when the task is handed to somebody else, so a task opened
 * on one device is not "new" on another.
 */
export const NEW_WINDOW_MS = 24 * 60 * 60 * 1000

export function isNewOnYou(it: MyTaskRow, now: number = Date.now()): boolean {
  const at = instant(it.assignedAt)
  return (
    it.status === 'todo' && it.revisionRound === 0 && !it.seenAt &&
    at != null && now - at <= NEW_WINDOW_MS && at <= now
  )
}

export function fromNewOnYou<R extends MyTaskRow>(rows: readonly R[], now: number = Date.now()): NeedsYouItem<R>[] {
  return rows
    .filter((r) => isNewOnYou(r, now))
    .map((r) => ({
      kind: 'new_on_you' as const,
      id: r.subTaskId,
      title: r.title,
      context: [r.deliverableName, r.campaignName, r.assignerName].filter(Boolean).join(' · '),
      since: r.assignedAt ?? null,
      clock: { dueAt: r.dueAt },
      primary: { type: 'link' as const, to: taskPageHref(r.subTaskId), labelKey: 'needsYou.action.open' },
      // Open · Too much. No Later (Edward, 26 Sep): the card goes once the task is opened.
      secondary: { type: 'dialog' as const, dialog: 'too_much' as const, name: 'too-much', labelKey: 'requests.tooMuch.button' },
      ref: r,
    }))
}
