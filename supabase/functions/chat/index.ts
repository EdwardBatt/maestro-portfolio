// chat — contextual chat for the internal delivery loop (ADR-0015 / ADR-0027 / ADR-0062, I4, I31).
//
// Five ops, all caller-authenticated:
//   open           — authorize the caller, get-or-create the ONE conversation for that context,
//                    join them, return { conversationId }. Clients read messages via RLS.
//   send           — verify membership, idempotent-insert the message (client-generated id; seq via
//                    trigger), then best-effort broadcast. Persist-first: the row is durable before
//                    the broadcast, and a missed broadcast is recovered by the client's seq
//                    catch-up (realtime is a lossy hint).
//   members        — who is in this conversation and WHY (ADR-0063 d.8).
//   add_member     — invite somebody by name (ADR-0062 d.6).
//   remove_member  — withdraw an invitation.
//
// AUTHORIZATION MOVED OUT (I31, ADR-0062). This function used to decide entitlement itself, in
// `resolveCampaign` + `onCampaignTeam`. That pair admitted four kinds of person — two manage
// grants, the account manager, and an assignee — and had NO NOTION OF A REVIEWER at all, so the one
// surface where two people must talk was the one it refused. It also walked only `streams` while
// its own campaign resolver followed `job_id` too, and 404d all ad-hoc work. It is now one call to
// `app.can_read_conversation` through `_shared/context-members.ts`; see that module for why the
// decision has to live in Postgres.
//
// Writes run as service role (clients have READ-only RLS on chat tables); authorization is the
// caller-scoped client throughout — a service-role client has no `auth.uid()` and would resolve
// every grant to false (ADR-0037, and the exact bug `20260824120000` fixed once already).
//
// Deploy: `supabase functions deploy chat`
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { z } from 'npm:zod@4'
import { guarded } from '../_shared/http.ts'
import {
  CONTEXTS,
  canManageMembers,
  canReadConversation,
  conversationPeople,
  type Context,
} from '../_shared/context-members.ts'

type ErrorBody = { error: { code: string; message: string } }
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...corsHeaders } })
const err = (status: number, code: string, message: string) =>
  json(status, { error: { code, message } } satisfies ErrorBody)

// AGENTS.md §5: validated at the boundary, not read off an untyped bag. This function was one of
// the five named in STATE.md as parsing input without Zod; rewriting it was the moment to fix that.
const ContextRef = z.object({
  contextType: z.enum(CONTEXTS),
  contextId: z.string().uuid(),
})
const Body = z.discriminatedUnion('op', [
  ContextRef.extend({ op: z.literal('open') }),
  z.object({
    op: z.literal('send'),
    conversationId: z.string().uuid(),
    id: z.string().uuid(), // client-generated idempotency key
    body: z.string().min(1).max(8000),
  }),
  ContextRef.extend({ op: z.literal('members') }),
  ContextRef.extend({ op: z.literal('add_member'), userId: z.string().uuid() }),
  ContextRef.extend({ op: z.literal('remove_member'), userId: z.string().uuid() }),
])

Deno.serve(guarded(corsHeaders, async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return err(405, 'method_not_allowed', 'POST only')

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // 1. Authenticate the caller.
  const authHeader = req.headers.get('authorization') ?? ''
  const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: callerData, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerData.user) return err(401, 'unauthenticated', 'Sign in required')
  const uid = callerData.user.id
  const meta = (callerData.user.app_metadata ?? {}) as Record<string, unknown>
  const tenant = typeof meta.tenant_id === 'string' ? meta.tenant_id : null
  const roleId = typeof meta.app_role_id === 'string' ? meta.app_role_id : null
  if (!tenant || !roleId) return err(403, 'forbidden', 'No tenant/role claim')

  let raw: unknown
  try { raw = await req.json() } catch { return err(400, 'bad_request', 'Invalid JSON body') }
  const parsed = Body.safeParse(raw)
  if (!parsed.success) return err(400, 'bad_request', parsed.error.issues[0]?.message ?? 'Invalid body')
  const body = parsed.data

  const admin = createClient(url, serviceKey)

  /**
   * Entitlement, and the two refusals told apart.
   *
   * ADR-0062 d.1: **404 only when the anchor resolves to nobody at all** — a deleted item, or
   * another tenant's. Never merely for having no campaign, which is the normal condition of ad-hoc
   * work and used to be a flat refusal. ADR-0062 d.8: the caller is told WHICH it was, because one
   * string for four causes is what made this look random for four days.
   */
  async function authorize(contextType: Context, contextId: string): Promise<Response | null> {
    if (await canReadConversation(callerClient, contextType, contextId)) return null
    const people = await conversationPeople(callerClient, contextType, contextId)
    // `conversation_people` refuses to enumerate a conversation the caller cannot read, so an empty
    // list here is ambiguous on its own; ask the database directly whether the anchor exists.
    //
    // Three literal `.from()` calls rather than one computed table name. `src/test/postgrest-
    // selects.test.ts` reads every query statically and checks it against the generated schema, and
    // a table name it cannot read is a query it cannot check — so it is written the way the checker
    // can see it. A `review` anchor is its deliverable (ADR-0027 §1), hence the shared branch.
    const exists = async (): Promise<boolean> => {
      if (contextType === 'campaign') {
        const { count } = await admin.from('campaigns')
          .select('id', { count: 'exact', head: true }).eq('id', contextId).eq('tenant_id', tenant)
        return !!count
      }
      if (contextType === 'sub_task') {
        const { count } = await admin.from('sub_tasks')
          .select('id', { count: 'exact', head: true }).eq('id', contextId).eq('tenant_id', tenant)
        return !!count
      }
      const { count } = await admin.from('deliverables')
        .select('id', { count: 'exact', head: true }).eq('id', contextId).eq('tenant_id', tenant)
      return !!count
    }
    if (!(await exists())) return err(404, 'not_found', 'That item no longer exists')
    if (people.length === 0) return err(404, 'no_people', 'Nobody is on this work yet')
    return err(403, 'forbidden', 'You are not on this work')
  }

  // ------------------------------------------------------------------ open ----
  if (body.op === 'open') {
    const refusal = await authorize(body.contextType, body.contextId)
    if (refusal) return refusal

    // get-or-create the one conversation for this context (race-safe via the unique index)
    let conversationId: string | null = null
    const { data: existing } = await admin.from('conversations').select('id')
      .eq('tenant_id', tenant).eq('context_type', body.contextType).eq('context_id', body.contextId).maybeSingle()
    conversationId = (existing as { id: string } | null)?.id ?? null
    if (!conversationId) {
      const { data: created, error: cErr } = await admin.from('conversations')
        .insert({ tenant_id: tenant, kind: 'group', context_type: body.contextType, context_id: body.contextId, created_by: uid })
        .select('id').single()
      if (cErr) {
        // lost the race — someone created it; fetch it
        const { data: again } = await admin.from('conversations').select('id')
          .eq('tenant_id', tenant).eq('context_type', body.contextType).eq('context_id', body.contextId).maybeSingle()
        conversationId = (again as { id: string } | null)?.id ?? null
        if (!conversationId) return err(500, 'create_failed', cErr.message)
      } else {
        conversationId = (created as { id: string }).id
      }
    }
    // Join the caller (idempotent). `added_by` stays NULL: this is a JOIN RECORD for realtime topic
    // authorization and the read cursor, and confers no entitlement of its own (ADR-0062 d.5).
    // Entitlement is recomputed on every open, because it legitimately changes — a reassignment, a
    // reviewer appointed or removed.
    await admin.from('conversation_members')
      .upsert({ conversation_id: conversationId, tenant_id: tenant, user_id: uid }, { onConflict: 'conversation_id,user_id', ignoreDuplicates: true })
    return json(200, { conversationId })
  }

  // ------------------------------------------------------------------ members ----
  if (body.op === 'members') {
    const refusal = await authorize(body.contextType, body.contextId)
    if (refusal) return refusal
    const people = await conversationPeople(callerClient, body.contextType, body.contextId)
    const canManage = await canManageMembers(callerClient, body.contextType, body.contextId)
    return json(200, { people, canManage })
  }

  // ------------------------------------------------------------------ add / remove ----
  if (body.op === 'add_member' || body.op === 'remove_member') {
    // ADR-0062 d.6: participants, leads in scope and management may invite. Someone who was
    // themselves invited may not, so an invitation never fans out beyond the accountable.
    if (!(await canManageMembers(callerClient, body.contextType, body.contextId)))
      return err(403, 'forbidden', 'Only people on this work can change who is in it')

    // The target must be a real, active, in-tenant, NON-PORTAL user. Chat is internal (ADR-0062 d.9)
    // and the portal fence is absolute — checked here as well as in the entitlement function,
    // because this is the one path that writes a row granting access.
    const { data: target } = await admin
      .from('user_profiles')
      .select('id, is_active, roles!inner(key)')
      .eq('id', body.userId).eq('tenant_id', tenant).maybeSingle()
    const targetRow = target as { id: string; is_active: boolean; roles: { key: string } } | null
    if (!targetRow) return err(404, 'not_found', 'No such person in this organization')
    if (!targetRow.is_active) return err(400, 'inactive', 'That person is deactivated')
    if (targetRow.roles?.key === 'client_portal') return err(403, 'forbidden', 'Chat is internal only')

    const { data: conv } = await admin.from('conversations').select('id')
      .eq('tenant_id', tenant).eq('context_type', body.contextType).eq('context_id', body.contextId).maybeSingle()
    const conversationId = (conv as { id: string } | null)?.id ?? null
    if (!conversationId) return err(409, 'no_conversation', 'Open the conversation before adding anyone')

    if (body.op === 'remove_member') {
      // Withdraws the INVITATION only. Somebody entitled by the work itself keeps their access, and
      // the surface says so rather than appearing to succeed — otherwise this reads as a way to
      // shut a reviewer out of their own review (ADR-0062 d.6).
      await admin.from('conversation_members').delete()
        .eq('conversation_id', conversationId).eq('user_id', body.userId).not('added_by', 'is', null)
      const stillIn = (await conversationPeople(callerClient, body.contextType, body.contextId))
        .some((p) => p.userId === body.userId)
      return json(200, { removed: true, stillEntitled: stillIn })
    }

    // `added_by` is SERVER-STAMPED — it is the record of who took the decision, following
    // `user_grants.granted_by` (L6.1), and a client may never set it.
    const { error: aErr } = await admin.from('conversation_members').upsert(
      { conversation_id: conversationId, tenant_id: tenant, user_id: body.userId, added_by: uid },
      { onConflict: 'conversation_id,user_id' },
    )
    if (aErr) return err(500, 'add_failed', aErr.message)

    // I30/I31.7: being pulled into a discussion is an action on the work, so it reaches the person
    // by EMAIL and not only in-app. The row is the trigger's cue (ADR-0028's slow lane).
    //
    // Two things the notification needs that the context does not give directly:
    //   * `entity_type` has its own CHECK — deliverable / sub_task / campaign / booking — and
    //     'review' is NOT in it. A review thread is anchored to its deliverable and `contextId` is
    //     already that deliverable's id, so it files as one. Passing 'review' would fail the insert
    //     and lose the notification silently, which is the whole family of bug I31 exists to end.
    //   * a NULL label emails "You were added to the discussion: an item". Nobody recognises a
    //     thread by name — the label has to be the WORK, so it is read off the anchor here.
    const entityType = body.contextType === 'review' ? 'deliverable' : body.contextType
    let label: string | null = null
    if (entityType === 'campaign') {
      const { data } = await admin.from('campaigns').select('name').eq('id', body.contextId).maybeSingle()
      label = (data as { name: string } | null)?.name ?? null
    } else if (entityType === 'sub_task') {
      const { data } = await admin.from('sub_tasks').select('title').eq('id', body.contextId).maybeSingle()
      label = (data as { title: string } | null)?.title ?? null
    } else {
      const { data } = await admin.from('deliverables').select('name').eq('id', body.contextId).maybeSingle()
      label = (data as { name: string } | null)?.name ?? null
    }

    await admin.from('notifications').insert({
      tenant_id: tenant,
      user_id: body.userId,
      type: 'chat_added',
      label,
      entity_type: entityType,
      entity_id: body.contextId,
      actor_id: uid,
    })
    return json(200, { added: true })
  }

  // ------------------------------------------------------------------ send ----
  {
    const { conversationId, id } = body
    const text = body.body.trim()
    if (!text) return err(400, 'empty', 'Message body required')

    // must be a member (and it pins the tenant)
    const { data: mem } = await admin.from('conversation_members').select('conversation_id')
      .eq('conversation_id', conversationId).eq('user_id', uid).eq('tenant_id', tenant).maybeSingle()
    if (!mem) return err(403, 'forbidden', 'Not a member of this conversation')

    // idempotent insert (client id is the primary key); seq assigned by trigger
    const { data: inserted, error: iErr } = await admin.from('messages')
      .insert({ id, tenant_id: tenant, conversation_id: conversationId, sender_id: uid, body: text })
      .select('id, seq, created_at').maybeSingle()
    let row = inserted as { id: string; seq: number; created_at: string } | null
    if (iErr) {
      // conflict on the client id → a prior retry already persisted it; return the existing row
      const { data: dup } = await admin.from('messages').select('id, seq, created_at').eq('id', id).maybeSingle()
      row = dup as typeof row
      if (!row) return err(500, 'send_failed', iErr.message)
    }

    // best-effort broadcast — realtime is a lossy hint; a miss is recovered by seq catch-up
    try {
      await fetch(`${url}/realtime/v1/api/broadcast`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          messages: [{
            topic: `tenant:${tenant}:conv:${conversationId}`,
            event: 'message',
            private: true,
            payload: { id: row!.id, seq: row!.seq, sender_id: uid, body: text, created_at: row!.created_at },
          }],
        }),
      })
    } catch { /* ignore — client reconciles by seq */ }

    return json(200, { id: row!.id, seq: row!.seq, createdAt: row!.created_at })
  }
}))
