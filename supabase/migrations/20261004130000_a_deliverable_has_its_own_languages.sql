-- ADR-0117 addendum, 4 Oct (Edward, Q18 and Q20) — I74.35, I74.36.
--
--   Q18  A deliverable starts with its campaign's languages, and a language can be added to that deliverable alone —
--        it does not change the campaign's. Until today a deliverable carried ONE language (`deliverables.language`,
--        I56.7), edited with a plain select of the campaign's languages (ADR-0117 d.7, now amended).
--   Q20  A deliverable's translation task follows its languages: "Translation — <deliverable> (English, Arabic,
--        Kurdish)". When the languages change, the task is renamed to list them and its assignee is told; with no
--        translation task yet, one is added where ADR-0117 d.4–d.5 place it (amends d.6, "created once").
--
-- ONE source of truth: `deliverables.languages text[]`, codes from the tenant's `language` list, in the order chosen.
-- `deliverables.language` is moved into it and DROPPED — every reader and writer moves in this change set
-- (write_campaign_content, update_piece_details, the edit guard, the task-list builder, the screens).
--
--   1. The column, and the backfill: a deliverable with `language` set → [language]; with none → its campaign's
--      languages (none for work outside a campaign, which stays empty).
--   2. A new deliverable with no languages takes its campaign's (BEFORE INSERT) — the wizard's pieces, a piece added on
--      the campaign page, a single job's.
--   3. The edit guard covers `languages`: the gate is unchanged (ADR-0141 d.1 — on a live campaign only the account
--      manager, the account director, Traffic and the Power Admin; `app.may_edit_piece_fields`). Taking the last
--      language away is refused (hint `languages_required`), and a code that is not on the tenant's list is refused
--      (hint `language_unknown`) — for a PATCH and the RPC alike.
--   4. `update_piece_details(p_deliverable, p_channel, p_languages text[], p_notes)` replaces the one-language form.
--   5. The task-list builder reads the DELIVERABLE's languages (it read the campaign's); the translation task's title
--      is composed in one place, `app.translation_task_title`.
--   6. The translation task follows (AFTER UPDATE OF languages): renamed, its assignee told
--      (`translation_languages_changed`, added to notifications_type_check re-emitted whole from 20261003110000), or
--      added when the deliverable has a task list and no translation task.
--
-- Reproduced WHOLE from their latest definitions (pg_get_functiondef on the local stack at 20261004120000):
--   app.tg_deliverable_edit_guard            20261003130000
--   public.update_piece_details              20261003130000 (dropped and re-created: the signature changes)
--   app.materialise_deliverable_workflow     20260927160000
--   app.write_campaign_content               20260927160000 (and again in 20261004140000, which requires a language)
--   notifications_type_check                 20261003110000
-- Safe on a populated database: the column is added with a default, the backfill writes only `languages`, and the
-- constraint added admits every row the old one did.
begin;

-- ===================================================================== 1. the column and the backfill ====
alter table deliverables add column if not exists languages text[] not null default '{}';
comment on column deliverables.languages is
  'ADR-0117 addendum (Q18, 4 Oct): the languages this deliverable is made in — `language` codes from the tenant''s '
  'list, in the order chosen. Starts as its campaign''s; one added here is the deliverable''s own. Replaces '
  '`language` (I56.7).';

-- The backfill is a function so pgTAP 227 can prove it (the test puts a `language` column back inside its own
-- rolled-back transaction). It reads `language`, so after this migration it runs only where that column exists.
create or replace function app.backfill_deliverable_languages() returns integer
language plpgsql security definer set search_path = public, app, extensions as $$
declare v_n integer;
begin
  update deliverables d
     set languages = x.langs
    from (select d2.id,
                 case when nullif(btrim(d2.language), '') is not null then array[btrim(d2.language)]
                      else coalesce((select c.languages from streams s join campaigns c on c.id = s.campaign_id
                                      where s.id = d2.stream_id), '{}')
                 end as langs
            from deliverables d2
           where cardinality(d2.languages) = 0) x
   where x.id = d.id and cardinality(x.langs) > 0;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
comment on function app.backfill_deliverable_languages() is
  'ADR-0117 addendum (Q18, 4 Oct), run once by 20261004130000: a deliverable''s one `language` becomes its list; with '
  'none, its campaign''s languages. Kept for pgTAP 227 only — it needs the dropped `language` column to run.';
revoke execute on function app.backfill_deliverable_languages() from public, anon, authenticated;

select app.backfill_deliverable_languages();

-- The guard's trigger names `language` in its column list, so it goes before the column does (re-created in 3).
drop trigger if exists deliverable_edit_guard on deliverables;
alter table deliverables drop column language;

-- ===================================================================== 2. a new deliverable starts with its campaign's ====
create or replace function app.tg_deliverable_languages_from_campaign() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
begin
  if cardinality(coalesce(new.languages, '{}')) = 0 and new.stream_id is not null then
    select coalesce(c.languages, '{}') into new.languages
      from streams s join campaigns c on c.id = s.campaign_id
     where s.id = new.stream_id;
    new.languages := coalesce(new.languages, '{}');
  end if;
  return new;
end $$;
comment on function app.tg_deliverable_languages_from_campaign() is
  'ADR-0117 addendum (Q18): a deliverable created with no languages starts with its campaign''s.';

drop trigger if exists deliverable_languages_from_campaign on deliverables;
create trigger deliverable_languages_from_campaign
  before insert on deliverables
  for each row execute function app.tg_deliverable_languages_from_campaign();

-- ===================================================================== 3. the edit guard ====
-- Reproduced from 20261003130000; `language` → `languages`, and the two refusals about the list itself.
create or replace function app.tg_deliverable_edit_guard() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
begin
  if new.name is not distinct from old.name
     and new.deliverable_type_id is not distinct from old.deliverable_type_id
     and new.quantity is not distinct from old.quantity
     and new.channel is not distinct from old.channel
     and new.languages is not distinct from old.languages
     and new.notes is not distinct from old.notes then
    return new;
  end if;
  -- Q18: a deliverable keeps at least one language once it has one, and only codes on the tenant's list are added.
  -- Before the authority check, so a migration or a system write is held to it too.
  if new.languages is distinct from old.languages then
    if cardinality(coalesce(new.languages, '{}')) = 0 and cardinality(coalesce(old.languages, '{}')) > 0 then
      raise exception 'a deliverable is made in at least one language — keep one, or choose another first'
        using errcode = '22023', hint = 'languages_required';
    end if;
    if exists (select 1 from unnest(new.languages) l(code)
                where not (l.code = any (coalesce(old.languages, '{}')))
                  and not exists (select 1 from deliverable_attribute_values av
                                   where av.tenant_id = new.tenant_id and av.attribute = 'language'
                                     and av.code = l.code)) then
      raise exception 'that language is not on your organisation''s list — add it with Add language first'
        using errcode = '22023', hint = 'language_unknown';
    end if;
  end if;
  if auth.uid() is null or app.is_system_op() then
    return new;
  end if;
  if length(trim(new.name)) = 0 then
    raise exception 'a deliverable needs a name' using errcode = '22023';
  end if;
  if new.deliverable_type_id is distinct from old.deliverable_type_id
     and old.deliverable_type_id is not null
     -- I59 E7: an accepted change request regenerates the list itself (the old type's open tasks
     -- cancelled, the new type's added for the owner to approve), so it is not refused here.
     and coalesce(current_setting('app.change_request_apply', true), '') <> 'on'
     and exists (select 1 from sub_tasks t where t.deliverable_id = old.id and t.status not in ('done', 'cancelled')) then
    raise exception
      'this deliverable already has tasks from its type — cancel them first, or leave the type as it is'
      using errcode = '22023';
  end if;
  if coalesce(current_setting('app.change_request_apply', true), '') = 'on'
     or app.may_edit_piece_fields(old.id) then
    return new;
  end if;
  raise exception 'only the account manager changes a deliverable — ask % to change it',
          coalesce(app.refusal_names_deliverable_am(old.id), 'the account manager')
    using errcode = '42501',
          detail = coalesce(app.refusal_names_deliverable_am(old.id), ''),
          hint = 'ask_account_manager';
end $$;

comment on function app.tg_deliverable_edit_guard() is
  'ADR-0141 d.1: who may change a deliverable''s name, type, quantity, channel, languages or brief lines — '
  'app.may_edit_piece_fields (the account manager''s gate on a live campaign). A blank name is refused; a type CHANGE '
  'over live tasks is refused except through an authorised apply (app.change_request_apply). ADR-0117 addendum (Q18): '
  'the last language is never taken away (languages_required) and only the tenant''s codes are added '
  '(language_unknown). Held in Postgres so a PATCH and the RPCs are governed identically.';

create trigger deliverable_edit_guard
  before update of name, deliverable_type_id, quantity, channel, languages, notes on deliverables
  for each row execute function app.tg_deliverable_edit_guard();

-- ===================================================================== 4. update_piece_details takes the list ====
drop function if exists public.update_piece_details(uuid, text, text, text);
create function public.update_piece_details(
  p_deliverable uuid,
  p_channel     text,
  p_languages   text[],
  p_notes       text
) returns void
language plpgsql security invoker
set search_path = public, app, extensions as $$
declare
  d       deliverables;
  v_langs text[];
begin
  select * into d from deliverables where id = p_deliverable and tenant_id = app.current_tenant_id();
  if d.id is null then
    raise exception 'deliverable not found' using errcode = 'P0002';
  end if;

  if not app.may_edit_piece_fields(d.id) then
    raise exception 'only the account manager changes a deliverable — ask % to change it',
            coalesce(app.refusal_names_deliverable_am(d.id), 'the account manager')
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_am(d.id), ''),
            hint = 'ask_account_manager';
  end if;

  if p_languages is null then
    -- Not given: the languages stay as they are (a caller saving only the channel or the brief lines).
    v_langs := d.languages;
  else
    -- Trimmed, blanks dropped, each once, in the order given.
    select coalesce(array_agg(x.code order by x.first), '{}') into v_langs
      from (select btrim(c) as code, min(n) as first
              from unnest(p_languages) with ordinality as u(c, n)
             where btrim(coalesce(c, '')) <> ''
             group by btrim(c)) x;
    if cardinality(v_langs) = 0 then
      raise exception 'a deliverable is made in at least one language — choose one'
        using errcode = '22023', hint = 'languages_required';
    end if;
  end if;
  -- Any language on the tenant's list — not only the campaign's (Q18); one it already has stays even if the list has
  -- since lost it. The guard holds the same rule for a PATCH.
  if exists (select 1 from unnest(v_langs) l(code)
              where not (l.code = any (d.languages))
                and not exists (select 1 from deliverable_attribute_values av
                                 where av.tenant_id = d.tenant_id and av.attribute = 'language' and av.code = l.code)) then
    raise exception 'that language is not on your organisation''s list — add it with Add language first'
      using errcode = '22023', hint = 'language_unknown';
  end if;

  update deliverables
     set channel   = nullif(trim(p_channel), ''),
         languages = v_langs,
         notes     = nullif(trim(p_notes), '')
   where id = d.id;
end $$;

comment on function public.update_piece_details(uuid, text, text[], text) is
  'I68.2 / ADR-0141 d.1 / ADR-0117 addendum (Q18): a deliverable''s channel, languages (any of the tenant''s, at '
  'least one — hint languages_required / language_unknown; null leaves them as they are) and brief lines (notes). Invoker; app.may_edit_piece_fields '
  '— the account manager''s gate on a live campaign (hint ask_account_manager). Its translation task follows.';
revoke execute on function public.update_piece_details(uuid, text, text[], text) from public, anon;
grant  execute on function public.update_piece_details(uuid, text, text[], text) to authenticated;

-- ===================================================================== 5. the translation task, composed in one place ====
create or replace function app.translation_task_title(p_deliverable uuid) returns text
language sql stable security definer set search_path = public, app, extensions as $$
  -- "Translation — <deliverable> (English, Arabic, Kurdish)": the English names, in the order chosen (ADR-0117 d.4).
  select 'Translation — ' || coalesce(nullif(app.task_segment(d.name), ''), 'deliverable') || ' (' || x.words || ')'
    from deliverables d
    cross join lateral (
      select string_agg(coalesce(av.label_en, l.code), ', ' order by l.n) as words
        from unnest(d.languages) with ordinality as l(code, n)
        left join deliverable_attribute_values av
               on av.tenant_id = d.tenant_id and av.attribute = 'language' and av.code = l.code
    ) x
   where d.id = p_deliverable and x.words is not null
$$;
comment on function app.translation_task_title(uuid) is
  'ADR-0117 d.4 (as amended 4 Oct): the translation task''s title from the deliverable''s own languages; null with none.';
revoke execute on function app.translation_task_title(uuid) from public, anon;

-- Adds the translation task where ADR-0117 d.5 places it — straight after Write Copy, else last — when the
-- deliverable has languages and no translation task. Returns 1 when it added one.
create or replace function app.place_translation_task(p_deliverable uuid) returns integer
language plpgsql security definer set search_path = public, app, extensions as $$
declare
  v_title  text := app.translation_task_title(p_deliverable);
  v_tenant uuid;
  v_dept   uuid;
  v_after  integer;
begin
  if v_title is null or exists (
    select 1 from sub_tasks st where st.deliverable_id = p_deliverable and st.title like 'Translation — %'
  ) then
    return 0;
  end if;
  select d.tenant_id, d.department_id into v_tenant, v_dept from deliverables d where d.id = p_deliverable;

  select max(st.sort_order) into v_after
    from sub_tasks st
    join workflow_steps ws on ws.id = st.workflow_step_id
   where st.deliverable_id = p_deliverable
     and ws.title_en ilike 'Write Copy%';
  if v_after is null then
    select coalesce(max(st.sort_order), 0) into v_after from sub_tasks st where st.deliverable_id = p_deliverable;
  else
    -- Make room: every later step moves down one, so the list reads ... Write Copy, Translation, ...
    update sub_tasks set sort_order = sort_order + 1
     where deliverable_id = p_deliverable and sort_order > v_after;
  end if;
  insert into sub_tasks (tenant_id, deliverable_id, title, department_id, status, sort_order, review_mode, created_by)
  values (v_tenant, p_deliverable, v_title, v_dept, 'todo', v_after + 1, 'digital', auth.uid());
  return 1;
end $$;
comment on function app.place_translation_task(uuid) is
  'ADR-0117 d.4–d.5: one translation task naming the deliverable''s languages, straight after Write Copy (else last), '
  'when it has languages and none yet. Called by the task-list builder and when the languages change.';
revoke execute on function app.place_translation_task(uuid) from public, anon;

-- Reproduced from 20260927160000: the translation part now reads the DELIVERABLE's languages, through
-- app.place_translation_task.
create or replace function app.materialise_deliverable_workflow(p_deliverable uuid, p_template uuid default null)
returns integer
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant   uuid;
  v_dept     uuid;
  v_template uuid;
  v_name     text;
  v_qty      integer;
  v_created  integer;
begin
  select d.tenant_id, d.department_id, app.task_segment(d.name), greatest(coalesce(d.quantity, 1), 1),
         coalesce(p_template, dt.default_workflow_template_id)
    into v_tenant, v_dept, v_name, v_qty, v_template
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
    -- ADR-0071 d.10, composed here at creation and then copied. I57.48: `v_name` is the deliverable's
    -- name without its " ×N" count.
    ws.title_en
      || case when coalesce(v_name, '') = '' then '' else ' — ' || v_name end
      || case when ws.repeats_per_unit and v_qty > 1 then ' ' || u.n::text else '' end,
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
  'ADR-0052 d.5: lays out a deliverable''s task list from its workflow template (idempotent). ADR-0117 (amended 4 Oct): '
  'and one translation task naming the deliverable''s languages, straight after Write Copy, when it has none.';

-- ===================================================================== 6. the translation task follows ====
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check check (type = any (array[
  'assigned', 'review_requested', 'changes_requested', 'signed_off', 'due_soon', 'dependency_ready', 'cancelled',
  'resource_clash', 'resource_required', 'campaign_approved', 'deliverable_reassigned', 'rescheduled', 'chat_added',
  'task_reinstated', 'feedback_collected', 'assignment_requested', 'assignment_approved', 'assignment_refused',
  'assignment_superseded', 'extension_requested', 'extension_approved', 'extension_refused', 'deliverable_added',
  'deliverable_owner_removed', 'task_reassigned_away', 'feedback_requested', 'assignment_overdue', 'task_reopened',
  'deliverable_reopened', 'task_blocked', 'untimed_round', 'extension_forwarded', 'change_request_sent',
  'change_request_answered', 'change_request_resolved', 'question_asked', 'question_replied', 'nudged', 'too_much',
  'too_much_answered', 'escalated', 'review_reminder', 'over_capacity', 'task_unblocked',
  'client_activation_requested', 'deliverable_type_changed', 'deliverable_edited',
  'handover_list', 'deactivation_complete',
  'link_expiring', 'file_brought_back',
  -- ADR-0139 d.4: an answer the asker hears, an offer taken, a request taken back
  'assignment_offered', 'assignment_offer_taken', 'assignment_withdrawn',
  -- ADR-0140 d.5: a booking cancelled — the assignee and their lead
  'task_unassigned',
  -- ADR-0141 d.2–d.5: the one change form, and the maker's ask for more time
  'deliverable_change_asked', 'deliverable_change_answered', 'deliverable_change_withdrawn',
  'time_asked', 'time_answered',
  -- ADR-0117 addendum (Q20, 4 Oct): a deliverable's languages changed; to its translation task's assignee
  'translation_languages_changed'
]::text[]));

create or replace function app.tg_deliverable_translation_follows() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
declare
  v_task  sub_tasks%rowtype;
  v_title text;
begin
  if new.languages is not distinct from old.languages then
    return new;
  end if;
  v_title := app.translation_task_title(new.id);

  -- The live translation task (the latest, should there be more than one). A cancelled one was taken off the list
  -- on purpose and is left as it is.
  select * into v_task from sub_tasks st
   where st.deliverable_id = new.id and st.title like 'Translation — %' and st.status <> 'cancelled'
   order by st.created_at desc
   limit 1;

  if v_task.id is not null then
    if v_title is not null and v_task.title is distinct from v_title then
      update sub_tasks set title = v_title where id = v_task.id;
      if v_task.assignee_id is not null and v_task.assignee_id is distinct from auth.uid() then
        insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
        values (new.tenant_id, v_task.assignee_id, 'translation_languages_changed', v_title, 'sub_task', v_task.id,
                auth.uid(),
                jsonb_build_object('deliverable_id', new.id, 'deliverable', new.name,
                                   'from_title', v_task.title, 'languages', to_jsonb(new.languages),
                                   'words', substring(v_title from '\(([^()]*)\)$')));
      end if;
    end if;
    return new;
  end if;

  -- No translation task yet: added where d.5 places it — once the deliverable has a task list (before that, the
  -- builder adds it when it runs, after Write Copy).
  if v_title is not null
     and not exists (select 1 from sub_tasks st where st.deliverable_id = new.id and st.title like 'Translation — %')
     and exists (select 1 from sub_tasks st where st.deliverable_id = new.id and st.status <> 'cancelled') then
    perform app.place_translation_task(new.id);
  end if;
  return new;
end $$;
comment on function app.tg_deliverable_translation_follows() is
  'ADR-0117 addendum (Q20, 4 Oct): when a deliverable''s languages change, its translation task is renamed to list '
  'them and its assignee told (translation_languages_changed); with none yet and a task list, one is added (d.5).';

drop trigger if exists deliverable_translation_follows on deliverables;
create trigger deliverable_translation_follows
  after update of languages on deliverables
  for each row execute function app.tg_deliverable_translation_follows();

-- ===================================================================== write_campaign_content reads `languages` ====
-- Reproduced from 20260927160000. A piece's languages: `languages` (a list) or the wizard's one `language`; neither
-- leaves it empty and the insert trigger gives it the campaign's.
create or replace function app.write_campaign_content(
  p_campaign    uuid,
  p_brief       jsonb,
  p_go_live     timestamptz,
  p_deliverables jsonb,
  p_phases      jsonb default null,
  p_workstreams jsonb default null
) returns void
language plpgsql
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_name   text;
  v_kind   text;
  v_stream uuid;
  v_deliv  jsonb;
  v_phase  jsonb;
  v_ws     jsonb;
  v_id     uuid;
  v_over   jsonb;
  v_on     boolean := p_phases is not null and jsonb_typeof(p_phases) = 'array' and jsonb_array_length(p_phases) > 0;
  v_n      integer := 0;
  v_phase_end date;
  -- The wizard's draft ids to the rows they became. Key -> id as text; jsonb because a plpgsql
  -- variable is the only place this needs to exist — the keys are the client's own and are never
  -- stored.
  v_ws_map jsonb := '{}'::jsonb;
  v_ws_key text;
  v_ws_id  uuid;
begin
  update campaigns
     set brief       = p_brief,
         audience    = p_brief ->> 'audiencePrimary',
         insight     = p_brief ->> 'insight',
         proposition = p_brief ->> 'proposition',
         go_live_at  = p_go_live,
         has_phases  = v_on,
         -- ADR-0117 d.1: the languages chosen, in their order. Absent or not a list leaves none.
         languages   = coalesce((
           select array_agg(x.code order by x.n)
             from jsonb_array_elements_text(
                    case when jsonb_typeof(p_brief -> 'languages') = 'array' then p_brief -> 'languages' else '[]'::jsonb end
                  ) with ordinality as x(code, n)
            where btrim(x.code) <> ''), '{}')
   where id = p_campaign and tenant_id = v_tenant
  returning name, kind into v_name, v_kind;

  if v_name is null then
    raise exception 'campaign_not_found' using errcode = 'no_data_found';
  end if;

  -- The phases first, numbered in the order given (ADR-0096 d.2). Written as the campaign's
  -- creator is by definition its authority at this moment; the table has no write policy, so the
  -- insert runs as the definer above.
  if v_on then
    for v_phase in select * from jsonb_array_elements(p_phases)
    loop
      v_n := v_n + 1;
      perform app.insert_campaign_phase(
        v_tenant, p_campaign, v_n,
        v_phase ->> 'name',
        (v_phase ->> 'startsOn')::date,
        (v_phase ->> 'endsOn')::date,
        -- I56.10: null where the phase simply ends on its date.
        nullif(v_phase ->> 'endsOnEvent', ''));
    end loop;
  end if;

  -- Then the groups (ADR-0099 d.1), because a deliverable names one on the way in: its department
  -- and the letters of its code are both taken from the group by triggers on the INSERT itself.
  if p_workstreams is not null and jsonb_typeof(p_workstreams) = 'array' then
    for v_ws in select * from jsonb_array_elements(p_workstreams)
    loop
      v_ws_key := v_ws ->> 'key';
      if v_ws_key is null or btrim(v_ws_key) = '' then
        raise exception 'every workstream in the payload needs a key' using errcode = '22023';
      end if;
      v_ws_id := app.insert_campaign_workstream(
        p_campaign,
        v_ws ->> 'name',
        nullif(v_ws ->> 'departmentId', '')::uuid,
        nullif(v_ws ->> 'ownerUserId', '')::uuid,
        -- I59.54: the letters the person typed; absent means the rule's.
        nullif(v_ws ->> 'codeLetters', ''));
      v_ws_map := v_ws_map || jsonb_build_object(v_ws_key, v_ws_id::text);
    end loop;
  end if;

  -- One stream, named for the campaign. It is a container, not a discipline (ADR-0050).
  insert into streams (tenant_id, campaign_id, name)
  values (v_tenant, p_campaign, v_name)
  returning id into v_stream;

  for v_deliv in select * from jsonb_array_elements(p_deliverables)
  loop
    -- ADR-0099 d.1: no key means ungrouped, which is legal and permanent. A key that names no
    -- group is a different thing — a payload that contradicts itself — and is refused by name
    -- rather than silently dropping the grouping the person asked for.
    v_ws_key := nullif(v_deliv ->> 'workstreamKey', '');
    v_ws_id  := nullif(v_ws_map ->> v_ws_key, '')::uuid;
    if v_ws_key is not null and v_ws_id is null then
      raise exception '"%" names a workstream that was not created with this campaign.',
        coalesce(v_deliv ->> 'name', v_ws_key) using errcode = '22023';
    end if;
    -- ADR-0116 d.3: every piece of a CAMPAIGN is in a workstream. A single job's piece never is.
    if v_kind = 'campaign' and v_ws_id is null then
      raise exception 'Every piece of a campaign goes in a workstream: "%" is in none.',
        coalesce(v_deliv ->> 'name', '?') using errcode = '22023', hint = 'piece_needs_workstream';
    end if;

    -- department_id is still not passed: `app.tg_deliverable_stamp_department` takes it from the
    -- workstream when there is one (ADR-0099 d.3) and from the owner, once, when there is not
    -- (`20260923190000`). One rule, in one place.
    insert into deliverables (
      tenant_id, stream_id, name, state, due_at, owner_user_id,
      deliverable_type_id, quantity, channel, format, phase_id, priority,
      workstream_id, content_idea, notes, languages, is_given_to_client
    )
    values (
      v_tenant,
      v_stream,
      v_deliv ->> 'name',
      'draft',
      nullif(v_deliv ->> 'dueAt', '')::timestamptz,
      nullif(v_deliv ->> 'ownerUserId', '')::uuid,
      (select dt.id from deliverable_types dt
        where dt.id = nullif(v_deliv ->> 'deliverableTypeId', '')::uuid
          and dt.tenant_id = v_tenant),
      greatest(coalesce(nullif(v_deliv ->> 'quantity', '')::int, 1), 1),
      nullif(v_deliv ->> 'channel', ''),
      nullif(v_deliv ->> 'format', ''),
      case when v_on then
        (select p.id from campaign_phases p
          where p.campaign_id = p_campaign
            and p.number = nullif(v_deliv ->> 'phaseNumber', '')::int)
      end,
      -- SJ-v3-04 (20260922160000): high | medium | low, refused by chk_deliverables_priority.
      nullif(v_deliv ->> 'priority', ''),
      -- I56.3: the group. Set HERE and not afterwards — the department stamp and the code's
      -- letters are both read off it by BEFORE INSERT triggers.
      v_ws_id,
      -- I56.8: the piece's own words.
      nullif(v_deliv ->> 'contentIdea', ''),
      nullif(v_deliv ->> 'notes', ''),
      -- ADR-0117 addendum (Q18): the piece's languages — a list, or the wizard's one language (I56.7: several
      -- languages picked in the wizard are several pieces). Neither: the campaign's (the insert trigger).
      coalesce(
        case when jsonb_typeof(v_deliv -> 'languages') = 'array' then
          (select array_agg(btrim(x.code) order by x.n)
             from jsonb_array_elements_text(v_deliv -> 'languages') with ordinality as x(code, n)
            where btrim(x.code) <> '')
        end,
        case when nullif(btrim(v_deliv ->> 'language'), '') is not null then array[btrim(v_deliv ->> 'language')] end,
        '{}'),
      -- I56.11 Q4: a MARKER that the date has been told to the client. Absent means no.
      coalesce((v_deliv ->> 'isGivenToClient')::boolean, false)
    )
    returning id into v_id;

    -- I41.8 / ADR-0093 / ADR-0096 d.7: the person was shown a tight, impossible, after-go-live or
    -- after-phase-end warning and proceeded. Record it against the row that now exists.
    v_over := v_deliv -> 'dueDateOverride';
    if v_over is not null and jsonb_typeof(v_over) = 'object' then
      select p.ends_on into v_phase_end from campaign_phases p
       where p.campaign_id = p_campaign and p.number = nullif(v_deliv ->> 'phaseNumber', '')::int;
      perform app.record_due_date_override(
        v_id,
        (v_deliv ->> 'dueAt')::date,
        v_over ->> 'severity',
        (p_go_live at time zone 'UTC')::date,
        coalesce((v_over ->> 'workingDaysLeft')::int, 0),
        coalesce((v_over ->> 'requiredDays')::int, 0),
        nullif(v_over ->> 'outstandingHours', '')::numeric,
        nullif(v_over ->> 'capacityHours', '')::numeric,
        coalesce(v_over ->> 'boundary', 'go_live'),
        case when coalesce(v_over ->> 'boundary', 'go_live') = 'phase_end' then v_phase_end end);
    end if;
  end loop;
end $$;

commit;
