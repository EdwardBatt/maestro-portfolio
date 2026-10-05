-- A demo week for the role dashboards (I61) — LOCAL ONLY. Run after `supabase db reset`:
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f scripts/db/demo-dashboards.sql
--
-- What it gives the local database, so every dashboard view has something true to show:
--   * readable names for the dev logins — the people of Figma section H (Inas Azmi the account manager,
--     Fadia Wael the Creative lead, Zubaida Jamil the maker, and their colleagues);
--   * five campaigns for Inas and two for her colleague, named as the Figma frames name them;
--   * five weeks of work — pieces due and finished in each of the last three weeks, this week's due dates
--     spread across Sunday to Thursday, work queued into the next two weeks;
--   * bookings on every working day of those weeks, so the four-week charts and the week by day have bars;
--   * the states the dashboards exist to show: late, at risk, in review, changes back, blocked on the client,
--     nobody on it, a task list waiting for approval, a go-live this week in danger.
--
-- It inserts rows directly with the triggers paused (`session_replication_role = replica`): the demo is
-- built consistent by hand — a finished piece has every task done and a finish time, a booking lies inside
-- its task's span — rather than walked through the transitions. That is fine for a local demo and wrong
-- anywhere else, so the script refuses to run unless the dev tenant from `supabase/seed.sql` is present.
-- The names in the campaigns are the designer's (Figma section H), not production data.
begin;

do $guard$
begin
  if not exists (select 1 from tenants where id = 'd0000000-0000-4000-8000-000000000001') then
    raise exception 'demo-dashboards: the dev tenant is not here — this script is for the local stack only';
  end if;
end $guard$;

set local session_replication_role = replica;

-- ------------------------------------------------------------------------------------ people
update user_profiles p set display_name = v.name, job_title = v.title
  from (values
    ('d0000000-0000-4000-8000-00000000a001'::uuid, 'Rayan Hourani',        'Systems administrator'),
    ('d0000000-0000-4000-8000-00000000a002'::uuid, 'Dalia Nassif',       'Traffic manager'),
    ('d0000000-0000-4000-8000-00000000a003'::uuid, 'Inas Azmi',        'Account manager'),
    ('d0000000-0000-4000-8000-00000000a004'::uuid, 'Fadia Wael',      'Creative lead'),
    ('d0000000-0000-4000-8000-00000000a005'::uuid, 'Noor Kanaan',       'Design team lead'),
    ('d0000000-0000-4000-8000-00000000a006'::uuid, 'Zubaida Jamil',       'Art & Video'),
    ('d0000000-0000-4000-8000-00000000a007'::uuid, 'Osama Bakri',      'Content lead'),
    ('d0000000-0000-4000-8000-00000000a008'::uuid, 'Basheer Ali',   'Motion team lead'),
    ('d0000000-0000-4000-8000-00000000a009'::uuid, 'Ismail Naji',        'Deputy team lead, Design'),
    ('d0000000-0000-4000-8000-00000000a00a'::uuid, 'Lujain Rashed',        'Motion designer'),
    ('d0000000-0000-4000-8000-00000000a00b'::uuid, 'Abeer Saad',       'Copy team lead'),
    ('d0000000-0000-4000-8000-00000000a00c'::uuid, 'Zuhour Talal',      'Copywriter'),
    ('d0000000-0000-4000-8000-00000000a00d'::uuid, 'Tamer Hilal',      'Studio lead'),
    ('d0000000-0000-4000-8000-00000000a00e'::uuid, 'Lama Nassif',      'Edit lead'),
    ('d0000000-0000-4000-8000-00000000a00f'::uuid, 'Samer Yassin',      'Producer'),
    ('d0000000-0000-4000-8000-00000000a010'::uuid, 'Kareem Idris',     'Editor'),
    ('d0000000-0000-4000-8000-00000000a011'::uuid, 'Mira Khalil',       'Planner'),
    ('d0000000-0000-4000-8000-00000000a012'::uuid, 'Jawad Hamdi',      'Account director'),
    ('d0000000-0000-4000-8000-00000000a013'::uuid, 'Rasha El-Sayed',    'Account manager'),
    ('d0000000-0000-4000-8000-00000000a014'::uuid, 'Anas Talib',       'Chief executive')
  ) as v(id, name, title)
 where p.id = v.id;
update resources r set name = p.display_name from user_profiles p where r.user_id = p.id;

-- ------------------------------------------------------------------------------------ the work
create function pg_temp.d(p_week int, p_day int, p_hour int default 9) returns timestamptz
language sql stable as $$
  -- Sunday of this week in Baghdad, then p_week weeks and p_day days on, at p_hour local time.
  select ((date_trunc('week', (now() at time zone 'Asia/Baghdad') + interval '1 day') - interval '1 day')
          + make_interval(days => p_week * 7 + p_day, hours => p_hour)) at time zone 'Asia/Baghdad'
$$;

do $demo$
declare
  T   constant uuid := 'd0000000-0000-4000-8000-000000000001';
  CRE constant uuid := 'd0000000-0000-4000-8000-00000000d001';
  CON constant uuid := 'd0000000-0000-4000-8000-00000000d002';
  DES constant uuid := 'd0000000-0000-4000-8000-00000000d101';
  MOT constant uuid := 'd0000000-0000-4000-8000-00000000d102';
  CPY constant uuid := 'd0000000-0000-4000-8000-00000000d105';
  INAS   constant uuid := 'd0000000-0000-4000-8000-00000000a003';
  RANIA  constant uuid := 'd0000000-0000-4000-8000-00000000a013';
  FADIA constant uuid := 'd0000000-0000-4000-8000-00000000a004';
  NOUR   constant uuid := 'd0000000-0000-4000-8000-00000000a005';
  ZUBAIDA  constant uuid := 'd0000000-0000-4000-8000-00000000a006';
  BADR   constant uuid := 'd0000000-0000-4000-8000-00000000a008';
  ISMAIL  constant uuid := 'd0000000-0000-4000-8000-00000000a009';
  LUJAIN   constant uuid := 'd0000000-0000-4000-8000-00000000a00a';
  ABEER   constant uuid := 'd0000000-0000-4000-8000-00000000a00b';
  ZUHOUR constant uuid := 'd0000000-0000-4000-8000-00000000a00c';
  c_kite uuid; c_aura uuid; c_brunos uuid; c_zeta uuid; c_mall uuid;
  k uuid; s uuid; w uuid; p uuid; tk uuid;
  i int; wk int; dy int; st text; fin timestamptz; due timestamptz;
  maker uuid; mdept uuid; mteam uuid;
  makers uuid[] := array[ZUBAIDA, ISMAIL, BADR, LUJAIN, ZUHOUR, ABEER, NOUR];
begin
  -- clients --------------------------------------------------------------------------------
  insert into clients (tenant_id, name, account_manager_id) values (T, 'Kite Card', INAS) returning id into c_kite;
  insert into clients (tenant_id, name, account_manager_id) values (T, 'Auracell', INAS) returning id into c_aura;
  insert into clients (tenant_id, name, account_manager_id) values (T, 'Brunos Snacks', INAS) returning id into c_brunos;
  insert into clients (tenant_id, name, account_manager_id) values (T, 'Zeta Mobile', RANIA) returning id into c_zeta;
  insert into clients (tenant_id, name, account_manager_id) values (T, 'Riverside Mall', RANIA) returning id into c_mall;

  -- A campaign: its stream and one workstream in Creative. Returns the stream in `s`, the workstream in `w`.
  -- (Written inline per campaign below, with the pieces that make its story.)

  -- 1. LUMA Season 2 (Kite Card) — the big one: goes live this Thursday, three pieces at risk.
  insert into campaigns (tenant_id, client_id, name, account_manager_id, status, kind, go_live_at, approved_at, approved_by, created_at)
  values (T, c_kite, 'LUMA Season 2', INAS, 'approved', 'campaign', pg_temp.d(0, 4, 18), pg_temp.d(-5, 0), INAS, pg_temp.d(-6, 0))
  returning id into k;
  insert into streams (tenant_id, campaign_id, name) values (T, k, 'LUMA Season 2') returning id into s;
  insert into workstreams (tenant_id, campaign_id, name, department_id, owner_user_id, code_letters)
  values (T, k, 'Launch visuals', CRE, FADIA, 'LV') returning id into w;

  -- Every piece of LUMA: name, due (week, day), outcome. Outcomes: on_time / late (finished after its date),
  -- open_late (not finished, date passed), review, progress, changes, blocked, risk (not started, tight),
  -- nobody (approved list, no one on a task), todo.
  for i, p, st, wk, dy in
    select * from (values
      (1,  null::uuid, 'on_time', -3, 1), (2,  null, 'on_time', -3, 3), (3,  null, 'late',    -3, 4),
      (4,  null, 'on_time', -2, 0), (5,  null, 'on_time', -2, 2), (6,  null, 'on_time', -2, 3), (7, null, 'late', -2, 4),
      (8,  null, 'on_time', -1, 0), (9,  null, 'on_time', -1, 1), (10, null, 'on_time', -1, 2), (11, null, 'late', -1, 3),
      (12, null, 'open_late', -1, 4),
      (13, null, 'on_time', 0, 0), (14, null, 'review',  0, 0), (15, null, 'review', 0, 1), (16, null, 'changes', 0, 2),
      (17, null, 'progress', 0, 2), (18, null, 'progress', 0, 3), (19, null, 'blocked', 0, 3), (20, null, 'risk', 0, 4),
      (21, null, 'risk', 0, 4), (22, null, 'nobody', 0, 4), (23, null, 'progress', 0, 4),
      (24, null, 'todo', 1, 1), (25, null, 'todo', 1, 2), (26, null, 'nobody', 1, 3), (27, null, 'todo', 2, 0)
    ) as x(i, p, st, wk, dy)
  loop
    -- This week's unfinished work falls due from today on (a date already gone would make it late, not at risk).
    if wk = 0 and st not in ('on_time', 'late') then
      -- …and at least two days out, so the design (due the day before) leaves the review day the piece needs.
      dy := least(4, greatest(dy, extract(dow from now() at time zone 'Asia/Baghdad')::int + case when st in ('risk','nobody') then 0 else 2 end));
    end if;
    due := pg_temp.d(wk, dy, 17);
    maker := (array[ZUBAIDA, BADR, ZUBAIDA, ISMAIL, BADR, ZUBAIDA, ISMAIL])[1 + (i % 7)];
    select department_id, team_id into mdept, mteam from user_profiles where id = maker;
    fin := case st when 'on_time' then due - interval '1 day' when 'late' then due + interval '1 day' end;
    insert into deliverables (tenant_id, stream_id, workstream_id, name, state, due_at, owner_user_id, department_id,
                              reviewer_id, tasks_approved_at, tasks_approved_by, finished_at, revision_limit, quantity, created_at)
    values (T, s, w,
            (array['Post','Reel','Story','Carousel','Explainer','Banner','Winner cards','Opener','Teaser','Cutdown'])[1 + (i % 10)]
              || ' ' || i || ' — ' ||
            (array['payment chime','interactive reveal','draw night','weekly winners','how to enter','prize wall','launch countdown'])[1 + (i % 7)],
            -- Finished in an earlier week: handed to the client. Finished this week: approved, not yet handed over.
            case when st in ('on_time','late') and wk < 0 then 'delivered' when st in ('on_time','late') then 'approved'
                 when st = 'review' then 'in_review' else 'in_progress' end::deliverable_state,
            due, case when i % 3 = 0 then NOUR else FADIA end, CRE, INAS,
            pg_temp.d(wk - 2, 0), FADIA, fin, 2, 1, pg_temp.d(-6, 0))
    returning id into p;

    -- Two tasks: the design and the copy. The design carries the state; the copy is done unless noted.
    insert into sub_tasks (tenant_id, deliverable_id, title, assignee_id, department_id, team_id, status,
                           committed_starts_at, committed_due_at, starts_at, due_at, sla_hours, committed_hours,
                           revision_number, assigned_at, review_mode, sort_order)
    values (T, p, 'Design', case when st = 'nobody' then null else maker end, mdept, mteam,
            case st when 'on_time' then 'done' when 'late' then 'done' when 'review' then 'review'
                    when 'progress' then 'in_progress' when 'changes' then 'in_progress' when 'blocked' then 'in_progress'
                    when 'open_late' then 'in_progress' else 'todo' end,
            due - interval '3 days', due - interval '1 day', due - interval '3 days', due - interval '1 day', 8, 8,
            case when st = 'changes' then 1 when st = 'late' then 2 else 0 end,
            case when st = 'nobody' then null else pg_temp.d(wk - 1, 0) end, 'digital', 1)
    returning id into tk;
    if st = 'risk' then update sub_tasks set description = 'demo: nothing booked' where id = tk; end if;
    if st = 'review' then
      insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory) values (T, tk, INAS, true);
      insert into task_time_entries (tenant_id, sub_task_id, user_id, round, started_at, submitted_at, minutes, mode)
      values (T, tk, maker, 0, due - interval '3 days', now() - make_interval(hours => 3 + i), 480, 'timer');
    end if;
    if st = 'blocked' then
      insert into deliverable_pending_inputs (tenant_id, deliverable_id, description, awaited_from, requested_at, kind)
      values (T, p, 'Offer terms for the launch film', 'Hasan at Kite Card', now() - interval '6 days', 'client');
    end if;
    insert into sub_tasks (tenant_id, deliverable_id, title, assignee_id, department_id, team_id, status,
                           committed_starts_at, committed_due_at, starts_at, due_at, sla_hours, committed_hours,
                           revision_number, assigned_at, review_mode, sort_order)
    values (T, p, 'Arabic copy', case when st = 'nobody' then null else ABEER end, CON, CPY,
            case when st in ('todo','risk','nobody') then 'todo' when st = 'open_late' then 'in_progress' else 'done' end,
            -- Copy comes first on work already moving; on work not yet started it is written the day before the design is due.
            case when st in ('todo','risk','nobody') then due - interval '2 days' else due - interval '5 days' end,
            case when st in ('todo','risk','nobody') then due - interval '1 day' else due - interval '4 days' end,
            case when st in ('todo','risk','nobody') then due - interval '2 days' else due - interval '5 days' end,
            case when st in ('todo','risk','nobody') then due - interval '1 day' else due - interval '4 days' end, 4, 4,
            0, case when st = 'nobody' then null else pg_temp.d(wk - 1, 0) end, 'digital', 2);
  end loop;

  -- 2. Miles & Smiles Offer (Kite Card) — its list is approved and nobody is on most of it.
  insert into campaigns (tenant_id, client_id, name, account_manager_id, status, kind, go_live_at, approved_at, approved_by)
  values (T, c_kite, 'Miles & Smiles Offer', INAS, 'approved', 'campaign', pg_temp.d(3, 0, 18), pg_temp.d(-1, 0), INAS)
  returning id into k;
  insert into streams (tenant_id, campaign_id, name) values (T, k, 'Miles & Smiles Offer') returning id into s;
  insert into workstreams (tenant_id, campaign_id, name, department_id, owner_user_id, code_letters)
  values (T, k, 'Offer launch', CRE, NOUR, 'OL') returning id into w;
  for i in 1..6 loop
    insert into deliverables (tenant_id, stream_id, workstream_id, name, state, due_at, owner_user_id, department_id,
                              reviewer_id, tasks_approved_at, tasks_approved_by, revision_limit, quantity)
    values (T, s, w, (array['Offer key visual','Airport OOH','Miles explainer','Offer carousel','App banner','Email header'])[i],
            'in_progress', pg_temp.d(2 + i / 3, i % 5, 17), NOUR, CRE, INAS, now() - interval '30 hours', NOUR, 2, 1)
    returning id into p;
    insert into sub_tasks (tenant_id, deliverable_id, title, assignee_id, department_id, team_id, status, due_at, sla_hours, review_mode, sort_order)
    values (T, p, 'Design', case when i = 1 then ZUBAIDA end, CRE, DES, 'todo', pg_temp.d(2 + i / 3, i % 5, 17), 8, 'digital', 1),
           (T, p, 'Arabic copy', null, CON, CPY, 'todo', pg_temp.d(2 + i / 3, i % 5, 12), 4, 'digital', 2);
  end loop;

  -- 3. Eid banner set (Auracell) — approved inside, waiting on the client's sign-off.
  insert into campaigns (tenant_id, client_id, name, account_manager_id, status, kind, go_live_at, approved_at, approved_by)
  values (T, c_aura, 'Eid banner set', INAS, 'approved', 'campaign', pg_temp.d(1, 2, 18), pg_temp.d(-3, 0), INAS)
  returning id into k;
  insert into streams (tenant_id, campaign_id, name) values (T, k, 'Eid banner set') returning id into s;
  for i in 1..4 loop
    insert into deliverables (tenant_id, stream_id, name, state, due_at, owner_user_id, department_id, reviewer_id,
                              tasks_approved_at, finished_at, revision_limit, quantity)
    values (T, s, 'Eid banner ' || (array['900 × 250','300 × 600','Story','Homepage'])[i], 'approved', pg_temp.d(0, i - 1, 17),
            FADIA, CRE, INAS, pg_temp.d(-2, 0), pg_temp.d(0, i - 1, 11), 2, 1)
    returning id into p;
    insert into sub_tasks (tenant_id, deliverable_id, title, assignee_id, department_id, team_id, status, committed_due_at, due_at, sla_hours, committed_hours, review_mode, sort_order)
    values (T, p, 'Design', ISMAIL, CRE, DES, 'done', pg_temp.d(0, i - 1, 12), pg_temp.d(0, i - 1, 12), 6, 6, 'digital', 1);
    if i = 1 then
      insert into deliverable_pending_inputs (tenant_id, deliverable_id, description, awaited_from, requested_at, kind)
      values (T, p, 'Client sign-off on the reduced scope', 'Ahmed at Auracell', now() - interval '2 days', 'client');
    end if;
  end loop;

  -- 4. Borderless Card (Kite Card) — early days, two pieces in progress.
  insert into campaigns (tenant_id, client_id, name, account_manager_id, status, kind, go_live_at, approved_at, approved_by)
  values (T, c_kite, 'Borderless Card', INAS, 'approved', 'campaign', pg_temp.d(4, 0, 18), pg_temp.d(-1, 2), INAS)
  returning id into k;
  insert into streams (tenant_id, campaign_id, name) values (T, k, 'Borderless Card') returning id into s;
  for i in 1..8 loop
    insert into deliverables (tenant_id, stream_id, name, state, due_at, owner_user_id, department_id, reviewer_id, tasks_approved_at, revision_limit, quantity)
    values (T, s, (array['Card reveal film','Card key visual','Unboxing reel','How it works','Branch poster','App tile','Launch email','Press kit'])[i],
            'in_progress', pg_temp.d(2 + i / 2, i % 5, 17), BADR, CRE, INAS, pg_temp.d(-1, 3), 2, 1)
    returning id into p;
    insert into sub_tasks (tenant_id, deliverable_id, title, assignee_id, department_id, team_id, status,
                           committed_starts_at, committed_due_at, due_at, sla_hours, committed_hours, assigned_at, review_mode, sort_order)
    values (T, p, 'Motion', case when i <= 4 then (array[BADR, LUJAIN])[1 + i % 2] end, CRE, MOT,
            case when i <= 2 then 'in_progress' else 'todo' end,
            pg_temp.d(0, i % 5, 9), pg_temp.d(2 + i / 2, i % 5, 12) - interval '2 days', pg_temp.d(2 + i / 2, i % 5, 12) - interval '2 days', 16, 16,
            case when i <= 4 then pg_temp.d(-1, 3) end, 'digital', 1);
  end loop;

  -- 5. Brunos social calendar (Brunos Snacks) — all eight delivered, on time.
  insert into campaigns (tenant_id, client_id, name, account_manager_id, status, kind, go_live_at, approved_at, approved_by)
  values (T, c_brunos, 'Brunos social calendar', INAS, 'approved', 'campaign', pg_temp.d(-1, 0, 18), pg_temp.d(-5, 0), INAS)
  returning id into k;
  insert into streams (tenant_id, campaign_id, name) values (T, k, 'Brunos social calendar') returning id into s;
  for i in 1..8 loop
    due := pg_temp.d(-4 + i / 3, i % 5, 17);
    insert into deliverables (tenant_id, stream_id, name, state, due_at, owner_user_id, department_id, reviewer_id,
                              tasks_approved_at, finished_at, is_given_to_client, revision_limit, quantity)
    values (T, s, 'Brunos post ' || i || ' — ' || (array['crunch test','flavour poll','match night','study snack','road trip','office drawer','family tray','last bite'])[i],
            'delivered', due, FADIA, CRE, INAS, pg_temp.d(-5, 0), due - interval '1 day', true, 2, 1)
    returning id into p;
    insert into sub_tasks (tenant_id, deliverable_id, title, assignee_id, department_id, team_id, status, committed_due_at, due_at, sla_hours, committed_hours, review_mode, sort_order)
    values (T, p, 'Design', ZUHOUR, CON, CPY, 'done', due - interval '1 day', due - interval '1 day', 4, 4, 'digital', 1);
  end loop;

  -- 5b. LUMA Season 1 (Kite Card) — the season before: 24 pieces, finished four to eight weeks ago.
  insert into campaigns (tenant_id, client_id, name, account_manager_id, status, kind, go_live_at, approved_at, approved_by)
  values (T, c_kite, 'LUMA Season 1', INAS, 'approved', 'campaign', pg_temp.d(-4, 4, 18), pg_temp.d(-10, 0), INAS)
  returning id into k;
  insert into streams (tenant_id, campaign_id, name) values (T, k, 'LUMA Season 1') returning id into s;
  for i in 1..24 loop
    due := pg_temp.d(-8 + (i - 1) / 6, i % 5, 17);
    insert into deliverables (tenant_id, stream_id, name, state, due_at, owner_user_id, department_id, reviewer_id,
                              tasks_approved_at, finished_at, is_given_to_client, revision_limit, quantity)
    values (T, s, 'Season 1 · ' || (array['Post','Reel','Story','Banner'])[1 + i % 4] || ' ' || i, 'delivered', due, FADIA, CRE, INAS,
            pg_temp.d(-9, 0), due - case when i % 7 = 0 then interval '-1 day' else interval '1 day' end, true, 2, 1)
    returning id into p;
    insert into sub_tasks (tenant_id, deliverable_id, title, assignee_id, department_id, team_id, status, committed_due_at, due_at, sla_hours, committed_hours, review_mode, sort_order)
    values (T, p, 'Design', (array[ZUBAIDA, ISMAIL, LUJAIN])[1 + i % 3], CRE, DES, 'done', due - interval '1 day', due - interval '1 day', 8, 8, 'digital', 1);
  end loop;

  -- 6. Back to School (Zeta Mobile, Rania) — goes live Wednesday; two pieces late.
  insert into campaigns (tenant_id, client_id, name, account_manager_id, status, kind, go_live_at, approved_at, approved_by)
  values (T, c_zeta, 'Back to School', RANIA, 'approved', 'campaign', pg_temp.d(0, 3, 18), pg_temp.d(-3, 0), RANIA)
  returning id into k;
  insert into streams (tenant_id, campaign_id, name) values (T, k, 'Back to School') returning id into s;
  for i in 1..5 loop
    due := pg_temp.d(case when i <= 2 then -1 else 0 end, 1 + i % 3, 17);
    insert into deliverables (tenant_id, stream_id, name, state, due_at, owner_user_id, department_id, reviewer_id, tasks_approved_at, revision_limit, quantity)
    values (T, s, (array['Backpack hero','Student bundle reel','Campus OOH','Data offer post','Store poster'])[i],
            'in_progress', due, NOUR, CRE, RANIA, pg_temp.d(-2, 0), 2, 1)
    returning id into p;
    insert into sub_tasks (tenant_id, deliverable_id, title, assignee_id, department_id, team_id, status,
                           committed_starts_at, committed_due_at, due_at, sla_hours, committed_hours, assigned_at, review_mode, sort_order)
    values (T, p, 'Design', (array[ZUBAIDA, ISMAIL, BADR])[1 + i % 3], CRE, case when i % 3 = 2 then MOT else DES end, 'in_progress',
            due - interval '3 days', due - interval '1 day', due - interval '1 day', 10, 10, pg_temp.d(-2, 1), 'digital', 1);
  end loop;

  -- 7. Mall Anniversary (Riverside Mall, Rania) — approved, its task lists not yet (they reach the leads, ADR-0119).
  insert into campaigns (tenant_id, client_id, name, account_manager_id, status, kind, go_live_at, approved_at, approved_by)
  values (T, c_mall, 'Mall Anniversary', RANIA, 'approved', 'campaign', pg_temp.d(5, 0, 18), now() - interval '26 hours', RANIA)
  returning id into k;
  insert into streams (tenant_id, campaign_id, name) values (T, k, 'Mall Anniversary') returning id into s;
  for i in 1..3 loop
    insert into deliverables (tenant_id, stream_id, name, state, due_at, owner_user_id, department_id, reviewer_id, revision_limit, quantity)
    values (T, s, (array['Anniversary key visual','Countdown stories','Atrium banner'])[i], 'in_progress', pg_temp.d(3, i, 17), FADIA, CRE, RANIA, 2, 1)
    returning id into p;
    insert into sub_tasks (tenant_id, deliverable_id, title, department_id, team_id, status, sla_hours, review_mode, sort_order)
    values (T, p, 'Design', CRE, DES, 'todo', 8, 'digital', 1), (T, p, 'Arabic copy', CON, CPY, 'todo', 4, 'digital', 2);
  end loop;
end $demo$;

-- ------------------------------------------------------------------------------------ bookings
-- Every assigned task is booked for its own hours, spread over the working days (Sun–Thu) of its committed span —
-- the way a lead books work — from three weeks back to next week. The two pieces meant to be at risk are left
-- unbooked. Zubaida carries the most, so she lands past the ceiling this week, as in the Figma story.
do $book$
declare
  T constant uuid := 'd0000000-0000-4000-8000-000000000001';
  r record; d date; n int; per numeric; res uuid; left_h numeric; have numeric;
begin
  for r in
    select st.id, st.assignee_id, coalesce(st.committed_hours, st.sla_hours, 8) as hours,
           (coalesce(st.committed_starts_at, st.due_at - interval '3 days') at time zone 'Asia/Baghdad')::date as first_day,
           (coalesce(st.committed_due_at, st.due_at) at time zone 'Asia/Baghdad')::date as last_day
      from sub_tasks st
     where st.tenant_id = T and st.assignee_id is not null and st.status <> 'cancelled'
       and coalesce(st.committed_due_at, st.due_at) is not null
       and st.description is distinct from 'demo: nothing booked'
       and coalesce(st.committed_due_at, st.due_at) >= pg_temp.d(-3, 0)
       and coalesce(st.committed_starts_at, st.due_at - interval '3 days') < pg_temp.d(2, 0)
     order by coalesce(st.committed_due_at, st.due_at)
  loop
    select id into res from resources where user_id = r.assignee_id;
    continue when res is null;
    select count(*) into n from generate_series(r.first_day, r.last_day, interval '1 day') g where extract(dow from g) between 0 and 4;
    continue when n = 0;
    -- Fill the lightest days of the span first, up to a normal day (8 h); anything left spreads evenly on top.
    left_h := r.hours;
    for d in
      select g::date from generate_series(r.first_day, r.last_day, interval '1 day') g
       where extract(dow from g) between 0 and 4
       order by (select coalesce(sum(extract(epoch from b.ends_at - b.starts_at)) / 3600, 0) from bookings b
                  where b.resource_id = res and (b.starts_at at time zone 'Asia/Baghdad')::date = g::date), g
    loop
      exit when left_h <= 0;
      select coalesce(sum(extract(epoch from b.ends_at - b.starts_at)) / 3600, 0) into have from bookings b
       where b.resource_id = res and (b.starts_at at time zone 'Asia/Baghdad')::date = d;
      per := least(left_h, greatest(0, 8 - have));
      if per <= 0 then per := least(left_h, ceil(r.hours * 60 / n) / 60.0); end if;
      insert into bookings (tenant_id, resource_id, state, starts_at, ends_at, sub_task_id, is_exclusive)
      values (T, res, 'confirmed', (d + time '09:00' + make_interval(mins => (least(have, 8) * 60)::int)) at time zone 'Asia/Baghdad',
              (d + time '09:00' + make_interval(mins => (least(have, 8) * 60)::int + ceil(per * 60)::int)) at time zone 'Asia/Baghdad', r.id, false);
      left_h := left_h - per;
    end loop;
  end loop;
end $book$;

-- Top each person up to the week the Figma story gives them (DB-L "Load by person"), on their own nearest task,
-- and ramp the three weeks before up to it (60%, 75%, 85%) — so the four-week charts climb as they do in the frames.
do $topup$
declare
  T constant uuid := 'd0000000-0000-4000-8000-000000000001';
  r record; wk int; dy int; have numeric; want numeric; per numeric; res uuid; tk uuid;
begin
  for r in
    select * from (values
      ('d0000000-0000-4000-8000-00000000a006'::uuid, 42),  -- Zubaida: past the ceiling
      ('d0000000-0000-4000-8000-00000000a008'::uuid, 40),  -- Basheer: at it
      ('d0000000-0000-4000-8000-00000000a005'::uuid, 30),  -- Nour
      ('d0000000-0000-4000-8000-00000000a00b'::uuid, 26),  -- Abeer
      ('d0000000-0000-4000-8000-00000000a009'::uuid, 24),  -- Ismail
      ('d0000000-0000-4000-8000-00000000a00c'::uuid, 16),  -- Zuhour: free later in the week
      ('d0000000-0000-4000-8000-00000000a004'::uuid, 12),  -- Fadia
      ('d0000000-0000-4000-8000-00000000a00a'::uuid, 8)    -- Lujain
    ) as x(uid, hours)
  loop
    select id into res from resources where user_id = r.uid;
    for wk in -3..0 loop
      want := r.hours * case wk when -3 then 0.6 when -2 then 0.75 when -1 then 0.85 else 1 end;
      select coalesce(sum(extract(epoch from least(b.ends_at, pg_temp.d(wk, 5, 0)) - greatest(b.starts_at, pg_temp.d(wk, 0, 0))) / 3600), 0)
        into have from bookings b
       where b.resource_id = res and b.starts_at < pg_temp.d(wk, 5, 0) and b.ends_at > pg_temp.d(wk, 0, 0);
      continue when have >= want;
      -- Zuhour and Fadia keep the end of the week free; everyone else spreads over all five days.
      per := round((want - have) / case when r.hours <= 16 then 3 else 5 end, 1);
      -- Zuhour, Fadia and Lujain keep the end of the week free; everyone else spreads over all five days.
      for dy in 0..(case when r.hours <= 16 then 2 else 4 end) loop
        select id into tk from sub_tasks where assignee_id = r.uid
         order by abs(extract(epoch from coalesce(committed_due_at, due_at, now()) - pg_temp.d(wk, dy, 12))) limit 1;
        insert into bookings (tenant_id, resource_id, state, starts_at, ends_at, sub_task_id, is_exclusive)
        values (T, res, 'confirmed', pg_temp.d(wk, dy, 13), pg_temp.d(wk, dy, 13) + make_interval(mins => (per * 60)::int), tk, false);
      end loop;
    end loop;
  end loop;
end $topup$;

-- Work in progress has time logged for the days already worked: its booked hours before now, on the current round
-- (`round` is the task's revision number, as the app writes it — 20260926102000).
insert into task_time_entries (tenant_id, sub_task_id, user_id, round, started_at, minutes, mode)
select st.tenant_id, st.id, st.assignee_id, st.revision_number, min(b.starts_at),
       round(sum(extract(epoch from least(b.ends_at, now()) - b.starts_at) / 60)), 'timer'
  from sub_tasks st join bookings b on b.sub_task_id = st.id
 where st.status = 'in_progress' and b.starts_at < now()
 group by st.tenant_id, st.id, st.assignee_id, st.revision_number;

-- One room booked twice on Tuesday, so Traffic has a clash to resolve.
insert into resources (tenant_id, kind, name, capacity_model)
select 'd0000000-0000-4000-8000-000000000001', 'room', 'Edit Suite 1', 'exclusive'
 where not exists (select 1 from resources where name = 'Edit Suite 1');
insert into bookings (tenant_id, resource_id, state, starts_at, ends_at, title, is_exclusive)
select 'd0000000-0000-4000-8000-000000000001', r.id, 'confirmed', pg_temp.d(0, 2, 10), pg_temp.d(0, 2, 14), x.title, false
  from resources r, (values ('Launch film grade'), ('Back to School voice-over')) as x(title)
 where r.name = 'Edit Suite 1';

-- ------------------------------------------------------------------------------------ every campaign piece in a workstream
-- ADR-0116 d.3 (27 Sep): a campaign's piece always names its workstream — the app refuses one without. The campaigns
-- above were written straight into the tables, past that rule, so each gets the workstream the wizard would have made
-- (named for its work, managed by the campaign's account manager, in its pieces' department) and its pieces join it.
do $$
declare
  r record;
  w uuid;
begin
  for r in
    select c.id, c.tenant_id, c.account_manager_id,
           case c.name
             when 'LUMA Season 1'          then 'Design & Animation'
             when 'Brunos social calendar' then 'Social posts'
             when 'Eid banner set'         then 'Digital banners'
             when 'Back to School'         then 'Launch visuals'
             when 'Mall Anniversary'       then 'Launch visuals'
             when 'Borderless Card'        then 'Launch visuals'
             else 'Launch visuals'
           end as ws_name,
           (select d.department_id from deliverables d join streams s on s.id = d.stream_id
             where s.campaign_id = c.id and d.department_id is not null limit 1) as dept
      from campaigns c
     where c.kind = 'campaign'
       and c.tenant_id = 'd0000000-0000-4000-8000-000000000001'
       and exists (select 1 from deliverables d join streams s on s.id = d.stream_id
                    where s.campaign_id = c.id and d.workstream_id is null)
  loop
    select id into w from workstreams where campaign_id = r.id and name = r.ws_name;
    if w is null then
      insert into workstreams (tenant_id, campaign_id, name, department_id, owner_user_id, code_letters)
      values (r.tenant_id, r.id, r.ws_name, r.dept, r.account_manager_id, app.workstream_code_letters(r.ws_name))
      returning id into w;
    end if;
    -- The piece joins the workstream; an ID it took before it had one (the "WS-" fallback) is re-issued below.
    update deliverables d set workstream_id = w,
           code = case when d.code like 'WS-%' then null else d.code end
      from streams s
     where s.id = d.stream_id and s.campaign_id = r.id and d.workstream_id is null;
  end loop;
end $$;

-- ------------------------------------------------------------------------------------ every field the Grid shows
-- The pieces above were written with the triggers paused, so the one that stamps a piece's ID (I56.9) never ran
-- and the Grid showed "—" for every ID (Edward, 28 Sep). Each piece gets what an app-made piece has: its ID from
-- the same function the trigger calls, in due-date order within its campaign; a deliverable type from the
-- catalogue that matches its name, with that type's channel and file format; the campaign's master language.
do $$
declare
  r record;
begin
  for r in
    select d.id, d.stream_id,
           coalesce(nullif(w.code_letters, ''), app.workstream_code_letters(w.name), 'WS') as letters
      from deliverables d
      left join workstreams w on w.id = d.workstream_id
     where d.code is null
       and d.tenant_id = 'd0000000-0000-4000-8000-000000000001'
     order by d.stream_id, d.due_at nulls last, d.created_at, d.id
  loop
    update deliverables set code = app.next_deliverable_code(r.stream_id, r.letters) where id = r.id;
  end loop;
end $$;

with kinds(pattern, type_code, channel, format) as (values
  ('reel',      'SOC-004', 'INSTAGRAM', 'MP4'),
  ('carousel',  'SOC-002', 'INSTAGRAM', 'PNG'),
  ('story',     'SOC-003', 'INSTAGRAM', 'MP4'),
  ('banner',    'DIG-005', 'WEBSITE',   'PNG'),
  ('winner',    'DIG-005', 'WEBSITE',   'PNG'),
  ('cutdown',   'VID-021', 'TIKTOK',    'MP4'),
  ('explainer', 'VID-006', 'YOUTUBE',   'MP4'),
  ('teaser',    'VID-009', 'TIKTOK',    'MP4'),
  ('opener',    'VID-009', 'TIKTOK',    'MP4'),
  ('post',      'SOC-001', 'FACEBOOK',  'JPG')
), matched as (
  select distinct on (d.id) d.id, k.type_code, k.channel, k.format
    from deliverables d
    left join kinds k on d.name ~* k.pattern
   where d.deliverable_type_id is null
     and d.tenant_id = 'd0000000-0000-4000-8000-000000000001'
   order by d.id, k.pattern is null, k.pattern
)
update deliverables d
   set deliverable_type_id = (select t.id from deliverable_types t where t.tenant_id = d.tenant_id and t.code = coalesce(m.type_code, 'SOC-001')),
       channel  = coalesce(nullif(d.channel, ''), coalesce(m.channel, 'INSTAGRAM')),
       format   = coalesce(nullif(d.format, ''), coalesce(m.format, 'JPG')),
       -- ADR-0117 addendum (Q18): a deliverable's languages (the list replaced the one `language`).
       languages = case when cardinality(d.languages) = 0 then array['ar'] else d.languages end
  from matched m
 where m.id = d.id;

commit;
