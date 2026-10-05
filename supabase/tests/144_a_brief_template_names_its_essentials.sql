-- SJ-v3-02 (22 Sep) — a template says which of its fields are the essentials, and a tenant's own
-- ticks survive the seed.
begin;
select plan(6);
\ir helpers/seed.sql

insert into tenants (id, name, slug) values
  ('cccccccc-0000-0000-0000-000000000144', 'Fresh Tenant 144', 'fresh-144');
select lives_ok($$ select public.seed_tenant_roles('cccccccc-0000-0000-0000-000000000144') $$,
  'the public wrapper provisions a fresh tenant');

-- The Figma's four on the Execution brief.
select results_eq($$
  select f->>'key' from brief_templates t, jsonb_array_elements(t.fields) f
   where t.tenant_id = 'cccccccc-0000-0000-0000-000000000144' and t.brief_type = 'single_execution'
     and (f->>'essential')::boolean
$$, $$ values ('deliverableType'), ('task'), ('reference'), ('specs') $$,
  'the Execution brief''s essentials are the Figma''s four, in template order');

-- Every seeded template has some, and never all.
select is_empty($$
  select t.brief_type from brief_templates t
   where t.tenant_id = 'cccccccc-0000-0000-0000-000000000144'
     and not exists (select 1 from jsonb_array_elements(t.fields) f where (f->>'essential')::boolean)
$$, 'every seeded template names at least one essential');
select is_empty($$
  select t.brief_type from brief_templates t
   where t.tenant_id = 'cccccccc-0000-0000-0000-000000000144'
     and jsonb_array_length(t.fields) > 4
     and not exists (select 1 from jsonb_array_elements(t.fields) f where not coalesce((f->>'essential')::boolean, false))
$$, 'no seeded template with more than four fields is all essentials');

-- The tenant's own choice survives a re-run: untick the Figma's four on the Social brief, tick one.
update brief_templates t
   set fields = (select jsonb_agg(case when f->>'key' = 'kpis' then f || '{"essential": true}'::jsonb else f - 'essential' end)
                   from jsonb_array_elements(t.fields) f)
 where t.tenant_id = 'cccccccc-0000-0000-0000-000000000144' and t.brief_type = 'social_calendar';
select lives_ok($$ select app.seed_tenant_brief_essentials('cccccccc-0000-0000-0000-000000000144') $$, 'the essentials seed re-runs');
select results_eq($$
  select f->>'key' from brief_templates t, jsonb_array_elements(t.fields) f
   where t.tenant_id = 'cccccccc-0000-0000-0000-000000000144' and t.brief_type = 'social_calendar'
     and (f->>'essential')::boolean
$$, $$ values ('kpis') $$,
  'a tenant that ticked its own essentials keeps them');

select * from finish();
rollback;
