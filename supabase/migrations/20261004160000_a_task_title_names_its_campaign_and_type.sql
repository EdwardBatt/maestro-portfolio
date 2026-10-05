-- ADR-0071 addendum, 4 Oct (Edward) — I74.39. A generated task's title names its CAMPAIGN and the deliverable's TYPE;
-- the deliverable's own name is not in it ("it is already displayed at the top of the form").
--
--   a task done once per deliverable   "<Step> — <Campaign>"                         Creative Direction — Northwind Summer Launch
--   a per-unit task                    "<Step> — <Campaign> · <Type> <n>"            Create Artwork — Northwind Summer Launch · Static Post 1
--                                      quantity 1: no number                          Create Artwork — Northwind Summer Launch · Billboard
--                                      no type: the number alone                      Create Artwork — Northwind Summer Launch · 2
--   the translation task               "Translation — <Campaign> (<languages>)"       Translation — Northwind Summer Launch (Arabic, English)
--
-- A single job is a campaign row — the same rule. A deliverable outside any campaign (none today) takes its own name in
-- the campaign's place, so a title is never a bare step.
--
-- Replaces d.10 / d.10a ("<step> — <deliverable>[ <n>]") and the I74.31 / I74.33 / I74.37 follow-ups. Kept from I57.48:
-- no " ×N" count anywhere.
--
-- ONE builder, ONE follower:
--   app.compose_task_title(step, context, type, unit, quantity)   every generated step task
--   app.compose_translation_title(context, words)                   the translation task
--   app.retitle_deliverable_tasks(deliverable, OLD context/type/quantity/languages, notify)
--       rewrites a task only when its title EQUALS what the old values composed — a hand-named task never does. The step
--       is read from the title itself (the text before the first " — "), so a task follows even if its template step was
--       renamed later. On a type change only the tasks of the new type's workflow follow (the old type's cancelled or
--       finished work keeps the type it was made as).
--   deliverable_task_titles_follow   AFTER UPDATE OF name, stream_id, deliverable_type_id, quantity, languages
--       — replaces deliverable_rename_cascade, deliverable_units_numbered and deliverable_translation_follows (dropped).
--       A rename changes no title any more (the name is not in it) except for a deliverable outside a campaign.
--       The translation task's assignee is still told when the LANGUAGES change (translation_languages_changed); no
--       other change notifies, as before.
--   campaign_task_titles_follow      AFTER UPDATE OF name ON campaigns — every deliverable's tasks follow the new name.
--
-- And the gap found mapping this: an accepted change request (app.apply_deliverable_change_request) changed the quantity
-- without adding or cancelling the unit tasks. Both it and edit_piece_directly now go through
-- app.resize_deliverable_units — the units above the new quantity cancelled (their assignees told), the missing ones
-- brought back or added, the owner's approval rule (ADR-0132 d.4) applied.
--
-- Reproduced WHOLE from their latest definitions (grep + pg_get_functiondef on the local stack at 20261004150000):
--   app.materialise_deliverable_workflow     20261004130000
--   app.translation_task_title               20261004130000
--   app.place_translation_task               20261004130000 (unchanged in body; reads the new title)
--   public.edit_piece_directly               20261003130000
--   public.preview_deliverable_type_change   20261003130000
--   public.preview_quantity_change           20261003130000
--   app.apply_deliverable_change_request     20260926132000
--   (change_deliverable_type composes no title: its new list comes from the materialiser through the type trigger.)
--
-- Backfill (safe on a populated database): a task is rewritten only when its title equals one the OLD rules composed
-- for it — "<step> — <deliverable>[ <n>]", "<step> — <deliverable without ×N>[ <n>]", or
-- "Translation — <deliverable>[ without ×N] (<anything>)". Everything else — every hand-named task — is untouched.
-- No other column moves.
begin;

-- ===================================================================== 1. the builder ====
create or replace function app.compose_task_title(
  p_step text, p_context text, p_type text, p_unit integer, p_quantity integer
) returns text
language sql immutable
set search_path = public, app, extensions as $$
  select btrim(coalesce(p_step, ''))
         || case when x.tail = '' then '' else ' — ' || x.tail end
    from (select concat_ws(' · ',
                   nullif(btrim(coalesce(p_context, '')), ''),
                   case when p_unit is not null then
                     nullif(btrim(coalesce(btrim(p_type), '')
                                  || case when coalesce(p_quantity, 1) > 1 then ' ' || p_unit::text else '' end), '')
                   end) as tail) x
$$;
comment on function app.compose_task_title(text, text, text, integer, integer) is
  'ADR-0071 addendum (4 Oct): a generated task''s title — "<step> — <campaign>" for a step done once, '
  '"<step> — <campaign> · <type> <n>" for a unit (no number at quantity 1; no type: the number alone).';

create or replace function app.compose_translation_title(p_context text, p_words text) returns text
language sql immutable
set search_path = public, app, extensions as $$
  select case when p_words is null then null
              else 'Translation — ' || coalesce(nullif(btrim(coalesce(p_context, '')), ''), 'deliverable')
                   || ' (' || p_words || ')' end
$$;
comment on function app.compose_translation_title(text, text) is
  'ADR-0071 addendum (4 Oct) / ADR-0117 d.4: "Translation — <campaign> (<languages>)"; null with no languages.';

-- The languages in words: the English names, in the order chosen (ADR-0117 d.4).
create or replace function app.language_words(p_tenant uuid, p_langs text[]) returns text
language sql stable security invoker
set search_path = public, app, extensions as $$
  select string_agg(coalesce(av.label_en, l.code), ', ' order by l.n)
    from unnest(coalesce(p_langs, '{}')) with ordinality as l(code, n)
    left join deliverable_attribute_values av
           on av.tenant_id = p_tenant and av.attribute = 'language' and av.code = l.code
$$;
revoke execute on function app.language_words(uuid, text[]) from public, anon;
grant  execute on function app.language_words(uuid, text[]) to authenticated;

-- What stands where the campaign's name goes: the campaign's (or single job's) name; for a deliverable outside any
-- campaign, its own name without its count. Invoker (as the two helpers around it): the previews call it as the
-- caller, so RLS decides which campaign and type names it may read; the definer callers read as themselves.
create or replace function app.task_title_context(p_stream uuid, p_name text) returns text
language sql stable security invoker
set search_path = public, app, extensions as $$
  select coalesce(
    (select nullif(btrim(c.name), '') from streams s join campaigns c on c.id = s.campaign_id where s.id = p_stream),
    nullif(app.task_segment(p_name), ''))
$$;
revoke execute on function app.task_title_context(uuid, text) from public, anon;
grant  execute on function app.task_title_context(uuid, text) to authenticated;

create or replace function app.type_title(p_type uuid) returns text
language sql stable security invoker
set search_path = public, app, extensions as $$
  select nullif(btrim(dt.name_en), '') from deliverable_types dt where dt.id = p_type
$$;
revoke execute on function app.type_title(uuid) from public, anon;
grant  execute on function app.type_title(uuid) to authenticated;

-- Reproduced from 20261004130000: composed by the builder.
create or replace function app.translation_task_title(p_deliverable uuid) returns text
language sql stable security definer set search_path = public, app, extensions as $$
  select app.compose_translation_title(app.task_title_context(d.stream_id, d.name),
                                       app.language_words(d.tenant_id, d.languages))
    from deliverables d
   where d.id = p_deliverable
$$;
comment on function app.translation_task_title(uuid) is
  'ADR-0117 d.4 / ADR-0071 addendum (4 Oct): "Translation — <campaign> (<the deliverable''s languages>)"; null with none.';
revoke execute on function app.translation_task_title(uuid) from public, anon;

-- ===================================================================== 2. creation ====
-- Reproduced from 20261004130000; the title is the builder's.
create or replace function app.materialise_deliverable_workflow(p_deliverable uuid, p_template uuid default null)
returns integer
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant   uuid;
  v_dept     uuid;
  v_template uuid;
  v_ctx      text;
  v_type     text;
  v_qty      integer;
  v_created  integer;
begin
  select d.tenant_id, d.department_id, app.task_title_context(d.stream_id, d.name), app.type_title(d.deliverable_type_id),
         greatest(coalesce(d.quantity, 1), 1), coalesce(p_template, dt.default_workflow_template_id)
    into v_tenant, v_dept, v_ctx, v_type, v_qty, v_template
    from deliverables d
    left join deliverable_types dt on dt.id = d.deliverable_type_id
   where d.id = p_deliverable;

  if v_tenant is null or v_template is null then
    return 0;
  end if;

  if not exists (select 1 from workflow_templates wt
                  where wt.id = v_template and wt.tenant_id = v_tenant) then
    raise exception 'that workflow template is not in your organization' using errcode = '22023';
  end if;

  insert into sub_tasks (
    tenant_id, deliverable_id, title, description, department_id,
    status, sort_order, workflow_step_id, unit_index, review_mode, created_by
  )
  select
    v_tenant,
    p_deliverable,
    -- ADR-0071 addendum (4 Oct): "<step> — <campaign>" once; "<step> — <campaign> · <type> <n>" per unit.
    app.compose_task_title(ws.title_en, v_ctx, v_type, case when ws.repeats_per_unit then u.n end, v_qty),
    ws.description_en,
    v_dept,
    'todo',
    ws.sort_order,
    ws.id,
    case when ws.repeats_per_unit then u.n else null end,
    ws.review_mode,
    auth.uid()
  from workflow_steps ws
  cross join lateral generate_series(1, case when ws.repeats_per_unit then v_qty else 1 end) as u(n)
  where ws.tenant_id = v_tenant
    and ws.template_id = v_template
    and ws.is_active
    and not exists (
      select 1 from sub_tasks st
       where st.deliverable_id = p_deliverable
         and st.workflow_step_id = ws.id
         and coalesce(st.unit_index, 0)
             = coalesce(case when ws.repeats_per_unit then u.n else null end, 0)
    )
  order by ws.sort_order, u.n;

  get diagnostics v_created = row_count;

  -- ADR-0117 d.4-d.5 (amended 4 Oct): ONE translation task naming every language the DELIVERABLE is made in.
  v_created := v_created + app.place_translation_task(p_deliverable);

  return v_created;
end $$;

comment on function app.materialise_deliverable_workflow(uuid, uuid) is
  'ADR-0052 d.5: lays out a deliverable''s task list from its workflow template (idempotent), titled by '
  'app.compose_task_title (ADR-0071 addendum, 4 Oct). ADR-0117 (amended 4 Oct): and one translation task naming the '
  'deliverable''s languages, straight after Write Copy, when it has none.';

-- ===================================================================== 3. the follower ====
create or replace function app.retitle_deliverable_tasks(
  p_deliverable uuid,
  p_old_context text,
  p_old_type    uuid,
  p_old_qty     integer,
  p_old_langs   text[],
  p_notify      boolean default false
) returns integer
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  d          deliverables%rowtype;
  v_ctx      text;
  v_type     text;
  v_old_type text := app.type_title(p_old_type);
  v_new_tpl  uuid;
  v_n        integer := 0;
  v_k        integer;
  v_old_tr   text;
  v_new_tr   text;
  v_task     sub_tasks%rowtype;
begin
  select * into d from deliverables where id = p_deliverable;
  if not found then return 0; end if;
  v_ctx  := app.task_title_context(d.stream_id, d.name);
  v_type := app.type_title(d.deliverable_type_id);
  select dt.default_workflow_template_id into v_new_tpl from deliverable_types dt where dt.id = d.deliverable_type_id;

  -- The step tasks: the step is the title's own text before " — ".
  update sub_tasks t
     set title = x.new_title
    from (select t2.id,
                 app.compose_task_title(split_part(t2.title, ' — ', 1), v_ctx, v_type, t2.unit_index,
                                        greatest(coalesce(d.quantity, 1), 1)) as new_title
            from sub_tasks t2
            join workflow_steps ws on ws.id = t2.workflow_step_id
           where t2.deliverable_id = d.id
             and position(' — ' in t2.title) > 0
             and t2.title = app.compose_task_title(split_part(t2.title, ' — ', 1), p_old_context, v_old_type,
                                                   t2.unit_index, greatest(coalesce(p_old_qty, 1), 1))
             -- a type change: only the new type's workflow follows; the old type's work keeps the type it was made as
             and (p_old_type is not distinct from d.deliverable_type_id or ws.template_id is not distinct from v_new_tpl)
         ) x
   where x.id = t.id and t.title is distinct from x.new_title;
  get diagnostics v_n = row_count;

  -- The translation task.
  v_old_tr := app.compose_translation_title(p_old_context, app.language_words(d.tenant_id, p_old_langs));
  v_new_tr := app.translation_task_title(d.id);
  if v_old_tr is not null and v_new_tr is not null and v_old_tr <> v_new_tr then
    for v_task in
      select * from sub_tasks st
       where st.deliverable_id = d.id and st.workflow_step_id is null and st.title = v_old_tr
       for update
    loop
      update sub_tasks set title = v_new_tr where id = v_task.id;
      v_n := v_n + 1;
      -- ADR-0117 addendum (Q20): the assignee is told when the LANGUAGES change — nothing else notifies.
      if p_notify and v_task.status <> 'cancelled'
         and v_task.assignee_id is not null and v_task.assignee_id is distinct from auth.uid() then
        insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
        values (d.tenant_id, v_task.assignee_id, 'translation_languages_changed', v_new_tr, 'sub_task', v_task.id,
                auth.uid(),
                jsonb_build_object('deliverable_id', d.id, 'deliverable', d.name,
                                   'from_title', v_task.title, 'languages', to_jsonb(d.languages),
                                   'words', substring(v_new_tr from '\(([^()]*)\)$')));
      end if;
    end loop;
  end if;
  return v_n;
end $$;
comment on function app.retitle_deliverable_tasks(uuid, text, uuid, integer, text[], boolean) is
  'ADR-0071 addendum (4 Oct): rewrites a deliverable''s generated task titles to the current campaign, type, quantity and '
  'languages — only a title that EQUALS what the old values composed (a hand-named task is left alone). p_notify: the '
  'translation task''s assignee is told (translation_languages_changed).';
revoke execute on function app.retitle_deliverable_tasks(uuid, text, uuid, integer, text[], boolean) from public, anon, authenticated;

create or replace function app.tg_deliverable_task_titles_follow() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_langs_changed boolean := new.languages is distinct from old.languages;
begin
  if new.name is not distinct from old.name
     and new.stream_id is not distinct from old.stream_id
     and new.deliverable_type_id is not distinct from old.deliverable_type_id
     and new.quantity is not distinct from old.quantity
     and not v_langs_changed then
    return new;
  end if;
  perform app.retitle_deliverable_tasks(new.id, app.task_title_context(old.stream_id, old.name),
                                        old.deliverable_type_id, old.quantity, old.languages, v_langs_changed);

  -- ADR-0117 addendum (Q20), kept from 20261004130000: no translation task yet and a task list — one is added (d.5).
  if v_langs_changed
     and app.translation_task_title(new.id) is not null
     and not exists (select 1 from sub_tasks st where st.deliverable_id = new.id and st.title like 'Translation — %')
     and exists (select 1 from sub_tasks st where st.deliverable_id = new.id and st.status <> 'cancelled') then
    perform app.place_translation_task(new.id);
  end if;
  return new;
end $$;
comment on function app.tg_deliverable_task_titles_follow() is
  'ADR-0071 addendum (4 Oct): a deliverable''s generated task titles follow its campaign, type, quantity and languages '
  '(app.retitle_deliverable_tasks); a languages change also adds a missing translation task (ADR-0117 Q20).';

drop trigger if exists deliverable_rename_cascade on deliverables;
drop trigger if exists deliverable_units_numbered on deliverables;
drop trigger if exists deliverable_translation_follows on deliverables;
drop function if exists app.tg_deliverable_rename_cascade();
drop function if exists app.tg_deliverable_units_numbered();
drop function if exists app.tg_deliverable_translation_follows();

drop trigger if exists deliverable_task_titles_follow on deliverables;
create trigger deliverable_task_titles_follow
  after update of name, stream_id, deliverable_type_id, quantity, languages on deliverables
  for each row execute function app.tg_deliverable_task_titles_follow();

create or replace function app.tg_campaign_task_titles_follow() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  d deliverables%rowtype;
begin
  if new.name is not distinct from old.name then
    return new;
  end if;
  for d in
    select dl.* from deliverables dl join streams s on s.id = dl.stream_id where s.campaign_id = new.id
  loop
    perform app.retitle_deliverable_tasks(d.id, coalesce(nullif(btrim(old.name), ''), nullif(app.task_segment(d.name), '')),
                                          d.deliverable_type_id, d.quantity, d.languages, false);
  end loop;
  return new;
end $$;
comment on function app.tg_campaign_task_titles_follow() is
  'ADR-0071 addendum (4 Oct): a campaign''s (or single job''s) rename reaches its generated task titles; hand-named '
  'tasks are left alone; nobody is notified.';

drop trigger if exists campaign_task_titles_follow on campaigns;
create trigger campaign_task_titles_follow
  after update of name on campaigns
  for each row execute function app.tg_campaign_task_titles_follow();

-- ===================================================================== 4. units, one path ====
-- The units of a quantity change: above the new quantity cancelled (assignees told), the missing ones brought back or
-- added, titled by the builder. Sets the quantity itself (between the two, so the follower renumbers the units that
-- stay before the new ones are written). Called under app.change_request_apply by both callers.
create or replace function app.resize_deliverable_units(p_deliverable uuid, p_to integer, p_reason text, p_extra jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  d           deliverables%rowtype;
  v_actor     uuid := auth.uid();
  v_old       integer;
  v_tpl       uuid;
  v_ctx       text;
  v_type      text;
  v_task      sub_tasks%rowtype;
  v_cancelled integer := 0;
  v_added     integer := 0;
  v_ins       integer := 0;
begin
  select * into d from deliverables where id = p_deliverable;
  v_old := greatest(coalesce(d.quantity, 1), 1);
  if p_to is null or p_to = v_old then
    if p_to is not null and d.quantity is distinct from p_to then
      update deliverables set quantity = p_to where id = d.id;
    end if;
    return jsonb_build_object('cancelled', 0, 'added', 0);
  end if;

  if p_to < v_old then
    for v_task in
      select t.* from sub_tasks t
        join workflow_steps ws on ws.id = t.workflow_step_id and ws.repeats_per_unit
       where t.deliverable_id = d.id
         and t.unit_index > p_to
         and t.status in ('todo', 'in_progress', 'blocked', 'review')
       order by t.unit_index, t.sort_order
       for update of t
    loop
      update sub_tasks set status = 'cancelled' where id = v_task.id;
      delete from bookings where sub_task_id = v_task.id;
      insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
      values (v_task.tenant_id, v_actor, 'task_cancelled', 'sub_tasks', v_task.id,
              jsonb_build_object('reason', p_reason, 'deliverable_id', d.id, 'was_status', v_task.status,
                                 'from_quantity', v_old, 'to_quantity', p_to) || coalesce(p_extra, '{}'::jsonb));
      if v_task.assignee_id is not null and v_task.assignee_id is distinct from v_actor then
        insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
        values (v_task.tenant_id, v_task.assignee_id, 'cancelled', v_task.title, 'sub_task', v_task.id,
                v_actor, jsonb_build_object('reason', p_reason) || coalesce(p_extra, '{}'::jsonb));
      end if;
      v_cancelled := v_cancelled + 1;
    end loop;
  end if;

  update deliverables set quantity = p_to where id = d.id;

  select dt.default_workflow_template_id into v_tpl from deliverable_types dt where dt.id = d.deliverable_type_id;
  if p_to > v_old and v_tpl is not null then
    v_ctx  := app.task_title_context(d.stream_id, d.name);
    v_type := app.type_title(d.deliverable_type_id);
    -- A unit cancelled by an earlier lowering is brought back, to do and unassigned: `uq_sub_tasks_workflow_step_unit`
    -- holds one row per (deliverable, step, unit) whatever its status, so it cannot be added twice.
    update sub_tasks t
       set status = 'todo', assignee_id = null, starts_at = null
      from workflow_steps ws
     where ws.id = t.workflow_step_id and ws.repeats_per_unit
       and t.deliverable_id = d.id and t.status = 'cancelled'
       and t.unit_index between v_old + 1 and p_to;
    get diagnostics v_added = row_count;
    insert into sub_tasks (tenant_id, deliverable_id, title, description, department_id,
                           status, sort_order, workflow_step_id, unit_index, review_mode, created_by)
    select d.tenant_id, d.id,
           app.compose_task_title(ws.title_en, v_ctx, v_type, u.n, p_to),
           ws.description_en, d.department_id, 'todo', ws.sort_order, ws.id, u.n, ws.review_mode, v_actor
      from workflow_steps ws
      cross join lateral generate_series(v_old + 1, p_to) as u(n)
     where ws.tenant_id = d.tenant_id and ws.template_id = v_tpl and ws.is_active and ws.repeats_per_unit
       and not exists (select 1 from sub_tasks st where st.deliverable_id = d.id
                                                    and st.workflow_step_id = ws.id and st.unit_index = u.n)
     order by ws.sort_order, u.n;
    get diagnostics v_ins = row_count;
    v_added := v_added + v_ins;
    -- ADR-0132 d.4. The insert trigger (`sub_tasks_added_to_an_approved_list`) stands aside under
    -- app.change_request_apply, so the rule is applied here: units added by anyone but the owner wait for the owner.
    if v_added > 0 and d.tasks_approved_at is not null and d.owner_user_id is not null
       and d.owner_user_id is distinct from v_actor then
      perform set_config('app.task_list_approval', 'on', true);
      update deliverables set tasks_approved_at = null, tasks_approved_by = null where id = d.id;
      perform set_config('app.task_list_approval', '', true);
    end if;
  end if;
  return jsonb_build_object('cancelled', v_cancelled, 'added', v_added);
end $$;
comment on function app.resize_deliverable_units(uuid, integer, text, jsonb) is
  'ADR-0071 d.8 / ADR-0132 d.3: a quantity change made real — units above it cancelled (assignees told), missing ones '
  'brought back or added (app.compose_task_title), the owner''s approval rule applied. Used by edit_piece_directly and '
  'app.apply_deliverable_change_request (I74.39: the change request changed the number and no task).';
revoke execute on function app.resize_deliverable_units(uuid, integer, text, jsonb) from public, anon, authenticated;

-- Reproduced from 20261003130000; the quantity goes through app.resize_deliverable_units.
CREATE OR REPLACE FUNCTION public.edit_piece_directly(p_deliverable uuid, p_quantity integer DEFAULT NULL::integer, p_due_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  v_tenant    uuid := app.current_tenant_id();
  v_actor     uuid := auth.uid();
  d           deliverables%rowtype;
  v_old       integer;
  v_cancelled integer := 0;
  v_added     integer := 0;
  v_res       jsonb;
  v_due       timestamptz;
  v_changes   jsonb := '{}'::jsonb;
  v_prior     text;
  v_prior2    text;
  v_w         text;
begin
  select * into d from deliverables where id = p_deliverable and tenant_id = v_tenant for update;
  if not found then raise exception 'deliverable % not found', p_deliverable using errcode = 'P0002'; end if;
  if not app.may_edit_deliverable(p_deliverable) then
    -- ADR-0141 d.1: only the account manager (or the account director, Traffic, the Power Admin) changes a deliverable.
    raise exception 'only the account manager changes a deliverable — ask % to change it',
            coalesce(app.refusal_names_deliverable_am(p_deliverable), 'the account manager')
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_am(p_deliverable), ''),
            hint = 'ask_account_manager';
  end if;
  if d.state = 'archived' then
    raise exception 'this deliverable is closed; there is nothing left to change' using errcode = '22023';
  end if;
  if p_quantity is not null and p_quantity < 1 then
    raise exception 'a quantity is at least 1' using errcode = '22023';
  end if;
  v_old := greatest(coalesce(d.quantity, 1), 1);
  v_due := case when p_due_day is null then null else app.close_of_day(p_due_day) end;
  if (p_quantity is null or p_quantity = v_old) and (v_due is null or v_due is not distinct from d.due_at) then
    raise exception 'nothing to change — the quantity and the due date are already that' using errcode = '22023';
  end if;

  v_prior  := coalesce(current_setting('app.change_request_apply', true), '');
  v_prior2 := coalesce(current_setting('app.deliverable_due_at_change', true), '');
  perform set_config('app.change_request_apply', 'on', true);

  -- ---- quantity ----
  if p_quantity is not null and p_quantity <> v_old then
    v_res := app.resize_deliverable_units(
      d.id, p_quantity,
      format('The deliverable''s quantity was changed from %s to %s — this unit is no longer made.', v_old, p_quantity),
      jsonb_build_object('direct', true));
    v_cancelled := (v_res ->> 'cancelled')::integer;
    v_added     := (v_res ->> 'added')::integer;
    v_changes := v_changes || jsonb_build_object('quantity', jsonb_build_object('from', v_old, 'to', p_quantity));
  end if;

  -- ---- due date ----
  if v_due is not null and v_due is distinct from d.due_at then
    perform set_config('app.deliverable_due_at_change', 'on', true);
    update deliverables set due_at = v_due where id = d.id;
    perform set_config('app.deliverable_due_at_change', v_prior2, true);
    if d.due_at is not null then
      v_w := coalesce(current_setting('app.sla_event_writer', true), '');
      perform set_config('app.sla_event_writer', 'on', true);
      insert into sla_events (tenant_id, deliverable_id, event_type, actor_user_id, payload)
      values (d.tenant_id, d.id, 'deadline_changed', v_actor,
              jsonb_build_object('from', d.due_at, 'to', v_due, 'direct', true));
      perform set_config('app.sla_event_writer', v_w, true);
    end if;
    v_changes := v_changes || jsonb_build_object('due', jsonb_build_object('from', d.due_at, 'to', v_due));
  end if;

  perform set_config('app.change_request_apply', v_prior, true);

  insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
  values (d.tenant_id, v_actor, 'deliverable_edited', 'deliverables', d.id,
          v_changes || jsonb_build_object('cancelled', v_cancelled, 'added', v_added, 'direct', true));

  if d.owner_user_id is not null and d.owner_user_id is distinct from v_actor then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (d.tenant_id, d.owner_user_id, 'deliverable_edited', d.name, 'deliverable', d.id, v_actor,
            v_changes || jsonb_build_object('cancelled', v_cancelled, 'added', v_added));
  end if;

  return jsonb_build_object('cancelled', v_cancelled, 'added', v_added,
                            'quantity', coalesce(p_quantity, v_old),
                            'due_at', coalesce(v_due, d.due_at));
end $function$;

-- Reproduced from 20260926132000; a quantity change goes through app.resize_deliverable_units (it changed the number and
-- no task).
CREATE OR REPLACE FUNCTION app.apply_deliverable_change_request(p_request uuid, p_due_override date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  r         deliverable_change_requests%rowtype;
  d         deliverables%rowtype;
  v_type    uuid;
  v_qty     integer;
  v_due     timestamptz;
  v_has_due boolean;
  v_prior   text;
  v_prior2  text;
  v_prior3  text;
  v_w       text;
  v_old_tpl uuid;
  v_new_tpl uuid;
  v_task    sub_tasks%rowtype;
  v_reason  text;
  v_from    integer;
begin
  select * into r from deliverable_change_requests where id = p_request for update;
  select * into d from deliverables where id = r.deliverable_id for update;

  v_type := case when r.changes ? 'type' then (r.changes -> 'type' ->> 'to')::uuid else d.deliverable_type_id end;
  v_qty  := case when r.changes ? 'quantity' then (r.changes -> 'quantity' ->> 'to')::integer else d.quantity end;
  v_has_due := r.changes ? 'due' or p_due_override is not null;
  v_due  := case when p_due_override is not null then app.close_of_day(p_due_override)
                 when r.changes ? 'due' then app.close_of_day((r.changes -> 'due' ->> 'to')::date)
                 else d.due_at end;

  v_prior := coalesce(current_setting('app.change_request_apply', true), '');
  perform set_config('app.change_request_apply', 'on', true);
  -- E5: the promise moves on the owner's answer; the evidence that came with the request (or not)
  -- is logged below.
  v_prior2 := coalesce(current_setting('app.deliverable_due_at_change', true), '');
  if v_has_due then perform set_config('app.deliverable_due_at_change', 'on', true); end if;

  -- ---- E7: a type change regenerates the task list ----
  if r.changes ? 'type' and v_type is distinct from d.deliverable_type_id then
    select dt.default_workflow_template_id into v_old_tpl from deliverable_types dt where dt.id = d.deliverable_type_id;
    select dt.default_workflow_template_id into v_new_tpl from deliverable_types dt where dt.id = v_type;

    if v_old_tpl is distinct from v_new_tpl then
      v_reason := format('The deliverable''s type changed (change request %s) — its task list is the new type''s.', r.id);
      for v_task in
        select t.* from sub_tasks t
          join workflow_steps ws on ws.id = t.workflow_step_id
         where t.deliverable_id = d.id
           and t.status in ('todo', 'in_progress', 'blocked', 'review')
           and ws.template_id is distinct from v_new_tpl
         order by t.sort_order, t.created_at
         for update of t
      loop
        update sub_tasks set status = 'cancelled' where id = v_task.id;
        -- Cancelled work stops consuming capacity (sub_task_cancel's rule).
        delete from bookings where sub_task_id = v_task.id;
        insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
        values (v_task.tenant_id, auth.uid(), 'task_cancelled', 'sub_tasks', v_task.id,
                jsonb_build_object('reason', v_reason, 'change_request_id', r.id,
                                   'deliverable_id', d.id, 'was_status', v_task.status,
                                   'from_type', d.deliverable_type_id, 'to_type', v_type));
        if v_task.assignee_id is not null and v_task.assignee_id is distinct from auth.uid() then
          insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
          values (v_task.tenant_id, v_task.assignee_id, 'cancelled', v_task.title, 'sub_task', v_task.id,
                  auth.uid(), jsonb_build_object('reason', v_reason, 'change_request_id', r.id));
        end if;
      end loop;
    end if;

    -- The type write fires deliverable_materialise_workflow: the new type's steps are added,
    -- unassigned, idempotent on (deliverable, step, unit).
    update deliverables set deliverable_type_id = v_type where id = d.id;

    -- ADR-0100: the owner approves the new task list before anyone is assigned. (One workflow for both
    -- types: the list did not change, so neither does its approval.)
    if v_old_tpl is distinct from v_new_tpl then
      v_prior3 := coalesce(current_setting('app.task_list_approval', true), '');
      perform set_config('app.task_list_approval', 'on', true);
      update deliverables set tasks_approved_at = null, tasks_approved_by = null where id = d.id;
      perform set_config('app.task_list_approval', v_prior3, true);
    end if;
  end if;

  -- One write per field that the request names, so nothing it does not name is touched.
  if r.changes ? 'quantity' then
    -- I74.39: the units follow the number, exactly as a direct change makes them.
    v_from := greatest(coalesce(d.quantity, 1), 1);
    perform app.resize_deliverable_units(
      d.id, greatest(coalesce(v_qty, 1), 1),
      format('The deliverable''s quantity was changed from %s to %s (change request %s) — this unit is no longer made.',
             v_from, greatest(coalesce(v_qty, 1), 1), r.id),
      jsonb_build_object('change_request_id', r.id));
  end if;
  if v_has_due then
    update deliverables set due_at = v_due where id = d.id;
  end if;

  perform set_config('app.deliverable_due_at_change', v_prior2, true);
  perform set_config('app.change_request_apply', v_prior, true);

  if v_has_due and v_due is distinct from d.due_at then
    v_w := coalesce(current_setting('app.sla_event_writer', true), '');
    perform set_config('app.sla_event_writer', 'on', true);
    insert into sla_events (tenant_id, deliverable_id, event_type, attributed_to, actor_user_id, payload)
    values (d.tenant_id, d.id, 'deadline_changed',
            case when r.asked_by = 'client' then 'client'::attribution_party end, auth.uid(),
            jsonb_build_object('from', d.due_at, 'to', v_due, 'change_request_id', r.id,
                               'asked_by', r.asked_by,
                               'evidence_attached', r.evidence_asset_id is not null,
                               'evidence_asset_id', r.evidence_asset_id));
    perform set_config('app.sla_event_writer', v_w, true);
  end if;

  if r.asked_by = 'client' then
    update deliverable_change_requests set round_spent = true where id = r.id;
  end if;
end $function$;

-- ===================================================================== 5. the confirm dialogs' previews ====
-- Reproduced from 20261003130000; "added" is composed by the builder.
CREATE OR REPLACE FUNCTION public.preview_deliverable_type_change(p_deliverable uuid, p_type uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  v_tenant   uuid := app.current_tenant_id();
  d          deliverables%rowtype;
  v_old_tpl  uuid;
  v_new_tpl  uuid;
  v_ctx      text;
  v_type     text;
  v_qty      integer;
  v_cancel   jsonb;
  v_keep     jsonb;
  v_add      jsonb;
begin
  select * into d from deliverables where id = p_deliverable and tenant_id = v_tenant;
  if not found then raise exception 'deliverable % not found', p_deliverable using errcode = 'P0002'; end if;
  if not app.may_edit_deliverable(p_deliverable) then
    -- ADR-0141 d.1: only the account manager (or the account director, Traffic, the Power Admin) changes a deliverable.
    raise exception 'only the account manager changes a deliverable — ask % to change it',
            coalesce(app.refusal_names_deliverable_am(p_deliverable), 'the account manager')
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_am(p_deliverable), ''),
            hint = 'ask_account_manager';
  end if;
  if not exists (select 1 from deliverable_types t where t.id = p_type and t.tenant_id = v_tenant) then
    raise exception 'that deliverable type is not in your organization' using errcode = '22023';
  end if;

  select dt.default_workflow_template_id into v_old_tpl from deliverable_types dt where dt.id = d.deliverable_type_id;
  select dt.default_workflow_template_id into v_new_tpl from deliverable_types dt where dt.id = p_type;
  v_ctx  := app.task_title_context(d.stream_id, d.name);
  v_type := app.type_title(p_type);
  v_qty  := greatest(coalesce(d.quantity, 1), 1);

  -- Cancelled: E7's rule — an open task on a workflow step outside the new type's workflow.
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status,
                                               'assignee', up.display_name) order by t.sort_order, t.created_at), '[]'::jsonb)
    into v_cancel
    from sub_tasks t
    join workflow_steps ws on ws.id = t.workflow_step_id
    left join user_profiles up on up.id = t.assignee_id
   where t.deliverable_id = d.id
     and t.status in ('todo', 'in_progress', 'review')
     and v_old_tpl is distinct from v_new_tpl
     and ws.template_id is distinct from v_new_tpl;

  -- Kept: everything else that is not already cancelled.
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status,
                                               'assignee', up.display_name) order by t.sort_order, t.created_at), '[]'::jsonb)
    into v_keep
    from sub_tasks t
    left join workflow_steps ws on ws.id = t.workflow_step_id
    left join user_profiles up on up.id = t.assignee_id
   where t.deliverable_id = d.id
     and t.status <> 'cancelled'
     and not (t.status in ('todo', 'in_progress', 'review')
              and t.workflow_step_id is not null
              and v_old_tpl is distinct from v_new_tpl
              and ws.template_id is distinct from v_new_tpl);

  -- Added: the new type's steps the materialiser would write — its title rule, its "already there" rule.
  select coalesce(jsonb_agg(app.compose_task_title(ws.title_en, v_ctx, v_type,
                                                   case when ws.repeats_per_unit then u.n end, v_qty)
                            order by ws.sort_order, u.n), '[]'::jsonb)
    into v_add
    from workflow_steps ws
    cross join lateral generate_series(1, case when ws.repeats_per_unit then v_qty else 1 end) as u(n)
   where ws.tenant_id = v_tenant
     and ws.template_id = v_new_tpl
     and ws.is_active
     and not exists (
       select 1 from sub_tasks st
        where st.deliverable_id = d.id
          and st.workflow_step_id = ws.id
          and coalesce(st.unit_index, 0) = coalesce(case when ws.repeats_per_unit then u.n else null end, 0));

  return jsonb_build_object(
    'cancelled', v_cancel,
    'kept', v_keep,
    'added', v_add,
    -- ADR-0132 d.4: the owner's change keeps the list approved; anyone else's leaves it for the owner.
    'approved_after', (d.owner_user_id = auth.uid()),
    'owner_id', d.owner_user_id);
end $function$;

CREATE OR REPLACE FUNCTION public.preview_quantity_change(p_deliverable uuid, p_quantity integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  d        deliverables%rowtype;
  v_tpl    uuid;
  v_ctx    text;
  v_type   text;
  v_old    integer;
  v_new    integer;
  v_cancel jsonb;
  v_add    jsonb;
begin
  select * into d from deliverables where id = p_deliverable and tenant_id = v_tenant;
  if not found then raise exception 'deliverable % not found', p_deliverable using errcode = 'P0002'; end if;
  if not app.may_edit_deliverable(p_deliverable) then
    -- ADR-0141 d.1: only the account manager (or the account director, Traffic, the Power Admin) changes a deliverable.
    raise exception 'only the account manager changes a deliverable — ask % to change it',
            coalesce(app.refusal_names_deliverable_am(p_deliverable), 'the account manager')
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_am(p_deliverable), ''),
            hint = 'ask_account_manager';
  end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'a quantity is at least 1' using errcode = '22023';
  end if;
  select dt.default_workflow_template_id into v_tpl from deliverable_types dt where dt.id = d.deliverable_type_id;
  v_ctx  := app.task_title_context(d.stream_id, d.name);
  v_type := app.type_title(d.deliverable_type_id);
  v_old  := greatest(coalesce(d.quantity, 1), 1);
  v_new  := p_quantity;

  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status,
                                               'assignee', up.display_name) order by t.unit_index, t.sort_order), '[]'::jsonb)
    into v_cancel
    from sub_tasks t
    join workflow_steps ws on ws.id = t.workflow_step_id and ws.repeats_per_unit
    left join user_profiles up on up.id = t.assignee_id
   where t.deliverable_id = d.id
     and t.unit_index > v_new
     and t.status in ('todo', 'in_progress', 'review');

  select coalesce(jsonb_agg(app.compose_task_title(ws.title_en, v_ctx, v_type, u.n, v_new)
                            order by ws.sort_order, u.n), '[]'::jsonb)
    into v_add
    from workflow_steps ws
    cross join lateral generate_series(v_old + 1, v_new) as u(n)
   where v_new > v_old
     and ws.tenant_id = v_tenant and ws.template_id = v_tpl and ws.is_active and ws.repeats_per_unit
     -- a cancelled unit counts as added: the change brings it back
     and not exists (select 1 from sub_tasks st where st.deliverable_id = d.id and st.status <> 'cancelled'
                                                  and st.workflow_step_id = ws.id and st.unit_index = u.n);

  return jsonb_build_object('cancelled', v_cancel, 'added', v_add,
                            'approved_after', d.owner_user_id = auth.uid() or d.tasks_approved_at is null);
end $function$;

-- ===================================================================== 6. the tasks already written ====
-- Rewrites a task only when its title equals one the OLD rules composed for it (see the header). A function so
-- pgTAP can prove it; run once here.
create or replace function app.backfill_task_titles() returns integer
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_n integer;
  v_k integer;
begin
  -- The step tasks: "<step> — <name>[ <n>]" or "<step> — <name without ×N>[ <n>]".
  update sub_tasks t
     set title = x.new_title
    from (select t2.id,
                 app.compose_task_title(split_part(t2.title, ' — ', 1), app.task_title_context(d.stream_id, d.name),
                                        app.type_title(d.deliverable_type_id), t2.unit_index,
                                        greatest(coalesce(d.quantity, 1), 1)) as new_title
            from sub_tasks t2
            join deliverables d on d.id = t2.deliverable_id
           where t2.workflow_step_id is not null
             and position(' — ' in t2.title) > 0
             and btrim(d.name) <> ''
             and substr(t2.title, position(' — ' in t2.title) + 3) in (
                   d.name, app.task_segment(d.name),
                   d.name || ' ' || t2.unit_index::text, app.task_segment(d.name) || ' ' || t2.unit_index::text)
         ) x
   where x.id = t.id and t.title is distinct from x.new_title;
  get diagnostics v_n = row_count;

  -- The translation task: "Translation — <name>[ without ×N] (<languages>)" — to the deliverable's own languages.
  update sub_tasks t
     set title = app.translation_task_title(d.id)
    from deliverables d
   where d.id = t.deliverable_id
     and t.workflow_step_id is null
     and btrim(d.name) <> ''
     and app.translation_task_title(d.id) is not null
     and t.title is distinct from app.translation_task_title(d.id)
     and right(t.title, 1) = ')'
     and (left(t.title, length('Translation — ' || d.name || ' (')) = 'Translation — ' || d.name || ' ('
          or left(t.title, length('Translation — ' || app.task_segment(d.name) || ' ('))
             = 'Translation — ' || app.task_segment(d.name) || ' (');
  get diagnostics v_k = row_count;
  return v_n + v_k;
end $$;
comment on function app.backfill_task_titles() is
  'ADR-0071 addendum (4 Oct), run once by 20261004160000: tasks titled by the old rules (<step> — <deliverable>[ <n>], '
  'Translation — <deliverable> (…)) take the new ones; every other title is untouched. Returns the rows rewritten.';
revoke execute on function app.backfill_task_titles() from public, anon, authenticated;

do $$
declare v_n integer;
begin
  v_n := app.backfill_task_titles();
  raise notice 'I74.39: % task titles rewritten to the campaign · type rule', v_n;
end $$;

commit;
