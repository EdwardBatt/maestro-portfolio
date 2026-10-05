import { useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, supabaseUntyped } from '../../../lib/supabase'
import { PAGE_ROWS, allRows, restPages } from '../../../lib/query/all-pages'
import { useAuth } from '../../../app/auth-context'
import { mergeMessages, type ChatMessage } from '../lib/merge-messages'

/**
 * Contextual chat API (ADR-0015/0027, I4). open() get-or-creates the context conversation and
 * joins the caller (chat Edge Function); messages are read under membership RLS and ordered by
 * `seq`; send() is optimistic + idempotent (client id, retry-safe); a live Broadcast subscription
 * merges incoming messages and, on (re)subscribe, triggers a catch-up refetch. Persist-first:
 * the DB is the truth, realtime is a lossy hint.
 */

export type ChatContext = 'campaign' | 'deliverable' | 'sub_task' | 'review'

export const chatKeys = {
  all: ['chat'] as const,
  conversation: (t: string, id: string) => [...chatKeys.all, 'conversation', t, id] as const,
  messages: (conversationId: string) => [...chatKeys.all, 'messages', conversationId] as const,
}

async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    const ctx = (error as { context?: Response }).context
    if (ctx) {
      const payload = await ctx.json().catch(() => null)
      throw Object.assign(new Error(payload?.error?.message ?? error.message), { code: payload?.error?.code })
    }
    throw error
  }
  return data as T
}

/** Get-or-create (and join) the conversation for a context. Returns its id. */
export function useConversation(contextType: ChatContext, contextId: string | null) {
  return useQuery({
    queryKey: chatKeys.conversation(contextType, contextId ?? 'none'),
    enabled: !!contextId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string> => {
      const { conversationId } = await invokeFn<{ conversationId: string }>('chat', {
        op: 'open', contextType, contextId,
      })
      return conversationId
    },
  })
}

/** Messages in a conversation, ordered by seq, with sender names (membership-gated read). */
export function useMessages(conversationId: string | null) {
  return useQuery({
    queryKey: chatKeys.messages(conversationId ?? 'none'),
    enabled: !!conversationId,
    queryFn: async (): Promise<ChatMessage[]> => {
      // Every page (I59.35): oldest first, so a thread past 1,000 messages lost its NEWEST ones.
      const raw = await allRows((a, b) =>
        supabaseUntyped
          .from('messages')
          .select('id, seq, sender_id, body, created_at, sender:user_profiles(display_name)')
          .eq('conversation_id', conversationId!)
          .order('seq', { ascending: true })
          .order('id', { ascending: true })
          .range(a, b))
      const rows = raw as unknown as {
        id: string; seq: number; sender_id: string; body: string; created_at: string
        sender: { display_name: string } | { display_name: string }[] | null
      }[]
      return rows.map((r) => ({
        id: r.id,
        seq: r.seq,
        senderId: r.sender_id,
        senderName: (Array.isArray(r.sender) ? r.sender[0] : r.sender)?.display_name ?? null,
        body: r.body,
        createdAt: r.created_at,
        status: 'sent' as const,
      }))
    },
  })
}

/** Send a message: optimistic render → idempotent Edge Function insert → confirm (or mark failed). */
export function useSendMessage(conversationId: string) {
  const { session } = useAuth()
  const qc = useQueryClient()
  const key = chatKeys.messages(conversationId)
  return useMutation({
    mutationFn: async (args: { id: string; body: string }) => {
      return invokeFn<{ id: string; seq: number; createdAt: string }>('chat', {
        op: 'send', conversationId, id: args.id, body: args.body,
      })
    },
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: key })
      const optimistic: ChatMessage = {
        id: args.id, seq: null, senderId: session?.user.id ?? 'me', senderName: null,
        body: args.body, createdAt: new Date().toISOString(), status: 'pending',
      }
      qc.setQueryData<ChatMessage[]>(key, (old) => mergeMessages(old ?? [], [optimistic]))
    },
    onSuccess: (res) => {
      qc.setQueryData<ChatMessage[]>(key, (old) => {
        const list = old ?? []
        const prev = list.find((o) => o.id === res.id)
        const confirmed: ChatMessage = {
          id: res.id,
          seq: res.seq,
          senderId: prev?.senderId ?? session?.user.id ?? 'me',
          senderName: prev?.senderName ?? null,
          body: prev?.body ?? '',
          createdAt: res.createdAt,
          status: 'sent',
        }
        return mergeMessages(list, [confirmed])
      })
    },
    onError: (_e, args) => {
      qc.setQueryData<ChatMessage[]>(key, (old) =>
        (old ?? []).map((m) => (m.id === args.id ? { ...m, status: 'failed' as const } : m)),
      )
    },
  })
}

/** Advance the caller's read cursor (RLS self-update on conversation_members). */
export function useMarkRead(conversationId: string) {
  return useMutation({
    mutationFn: async (lastReadSeq: number) => {
      const { error } = await supabaseUntyped
        .from('conversation_members')
        .update({ last_read_seq: lastReadSeq })
        .eq('conversation_id', conversationId)
      if (error) throw error
    },
  })
}

/** Live Broadcast subscription: merge incoming messages; refetch (catch-up) on (re)subscribe. */
export function useConversationChannel(conversationId: string | null) {
  const { claims } = useAuth()
  const qc = useQueryClient()
  useEffect(() => {
    if (!conversationId || !claims.tenantId) return
    const key = chatKeys.messages(conversationId)
    const topic = `tenant:${claims.tenantId}:conv:${conversationId}`
    // ensure the socket carries the current access token for private-channel auth
    supabase.realtime.setAuth()
    const channel = supabase
      .channel(topic, { config: { private: true, broadcast: { self: false } } })
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        const p = payload as { id: string; seq: number; sender_id: string; body: string; created_at: string }
        qc.setQueryData<ChatMessage[]>(key, (old) =>
          mergeMessages(old ?? [], [{
            id: p.id, seq: p.seq, senderId: p.sender_id,
            senderName: (old ?? []).find((o) => o.senderId === p.sender_id)?.senderName ?? null,
            body: p.body, createdAt: p.created_at, status: 'sent',
          }]),
        )
      })
      .subscribe((status) => {
        // reconnect / first join → reconcile from the DB (the ultimate backstop)
        if (status === 'SUBSCRIBED') void qc.invalidateQueries({ queryKey: key })
      })
    return () => { void supabase.removeChannel(channel) }
  }, [conversationId, claims.tenantId, qc])
}

// ---------------------------------------------------------------- members (I31.4) ----

/** Why somebody is in a conversation. Rendered beside their name (ADR-0063 d.8): "who is here" is
 *  far less useful than "why is the CFO here". */
export type MemberReason =
  | 'assignee' | 'reviewer' | 'creator' | 'owner' | 'account_manager' | 'invited'

export interface ConversationPerson {
  userId: string
  displayName: string | null
  reason: MemberReason
  /**
   * What the reason is ABOUT: the task for an assignee/reviewer/assigner, the deliverable for an
   * owner, the campaign for an account manager, the inviter for somebody added by name.
   *
   * A bare label was ambiguous exactly where the list matters most — a campaign room spans every
   * deliverable beneath it, so "owner" and "assigner" appear over and over with nothing saying
   * which work each is about (Edward, 31 Aug).
   *
   * **Optional at runtime even though the current function always sends it.** The `chat` Edge
   * Function deploys separately from this bundle, so a browser can legitimately hold new client
   * code and talk to an older function. Readers must cope with it being absent.
   */
  subjects?: string[]
  /** How many rows the reason covers. NOT `subjects.length` — that array is deduplicated and capped
   *  at three, and counting it reported "17 tasks" for 26 (Edward, 31 Aug). */
  total?: number
}

/**
 * Who is in this conversation, and whether the caller may change that.
 *
 * Computed from the same function the gate uses (`app.conversation_participants`), never from a
 * stored roster — ADR-0063 d.8: if the list and the gate disagree, the list is wrong, and there is
 * only one source for them to disagree about.
 */
export function useConversationPeople(contextType: ChatContext, contextId: string | null) {
  return useQuery({
    queryKey: [...chatKeys.all, 'people', contextType, contextId ?? 'none'] as const,
    enabled: !!contextId,
    queryFn: async (): Promise<{ people: ConversationPerson[]; canManage: boolean }> =>
      invokeFn('chat', { op: 'members', contextType, contextId }),
  })
}

/** Anyone who could be invited: active, in-tenant, and not the client portal (chat is internal). */
export function useAddablePeople() {
  return useQuery({
    queryKey: [...chatKeys.all, 'addable'] as const,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ id: string; displayName: string }[]> => {
      const { data, error } = await supabaseUntyped
        .from('user_profiles')
        .select('id, display_name, roles!inner(key)')
        .eq('is_active', true)
        .neq('roles.key', 'client_portal')
        .order('display_name')
      if (error) throw error
      return ((data ?? []) as unknown as { id: string; display_name: string }[])
        .map((r) => ({ id: r.id, displayName: r.display_name }))
    },
  })
}

/** Invite somebody by name (ADR-0062 d.6). Server-stamps `added_by`, and tells them by email. */
export function useAddMember(contextType: ChatContext, contextId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) =>
      invokeFn<{ added: true }>('chat', { op: 'add_member', contextType, contextId, userId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...chatKeys.all, 'people', contextType, contextId ?? 'none'] })
    },
  })
}

/**
 * Withdraw an invitation.
 *
 * Returns `stillEntitled` when the person stays anyway because the WORK puts them there — a
 * reviewer, the assignee. The surface must say so rather than appear to succeed, or this reads as a
 * way to shut a reviewer out of their own review (ADR-0062 d.6).
 */
export function useRemoveMember(contextType: ChatContext, contextId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) =>
      invokeFn<{ removed: true; stillEntitled: boolean }>('chat', {
        op: 'remove_member', contextType, contextId, userId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...chatKeys.all, 'people', contextType, contextId ?? 'none'] })
    },
  })
}

// ---------------------------------------------------------------- the rail (I32) ----

export interface RailRow {
  contextType: ChatContext
  contextId: string
  title: string
  campaignId: string | null
  campaignName: string | null
  conversationId: string | null
  lastMessageAt: string | null
  unread: number
  /** Archived work keeps its conversation; the rail groups it separately and off by default. */
  isArchived: boolean
}

/**
 * Every conversation the caller can reach (ADR-0063 d.2).
 *
 * **Entitled WORK, not existing conversations.** Rooms are created lazily, so listing
 * `conversations` would show a handful of rows and no campaigns, and read as a broken screen. Each
 * row here is an anchor the caller may open, whether or not a thread exists on it yet — the thread
 * materialises on first open, exactly as the in-context panel already does.
 */
type RailRaw = {
  context_type: ChatContext; context_id: string; title: string
  campaign_id: string | null; campaign_name: string | null
  conversation_id: string | null; last_message_at: string | null; unread: number
  is_archived: boolean
}
const toRailRow = (r: RailRaw): RailRow => ({
  contextType: r.context_type,
  contextId: r.context_id,
  title: r.title,
  campaignId: r.campaign_id,
  campaignName: r.campaign_name,
  conversationId: r.conversation_id,
  lastMessageAt: r.last_message_at,
  unread: r.unread ?? 0,
  isArchived: r.is_archived ?? false,
})
/** One page of the rail, in a stable order so the pages neither overlap nor skip. */
const railPage = (from: number, to: number, withCount = false) =>
  supabaseUntyped
    .rpc('my_conversations', {}, withCount ? { count: 'exact' } : undefined)
    .order('context_type')
    .order('context_id')
    .range(from, to)

export function useMyConversations() {
  // EVERY row, not PostgREST's first 1000 (lib/query/all-pages.ts): a lead reaches thousands of
  // pieces, and the one cut off was the newest — its thread missing from the rail and from the search
  // (25 Sep, 2,154 rows). The first page carries the exact count and shows at once; the rest are asked
  // for together and join it, so a big rail costs one more round trip, not one per thousand.
  const first = useQuery({
    queryKey: [...chatKeys.all, 'rail'] as const,
    staleTime: 30_000,
    queryFn: async (): Promise<{ rows: RailRow[]; total: number }> => {
      const { data, error, count } = await railPage(0, PAGE_ROWS - 1, true)
      if (error) throw error
      const rows = ((data ?? []) as RailRaw[]).map(toRailRow)
      return { rows, total: count ?? rows.length }
    },
  })
  const total = first.data?.total ?? 0
  const rest = useQuery({
    queryKey: [...chatKeys.all, 'rail', 'rest', total] as const,
    staleTime: 30_000,
    enabled: total > PAGE_ROWS,
    queryFn: async (): Promise<RailRow[]> => (await restPages<RailRaw>(total, (a, b) => railPage(a, b))).map(toRailRow),
  })
  const data = useMemo(
    () => (first.data ? [...first.data.rows, ...(rest.data ?? [])] : undefined),
    [first.data, rest.data],
  )
  return { data, isLoading: first.isLoading, isError: first.isError || rest.isError }
}
