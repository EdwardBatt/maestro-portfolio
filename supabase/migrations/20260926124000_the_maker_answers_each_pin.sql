-- I59.29 / ADR-0112 d.2 (25 Sep, Edward) — the maker marks a pin done and replies to it; the reviewer
-- may re-open it.
--
--   * `review_feedback.parent_id` — a reply hangs off a PIN (a top-level row). One level only: a reply
--     to a reply is refused. The reply takes its pin's task and file (`sub_task_id`,
--     `media_record_id`) and its pin's ROUND: it answers that round's pin, it is not this round's
--     account of the work — so it can never satisfy the manual-review submit gate
--     (`sub_task_submit`: "this round's note by the maker"), which reads rows at the current round.
--   * `review_feedback.done_by` / `done_at` — "fixed in the next version". Not required to send the
--     next version (d.2); nothing reads it as a gate.
--
-- WHO (RLS + one guard trigger, since RLS cannot see columns):
--   reply      the parent pin's task's ASSIGNEE only (a new branch of the insert rule; a top-level
--              comment keeps today's rule — any internal user, as themself).
--   mark done  the pin's task's assignee (new policy `review_feedback_assignee_update`); the guard
--              lets that person change `done_at` from empty to set and NOTHING else, and stamps
--              `done_by` itself.
--   re-open    the reviewer — the pin's author or a `reviews:moderate` holder, exactly today's
--              `review_feedback_resolve_update` — clears `done_at` / `done_by`. The assignee cannot
--              clear it: the reviewer keeps the final word on every pin (ADR-0112 Locked in).
-- Everything the author / moderator could do before (edit, resolve) is unchanged.

begin;

alter table review_feedback
  add column if not exists parent_id uuid references review_feedback(id) on delete cascade,
  add column if not exists done_by   uuid references user_profiles(id),
  add column if not exists done_at   timestamptz;

alter table review_feedback
  add constraint chk_review_feedback_done_pair check ((done_at is null) = (done_by is null)),
  add constraint chk_review_feedback_reply_not_done check (parent_id is null or done_at is null);

create index if not exists idx_review_feedback_parent on review_feedback (parent_id) where parent_id is not null;

comment on column review_feedback.parent_id is
  'ADR-0112 d.2 (I59.29): the pin this row replies to, or NULL for a pin. One level; written by the '
  'pin''s task''s assignee; takes the pin''s task, file and round.';
comment on column review_feedback.done_at is
  'ADR-0112 d.2: when the maker marked the pin done ("fixed in the next version"); cleared when the '
  'reviewer re-opens it. Never a gate on sending the next version.';
comment on column review_feedback.done_by is
  'ADR-0112 d.2: who marked the pin done — stamped by the guard, never by the client.';

-- ---------------------------------------------------------------- a reply's shape ----
-- Named to sort AFTER review_feedback_set_round (triggers fire alphabetically): the round stamp runs
-- first, then a reply takes its pin's round over it.
create or replace function app.tg_review_feedback_thread_shape()
returns trigger language plpgsql
set search_path = public, app, extensions as $$
declare p review_feedback;
begin
  if new.parent_id is null then
    return new;
  end if;
  select * into p from review_feedback where id = new.parent_id;
  if p.id is null or p.tenant_id <> new.tenant_id then
    raise exception 'that pin does not exist' using errcode = 'P0002';
  end if;
  if p.parent_id is not null then
    raise exception 'a reply answers a pin, not another reply' using errcode = '22023';
  end if;
  new.sub_task_id     := p.sub_task_id;
  new.media_record_id := p.media_record_id;
  new.round           := p.round;
  new.page            := null;
  new.pos_x           := null;
  new.pos_y           := null;
  new.timecode_ms     := null;
  new.done_at         := null;
  new.done_by         := null;
  return new;
end $$;

create trigger review_feedback_thread_shape
  before insert on review_feedback
  for each row execute function app.tg_review_feedback_thread_shape();

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
  v_assignee := exists (select 1 from sub_tasks t where t.id = old.sub_task_id and t.assignee_id = auth.uid());

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
      -- Re-opening: the reviewer's act.
      if not v_reviewer then
        raise exception 'only the reviewer can re-open this feedback' using errcode = '42501';
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

create trigger review_feedback_done_guard
  before update on review_feedback
  for each row execute function app.tg_review_feedback_done_guard();

-- ---------------------------------------------------------------- the policies ----
-- Insert, reproduced from 20260818110000 with the reply branch: a pin as before; a reply only by the
-- assignee of the pin's task.
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
                   join sub_tasks t on t.id = p.sub_task_id
                  where p.id = review_feedback.parent_id and p.tenant_id = app.current_tenant_id()
                    and t.assignee_id = auth.uid())
    )
  );

-- The maker may update a pin on their own task — the guard narrows that to marking it done.
create policy review_feedback_assignee_update on review_feedback
  for update to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and exists (select 1 from sub_tasks t where t.id = sub_task_id and t.assignee_id = auth.uid())
  )
  with check (tenant_id = app.current_tenant_id());

commit;
