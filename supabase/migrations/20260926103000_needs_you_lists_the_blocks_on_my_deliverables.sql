-- I59.21 (ADR-0107 d.2, with ADR-0105's "Needs you") — the owner sees every block raised on the
-- tasks of the deliverables they own: which task, whose, what is missing, from whom, since when.
--
-- A new read beside `public.my_pending_approvals`, not an edit to it (that function is shared by
-- the other I59 tracks). SECURITY INVOKER: it narrows what the caller can already read
-- (deliverable_pending_inputs / sub_tasks are tenant-wide, deliverables as the caller's own
-- policies allow) to the rows where they are the OWNER — it grants nothing.

begin;

create or replace function public.needs_me_blocks()
returns table (
  input_id         uuid,
  sub_task_id      uuid,
  task_title       text,
  deliverable_id   uuid,
  deliverable_name text,
  maker_id         uuid,
  maker_name       text,
  kind             text,
  description      text,
  awaited_from     text,
  requested_at     timestamptz
)
language sql stable security invoker set search_path = public, app as $$
  select pin.id, st.id, st.title, d.id, d.name, st.assignee_id, up.display_name,
         pin.kind, pin.description, pin.awaited_from, pin.requested_at
    from deliverable_pending_inputs pin
    join sub_tasks st    on st.id = pin.sub_task_id
    join deliverables d  on d.id = pin.deliverable_id
    left join user_profiles up on up.id = st.assignee_id
   where pin.satisfied_at is null
     and pin.tenant_id = app.current_tenant_id()
     and d.owner_user_id = auth.uid()
   order by pin.requested_at, pin.id
$$;

comment on function public.needs_me_blocks() is
  'ADR-0107 d.2: the open task-level inputs ("I''m blocked") on tasks of deliverables I OWN — task, '
  'maker, kind, what, from whom, since (requested_at), oldest first. Every open one, whatever '
  'the task''s status. Invoker; grants nothing.';

revoke execute on function public.needs_me_blocks() from public, anon;
grant  execute on function public.needs_me_blocks() to authenticated;

commit;
