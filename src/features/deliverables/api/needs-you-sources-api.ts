import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabaseUntyped } from '../../../lib/supabase'
import { inChunks } from '../../../lib/query/in-chunks'
import { allRows } from '../../../lib/query/all-pages'
import { deliverableKeys } from './deliverables-api'
import {
  changeLines,
  isClientInput,
  type BlockRow,
  type ChangeRequestRow,
  type ClientWaitRow,
  type EscalationRow,
  type ExtensionStepRow,
  type MessageRow,
  type OverloadRow,
  type ScopeRow,
  type ChangeAskNeedRow,
} from '../lib/needs-you-requests'
import { withAskNames, type AskRaw } from '../../campaigns/api/change-asks-api'

/**
 * I59 Track 6 — the reads behind the database tracks' "Needs you" sources (ADR-0107 – 0113), and
 * the clocks' inputs. One query per source (ADR-0105 Consequences); each maps its rows to the
 * camel-cased shape `lib/needs-you-requests.ts` documents. Every source refreshes on the 20-second
 * clock My Work already runs, and on returning to the tab.
 *
 * The `needs_me_*` functions are SECURITY INVOKER: they narrow what the caller can already read to
 * what waits on them, and grant nothing (their migrations say so). The client decides nothing.
 */

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

const LIVE = { refetchOnWindowFocus: true, refetchInterval: 20_000 } as const

export const needsYouKeys = {
  all: [...deliverableKeys.all, 'needs-you'] as const,
  rules: () => [...needsYouKeys.all, 'rules'] as const,
  sentAt: (ids: readonly string[]) => [...needsYouKeys.all, 'sent-at', [...ids].sort().join(',')] as const,
  cameBack: (userId: string, ids: readonly string[]) => [...needsYouKeys.all, 'came-back', userId, [...ids].sort().join(',')] as const,
  source: (name: string, userId?: string | null) => [...needsYouKeys.all, name, userId ?? 'me'] as const,
}

/**
 * The escalation hours by kind (`tenant_escalation_rules`, ADR-0108 d.2) — read by everyone in the
 * tenant (its select policy), so each card says "escalates in 4 hours" with the sweep's own hours.
 */
export function useEscalationRules() {
  return useQuery({
    queryKey: needsYouKeys.rules(),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabaseUntyped.from('tenant_escalation_rules').select('kind, hours')
      if (error) throw error
      return new Map(((data ?? []) as { kind: string; hours: number }[]).map((r) => [r.kind, r.hours]))
    },
  })
}

/** When each task's CURRENT round was sent — the review clock's start, as the sweep reads it. */
export function useReviewSentAt(taskIds: readonly string[]) {
  return useQuery({
    queryKey: needsYouKeys.sentAt(taskIds),
    enabled: taskIds.length > 0,
    ...LIVE,
    queryFn: async (): Promise<Map<string, string>> => {
      const rows = await inChunks<{ sub_task_id: string; submitted_at: string | null }>(taskIds, (chunk) =>
        supabaseUntyped
          .from('task_time_entries')
          .select('sub_task_id, submitted_at')
          .in('sub_task_id', chunk)
          .not('submitted_at', 'is', null)
          .order('submitted_at', { ascending: true }),
      )
      const out = new Map<string, string>()
      // Ascending: the last one written for a task is its latest round's.
      for (const r of rows) if (r.submitted_at) out.set(r.sub_task_id, r.submitted_at)
      return out
    },
  })
}

/**
 * When each of my sent-back tasks came back: the newest `changes_requested` notification the
 * send-back wrote to me (`app.sub_task_request_changes`). My own notifications only (RLS).
 */
export function useChangesCameBackAt(userId: string | null, taskIds: readonly string[]) {
  return useQuery({
    queryKey: needsYouKeys.cameBack(userId ?? 'none', taskIds),
    enabled: !!userId && taskIds.length > 0,
    ...LIVE,
    queryFn: async (): Promise<Map<string, string>> => {
      const rows = await inChunks<{ entity_id: string; created_at: string }>(taskIds, (chunk) =>
        supabaseUntyped
          .from('notifications')
          .select('entity_id, created_at')
          .eq('user_id', userId!)
          .eq('type', 'changes_requested')
          .in('entity_id', chunk)
          .order('created_at', { ascending: true }),
      )
      const out = new Map<string, string>()
      for (const r of rows) out.set(r.entity_id, r.created_at)
      return out
    },
  })
}

interface PiecePlace {
  campaignId: string | null
  departmentId: string | null
}

/** Each deliverable's campaign and department — what Reassign / Rebalance narrow the Schedule to. */
async function placesOf(deliverableIds: readonly (string | null | undefined)[]): Promise<Map<string, PiecePlace>> {
  const ids = [...new Set(deliverableIds.filter((x): x is string => !!x))]
  if (ids.length === 0) return new Map()
  const rows = await inChunks<{
    id: string
    department_id: string | null
    streams: { campaign_id: string | null } | { campaign_id: string | null }[] | null
  }>(ids, (chunk) => supabaseUntyped.from('deliverables').select('id, department_id, streams(campaign_id)').in('id', chunk))
  return new Map(rows.map((r) => [r.id, { campaignId: one(r.streams)?.campaign_id ?? null, departmentId: r.department_id }]))
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** Open "I'm blocked" on tasks of deliverables I own (`needs_me_blocks`, ADR-0107 d.2). */
export function useNeedsMeBlocks(userId: string | null) {
  return useQuery({
    queryKey: needsYouKeys.source('blocks', userId),
    enabled: !!userId,
    ...LIVE,
    queryFn: async (): Promise<BlockRow[]> => {
      const { data, error } = await supabaseUntyped.rpc('needs_me_blocks')
      if (error) throw error
      const raw = (data ?? []) as Record<string, unknown>[]
      const places = await placesOf(raw.map((r) => str(r.deliverable_id)))
      return raw.map((r) => {
        const place = places.get(str(r.deliverable_id) ?? '')
        return {
          inputId: r.input_id as string,
          subTaskId: r.sub_task_id as string,
          taskTitle: str(r.task_title) ?? '',
          deliverableId: r.deliverable_id as string,
          deliverableName: str(r.deliverable_name),
          makerId: str(r.maker_id),
          makerName: str(r.maker_name),
          kind: str(r.kind),
          description: str(r.description) ?? '',
          awaitedFrom: str(r.awaited_from),
          requestedAt: r.requested_at as string,
          campaignId: place?.campaignId ?? null,
          departmentId: place?.departmentId ?? null,
        }
      })
    },
  })
}

/** Pending extension requests at MY step — the owner's or the account manager's (`needs_me_extensions`). */
export function useNeedsMeExtensions(userId: string | null) {
  return useQuery({
    queryKey: needsYouKeys.source('extensions', userId),
    enabled: !!userId,
    ...LIVE,
    queryFn: async (): Promise<ExtensionStepRow[]> => {
      const { data, error } = await supabaseUntyped.rpc('needs_me_extensions')
      if (error) throw error
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        requestId: r.request_id as string,
        stage: r.stage === 'owner' ? ('owner' as const) : ('am' as const),
        subTaskId: r.sub_task_id as string,
        deliverableId: r.deliverable_id as string,
        taskTitle: str(r.task_title) ?? '',
        deliverableName: str(r.deliverable_name),
        campaignId: str(r.campaign_id),
        campaignName: str(r.campaign_name),
        requestedBy: str(r.requested_by),
        requestedByName: str(r.requested_by_name),
        assigneeId: str(r.assignee_id),
        fromAt: str(r.from_at),
        toAt: str(r.to_at),
        reason: str(r.reason),
        attributedTo: str(r.attributed_to),
        ownerNote: str(r.owner_note),
        requestedAt: r.requested_at as string,
        forwardedAt: str(r.forwarded_at),
      }))
    },
  })
}

/**
 * Change requests waiting on me (`needs_me_change_requests`, ADR-0110): to answer as the owner, or
 * pushed back / declined for me as the requester. A type or a department is stored as its id; the
 * names are read so the dialog says "Static post → Reel", not two ids.
 */
export function useNeedsMeChangeRequests(userId: string | null) {
  const { i18n } = useTranslation()
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en'
  return useQuery({
    queryKey: [...needsYouKeys.source('change-requests', userId), lang],
    enabled: !!userId,
    ...LIVE,
    queryFn: async (): Promise<ChangeRequestRow[]> => {
      const { data, error } = await supabaseUntyped.rpc('needs_me_change_requests')
      if (error) throw error
      const raw = (data ?? []) as Record<string, unknown>[]
      const typeIds = new Set<string>()
      const deptIds = new Set<string>()
      for (const r of raw) {
        const c = (r.changes ?? {}) as Record<string, { from?: unknown; to?: unknown } | undefined>
        for (const v of [c.type?.from, c.type?.to]) if (typeof v === 'string') typeIds.add(v)
        for (const v of [c.department?.from, c.department?.to]) if (typeof v === 'string') deptIds.add(v)
      }
      const [types, depts] = await Promise.all([
        typeIds.size
          ? inChunks<{ id: string; name_en: string; name_ar: string | null }>([...typeIds], (chunk) =>
              supabaseUntyped.from('deliverable_types').select('id, name_en, name_ar').in('id', chunk))
          : Promise.resolve([] as { id: string; name_en: string; name_ar: string | null }[]),
        deptIds.size
          ? inChunks<{ id: string; name: string }>([...deptIds], (chunk) =>
              supabaseUntyped.from('departments').select('id, name').in('id', chunk))
          : Promise.resolve([] as { id: string; name: string }[]),
      ])
      const names = {
        // The reader's language: the type's Arabic name when there is one (read at fetch time; the
        // key carries the language so a switch reads again).
        types: new Map(types.map((x) => [x.id, lang === 'ar' && x.name_ar ? x.name_ar : x.name_en])),
        departments: new Map(depts.map((x) => [x.id, x.name])),
      }
      return raw.map((r) => ({
        id: r.id as string,
        myPart: r.my_part === 'owner' ? ('owner' as const) : ('requester' as const),
        status: str(r.status) ?? 'pending',
        deliverableId: r.deliverable_id as string,
        deliverableName: str(r.deliverable_name),
        campaignId: str(r.campaign_id),
        campaignName: str(r.campaign_name),
        requestedBy: r.requested_by as string,
        requestedByName: str(r.requested_by_name),
        changes: changeLines(r.changes, names),
        askedBy: str(r.asked_by) ?? 'us',
        cost: (r.cost && typeof r.cost === 'object' ? r.cost : {}) as Record<string, unknown>,
        declineReason: str(r.decline_reason),
        counterText: str(r.counter_text),
        counterDate: str(r.counter_date),
        answeredBy: str(r.answered_by),
        answeredByName: str(r.answered_by_name),
        createdAt: r.created_at as string,
        answeredAt: str(r.answered_at),
      }))
    },
  })
}

/**
 * Questions to me and "too much" on tasks I assigned (`needs_me_messages`, ADR-0113). A too much
 * carries the maker's week % from the `too_much` notification it sent me (`detail.week.util_pct`,
 * the server's `app.person_week_load`), and the piece's campaign / department for Rebalance.
 */
export function useNeedsMeMessages(userId: string | null) {
  return useQuery({
    queryKey: needsYouKeys.source('messages', userId),
    enabled: !!userId,
    ...LIVE,
    queryFn: async (): Promise<MessageRow[]> => {
      const { data, error } = await supabaseUntyped.rpc('needs_me_messages')
      if (error) throw error
      const raw = ((data ?? []) as Record<string, unknown>[]).filter((r) => r.kind === 'question' || r.kind === 'too_much')
      const tooMuch = raw.filter((r) => r.kind === 'too_much')
      const weeks = new Map<string, number>()
      if (tooMuch.length > 0) {
        const { data: notes, error: e } = await supabaseUntyped
          .from('notifications')
          .select('detail')
          .eq('user_id', userId!)
          .eq('type', 'too_much')
          .order('created_at', { ascending: false })
          .limit(200)
        if (e) throw e
        for (const n of (notes ?? []) as { detail: { message_id?: string; week?: { util_pct?: number } } | null }[]) {
          const id = n.detail?.message_id
          const pct = n.detail?.week?.util_pct
          if (id && typeof pct === 'number' && !weeks.has(id)) weeks.set(id, pct)
        }
      }
      const places = await placesOf(tooMuch.map((r) => str(r.deliverable_id)))
      return raw.map((r) => {
        const place = places.get(str(r.deliverable_id) ?? '')
        return {
          id: r.id as string,
          kind: r.kind as 'question' | 'too_much',
          deliverableId: str(r.deliverable_id),
          subTaskId: str(r.sub_task_id),
          label: str(r.label),
          deliverableName: str(r.deliverable_name),
          authorId: r.author_id as string,
          authorName: str(r.author_name),
          body: str(r.body),
          createdAt: r.created_at as string,
          weekPct: weeks.get(r.id as string) ?? null,
          campaignId: place?.campaignId ?? null,
          departmentId: place?.departmentId ?? null,
        }
      })
    },
  })
}

/** The people I lead booked over the tenant's percentage this week (`needs_me_overload`, ADR-0108 d.6). */
export function useNeedsMeOverload(userId: string | null) {
  return useQuery({
    queryKey: needsYouKeys.source('overload', userId),
    enabled: !!userId,
    ...LIVE,
    queryFn: async (): Promise<OverloadRow[]> => {
      const { data, error } = await supabaseUntyped.rpc('needs_me_overload')
      if (error) throw error
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        resourceId: r.resource_id as string,
        userId: str(r.user_id),
        name: str(r.name) ?? '—',
        teamId: str(r.team_id),
        departmentId: str(r.department_id),
        weekStart: r.week_start as string,
        bookedHours: Number(r.booked_hours ?? 0),
        nominalHours: Number(r.nominal_hours ?? 0),
        utilPct: Number(r.util_pct ?? 0),
        overCapacityPct: Number(r.over_capacity_pct ?? 110),
      }))
    },
  })
}

/** Escalations addressed to me whose stall is still there (`needs_me_escalations`, ADR-0108 d.3). */
export function useNeedsMeEscalations(userId: string | null) {
  return useQuery({
    queryKey: needsYouKeys.source('escalations', userId),
    enabled: !!userId,
    ...LIVE,
    queryFn: async (): Promise<EscalationRow[]> => {
      const { data, error } = await supabaseUntyped.rpc('needs_me_escalations')
      if (error) throw error
      const raw = (data ?? []) as Record<string, unknown>[]
      // "Open" on an unassigned piece goes to the Schedule narrowed to it (plan View 3).
      const places = await placesOf(
        raw.filter((r) => r.kind === 'unassigned' && r.entity_type === 'deliverable').map((r) => str(r.entity_id)),
      )
      return raw.map((r) => {
        const place = places.get(str(r.entity_id) ?? '')
        return {
          notificationId: r.notification_id as string,
          kind: str(r.kind),
          entityType: str(r.entity_type),
          entityId: str(r.entity_id),
          label: str(r.label),
          contextLabel: str(r.context_label),
          detail: (r.detail && typeof r.detail === 'object' ? r.detail : {}) as Record<string, unknown>,
          escalatedAt: r.escalated_at as string,
          campaignId: place?.campaignId ?? null,
          departmentId: place?.departmentId ?? null,
        }
      })
    },
  })
}

/**
 * Every source above, read together for the panel — one call site, so the panel's tests mock one
 * module. Each result is the query's own (`data`, `isError`, `error`).
 */
export function useNeedsYouSources(userId: string | null, reviewTaskIds: readonly string[], sentBackTaskIds: readonly string[]) {
  return {
    rules: useEscalationRules(),
    sentAt: useReviewSentAt(reviewTaskIds),
    cameBack: useChangesCameBackAt(userId, sentBackTaskIds),
    blocks: useNeedsMeBlocks(userId),
    extensions: useNeedsMeExtensions(userId),
    changes: useNeedsMeChangeRequests(userId),
    messages: useNeedsMeMessages(userId),
    overload: useNeedsMeOverload(userId),
    escalations: useNeedsMeEscalations(userId),
    client: useClientWaiting(userId),
    scope: useScopeUnacknowledged(userId),
    changeAsks: useChangeAsksForMe(userId),
  }
}

type AmRef = { account_manager_id: string | null }
interface InputRaw {
  id: string
  deliverable_id: string
  sub_task_id: string | null
  kind: string | null
  description: string
  awaited_from: string | null
  requested_at: string
  deliverables: {
    name: string
    streams: unknown
  } | null
}
interface CampaignRef {
  name: string
  account_manager_id: string | null
  clients: AmRef | AmRef[] | null
}

/**
 * Work waiting on the client on the campaigns I manage (Q16): each outstanding input that is the
 * client's (`isClientInput`), on a campaign whose account manager is me — the campaign's own, else
 * its client's (`app.deliverable_account_manager`'s rule).
 */
export function useClientWaiting(userId: string | null) {
  return useQuery({
    queryKey: needsYouKeys.source('client-waiting', userId),
    enabled: !!userId,
    ...LIVE,
    queryFn: async (): Promise<ClientWaitRow[]> => {
      // Every page (I59.35): this is every open input in the tenant, narrowed to mine below.
      const data = await allRows<InputRaw>((a, b) =>
        supabaseUntyped
          .from('deliverable_pending_inputs')
          .select(
            'id, deliverable_id, sub_task_id, kind, description, awaited_from, requested_at, ' +
              'deliverables(name, streams(campaign_id, campaigns(name, account_manager_id, clients(account_manager_id))))',
          )
          .is('satisfied_at', null)
          .order('requested_at', { ascending: true })
          .order('id', { ascending: true })
          .range(a, b))
      const out: ClientWaitRow[] = []
      for (const r of data) {
        if (!isClientInput({ kind: r.kind, subTaskId: r.sub_task_id })) continue
        const stream = one(r.deliverables?.streams as { campaign_id: string | null; campaigns: unknown } | null)
        const campaign = one(stream?.campaigns as CampaignRef | CampaignRef[] | null)
        const am = campaign?.account_manager_id ?? one(campaign?.clients ?? null)?.account_manager_id ?? null
        if (am !== userId) continue
        out.push({
          inputId: r.id,
          deliverableId: r.deliverable_id,
          deliverableName: r.deliverables?.name ?? null,
          campaignId: stream?.campaign_id ?? null,
          campaignName: campaign?.name ?? null,
          description: r.description,
          awaitedFrom: r.awaited_from,
          requestedAt: r.requested_at,
        })
      }
      return out
    },
  })
}

/**
 * My single jobs released as reduced scope (SJ-v3-S2: `brief.request.reducedScope`) with no
 * acknowledgement recorded (`scope_acknowledgements`, one per job) — Q33. The job's piece gives the
 * due date and the type's lead time the acknowledgement records as needs / has days.
 */
export function useScopeUnacknowledged(userId: string | null) {
  return useQuery({
    queryKey: needsYouKeys.source('scope', userId),
    enabled: !!userId,
    ...LIVE,
    queryFn: async (): Promise<ScopeRow[]> => {
      // Every page (I59.35): approved single jobs stay approved, so this tenant-wide set only grows.
      const data = await allRows<{ id: string; name: string; created_at: string; account_manager_id: string | null; clients: AmRef | AmRef[] | null }>((a, b) =>
        supabaseUntyped
          .from('campaigns')
          .select('id, name, status, created_at, account_manager_id, clients(account_manager_id)')
          .eq('kind', 'single_job')
          .in('status', ['pending_approval', 'approved'])
          .filter('brief->request->>reducedScope', 'eq', 'true')
          .order('id')
          .range(a, b))
      const mine = data
        .filter((c) => (c.account_manager_id ?? one(c.clients)?.account_manager_id ?? null) === userId)
      if (mine.length === 0) return []
      const acks = await inChunks<{ campaign_id: string }>(mine.map((c) => c.id), (chunk) =>
        supabaseUntyped.from('scope_acknowledgements').select('campaign_id').in('campaign_id', chunk))
      const done = new Set(acks.map((a) => a.campaign_id))
      const open = mine.filter((c) => !done.has(c.id))
      if (open.length === 0) return []
      type TypeRef = { lead_time_hours: number | null }
      const streams = await inChunks<{
        campaign_id: string
        deliverables: { due_at: string | null; deliverable_types: TypeRef | TypeRef[] | null }[] | null
      }>(open.map((c) => c.id), (chunk) =>
        supabaseUntyped.from('streams').select('campaign_id, deliverables(due_at, deliverable_types(lead_time_hours))').in('campaign_id', chunk))
      const piece = new Map<string, { dueAt: string | null; lead: number | null }>()
      for (const s of streams) {
        const d = (s.deliverables ?? [])[0]
        if (d && !piece.has(s.campaign_id)) piece.set(s.campaign_id, { dueAt: d.due_at, lead: one(d.deliverable_types)?.lead_time_hours ?? null })
      }
      return open.map((c) => ({
        campaignId: c.id,
        name: c.name,
        createdAt: c.created_at,
        dueAt: piece.get(c.id)?.dueAt ?? null,
        leadTimeHours: piece.get(c.id)?.lead ?? null,
      }))
    },
  })
}

/**
 * ADR-0141 d.4: the changes asked through the one form that wait on me — the piece's account manager (the campaign's,
 * else its client's, `app.deliverable_account_manager`'s rule). Escalated asks reach the account director as an
 * `escalated` notification (its own source), which opens the piece where she answers. The server decides who may
 * answer; this only chooses whose list a waiting ask appears in.
 */
export function useChangeAsksForMe(userId: string | null) {
  return useQuery({
    queryKey: needsYouKeys.source('change-asks', userId),
    enabled: !!userId,
    ...LIVE,
    queryFn: async (): Promise<ChangeAskNeedRow[]> => {
      const { data, error } = await supabaseUntyped
        .from('deliverable_change_asks')
        // Written out (not ASK_COLUMNS) so src/test/postgrest-selects.test.ts can read it against the schema.
        .select('id, deliverable_id, asked_by, kinds, requested_due_day, requested_hours, reason, from_sub_task_id, status, answered_by, answered_at, answer_note, applied_due_day, applied_hours, escalated_at, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(500)
      if (error) throw error
      const raw = (data ?? []) as unknown as AskRaw[]
      if (raw.length === 0) return []
      const pieces = await inChunks<{ id: string; name: string; streams: unknown }>([...new Set(raw.map((r) => r.deliverable_id))], (chunk) =>
        supabaseUntyped
          .from('deliverables')
          .select('id, name, streams(campaign_id, campaigns(name, account_manager_id, clients(account_manager_id)))')
          .in('id', chunk))
      const place = new Map<string, { name: string; campaignId: string | null; campaignName: string | null; am: string | null }>()
      for (const p of pieces) {
        const stream = one(p.streams as { campaign_id: string | null; campaigns: unknown } | null)
        const campaign = one(stream?.campaigns as CampaignRef | CampaignRef[] | null)
        place.set(p.id, {
          name: p.name,
          campaignId: stream?.campaign_id ?? null,
          campaignName: campaign?.name ?? null,
          am: campaign?.account_manager_id ?? one(campaign?.clients ?? null)?.account_manager_id ?? null,
        })
      }
      const mine = raw.filter((r) => place.get(r.deliverable_id)?.am === userId)
      const named = await withAskNames(mine)
      return named.map((r) => {
        const p = place.get(r.deliverableId)
        return { ...r, deliverableName: p?.name ?? null, campaignId: p?.campaignId ?? null, campaignName: p?.campaignName ?? null }
      })
    },
  })
}
