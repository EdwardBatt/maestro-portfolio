// contextMembers — who is entitled to a conversation (ADR-0062 d.1).
//
// This replaces `resolveCampaign` + `onCampaignTeam`, which lived inside `chat/index.ts` and decided
// entitlement themselves. That pair admitted four kinds of person and had NO NOTION OF A REVIEWER:
// grep the old function for `sub_task_reviewers` and there was no match, so the one surface where
// two people must talk was the one it refused. On the live tenant it admitted 16 of 27 users and
// refused 11 — the CEO, the CCO and every Team Member.
//
// **The decision is not made here.** It is made once, in Postgres, by `app.can_read_conversation`
// (migration `20260831120100`), and this module walks through the PostgREST doorway to reach it —
// the same shape `_shared/authz.ts` uses for `public.has_permission` (ADR-0037: one primitive, one
// call path). Two reasons it has to be that way round: ADR-0062 d.3 requires `app.in_write_scope`,
// which is not exposed over PostgREST and so cannot be evaluated out here at all; and a rule this
// consequential needs pgTAP to prove it, which means it must live where pgTAP can reach it.
//
// AGENTS.md §2: no Edge Function may decide authorization by querying `role_grants`/`user_grants`.
// The same reasoning applies to deciding it by querying `sub_tasks` and `sub_task_reviewers` — a
// second copy of the rule is how the first one drifted six defects deep.

/** Structural, so this module depends on neither import specifier the functions use. */
interface RpcCapable {
  rpc(fn: string, params: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>
}

/** The anchors a conversation may hang off (ADR-0027 §1). `dm`/`group` are schema-legal and have no
 *  surface — and, by ADR-0062 d.4, `chat_oversight` deliberately does not reach them. */
export const CONTEXTS = ['campaign', 'deliverable', 'sub_task', 'review'] as const
export type Context = (typeof CONTEXTS)[number]

/** Why a person is in a conversation. Rendered beside their name (ADR-0063 d.8) — "who is here" is
 *  much less useful than "why is the CFO here". */
export type MemberReason =
  | 'assignee'
  | 'reviewer'
  /** Who PUT THE WORK THERE (`sub_tasks.created_by`) — not who it is assigned to. On a campaign
   *  built from a workflow template this is whoever approved it, and it says nothing about who will
   *  do the work; calling it "assigned" reported 26 assignments on a campaign with none. */
  | 'creator'
  | 'owner'
  | 'account_manager'
  | 'invited'

export interface ConversationPerson {
  userId: string
  displayName: string | null
  reason: MemberReason
  /** Up to three NAMES the reason is about — the task, deliverable, campaign, or the inviter. */
  subjects: string[]
  /** How many rows the reason really covers. Never `subjects.length`: the array is deduplicated and
   *  capped, and counting it reported 17 for 26 tasks. */
  total: number
}

/**
 * May the caller READ this conversation?
 *
 * @param caller MUST be the caller-scoped client — the primitive resolves `auth.uid()`, and a
 *   service-role client has none, so passing one is a silent lockout rather than a bypass.
 *
 * Fail-closed by construction: any error — the migration not yet applied, a network blip, a policy
 * refusal — is a DENIAL. That is what makes "migration first, function second" safe to get wrong.
 */
export async function canReadConversation(
  caller: RpcCapable,
  contextType: Context,
  contextId: string,
): Promise<boolean> {
  const { data, error } = await caller.rpc('can_read_conversation', {
    p_context_type: contextType,
    p_context_id: contextId,
  })
  if (error) return false
  return data === true
}

/**
 * May the caller ADD or REMOVE someone here? (ADR-0062 d.6.)
 *
 * Everyone with a standing claim on the work — participants, leads in scope, and management, who
 * are full participants and not observers (Edward, 31 Aug). Not someone who was themselves invited:
 * an invitation cannot fan out, so every membership traces back to somebody accountable.
 */
export async function canManageMembers(
  caller: RpcCapable,
  contextType: Context,
  contextId: string,
): Promise<boolean> {
  const { data, error } = await caller.rpc('can_manage_conversation_members', {
    p_context_type: contextType,
    p_context_id: contextId,
  })
  if (error) return false
  return data === true
}

/**
 * Everyone in the conversation, with the reason each is there.
 *
 * Also the answer to "does this anchor resolve to anybody at all?" — which is the ONLY thing that
 * now justifies a 404 (ADR-0062 d.1). Having no campaign is not a reason: ad-hoc work has none and
 * is perfectly real, and treating that as not-found is what made ad-hoc chat impossible.
 */
export async function conversationPeople(
  caller: RpcCapable,
  contextType: Context,
  contextId: string,
): Promise<ConversationPerson[]> {
  const { data, error } = await caller.rpc('conversation_people', {
    p_context_type: contextType,
    p_context_id: contextId,
  })
  if (error || !Array.isArray(data)) return []
  return (data as {
    user_id: string; display_name: string | null; reason: MemberReason
    subjects: string[] | null; total: number | null
  }[]).map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    reason: r.reason,
    subjects: r.subjects ?? [],
    total: r.total ?? 0,
  }))
}
