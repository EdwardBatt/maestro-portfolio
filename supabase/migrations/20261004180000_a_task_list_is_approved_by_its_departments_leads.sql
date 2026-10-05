-- I74.51 (ADR-0100 addendum, Edward 4 Oct) — who approves a deliverable's task list.
--
-- Edward: "the deliverable's owner, other team leads from the same department and the department lead";
-- the Traffic Manager and the Power Admin keep the failsafe for an absent owner (ADR-0070, 3 Sep), and a
-- Deputy Team Leader counts as a team lead here. The account manager and the Account Director do not.
--
-- Until now the predicate read `deliverable_owner:manage` within the department's write scope. That let the
-- Account Director in (all_accounts passes every scope question, ADR-0074) and kept every team lead out (the
-- role does not hold `deliverable_owner:manage`). It now reads the lead's own mark — whoever books work
-- (`bookings:create`, ADR-0139: a role that books is a lead) — with a reach that is the organisation, a
-- department or a team, inside the deliverable's department (`in_write_scope` with no team: a team lead
-- answers by the department their team sits in, ADR-0070 d.3). No role is named (ADR-0073/0074):
--   * owner of record — always;
--   * tenant reach + books — the Traffic Manager and the Power Admin (the failsafe); the C-level roles book
--     nobody and stay out;
--   * department reach + books, the deliverable's department — its department lead;
--   * team reach + books, a team of the deliverable's department — its team leads and deputy team leads;
--   * account / all_accounts reach — the account manager and the Account Director — never.
--
-- One predicate still: `approve_deliverable_tasks` raises on it, `public.can_approve_tasks` (the button)
-- reads it, and every "waiting for you" list that offers a held task list filters on it — so the leads who
-- may approve are the leads who are asked.

begin;

create or replace function app.may_approve_deliverable_tasks(v public.deliverables)
returns boolean
language sql stable security definer
set search_path = public, app, extensions as $$
  select
       (v.owner_user_id is not null and v.owner_user_id = auth.uid())
    or (app.has_permission('bookings', 'create')
        and app.current_scope() in ('tenant', 'department', 'team')
        and app.in_write_scope(v.department_id, null, null));
$$;

comment on function app.may_approve_deliverable_tasks(public.deliverables) is
  'ADR-0100 addendum (I74.51, 4 Oct): may the caller approve this deliverable''s task list. Its owner; '
  'a lead who books (bookings:create) whose reach is the deliverable''s department — its department lead, '
  'its team leads and deputy team leads; and, by tenant reach, the Traffic Manager and the Power Admin '
  '(the failsafe for an absent owner). Never the account manager or the Account Director. One predicate: '
  'approve_deliverable_tasks, can_approve_tasks and every waiting-for-you list read it.';

revoke execute on function app.may_approve_deliverable_tasks(public.deliverables) from public, anon;
grant  execute on function app.may_approve_deliverable_tasks(public.deliverables) to authenticated;

commit;
