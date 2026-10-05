-- L6.8 (ADR-0037): expose THE authorization primitive to Edge Functions.
--
-- CORRECTION. Migration 20260823100100 (L6.2) asserted:
--
--   "Every RLS policy and Edge Function already funnels through app.has_permission … so extending
--    these two functions applies the overlay everywhere with NO policy rewrites."
--
-- The first half is true. The second half was never verified and is false. All eight grant-checking
-- Edge Functions hand-roll their own check against role_grants, keyed on the JWT app_role_id
-- (subtask-schedule, booking-transition, deliverable-transition, asset-url, review-media,
-- invite-user, update-user, chat). The ADR-0036 per-user overlay is therefore invisible to every one
-- of them, in BOTH directions: a user-allow is ignored (403 where RLS would permit — observed live)
-- and a user-deny is ignored (fails OPEN — the more serious half).
--
-- It is not mere oversight: app.has_permission lives in schema `app`, which PostgREST does not
-- expose, so an Edge Function running as the caller cannot call it at all. Hence this wrapper.
--
-- SECURITY SHAPE (ADR-0037 decision 1). Invoker, NOT security definer: the privileged read belongs
-- inside the primitive, not in the doorway to it. Today app.has_permission is itself invoker and
-- reads role_grants / user_grants under the caller's own RLS (both carry grant-free tenant SELECT
-- policies, so no recursion). When L6.11 privatises those tables the primitive becomes SECURITY
-- DEFINER (ADR-0037 decision 0) and THIS function is unchanged — it only crosses the schema
-- boundary. It returns a single boolean about the caller, about themselves: no disclosure.
--
-- search_path pinned inline per ADR-0033.

begin;

create or replace function public.has_permission(p_resource text, p_action text)
returns boolean language sql stable
set search_path = public, app, extensions as $$
  select app.has_permission(p_resource, p_action)
$$;

comment on function public.has_permission(text, text) is
  'ADR-0037: the PostgREST-visible doorway to app.has_permission, so Edge Functions resolve the '
  'permission axis through THE primitive instead of re-implementing it against role_grants. '
  'Invoker, STABLE; returns one boolean about the caller. Callers: the eight Edge Functions. '
  'No Edge Function, RPC or frontend module may decide authorization by reading role_grants / '
  'user_grants directly (AGENTS.md §2) — displaying a permission matrix is the sole exception.';

revoke execute on function public.has_permission(text, text) from public;
revoke execute on function public.has_permission(text, text) from anon;
grant  execute on function public.has_permission(text, text) to authenticated, service_role;

commit;
