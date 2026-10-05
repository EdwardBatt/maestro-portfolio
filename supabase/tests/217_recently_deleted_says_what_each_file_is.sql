-- ADR-0134 d.9 (I72.17) — Recently deleted says what each deleted item is.
--   A deleted link comes back with its address (so it is badged a link, not "FILE"); a deleted
--   upload comes back with its content type.
begin;
select plan(4);
\ir helpers/seed.sql
select app.seed_tenant_asset_grants(id) from tenants;

create temp table f217 as
select id from asset_folders
 where campaign_id = 'aaaaaaaa-0000-0000-0000-00000000e001' and kind = 'asset_type' and name = 'References';
grant select on f217 to public;

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

insert into assets (id, tenant_id, folder_id, name, object_key, content_type)
values ('aaaaaaaa-0000-0000-0000-0000000a5217', 'aaaaaaaa-0000-0000-0000-000000000001', (select id from f217), 'Deck.pdf',
        'aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-0000-0000-0000-00000000c001/deck.pdf', 'application/pdf');
create temp table l217 as
select public.library_add_link((select id from f217), 'Masters on Drive', 'https://drive.example/masters', null) as id;

select lives_ok($$ select public.library_delete((select id from l217)) $$, 'delete: the link');
select lives_ok($$ select public.library_delete('aaaaaaaa-0000-0000-0000-0000000a5217') $$, 'delete: the upload');

select is((select link_url from public.library_recently_deleted('aaaaaaaa-0000-0000-0000-00000000c001')
            where id = (select id from l217)), 'https://drive.example/masters',
  'a deleted link comes back with its address');
select is((select content_type from public.library_recently_deleted('aaaaaaaa-0000-0000-0000-00000000c001')
            where id = 'aaaaaaaa-0000-0000-0000-0000000a5217'), 'application/pdf',
  'a deleted upload comes back with its content type');

select * from finish();
rollback;
