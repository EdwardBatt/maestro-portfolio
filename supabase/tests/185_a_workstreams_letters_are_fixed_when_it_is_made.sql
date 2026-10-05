-- 20260927100000 (I59.53) — a workstream's code letters are set from its name when it is made and never
-- change; every piece created in it takes them, before and after a rename.
begin;
select plan(6);
\ir helpers/seed.sql

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000185d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S185');
insert into workstreams (id, tenant_id, campaign_id, name, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000185a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001',
   'Design & Animation','aaaaaaaa-0000-0000-0000-0000000de0ff');

select is((select code_letters from workstreams where id = 'aaaaaaaa-0000-0000-0000-0000000185a1'), 'DA',
  'made: the letters come from the name (Design & Animation -> DA)');

insert into deliverables (id, tenant_id, stream_id, workstream_id, name, state, owner_user_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000185e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000185d1',
   'aaaaaaaa-0000-0000-0000-0000000185a1','Before the rename','draft','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000a001');
select matches((select code from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000185e1'), '^DA-[0-9]{3}$',
  'a piece made in it takes those letters');

update workstreams set name = 'Motion' where id = 'aaaaaaaa-0000-0000-0000-0000000185a1';
select is((select code_letters from workstreams where id = 'aaaaaaaa-0000-0000-0000-0000000185a1'), 'DA',
  'renamed to Motion: the letters stay DA');

insert into deliverables (id, tenant_id, stream_id, workstream_id, name, state, owner_user_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000185e2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000185d1',
   'aaaaaaaa-0000-0000-0000-0000000185a1','After the rename','draft','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000a001');
select matches((select code from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000185e2'), '^DA-[0-9]{3}$',
  'a piece made AFTER the rename still takes DA — one prefix for the workstream''s life');

select is((select code from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000185e1') <>
          (select code from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000185e2'), true,
  'and the numbering carries on: the two codes differ');

update workstreams set code_letters = 'ZZ' where id = 'aaaaaaaa-0000-0000-0000-0000000185a1';
select is((select code_letters from workstreams where id = 'aaaaaaaa-0000-0000-0000-0000000185a1'), 'DA',
  'the letters cannot be changed after the workstream is made');

select * from finish();
rollback;
