-- The public read-wrappers must forward to the app resolvers (the UI calls these via rpc()).
begin;
select plan(3);
\ir helpers/seed.sql

-- effective_sla: a sub-task with a manual leaf SLA
insert into sub_tasks (id, tenant_id, deliverable_id, title, sla_hours)
values ('aaaaaaaa-0000-0000-0000-0000000035a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f101','W',5);
select is((select public.effective_sla('aaaaaaaa-0000-0000-0000-0000000035a1')), 5::numeric,
  'public.effective_sla forwards to app.effective_sla');

-- attendance_deviation: a weekend is suppressed (needs a tenant default profile)
insert into attendance_profiles (tenant_id, name, expected_check_in, expected_minutes, is_default)
values ('aaaaaaaa-0000-0000-0000-000000000001','Std','09:00',480,true);
select is((select suppressed from public.attendance_deviation('00000000-0000-0000-0000-00000000a003','2026-08-16')), true,
  'public.attendance_deviation forwards (a weekend is suppressed)');

-- kpi_rollup: one member's target rolls up to their team
insert into departments (id, tenant_id, name) values ('aaaaaaaa-0000-0000-0000-0000000035d1','aaaaaaaa-0000-0000-0000-000000000001','D35');
insert into teams (id, tenant_id, department_id, name) values ('aaaaaaaa-0000-0000-0000-0000000035b1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000035d1','T35');
update user_profiles set team_id='aaaaaaaa-0000-0000-0000-0000000035b1' where id='00000000-0000-0000-0000-00000000a003';
insert into kpi_definitions (id, tenant_id, name, aggregation) values ('aaaaaaaa-0000-0000-0000-0000000035c1','aaaaaaaa-0000-0000-0000-000000000001','K35','avg');
insert into kpi_targets (tenant_id, kpi_definition_id, user_id, period_start, period_end, actual)
values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000035c1','00000000-0000-0000-0000-00000000a003','2026-08-01','2026-08-31',50);
select is((select actual from public.kpi_rollup('2026-08-01','2026-08-31')
    where scope_kind='team' and scope_id='aaaaaaaa-0000-0000-0000-0000000035b1'), 50::numeric,
  'public.kpi_rollup forwards to app.kpi_rollup');

select * from finish();
rollback;
