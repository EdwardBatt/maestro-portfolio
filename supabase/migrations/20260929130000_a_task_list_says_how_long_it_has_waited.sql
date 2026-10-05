-- I66.6 (Edward, 29 Sep) — the Dashboard's "Task lists not approved" opens the task lists themselves: one row
-- each, with the owner it waits on and how long it has waited.
--
-- How long a list has waited is ONE clock (ADR-0119 d.3): `app.task_list_waiting_since` — the campaign's
-- approval, or, for a campaign approved before the task-list gate, the release that brought it in. The card
-- (`my_pending_approvals`) and the escalation sweep read it; the list reads it here rather than keep a second
-- copy of the rule in the browser.
--
-- `security_invoker`: the reader's own RLS on deliverables, streams and campaigns decides the rows — the view
-- adds no reach. Every waiting list, with or without tasks; the screen keeps the ones with a live task
-- (I66.3: a piece with no tasks has no list to approve).

begin;

create or replace view public.task_list_waiting
with (security_invoker = true) as
select d.id                                                    as deliverable_id,
       d.tenant_id                                             as tenant_id,
       app.task_list_waiting_since(c.kind, c.approved_at)      as since
  from deliverables d
  join streams s   on s.id = d.stream_id
  join campaigns c on c.id = s.campaign_id
 where c.status = 'approved'
   and d.tasks_approved_at is null
   and d.state <> 'archived';

comment on view public.task_list_waiting is
  'I66.6: every deliverable whose task list waits for approval on an approved campaign, and since when '
  '(app.task_list_waiting_since, ADR-0119 d.3 — the card''s and the escalation''s clock). security_invoker: '
  'the reader''s RLS decides the rows.';

revoke all on public.task_list_waiting from public, anon;
grant select on public.task_list_waiting to authenticated;

commit;
