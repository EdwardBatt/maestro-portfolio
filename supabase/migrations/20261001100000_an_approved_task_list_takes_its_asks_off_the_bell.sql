-- I67.10 (ADR-0119 addendum, 1 Oct, accepted): approving a task list removes the bell notices that asked for it.
--
-- The cause. The Needs-you card goes for everyone the moment one person approves a list (`my_pending_approvals` reads
-- `tasks_approved_at`), but the bell's notices are one row per person with only `read_at`: the owner's ask and the
-- 24-hour escalations to Traffic and the account manager stayed unread, keeping the red count up for work already done.
--
-- The fix.
--   1) `app.tg_deliverable_clears_task_list_asks` — when `tasks_approved_at` goes from empty to set, delete, for every
--      recipient, the notices ON THAT DELIVERABLE that ask for the approval (addendum d.1), and the owner's campaign-level
--      `campaign_approved` once every live piece they own on the campaign has an approved list (d.2). Kept: the
--      escalation for a piece whose every task was cancelled, `deliverable_edited`, and everything else (d.3).
--   2) `app.tg_notification_removed_broadcast` — a deleted notice nudges its recipient's own topic with
--      `notification_removed`, so an open bell reloads its list and count without a chime (d.4).
--
-- `security definer` (addendum d.5): the approver may not delete another person's notice under row-level security. The
-- function is a trigger only (no EXECUTE for clients), acts only on the deliverable whose row just changed, and only on
-- the types named; the approval itself has already passed the existing guards.

begin;

create or replace function app.tg_deliverable_clears_task_list_asks() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_campaign uuid;
begin
  if not (old.tasks_approved_at is null and new.tasks_approved_at is not null) then
    return null;
  end if;

  -- d.1: the asks raised on this deliverable.
  delete from notifications n
   where n.tenant_id = new.tenant_id
     and n.entity_type = 'deliverable'
     and n.entity_id = new.id
     and (   (n.type = 'escalated' and n.detail ->> 'kind' = 'task_list'
              and coalesce((n.detail ->> 'all_cancelled')::boolean, false) = false)
          or (n.type = 'deliverable_added' and coalesce((n.detail ->> 'for_owner')::boolean, false))
          or (n.type = 'deliverable_reassigned' and not coalesce((n.detail ->> 'tasks_approved')::boolean, false))
          or n.type = 'deliverable_type_changed'
          or n.type = 'campaign_approved');

  -- d.2: the owner's campaign-level approval notice, once nothing of theirs on the campaign still waits.
  if new.owner_user_id is not null then
    select s.campaign_id into v_campaign from streams s where s.id = new.stream_id;
    if v_campaign is not null and not exists (
      select 1
        from deliverables d
        join streams s on s.id = d.stream_id
       where s.campaign_id = v_campaign
         and d.owner_user_id = new.owner_user_id
         and d.state <> 'archived'
         and d.tasks_approved_at is null
         and d.id <> new.id
    ) then
      delete from notifications n
       where n.tenant_id = new.tenant_id
         and n.user_id = new.owner_user_id
         and n.type = 'campaign_approved'
         and n.entity_type = 'campaign'
         and n.entity_id = v_campaign;
    end if;
  end if;

  return null;
end $$;

comment on function app.tg_deliverable_clears_task_list_asks() is
  'I67.10 (ADR-0119 addendum d.1-d.2): when a task list is approved, deletes for every recipient the bell notices that '
  'asked for it. SECURITY DEFINER because the approver cannot delete another person''s notice under RLS; trigger-only, '
  'scoped to the changed deliverable and the named types.';

revoke execute on function app.tg_deliverable_clears_task_list_asks() from public, anon, authenticated;

create trigger deliverable_clears_task_list_asks
  after update of tasks_approved_at on deliverables
  for each row execute function app.tg_deliverable_clears_task_list_asks();

-- d.4: an open bell hears that a notice went.
create or replace function app.tg_notification_removed_broadcast()
returns trigger language plpgsql as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('id', old.id, 'type', old.type),
      'notification_removed',
      'tenant:' || old.tenant_id::text || ':user:' || old.user_id::text,
      true
    );
  exception when others then null;  -- realtime absent (CI) or transient; the client reconciles on its next read
  end;
  return old;
end $$;

comment on function app.tg_notification_removed_broadcast() is
  'I67.10 (ADR-0119 addendum d.4): nudge the recipient''s inbox topic when a notification is deleted. Best-effort.';

create trigger notification_removed_broadcast after delete on notifications
  for each row execute function app.tg_notification_removed_broadcast();

commit;
