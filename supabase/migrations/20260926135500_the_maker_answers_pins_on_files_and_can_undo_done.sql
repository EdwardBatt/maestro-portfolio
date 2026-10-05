-- I59.31 / ADR-0112 d.2 — the maker's pin rules, finished (Edward, 25 Sep; the coordinator's settled
-- item and Track 7's finding, 26 Sep).
--
--   settled  The maker can UNDO their own "done" on a pin: clearing `done_at` / `done_by` on a pin THEY
--            marked (done_by = them, still the task's assignee). The reviewer's re-open is unchanged (the
--            pin's author or reviews:moderate). A pin another person marked done is not theirs to undo.
--   Track 7  A pin on a FILE carries only its file (`review_feedback.media_record_id`, `sub_task_id`
--            null), so 20260926124000's rules — which read the pin's `sub_task_id` — let the maker reply
--            to and mark done only the manual-review notes. The pin's task is now resolved THROUGH its
--            file: `media_records.sub_task_id`, the task whose round uploaded that version
--            (`app.review_feedback_task`). A file with no task (a deliverable-level version) has no maker
--            to answer it; its pins stay the reviewer's (listed as a question).
--
-- Reproduced WHOLE from 20260926124000 (their only definitions, grep confirmed 26 Sep):
--   app.tg_review_feedback_done_guard — the task through the file; the maker's own undo;
--   policy review_feedback_internal_insert — a reply to a file pin by that file's task's assignee;
--   policy review_feedback_assignee_update — the file pin's task's assignee reaches the row.
-- app.tg_review_feedback_thread_shape is unchanged: a reply already takes its pin's task AND file.
--
-- Tests: supabase/tests/179_the_maker_answers_pins_on_files_and_can_undo_done.sql

begin;

-- ---------------------------------------------------------------- the pin's task ----
-- SECURITY DEFINER so a policy can read it without depending on the caller's reach over media_records;
-- it returns an id and nothing else, and only within the caller's tenant.
create or replace function app.review_feedback_task(p_sub_task uuid, p_media_record uuid)
returns uuid
language sql stable security definer
set search_path = public, app, extensions as $$
  select coalesce(
    p_sub_task,
    (select mr.sub_task_id from media_records mr
      where mr.id = p_media_record and mr.tenant_id = app.current_tenant_id()));
$$;

comment on function app.review_feedback_task(uuid, uuid) is
  'ADR-0112 d.2 (I59.31): the task a pin answers to — its own sub_task_id, else the task of the file it '
  'is pinned on (media_records.sub_task_id). Null for a deliverable-level file.';

revoke execute on function app.review_feedback_task(uuid, uuid) from public, anon;
grant  execute on function app.review_feedback_task(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- the guard ----
create or replace function app.tg_review_feedback_done_guard()
returns trigger language plpgsql
set search_path = public, app, extensions as $$
declare
  v_reviewer boolean;
  v_assignee boolean;
begin
  -- No caller (a migration, the service role, a definer path without a user): nothing to guard.
  if auth.uid() is null then
    return new;
  end if;

  v_reviewer := coalesce(old.author_user_id = auth.uid(), false) or app.has_permission('reviews', 'moderate');
  -- Track 7: the pin's task, through its file when it has no task of its own.
  v_assignee := exists (select 1 from sub_tasks t
                         where t.id = app.review_feedback_task(old.sub_task_id, old.media_record_id)
                           and t.assignee_id = auth.uid());

  if new.done_at is distinct from old.done_at or new.done_by is distinct from old.done_by then
    if old.done_at is null and new.done_at is not null then
      -- Marking done: the maker's act (d.2), on a pin — not a reply.
      if not v_assignee then
        raise exception 'only the person doing the task can mark its feedback done' using errcode = '42501';
      end if;
      if old.parent_id is not null then
        raise exception 'a reply cannot be marked done — mark the pin' using errcode = '22023';
      end if;
      new.done_at := now();
      new.done_by := auth.uid();
    elsif old.done_at is not null and new.done_at is null then
      -- Re-opening: the reviewer's act — or (I59 settled) the maker undoing their OWN "done".
      if not (v_reviewer or (v_assignee and old.done_by = auth.uid())) then
        raise exception 'only the reviewer, or whoever marked it done, can re-open this feedback' using errcode = '42501';
      end if;
      new.done_by := null;
    else
      -- done_by changed alone, or a done time rewritten: never a client's to set.
      new.done_at := old.done_at;
      new.done_by := old.done_by;
    end if;
  end if;

  -- The maker, as the maker, changes nothing else on a reviewer's pin.
  if not v_reviewer then
    if (new.body, new.resolved, new.page, new.pos_x, new.pos_y, new.timecode_ms, new.link_url,
        new.sub_task_id, new.media_record_id, new.round, new.author_user_id, new.parent_id, new.source)
       is distinct from
       (old.body, old.resolved, old.page, old.pos_x, old.pos_y, old.timecode_ms, old.link_url,
        old.sub_task_id, old.media_record_id, old.round, old.author_user_id, old.parent_id, old.source) then
      raise exception 'you can mark this feedback done or reply to it; only its reviewer can change it'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

comment on function app.tg_review_feedback_done_guard() is
  'ADR-0112 d.2 + I59.31: the assignee of the pin''s task (its own, or its file''s) marks a pin done '
  '(stamped, not client-set) and may undo their OWN done; the reviewer (author or reviews:moderate) '
  're-opens any; the maker changes nothing else on a reviewer''s pin.';

-- ---------------------------------------------------------------- the policies ----
-- Insert, reproduced from 20260926124000: a pin as before; a reply only by the assignee of the pin's
-- task — its own, or (Track 7) its file's.
drop policy review_feedback_internal_insert on review_feedback;
create policy review_feedback_internal_insert on review_feedback
  for insert to authenticated
  with check (
    tenant_id = app.current_tenant_id()
    and author_user_id = auth.uid()
    and source = 'internal'
    and (
      parent_id is null
      or exists (select 1 from review_feedback p
                   join sub_tasks t on t.id = app.review_feedback_task(p.sub_task_id, p.media_record_id)
                  where p.id = review_feedback.parent_id and p.tenant_id = app.current_tenant_id()
                    and t.assignee_id = auth.uid())
    )
  );

-- The maker may update a pin on their own task (or its file) — the guard narrows that to done / undo.
drop policy review_feedback_assignee_update on review_feedback;
create policy review_feedback_assignee_update on review_feedback
  for update to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and exists (select 1 from sub_tasks t
                 where t.id = app.review_feedback_task(sub_task_id, media_record_id)
                   and t.assignee_id = auth.uid())
  )
  with check (tenant_id = app.current_tenant_id());

commit;
