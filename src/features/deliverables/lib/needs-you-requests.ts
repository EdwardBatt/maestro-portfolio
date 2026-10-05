import { handoverHref } from '../../../lib/navigation/handover-link'
import { assignHref, escalatesAtFor, taskPageHref, type EscalationRules, type NeedsYouItem } from './needs-you'
import { pieceHref } from '../../../lib/navigation/piece-link'
import type { ChangeAskAnswer, ChangeAskRow } from '../../campaigns/lib/change-ask'

/**
 * "Needs you" — the sources the database tracks brought on 25 Sep (ADR-0107 – 0113, I59 Track 6),
 * each mapped onto the one item shape `needs-you.ts` defines, with its real clock (ADR-0108 d.2:
 * the moment it started waiting plus its rule's hours, `escalatesAtFor`).
 *
 * The rows arrive camel-cased from `api/needs-you-api.ts`, one query per source (ADR-0105
 * Consequences). The words are said through `say` (i18next's `t`), so this file stays pure and the
 * mapping is unit-tested on its own (`needs-you-requests.test.ts`).
 *
 * | kind                  | read                         | clock (rule, from)              |
 * |-----------------------|------------------------------|---------------------------------|
 * | blocked               | needs_me_blocks              | blocked, raised                 |
 * | extension_owner       | needs_me_extensions (owner)  | extension_owner, asked          |
 * | extension_am          | needs_me_extensions (am)     | extension_am, forwarded (asked) |
 * | change_request        | needs_me_change_requests     | change_request, sent            |
 * | change_pushed_back    | needs_me_change_requests     | none (waiting since answered)   |
 * | change_declined       | needs_me_change_requests     | none (waiting since answered)   |
 * | too_much              | needs_me_messages            | none — no rule exists           |
 * | question              | needs_me_messages            | none — no rule exists           |
 * | over_capacity         | needs_me_overload            | none — it is itself the alert   |
 * | escalated             | needs_me_escalations         | already escalated               |
 * | client_waiting        | deliverable_pending_inputs   | none — no rule exists           |
 * | scope_unacknowledged  | campaigns + acknowledgements | none — no rule exists           |
 */

export type Say = (key: string, vars?: Record<string, unknown>) => string

// ---------------------------------------------------------------------- blocked ----

/** One open "I'm blocked" on a task of a deliverable I own (`needs_me_blocks`), enriched with the
 *  piece's campaign and department so Reassign opens the Schedule narrowed to them. */
export interface BlockRow {
  inputId: string
  subTaskId: string
  taskTitle: string
  deliverableId: string
  deliverableName: string | null
  makerId: string | null
  makerName: string | null
  kind: string | null
  description: string
  awaitedFrom: string | null
  requestedAt: string
  campaignId: string | null
  departmentId: string | null
}

export function fromBlocks(rows: readonly BlockRow[], rules: EscalationRules | null | undefined, say: Say): NeedsYouItem<BlockRow>[] {
  return rows.map((r) => ({
    kind: 'blocked' as const,
    id: r.inputId,
    title: say('requests.ny.blocked', { maker: r.makerName ?? '—', task: r.taskTitle }),
    context: [
      r.awaitedFrom ? say('requests.ny.waitingOnFor', { who: r.awaitedFrom, what: r.description }) : r.description,
      r.deliverableName,
    ].filter(Boolean).join(' · '),
    since: r.requestedAt,
    clock: { escalatesAt: escalatesAtFor(r.requestedAt, rules, 'blocked') },
    primary: { type: 'dialog' as const, dialog: 'nudge' as const, name: 'nudge', labelKey: 'requests.nudge.button' },
    secondary: r.campaignId
      ? { type: 'link' as const, to: assignHref({ campaignId: r.campaignId, departmentId: r.departmentId }), labelKey: 'requests.ny.reassign', name: 'reassign' }
      : null,
    ref: r,
  }))
}

// ------------------------------------------------------------------- extensions ----

/** A pending extension request at MY step (`needs_me_extensions`). */
export interface ExtensionStepRow {
  requestId: string
  stage: 'owner' | 'am'
  subTaskId: string
  deliverableId: string
  taskTitle: string
  deliverableName: string | null
  campaignId: string | null
  campaignName: string | null
  requestedBy: string | null
  requestedByName: string | null
  assigneeId: string | null
  /** The commitment when it was asked — the lower bound of a shorter approval (ADR-0109 d.3). */
  fromAt: string | null
  /** The deadline asked for — the upper bound. */
  toAt: string | null
  reason: string | null
  attributedTo: string | null
  ownerNote: string | null
  requestedAt: string
  forwardedAt: string | null
}

/** Whole days between the commitment and the date asked (at least one) — "asks for 2 more days". */
export function extraDays(fromAt: string | null, toAt: string | null): number | null {
  if (!fromAt || !toAt) return null
  const d = (Date.parse(toAt) - Date.parse(fromAt)) / 86_400_000
  return Number.isFinite(d) ? Math.max(1, Math.round(d)) : null
}

function addDay(isoDay: string, n: number): string {
  const d = new Date(`${isoDay}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * The days a SHORTER approval may give (ADR-0109 d.3): strictly after the current commitment and
 * strictly before the day asked — the server lands the day at 18:00 Iraq and refuses anything
 * outside, so the picker offers only what it accepts. Both are Iraq calendar days (`iraqDay`),
 * passed in so this stays pure. Null when no day fits between (asked for one day more).
 */
export function shorterBounds(commitmentDay: string | null, askedDay: string | null): { min: string | null; max: string } | null {
  if (!askedDay) return null
  const max = addDay(askedDay, -1)
  const min = commitmentDay ? addDay(commitmentDay, 1) : null
  if (min && min > max) return null
  return { min, max }
}

export function fromExtensionSteps(
  rows: readonly ExtensionStepRow[],
  rules: EscalationRules | null | undefined,
  say: Say,
): NeedsYouItem<ExtensionStepRow>[] {
  return rows.map((r) => {
    const days = extraDays(r.fromAt, r.toAt)
    const asks = days
      ? say('requests.ny.extensionAsks', { who: r.requestedByName ?? '—', count: days, task: r.taskTitle })
      : say('requests.ny.extensionAsksNoDays', { who: r.requestedByName ?? '—', task: r.taskTitle })
    if (r.stage === 'owner') {
      return {
        kind: 'extension_owner' as const,
        id: r.requestId,
        title: asks,
        context: [r.reason, r.deliverableName, r.campaignName].filter(Boolean).join(' · '),
        since: r.requestedAt,
        clock: { escalatesAt: escalatesAtFor(r.requestedAt, rules, 'extension_owner') },
        primary: { type: 'dialog' as const, dialog: 'extension_owner' as const, name: 'forward', labelKey: 'requests.extOwner.forward', mode: 'forward' },
        secondary: { type: 'dialog' as const, dialog: 'extension_owner' as const, name: 'decline', labelKey: 'requests.extOwner.decline', mode: 'decline' },
        ref: r,
      }
    }
    // The account manager's step waits from the owner's forward; a request that skipped the
    // owner's step (ADR-0109 d.1) waits from when it was asked.
    const since = r.forwardedAt ?? r.requestedAt
    return {
      kind: 'extension_am' as const,
      id: r.requestId,
      title: asks,
      context: [
        r.ownerNote ? say('requests.ny.forwardedWith', { note: r.ownerNote }) : null,
        r.deliverableName,
        r.campaignName,
      ].filter(Boolean).join(' · '),
      since,
      clock: { escalatesAt: escalatesAtFor(since, rules, 'extension_am') },
      primary: { type: 'dialog' as const, dialog: 'extension_am' as const, name: 'decide-extension', labelKey: 'requests.extAm.decide' },
      ref: r,
    }
  })
}

/**
 * `my_pending_approvals` still returns the account manager's extension request as a row of its own
 * (kind `extension_request`, `targetId` = the task). When `needs_me_extensions` carries the same
 * task at the account manager's step, the richer item wins and the plain row is dropped — one card
 * per thing to do.
 */
export function withoutDuplicateExtensions<T extends { kind: string; ref?: unknown }>(
  items: readonly T[],
  steps: readonly ExtensionStepRow[],
): T[] {
  const tasks = new Set(steps.filter((s) => s.stage === 'am').map((s) => s.subTaskId))
  return items.filter((it) => !(it.kind === 'extension_request' && tasks.has((it.ref as { targetId?: string } | undefined)?.targetId ?? '')))
}

// --------------------------------------------------------------- change requests ----

export type ChangeField = 'type' | 'quantity' | 'department' | 'due'

/** One field of a change: before and after, as the server recorded them, and a readable name for
 *  each (a type's or a department's name; the raw value otherwise). */
export interface ChangeLine {
  field: ChangeField
  from: string | null
  to: string | null
  fromLabel: string | null
  toLabel: string | null
}

export interface ChangeRequestRow {
  id: string
  myPart: 'owner' | 'requester'
  status: 'pending' | 'pushed_back' | 'declined' | string
  deliverableId: string
  deliverableName: string | null
  campaignId: string | null
  campaignName: string | null
  requestedBy: string
  requestedByName: string | null
  changes: ChangeLine[]
  askedBy: 'client' | 'us' | string
  /** The figures the requester's screen worked out (Track 10), as sent — shown, never computed here. */
  cost: Record<string, unknown>
  declineReason: string | null
  counterText: string | null
  counterDate: string | null
  answeredBy: string | null
  answeredByName: string | null
  createdAt: string
  answeredAt: string | null
}

const FIELD_ORDER: readonly ChangeField[] = ['type', 'quantity', 'department', 'due']

/** `{type: {from, to}, …}` as the table stores it, in a stable order; unknown keys are ignored. */
export function changeLines(
  changes: unknown,
  names: { types?: ReadonlyMap<string, string>; departments?: ReadonlyMap<string, string> } = {},
): ChangeLine[] {
  const c = (changes && typeof changes === 'object' ? changes : {}) as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null)
  const label = (field: ChangeField, v: string | null) => {
    if (v == null) return null
    if (field === 'type') return names.types?.get(v) ?? v
    if (field === 'department') return names.departments?.get(v) ?? v
    return v
  }
  return FIELD_ORDER.filter((f) => f in c).map((field) => {
    const e = c[field]
    const pair = e && typeof e === 'object' ? (e as Record<string, unknown>) : { to: e }
    const from = text(pair.from)
    const to = text(pair.to)
    return { field, from, to, fromLabel: label(field, from), toLabel: label(field, to) }
  })
}

/** "type, due date" — the fields a request touches, for the card's one sentence. */
export function changeSummary(lines: readonly ChangeLine[], say: Say): string {
  return lines.map((l) => say(`requests.field.${l.field}`)).join(', ')
}

/** Where "Send a new request" goes: the campaign page with `?edit=<piece>`, which opens that piece's Edit (Track 10) where a new request is made. */
export const campaignPieceHref = (campaignId: string, deliverableId: string) =>
  `/campaigns/${campaignId}?edit=${deliverableId}`

export function fromChangeRequests(
  rows: readonly ChangeRequestRow[],
  rules: EscalationRules | null | undefined,
  say: Say,
): NeedsYouItem<ChangeRequestRow>[] {
  const out: NeedsYouItem<ChangeRequestRow>[] = []
  for (const r of rows) {
    const piece = r.deliverableName ?? '—'
    const what = changeSummary(r.changes, say)
    if (r.myPart === 'owner' && r.status === 'pending') {
      out.push({
        kind: 'change_request',
        id: r.id,
        title: say('requests.ny.changeWants', { who: r.requestedByName ?? '—', piece, what }),
        context: [say(`requests.change.askedBy_${r.askedBy === 'client' ? 'client' : 'us'}`), r.campaignName].filter(Boolean).join(' · '),
        since: r.createdAt,
        clock: { escalatesAt: escalatesAtFor(r.createdAt, rules, 'change_request') },
        primary: { type: 'dialog', dialog: 'change_decide', name: 'decide-change', labelKey: 'requests.change.decide' },
        secondary: { type: 'dialog', dialog: 'change_cost', name: 'change-cost', labelKey: 'requests.change.seeCost' },
        ref: r,
      })
    } else if (r.status === 'pushed_back') {
      out.push({
        kind: 'change_pushed_back',
        id: r.id,
        title: say('requests.ny.changePushedBack', { who: r.answeredByName ?? '—', text: r.counterText ?? '' }),
        context: [piece, r.campaignName].filter(Boolean).join(' · '),
        since: r.answeredAt ?? r.createdAt,
        clock: {},
        primary: { type: 'dialog', dialog: 'change_counter', name: 'accept-counter', labelKey: 'requests.counter.accept', mode: 'accept_counter' },
        secondary: { type: 'dialog', dialog: 'change_counter', name: 'withdraw-change', labelKey: 'requests.counter.withdraw', mode: 'withdraw' },
        ref: r,
      })
    } else if (r.status === 'declined') {
      out.push({
        kind: 'change_declined',
        id: r.id,
        title: say('requests.ny.changeDeclined', { who: r.answeredByName ?? '—', reason: r.declineReason ?? '' }),
        context: [piece, r.campaignName].filter(Boolean).join(' · '),
        since: r.answeredAt ?? r.createdAt,
        clock: {},
        primary: r.campaignId
          ? { type: 'link', to: campaignPieceHref(r.campaignId, r.deliverableId), labelKey: 'requests.change.sendNew', name: 'send-new-request' }
          : null,
        secondary: { type: 'act', act: 'change_close', name: 'close-change', labelKey: 'requests.change.close' },
        ref: r,
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------- messages ----

/** A question to me, or a "too much" on a task I assigned (`needs_me_messages`), enriched with the
 *  maker's week % (from the `too_much` notification's detail) and the piece's campaign/department. */
export interface MessageRow {
  id: string
  kind: 'question' | 'too_much'
  deliverableId: string | null
  subTaskId: string | null
  label: string | null
  deliverableName: string | null
  authorId: string
  authorName: string | null
  body: string | null
  createdAt: string
  weekPct?: number | null
  campaignId?: string | null
  departmentId?: string | null
}

export function fromMessages(rows: readonly MessageRow[], say: Say): NeedsYouItem<MessageRow>[] {
  return rows.map((r) => {
    if (r.kind === 'question') {
      return {
        kind: 'question' as const,
        id: r.id,
        title: say('requests.ny.question', { who: r.authorName ?? '—', label: r.label ?? '—', body: r.body ?? '' }),
        context: r.deliverableName && r.deliverableName !== r.label ? r.deliverableName : '',
        since: r.createdAt,
        clock: {},
        primary: { type: 'dialog' as const, dialog: 'reply' as const, name: 'reply', labelKey: 'requests.reply.button' },
        ref: r,
      }
    }
    const rebalanceTo = r.campaignId ? assignHref({ campaignId: r.campaignId, departmentId: r.departmentId ?? null }) : '/schedule'
    return {
      kind: 'too_much' as const,
      id: r.id,
      title:
        r.weekPct != null
          ? say('requests.ny.tooMuchPct', { who: r.authorName ?? '—', label: r.label ?? '—', pct: r.weekPct })
          : say('requests.ny.tooMuch', { who: r.authorName ?? '—', label: r.label ?? '—' }),
      context: [r.body, r.deliverableName && r.deliverableName !== r.label ? r.deliverableName : null].filter(Boolean).join(' · '),
      since: r.createdAt,
      clock: {},
      primary: { type: 'act' as const, act: 'too_much_rebalance' as const, name: 'rebalance', labelKey: 'requests.ny.rebalance', to: rebalanceTo },
      secondary: { type: 'act' as const, act: 'too_much_keep' as const, name: 'keep', labelKey: 'requests.ny.keep' },
      ref: r,
    }
  })
}

// ------------------------------------------------------------------ over capacity ----

export interface OverloadRow {
  resourceId: string
  userId: string | null
  name: string
  teamId: string | null
  departmentId: string | null
  weekStart: string
  bookedHours: number
  nominalHours: number
  utilPct: number
  overCapacityPct: number
}

/** Rebalance: the Schedule narrowed to the person's department and name (`dept`, `who`). */
export function rebalanceHref(r: Pick<OverloadRow, 'departmentId' | 'name'>): string {
  const q = new URLSearchParams()
  if (r.departmentId) q.set('dept', r.departmentId)
  q.set('who', r.name)
  return `/schedule?${q.toString()}`
}

export function fromOverload(rows: readonly OverloadRow[], say: Say): NeedsYouItem<OverloadRow>[] {
  return rows.map((r) => ({
    kind: 'over_capacity' as const,
    id: r.resourceId,
    title: say('requests.ny.overCapacity', { who: r.name, pct: r.utilPct }),
    context: say('requests.ny.overCapacityLine', { booked: r.bookedHours, nominal: r.nominalHours, limit: r.overCapacityPct }),
    since: null,
    clock: {},
    primary: { type: 'link' as const, to: rebalanceHref(r), labelKey: 'requests.ny.rebalance', name: 'rebalance-week' },
    secondary: { type: 'link' as const, to: '/team', labelKey: 'requests.ny.seeWeek', name: 'see-week' },
    ref: r,
  }))
}

// ------------------------------------------------------------------ escalations ----

export interface EscalationRow {
  notificationId: string
  /** The rule kind (`detail.kind`): unassigned, task_list, review_escalate, … */
  kind: string | null
  entityType: string | null
  entityId: string | null
  label: string | null
  contextLabel: string | null
  detail: Record<string, unknown>
  escalatedAt: string
  /** For `unassigned` on a deliverable: its campaign and department, so Open goes to the Schedule. */
  campaignId?: string | null
  departmentId?: string | null
}

/** Where Open goes (plan View 3: "the piece, or the Schedule for unassigned"). */
export function escalationHref(r: EscalationRow): string {
  if (r.kind === 'unassigned' && r.campaignId) return assignHref({ campaignId: r.campaignId, departmentId: r.departmentId ?? null })
  if (r.entityType === 'sub_task' && r.entityId) return taskPageHref(r.entityId)
  if (r.entityType === 'deliverable' && r.entityId) return pieceHref(r.campaignId, r.entityId)   // ADR-0132 d.8
  if (r.entityType === 'campaign' && r.entityId) return `/campaigns/${r.entityId}`
  // ADR-0133 d.5: an unfinished hand-over opens the leaving person's list.
  if (r.kind === 'handover' && r.entityId) return handoverHref(r.entityId)
  return '/my-work'
}

const ESCALATION_KINDS = new Set([
  'unassigned', 'task_list', 'change_request', 'extension_owner', 'extension_am', 'blocked', 'review_escalate', 'handover',
  'deliverable_change',
])

export function fromEscalations(rows: readonly EscalationRow[], say: Say): NeedsYouItem<EscalationRow>[] {
  return rows.map((r) => {
    const waitingOn = typeof r.detail.waiting_on === 'string' ? r.detail.waiting_on : null
    // I66.4: a piece with no tasks escalates as "no tasks defined", not as a list waiting for approval.
    const key = r.kind === 'task_list' && waitingOn === 'campaign_brief' ? 'campaign_brief'
      : r.kind === 'task_list' && r.detail.all_cancelled === true ? 'tasks_all_cancelled'
      : r.kind === 'task_list' && r.detail.no_tasks === true ? 'task_list_undefined'
        : r.kind && ESCALATION_KINDS.has(r.kind) ? r.kind : 'other'
    const owner = typeof r.detail.owner === 'string' ? r.detail.owner : null
    const since = typeof r.detail.since === 'string' ? r.detail.since : null
    return {
      kind: 'escalated' as const,
      id: r.notificationId,
      title: say(`requests.ny.escalated.${key}`, { label: r.label ?? '—', hours: r.detail.threshold ?? r.detail.hours ?? '', ...(key === 'handover' ? { total: r.detail.total ?? '' } : {}) }),
      context: [owner ? say('requests.ny.owner', { name: owner }) : null, r.contextLabel].filter(Boolean).join(' · '),
      since,
      // It has escalated: the clock bit when the sweep sent it, so it sits in "today".
      clock: { escalatesAt: r.escalatedAt },
      primary: { type: 'link' as const, to: escalationHref(r), labelKey: 'needsYou.action.open' },
      ref: r,
    }
  })
}

// --------------------------------------------------------------- waiting on the client ----

export interface ClientWaitRow {
  inputId: string
  deliverableId: string
  deliverableName: string | null
  campaignId: string | null
  campaignName: string | null
  description: string
  awaitedFrom: string | null
  requestedAt: string
}

/**
 * An outstanding input is the client's when it says so (`kind = 'client'`, ADR-0107), or when it
 * is one of ADR-0069's deliverable-wide inputs raised before kinds existed — the rule the campaign
 * page's "Waiting on client" badge reads (I57 Q5). A maker's own block of another kind is not.
 */
export function isClientInput(r: { kind: string | null; subTaskId: string | null }): boolean {
  return r.kind === 'client' || (r.kind == null && r.subTaskId == null)
}

export function fromClientWaiting(rows: readonly ClientWaitRow[], say: Say): NeedsYouItem<ClientWaitRow>[] {
  return rows.map((r) => ({
    kind: 'client_waiting' as const,
    id: r.inputId,
    title: say('requests.ny.clientWaiting', { piece: r.deliverableName ?? '—', what: r.description }),
    context: [r.awaitedFrom, r.campaignName].filter(Boolean).join(' · '),
    since: r.requestedAt,
    clock: {},
    primary: { type: 'dialog' as const, dialog: 'mark_received' as const, name: 'mark-received', labelKey: 'requests.received.button' },
    ref: r,
  }))
}

// ------------------------------------------------------------- reduced scope ----

export interface ScopeRow {
  campaignId: string
  name: string
  createdAt: string
  /** The job's due date (its piece's), and the deliverable type's lead time in hours. */
  dueAt: string | null
  leadTimeHours: number | null
}

export function fromScopeUnacknowledged(rows: readonly ScopeRow[], say: Say): NeedsYouItem<ScopeRow>[] {
  return rows.map((r) => ({
    kind: 'scope_unacknowledged' as const,
    id: r.campaignId,
    title: say('requests.ny.scope', { name: r.name }),
    context: '',
    since: r.createdAt,
    clock: {},
    primary: { type: 'dialog' as const, dialog: 'scope_ack' as const, name: 'record-ack', labelKey: 'requests.scope.button' },
    ref: r,
  }))
}

// ------------------------------------------------------------- the one change form ----

/** A change asked of the account manager (ADR-0141 d.2), with the piece's name and campaign for the card. */
export interface ChangeAskNeedRow extends ChangeAskRow {
  deliverableName: string | null
  campaignId: string | null
  campaignName: string | null
}

/**
 * The account manager's side (ADR-0141 d.4): each waiting ask on a piece she manages — Accept, Change it, Keep it as
 * it is, all in the one answer dialog. The clock is the rule `deliverable_change` (4 hours by default). The sweep counts
 * WORKING hours; the card's clock adds real hours, as every Needs-you clock does (ADR-0108 d.1), so it may read early.
 * Once escalated, the escalation's own instant.
 */
export function fromChangeAsks(
  rows: readonly ChangeAskNeedRow[],
  rules: EscalationRules | null | undefined,
  say: Say,
): NeedsYouItem<ChangeAskNeedRow>[] {
  const mode = (m: ChangeAskAnswer) => m
  return rows.map((r) => ({
    kind: 'deliverable_change' as const,
    id: r.id,
    title: say('changeAsk.ny.title', {
      who: r.askedByName ?? '—',
      piece: r.deliverableName ?? '—',
      what: r.kinds.map((k) => say(`changeAsk.kind.${k}`)).join(', '),
    }),
    context: [`“${r.reason}”`, r.campaignName].filter(Boolean).join(' · '),
    since: r.createdAt,
    clock: { escalatesAt: r.escalatedAt ?? escalatesAtFor(r.createdAt, rules, 'deliverable_change') },
    primary: { type: 'dialog' as const, dialog: 'change_ask_answer' as const, name: 'answer-change', labelKey: 'changeAsk.ny.accept', mode: mode('accept') },
    secondary: { type: 'dialog' as const, dialog: 'change_ask_answer' as const, name: 'keep-change', labelKey: 'changeAsk.ny.keep', mode: mode('keep') },
    ref: r,
  }))
}
