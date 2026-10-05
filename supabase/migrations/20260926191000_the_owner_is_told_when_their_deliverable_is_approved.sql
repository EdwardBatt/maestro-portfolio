-- I59.49 (Edward, 26 Sep): "On a deliverable being approved the deliverable owner and account
-- manager/director should be notified."
--
-- Found by the 26 Sep recipient check of the walks: a deliverable reaching `approved` told its tasks'
-- assignees and the campaign's account manager (the account-side person on the campaign — an account
-- manager, or an account director standing in, which the campaign's account-manager field already
-- holds) — but not its OWNER, the lead accountable for it (ADR-0090), unless they happened to hold a
-- task on it. The rule dates from 20260818140000 and predates owners.
--
-- Now `signed_off` also goes to the owner. The other transitions this trigger announces (in review,
-- changes requested, blocked) are unchanged: their recipients are a separate question. The actor is
-- still never told about their own act.

begin;

create or replace function app.tg_deliverable_notify()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
declare v_type text;
begin
  if new.state = old.state then return new; end if;
  v_type := case
    when new.state = 'in_review' then 'review_requested'
    when old.state = 'in_review' and new.state = 'in_progress' then 'changes_requested'
    when new.state = 'approved' then 'signed_off'
    when new.state = 'blocked' then 'blocked'
    else null
  end;
  if v_type is null then return new; end if;

  -- recipients: the deliverable's sub-task assignees + the campaign's account manager (or the account
  -- director standing in, who is recorded there) + — on approval — its owner; minus the actor.
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  select new.tenant_id, r.uid, v_type, new.name, 'deliverable', new.id, auth.uid()
  from (
    select distinct st.assignee_id as uid from sub_tasks st where st.deliverable_id = new.id and st.assignee_id is not null
    union
    select app.deliverable_account_manager(new.id) as uid
    union
    select new.owner_user_id as uid where v_type = 'signed_off'
  ) r
  where r.uid is not null and r.uid is distinct from auth.uid();
  return new;
end $$;

comment on function app.tg_deliverable_notify() is
  'Announces a deliverable''s state change to its tasks'' assignees and the campaign''s account manager '
  '(or the account director recorded there); on approval (signed_off) also to its owner (I59.49). '
  'Never the actor.';

commit;
