-- I74 fix-up (Edward, 3 Oct — the reviewer rule): re-opening a task that has no reviewer failed at commit with
-- 23514 "a reviewer must be appointed for this task" (app.tg_sub_task_reviewer_required), e.g. the seeded
-- "Brunos post 7": the re-open hands the task back to its maker, and an assigned live task must have a reviewer.
--
-- Edward's rule: reviewers are chosen with the existing ReviewerPicker — several, the first required, the rest optional
-- (the optional answer before the required); no default; reviewing itself does not change. So the Re-open dialog asks
-- for reviewers on every ticked task that has none, and the re-open SAVES them before the task goes back to work:
--   public.reopen_deliverable  gains p_reviewers jsonb — {"<sub_task_id>": [{user_id, is_mandatory}]}; required (22023,
--                              hint reviewer_required) for a ticked task with no reviewer, ignored for one that has any.
--   public.reopen_task         gains p_reviewers jsonb — the one task's [{user_id, is_mandatory}].
-- The reviewer rows go through sub_task_reviewers' own triggers (eligibility, no self-review, one required), so nothing
-- about who may review is decided here.
--
-- Reproduced WHOLE from their latest definitions (grep -liE "function +(public|app)\.<name>\b", 3 Oct):
--   public.reopen_deliverable  20261003140000 (signature gains p_reviewers: dropped and re-created)
--   public.reopen_task         20261003140000 (idem)
-- Safe on a populated database: two functions replaced; no data changes.

begin;

drop function if exists public.reopen_task(uuid, text, timestamptz, text, numeric);
drop function if exists public.reopen_deliverable(uuid, uuid[], text, timestamptz, text, numeric);
create function public.reopen_deliverable(
  p_deliverable uuid, p_tasks uuid[], p_reason text, p_due_at timestamptz,
  p_kind text default 'own_fix', p_hours numeric default null, p_reviewers jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  d deliverables;
  v_actor uuid := auth.uid();
  v_task uuid;
  v_titles text[];
  v_campaign_reopened boolean := false;
  v_place uuid[];
  v_list jsonb;
begin
  select * into d from deliverables where id = p_deliverable and tenant_id = app.current_tenant_id() for update;
  if not found then
    raise exception 'deliverable % not found', p_deliverable using errcode = 'P0002';
  end if;
  if not app.may_reopen(p_deliverable) then
    raise exception
      're-opening "%" is outside your reach — its account manager, Traffic, an Account Director, a Power Admin or a lead of its owner''s department can',
      d.name using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'say why it is being re-opened — the reason goes on the record and to the people told'
      using errcode = '22023';
  end if;
  if p_due_at is null then
    raise exception 'a re-opened task needs a new due date' using errcode = '22023';
  end if;
  if p_due_at < now() then
    raise exception 'the new due date is in the past' using errcode = '22023';
  end if;
  if p_tasks is null or cardinality(p_tasks) = 0 then
    raise exception 'choose at least one task to do again' using errcode = '22023';
  end if;
  if d.state = 'archived' then
    raise exception '"%" was called off — it cannot be re-opened', d.name using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_tasks) t(id)
              where not exists (select 1 from sub_tasks st where st.id = t.id and st.deliverable_id = p_deliverable)) then
    raise exception 'a task chosen is not one of "%"''s', d.name using errcode = '22023';
  end if;
  -- ADR-0142 d.1
  if p_kind is null or p_kind not in ('client_amendment', 'own_fix') then
    raise exception 'say whether this is a client amendment or our own fix' using errcode = '22023', hint = 'kind_required';
  end if;

  -- I74 fix-up (Edward, 3 Oct — the reviewer rule): a ticked task with no reviewer is given one here, chosen in the
  -- dialog with the ReviewerPicker (several; the first required, the rest optional) — never a default. Saved BEFORE the
  -- task goes back to work, so the assignment check (app.tg_sub_task_reviewer_required, deferred) finds them. A task that
  -- already has reviewers keeps them: re-opening does not change who reviews.
  if p_reviewers is not null and jsonb_typeof(p_reviewers) <> 'object' then
    raise exception 'the reviewers must be given per task' using errcode = '22023';
  end if;
  foreach v_task in array p_tasks loop
    if exists (select 1 from sub_task_reviewers rv where rv.sub_task_id = v_task) then
      continue;
    end if;
    v_list := p_reviewers -> v_task::text;
    if v_list is null or jsonb_typeof(v_list) <> 'array' or jsonb_array_length(v_list) = 0 then
      raise exception '"%" has no reviewer — choose who reviews it before it is re-opened',
        (select st.title from sub_tasks st where st.id = v_task)
        using errcode = '22023', hint = 'reviewer_required';
    end if;
    if (select count(*) from jsonb_array_elements(v_list) e) <>
       (select count(distinct e ->> 'user_id') from jsonb_array_elements(v_list) e) then
      raise exception 'the same reviewer is listed twice' using errcode = '22023';
    end if;
    insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory, created_by)
    select d.tenant_id, v_task, (e ->> 'user_id')::uuid, coalesce((e ->> 'is_mandatory')::boolean, false), v_actor
      from jsonb_array_elements(v_list) e;
  end loop;

  -- d.4 first: the work cannot move inside a closed campaign.
  v_campaign_reopened := app.reopen_campaign_for(p_deliverable);

  if d.state in ('approved', 'delivered') then
    perform set_config('app.reopen', 'on', true);
    update deliverables set state = 'in_progress' where id = p_deliverable;
    perform set_config('app.reopen', 'off', true);
  end if;

  foreach v_task in array p_tasks loop
    perform app.reopen_one_task(v_task, trim(p_reason), p_due_at, p_kind, p_hours);
  end loop;

  select array_agg(st.title order by st.sort_order, st.unit_index) into v_titles
    from sub_tasks st where st.id = any(p_tasks);
  -- ADR-0142 d.2: the tasks with a maker, for `subtask-schedule` to place on her week.
  select coalesce(array_agg(st.id order by st.sort_order, st.unit_index), '{}') into v_place
    from sub_tasks st where st.id = any(p_tasks) and st.assignee_id is not null;

  insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
  values (d.tenant_id, v_actor, 'deliverable_reopened', 'deliverables', d.id,
          jsonb_build_object('reason', trim(p_reason), 'tasks', p_tasks, 'due_at', p_due_at, 'kind', p_kind,
                             'was_state', d.state, 'campaign_reopened', v_campaign_reopened));

  -- The owner is told what came back and why — unless they did it, or already heard as a task's
  -- assignee or reviewer.
  if d.owner_user_id is not null and d.owner_user_id is distinct from v_actor
     and not exists (select 1 from sub_tasks st where st.id = any(p_tasks) and st.assignee_id = d.owner_user_id)
     and not exists (select 1 from sub_task_reviewers rv where rv.sub_task_id = any(p_tasks) and rv.user_id = d.owner_user_id) then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (d.tenant_id, d.owner_user_id, 'deliverable_reopened', d.name, 'deliverable', d.id, v_actor,
            jsonb_build_object('reason', trim(p_reason), 'due_at', p_due_at, 'tasks', to_jsonb(v_titles),
                               'campaign_reopened', v_campaign_reopened, 'kind', p_kind));
  end if;

  return jsonb_build_object('reopened', cardinality(p_tasks), 'campaign_reopened', v_campaign_reopened,
                            'kind', p_kind, 'reschedule', to_jsonb(v_place));
end $$;

comment on function public.reopen_deliverable(uuid, uuid[], text, timestamptz, text, numeric, jsonb) is
  'ADR-0103 d.2–d.4, ADR-0142: the picked tasks go back to To do WITH THEIR MAKER and reviewers (approval cleared, new '
  'due date and commitment, the old bookings released), the container to in_progress, a closed campaign re-opens; the '
  'maker, reviewers and owner are told. p_kind: client_amendment | own_fix (recorded in sub_task_reopenings). Returns '
  '{reopened, campaign_reopened, kind, reschedule: [sub_task_id]} — call subtask-schedule for each id in reschedule. '
  'p_reviewers: {"<sub_task_id>": [{user_id, is_mandatory}]} for each ticked task that has no reviewer (required for '
  'those; ignored for a task that has reviewers — re-opening does not change who reviews).';
revoke execute on function public.reopen_deliverable(uuid, uuid[], text, timestamptz, text, numeric, jsonb) from public, anon;
grant  execute on function public.reopen_deliverable(uuid, uuid[], text, timestamptz, text, numeric, jsonb) to authenticated;

-- A single task — the row's own Re-open. The same door, one task.
create function public.reopen_task(p_sub_task uuid, p_reason text, p_due_at timestamptz,
                                   p_kind text default 'own_fix', p_hours numeric default null,
                                   p_reviewers jsonb default null)
returns jsonb
language sql
security invoker
set search_path = public, app, extensions
as $$
  select public.reopen_deliverable(
    (select st.deliverable_id from sub_tasks st where st.id = p_sub_task), array[p_sub_task], p_reason, p_due_at,
    p_kind, p_hours,
    case when p_reviewers is null then null else jsonb_build_object(p_sub_task::text, p_reviewers) end)
$$;

revoke execute on function public.reopen_task(uuid, text, timestamptz, text, numeric, jsonb) from public, anon;
grant  execute on function public.reopen_task(uuid, text, timestamptz, text, numeric, jsonb) to authenticated;

commit;
