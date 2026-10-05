-- ADR-0042 d.6 (I13.1 d): a contested resource raises, it does not block.
--
-- WHAT THE ADR ASSUMED, AND WHAT IS ACTUALLY THERE. ADR-0042 d.6 says a clash raises "an exception"
-- and that those exceptions "go to the Traffic Manager and Account Manager"; its consequences section
-- says the exceptions surface has to carry it "or it is worse than useless". There is no exceptions
-- table — searched all 91 migrations. `ExceptionsPanel` is a DERIVED counts strip that recomputes
-- overdue / due-today / in-review from the viewer's own open work. There was nowhere to record a
-- contested camera and nothing that reached anybody.
--
-- DECIDED (Edward, 26 Aug) rather than building a table and a screen nobody asked for:
--   * the RECORD is the booking itself. An exclusive clash is written `tentative`, which is visible
--     on the grid and durable until somebody resolves it. An over-ceiling person is written
--     `confirmed` and the cell's existing overload badge marks the day. Both shapes are already
--     visible exactly where the work is.
--   * the ALERT is a notification, reusing ADR-0026 (inbox) and ADR-0028 (email slow lane).
-- This keeps exceptions derived rather than stored, which is what ADR-0018 chose.
--
-- WHY AN RPC AND NOT A DIRECT INSERT. `notifications` has no INSERT policy for `authenticated` —
-- rows arrive only through SECURITY DEFINER emission triggers (20260818140000). The clash decision
-- is a calculation over a day's accumulated load and the resource's capacity model, which
-- AGENTS.md §2 puts in an Edge Function, not a trigger. So the function decides and calls this,
-- which is definer, narrow, and self-authorizing: it derives its own recipients and refuses a caller
-- who could not have scheduled the task in the first place.
--
-- search_path pinned inline per ADR-0033.

begin;

-- ============================================================================
-- 1) the new notification type
-- ============================================================================
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('assigned','review_requested','changes_requested','signed_off','blocked',
                  'due_soon','dependency_ready','cancelled','resource_clash'));

-- ============================================================================
-- 2) emit
-- ============================================================================
-- Recipients are derived here, never passed in: whoever ASSIGNED the work (they chose the dates and
-- can move them) and the account manager responsible for the deliverable (ADR-0042 d.6 names both).
-- The actor is excluded — telling somebody about the clash they just caused, in the moment they
-- caused it, is noise; the refusal is already on their screen.
--
-- `label` carries the RESOURCE name rather than the task title: "the RED Camera is contested" is the
-- message, while entity_id points at the sub_task so the notification still links to the work.
create or replace function public.notify_resource_clash(p_sub_task uuid, p_resource uuid)
returns integer language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_task     sub_tasks;
  v_resource resources;
  v_n        integer;
begin
  select * into v_task from sub_tasks
   where id = p_sub_task and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002';
  end if;

  -- Self-authorizing: only somebody who may manage this task may raise a clash against it. Without
  -- this the function is an open notification cannon for any authenticated user.
  if not app.can_manage_sub_task(p_sub_task) then
    raise exception 'not authorised to raise a clash on this task' using errcode = '42501';
  end if;

  select * into v_resource from resources
   where id = p_resource and tenant_id = v_task.tenant_id;
  if not found then
    raise exception 'resource % not found in this tenant', p_resource using errcode = 'P0002';
  end if;

  with recipients as (
    select v_task.assigned_by as user_id
    union
    select app.deliverable_account_manager(v_task.deliverable_id)
  )
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  select v_task.tenant_id, r.user_id, 'resource_clash', v_resource.name, 'sub_task', v_task.id, auth.uid()
  from recipients r
  where r.user_id is not null
    and r.user_id is distinct from auth.uid();   -- never notify the person who just did it

  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on function public.notify_resource_clash(uuid, uuid) is
  'ADR-0042 d.6: tell the assigner and the account manager that a resource required by a task could '
  'not be booked cleanly. The RECORD of the clash is the booking (tentative for an exclusive '
  'resource, confirmed-and-over-ceiling for a person); this is only the alert. Self-authorizing — '
  'the caller must be able to manage the task. Recipients are derived, never passed in.';

revoke execute on function public.notify_resource_clash(uuid, uuid) from public;
revoke execute on function public.notify_resource_clash(uuid, uuid) from anon;
grant  execute on function public.notify_resource_clash(uuid, uuid) to authenticated;

commit;
