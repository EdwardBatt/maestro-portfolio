-- I59.20 / I59.21 (ADR-0106 d.1–d.4, ADR-0107 d.3, accepted 25 Sep) — sending a round records the
-- real time, less the blocked time, or — if it was untimed — the task's allocated hours.
--
-- app.sub_task_submit, reproduced WHOLE from its latest definition (20260917130000 — checked:
-- `grep -rln "sub_task_submit" supabase/migrations | sort | tail -1`, nothing later redefines it),
-- search_path pinned. Every edit is marked `ADR-0106` or `ADR-0107`. The version / manual-note gates
-- are unchanged, word for word, and still run BEFORE the timing, so an untimed warning is never
-- followed by "attach this round's version".
--
-- WHAT CHANGES
--   * ADR-0106 d.1 — a round is UNTIMED when it was never started (no open time entry: status
--     `todo`, or a legacy `in_progress` with none) or its open entry started less than
--     `tenant_reminder_settings.untimed_threshold_minutes` ago (15 when the tenant has no row).
--   * d.2 — an untimed send is REFUSED unless `p_accept_untimed` is true: SQLSTATE 22023,
--     HINT 'untimed', DETAIL = the allocated hours (empty when none) — the screen's cue to show the
--     warning and ask. Refusing `todo` without the flag keeps the 22023 that I52.15 raised there.
--   * d.3 — accepted: `minutes` = the allocation (sla_hours x 60, else committed_hours x 60 — see
--     below), `untimed` = true. From `todo` the round is opened and closed in this one call: the task
--     passes through `in_progress` and a still-draft container starts, exactly as Start would have
--     done (ADR-0077 addendum d.7 — otherwise the container of work sent untimed could never close),
--     then one entry is written with started_at = submitted_at = now(), mode 'manual' (ADR-0106
--     Consequences: "ADR-0030's mode='manual' branch is re-used"). The deliverable's owner is told,
--     `untimed_round`.
--   * ADR-0107 d.3 — every round records `blocked_minutes` (the union of the task's OWN inputs over
--     the round), and a timed round's `minutes` is the elapsed time LESS it.
--   * d.4 — the one update into review raises `app.submitting` for itself and lowers it again; the
--     guard from 20260926100000 refuses every other route.
--   * `p_manual_minutes` is kept so existing callers resolve, and is IGNORED: typed minutes were the
--     only unstarted path, and ADR-0106 d.3 replaces them with the allocation.
--
-- THE ALLOCATION. `sla_hours` is nullable with no default (20260812120000), the materialiser leaves
-- it null (20260828220000), the assignment functions only ever `coalesce(p_hours, sla_hours)`, and
-- supabase/seed.sql sets it on no task. `committed_hours` is copied from sla_hours when the task is
-- committed and keeps it, so it is the fallback. When both are null the untimed round is still
-- recorded and marked, with `minutes` null — nothing is invented. (Questions for Edward.)
--
-- The signature gains a parameter, so the old (uuid, numeric) is DROPPED first: a second overload
-- with defaults would make every existing two-argument call ambiguous. The public wrapper
-- (20260819210000) follows, same reason.

begin;

drop function if exists public.sub_task_submit(uuid, numeric);
drop function if exists app.sub_task_submit(uuid, numeric);

CREATE OR REPLACE FUNCTION app.sub_task_submit(
  p_id uuid,
  p_manual_minutes numeric DEFAULT NULL::numeric,
  p_accept_untimed boolean DEFAULT false               -- ADR-0106 d.2
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 set search_path = public, app
AS $$
declare v sub_tasks; v_open task_time_entries; v_round integer; v_deliv_round integer;
        -- ADR-0106 / ADR-0107
        v_threshold integer; v_untimed boolean; v_alloc numeric; v_elapsed numeric;
        v_blocked numeric; v_owner uuid;
begin
  select * into v from sub_tasks where id = p_id;
  if v.id is null then raise exception 'sub_task % not found', p_id using errcode = 'P0002'; end if;
  if v.assignee_id is distinct from auth.uid() then
    raise exception 'only the assignee may submit this task' using errcode = '42501';
  end if;
  -- ADR-0106 d.1 (was I52.15's "in_progress only"): an unstarted round may be sent, as UNTIMED,
  -- below — never silently. Review, done and cancelled still cannot be sent.
  if v.status not in ('todo', 'in_progress') then
    raise exception 'this task cannot be sent for review (it is %)', v.status using errcode = '22023';
  end if;

  if v.review_mode = 'manual' then
    -- ADR-0059 d.6. Physical work has no file, so the artefact is the account of it: "Shot 4
    -- setups, all approved on set". It must be THIS round's and THIS person's — a reviewer's
    -- comment is not the maker saying what they did, and last round's note is not this round's.
    --
    -- **Submitting with nothing at all is still refused**, in both modes and for the same reason: a
    -- reviewer asked to approve nothing is being asked to rubber-stamp. That is the rule ADR-0058
    -- d.5 exists to enforce; this changes what counts as something, never whether something is
    -- needed.
    if not exists (
      select 1 from review_feedback rf
       where rf.sub_task_id = p_id
         and rf.round = app.task_review_round(p_id)
         and rf.author_user_id = auth.uid()
    ) then
      raise exception 'describe what you did before submitting this task for review'
        using errcode = '55000';
    end if;

  elsif v.deliverable_id is not null then
    -- I11.9, corrected by ADR-0058 d.5 (I25.3) and d.15. THIS round must have something to
    -- review — and it must be THIS TASK'S something, at THIS TASK'S round.
    --
    -- The old predicate asked only `m.deliverable_id = v.deliverable_id`, so ANY version on the
    -- deliverable at this round satisfied it. With six sub-tasks under one deliverable, one person
    -- uploaded one file and all six passed their gate: six approvals, five of them of something
    -- nobody looked at. And the round it asked for was the DELIVERABLE's, which a task send-back
    -- never moves — so last round's file satisfied this round (I48.33).
    --
    -- A task with no deliverable is still exempt: it can hold no version at all.
    v_round := app.task_review_round(p_id);                                                   -- d.15
    select d.revision_round + 1 into v_deliv_round from deliverables d where d.id = v.deliverable_id;
    if not exists (
      select 1 from media_records m
      where (
          -- The task's own artefact, at the task's own round. This is the rule from here on.
          (m.sub_task_id = p_id and m.round = v_round)
          -- Legacy: a version uploaded before the container model has no sub_task_id, and the
          -- backfill could not attach it because its deliverable holds more than one task. Those
          -- rows still satisfy the gate for the deliverable they belong to, at the deliverable's
          -- round they were stamped with, because refusing them would strand work that was
          -- legitimately submitted under the old rule. New uploads always carry a sub_task_id, so
          -- this arm narrows to nothing over time rather than being a permanent hole.
          or (m.sub_task_id is null and m.deliverable_id = v.deliverable_id and m.round = v_deliv_round)
        )
    ) then
      raise exception 'attach this round''s version before submitting for review'
        using errcode = '55000';
    end if;
  end if;

  select * into v_open from task_time_entries
    where sub_task_id = p_id and round = v.revision_number and submitted_at is null;

  -- ADR-0106 d.1: untimed = never started, or sent under the tenant's threshold after Start.
  select coalesce((select s.untimed_threshold_minutes from tenant_reminder_settings s
                    where s.tenant_id = v.tenant_id), 15)
    into v_threshold;
  v_untimed := v_open.id is null
               or v_open.started_at is null
               or now() - v_open.started_at < make_interval(mins => v_threshold);
  v_alloc := coalesce(v.sla_hours, v.committed_hours);

  if v_untimed and not coalesce(p_accept_untimed, false) then
    -- ADR-0106 d.2: the maker is warned first. The screen reads HINT 'untimed' and DETAIL (the
    -- allocated hours, '' when there are none) to word the warning, then sends again with the flag.
    raise exception 'this round was not timed — sending it records the task''s full allocated time'
      using errcode = '22023',
            hint = 'untimed',
            detail = coalesce(v_alloc::text, '');
  end if;

  if v_open.id is not null then
    -- ADR-0107 d.3: the task's own blocks over this round, counted once.
    v_blocked := app.task_blocked_minutes(p_id, v_open.started_at, now());
    if v_untimed then
      -- ADR-0106 d.3: sent too soon after Start — the allocation, marked.
      update task_time_entries
        set submitted_at = now(), minutes = round(v_alloc * 60, 1), untimed = true,
            blocked_minutes = v_blocked
        where id = v_open.id;
    else
      v_elapsed := extract(epoch from (now() - v_open.started_at)) / 60.0;
      update task_time_entries
        set submitted_at = now(),
            minutes = round(greatest(v_elapsed - v_blocked, 0), 1),                   -- ADR-0107 d.3
            blocked_minutes = v_blocked
        where id = v_open.id;
    end if;
  else
    -- ADR-0106 d.3: never started. Open and close the round in this one call. The task passes
    -- through in_progress and a draft container starts, as app.sub_task_start would have done
    -- (ADR-0077 addendum d.7); then the one entry, the allocation, marked.
    if v.status = 'todo' then
      update sub_tasks set status = 'in_progress' where id = p_id;
      if v.deliverable_id is not null then
        update deliverables set state = 'in_progress'
         where id = v.deliverable_id and state = 'draft';
      end if;
    end if;
    insert into task_time_entries (tenant_id, sub_task_id, user_id, round, started_at, submitted_at,
                                   minutes, mode, started_ahead, untimed, blocked_minutes)
    values (v.tenant_id, p_id, auth.uid(), v.revision_number, now(), now(),
            round(v_alloc * 60, 1), 'manual', app.sub_task_has_unmet_prereqs(p_id), true, 0);
  end if;

  if v_untimed and v.deliverable_id is not null then
    -- ADR-0106 d.3: the deliverable's owner is told — never the maker about their own send.
    select d.owner_user_id into v_owner from deliverables d where d.id = v.deliverable_id;
    if v_owner is not null and v_owner is distinct from auth.uid() then
      insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
      values (v.tenant_id, v_owner, 'untimed_round', v.title, 'sub_task', v.id, auth.uid(),
              jsonb_build_object(
                'task', v.title, 'task_id', v.id, 'deliverable_id', v.deliverable_id,
                'round', v.revision_number, 'maker_id', auth.uid(),
                'allocated_hours', v_alloc,
                'started', v_open.id is not null,
                'elapsed_minutes', case when v_open.started_at is null then null
                                        else round(extract(epoch from (now() - v_open.started_at)) / 60.0, 1) end));
    end if;
  end if;

  -- ADR-0106 d.4: the only door into review, opened for this one statement.
  perform set_config('app.submitting', 'on', true);
  update sub_tasks set status = 'review' where id = p_id;
  perform set_config('app.submitting', '', true);
end $$;

comment on function app.sub_task_submit(uuid, numeric, boolean) is
  'ADR-0030 §1 as amended by ADR-0106 and ADR-0107: the assignee sends a round for review. Timed '
  '(an open entry older than the tenant''s untimed_threshold_minutes): minutes = elapsed less the '
  'task''s own blocked minutes. Untimed (never started, or sent under the threshold): refused '
  '(22023, HINT untimed) unless p_accept_untimed, then minutes = the allocation (sla_hours, else '
  'committed_hours, x60), marked untimed, and the owner is told (untimed_round). The only path '
  'into review (app.submitting). p_manual_minutes is ignored.';

revoke execute on function app.sub_task_submit(uuid, numeric, boolean) from public, anon;
grant  execute on function app.sub_task_submit(uuid, numeric, boolean) to authenticated;

-- ------------------------------------------------------------ the public wrapper ----
-- 20260819210000's convention: SECURITY INVOKER, forwards only.
create or replace function public.sub_task_submit(
  p_id uuid,
  p_manual_minutes numeric default null,
  p_accept_untimed boolean default false
)
returns void language sql security invoker set search_path = public, app as $$
  select app.sub_task_submit(p_id, p_manual_minutes, p_accept_untimed);
$$;

revoke execute on function public.sub_task_submit(uuid, numeric, boolean) from public, anon;
grant  execute on function public.sub_task_submit(uuid, numeric, boolean) to authenticated;

-- ------------------------------------------------------------ the screen's read ----
-- For the warning (ADR-0106 d.2) and the running figure: the current round's start, how long ago,
-- the threshold, whether sending NOW would be untimed, the allocation, and the blocked minutes so
-- far. SECURITY INVOKER: whoever can read the task (sub_tasks_tenant_select) reads this; one row, or
-- none for a task the caller cannot see.
create or replace function public.task_round_timing(p_sub_task uuid)
returns table (
  sub_task_id            uuid,
  round                  integer,
  status                 text,
  started_at             timestamptz,
  elapsed_minutes        numeric,
  threshold_minutes      integer,
  is_untimed             boolean,
  allocated_hours        numeric,
  blocked_minutes_so_far numeric
)
language sql stable security invoker set search_path = public, app as $$
  select st.id,
         st.revision_number,
         st.status,
         e.started_at,
         case when e.started_at is null then null
              else round((extract(epoch from (now() - e.started_at)) / 60.0)::numeric, 1) end,
         coalesce(s.untimed_threshold_minutes, 15),
         (e.started_at is null
           or now() - e.started_at < make_interval(mins => coalesce(s.untimed_threshold_minutes, 15))),
         coalesce(st.sla_hours, st.committed_hours),
         case when e.started_at is null then 0::numeric
              else app.task_blocked_minutes(st.id, e.started_at, now()) end
    from sub_tasks st
    left join lateral (
      select t.started_at from task_time_entries t
       where t.sub_task_id = st.id and t.round = st.revision_number and t.submitted_at is null
       order by t.created_at desc limit 1
    ) e on true
    left join tenant_reminder_settings s on s.tenant_id = st.tenant_id
   where st.id = p_sub_task
$$;

comment on function public.task_round_timing(uuid) is
  'ADR-0106 d.2 / ADR-0107 d.3: the current round''s timing for the task screen — started_at, '
  'elapsed_minutes, threshold_minutes, is_untimed (would sending now be untimed), allocated_hours '
  '(sla_hours, else committed_hours), blocked_minutes_so_far. Invoker: readable by whoever can read '
  'the task.';

revoke execute on function public.task_round_timing(uuid) from public, anon;
grant  execute on function public.task_round_timing(uuid) to authenticated;

commit;
