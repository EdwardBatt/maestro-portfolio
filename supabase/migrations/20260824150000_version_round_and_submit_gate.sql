-- I11.9 (ADR-0038 neighbourhood): a task cannot be submitted for review with nothing to review.
--
-- WHY. app.sub_task_submit checks the assignee, the status, and a timer — nothing requires a file.
-- A maker could submit an empty round and the reviewer received a version chain with nothing new in
-- it. The screen was taught to refuse this (I12.0), but a screen-deep guard is not a rule: any other
-- caller still gets through, which is the shape of defect this whole day has been about.
--
-- WHICH ROUND? Counting versions against revision_round would work until somebody uploads twice in
-- one round — a mistake then a fix — after which the count runs ahead and the NEXT round is
-- satisfied without a new upload. Silently. So the round is stamped on the upload instead, exactly
-- as review_feedback.round already is (20260818110000): 1-based, from the parent deliverable's
-- revision_round at insert time. Reviewer comments have been round-aware since August; the files
-- they comment on now are too.
--
-- A task with no deliverable is exempt: media_records.deliverable_id is NOT NULL, so such a task
-- physically cannot hold a version. Nothing has created one since ADR-0035 replaced that path and
-- the tenant holds zero of them — the exemption is for the legacy shape, not a licence.
--
-- search_path pinned inline per ADR-0033.

begin;

-- ------------------------------------------------------------------ the round ----
alter table media_records add column round integer;
comment on column media_records.round is
  'I11.9: the review round this version belongs to, 1-based, stamped from the parent deliverable''s '
  'revision_round at upload. Mirrors review_feedback.round. Never client-writable.';

create or replace function app.tg_media_record_stamp_round() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v_round integer;
begin
  select d.revision_round into v_round from public.deliverables d where d.id = new.deliverable_id;
  new.round := coalesce(v_round, 0) + 1;   -- first pass (revision_round 0) → round 1
  return new;
end $$;
comment on function app.tg_media_record_stamp_round() is
  'I11.9: stamp media_records.round from the deliverable''s revision_round. The client never sets it, '
  'so an upload cannot claim to belong to a round it was not made in.';

create trigger media_record_stamp_round before insert on media_records
  for each row execute function app.tg_media_record_stamp_round();

-- Existing versions predate the stamp. Their round is unknowable after the fact, so derive the
-- honest approximation: order by version within each deliverable and number them from 1. That is
-- exactly right for the one-upload-per-round case, which is every version filed so far.
with numbered as (
  select id, row_number() over (partition by deliverable_id order by version) as n
  from media_records
)
update media_records m set round = numbered.n
from numbered where numbered.id = m.id and m.round is null;

alter table media_records alter column round set not null;

-- ------------------------------------------------------------- the submit gate ----
-- Reproduces app.sub_task_submit from 20260819170000 verbatim, with ONE addition: the round must
-- carry a version. Lifted from source rather than retyped — reproducing a function from memory has
-- already cost a regression today.
create or replace function app.sub_task_submit(p_id uuid, p_manual_minutes numeric default null)
returns void language plpgsql security definer set search_path = public, app as $$
declare v sub_tasks; v_open task_time_entries; v_round integer;
begin
  select * into v from sub_tasks where id = p_id;
  if v.id is null then raise exception 'sub_task % not found', p_id using errcode = 'P0002'; end if;
  if v.assignee_id is distinct from auth.uid() then
    raise exception 'only the assignee may submit this task' using errcode = '42501';
  end if;
  if v.status not in ('todo', 'in_progress') then
    raise exception 'task cannot be submitted from % (only todo or in_progress)', v.status using errcode = '22023';
  end if;

  -- I11.9: THIS round must have something to review. A task with no deliverable cannot hold a
  -- version at all (media_records.deliverable_id is NOT NULL) and is exempt.
  if v.deliverable_id is not null then
    select d.revision_round + 1 into v_round from deliverables d where d.id = v.deliverable_id;
    if not exists (
      select 1 from media_records m
      where m.deliverable_id = v.deliverable_id and m.round = v_round
    ) then
      raise exception 'attach this round''s version before submitting for review'
        using errcode = '55000';
    end if;
  end if;

  select * into v_open from task_time_entries
    where sub_task_id = p_id and round = v.revision_number and submitted_at is null;
  if v_open.id is not null then
    update task_time_entries
      set submitted_at = now(), minutes = round(extract(epoch from (now() - started_at)) / 60.0, 1)
      where id = v_open.id;
  else
    if p_manual_minutes is null or p_manual_minutes <= 0 then
      raise exception 'submitting without a running timer requires manual minutes (> 0)' using errcode = '22023';
    end if;
    insert into task_time_entries (tenant_id, sub_task_id, user_id, round, submitted_at, minutes, mode)
    values (v.tenant_id, p_id, auth.uid(), v.revision_number, now(), p_manual_minutes, 'manual');
  end if;

  update sub_tasks set status = 'review' where id = p_id;

  -- notify downstream tasks whose prerequisites are now ALL satisfied (the payoff of the dep model)
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  select b.tenant_id, b.assignee_id, 'dependency_ready', b.title, 'sub_task', b.id, auth.uid()
  from sub_task_dependencies dep
  join sub_tasks b on b.id = dep.sub_task_id
  where dep.depends_on_sub_task_id = p_id
    and b.assignee_id is not null and b.assignee_id is distinct from auth.uid()
    and not app.sub_task_has_unmet_prereqs(b.id);
end $$;

comment on function app.sub_task_submit(uuid, numeric) is
  'ADR-0030 + I11.9: the assignee submits a task for review. Requires a version stamped with THIS '
  'round — a submission with nothing to review is refused in the database, not only on screen.';

commit;
