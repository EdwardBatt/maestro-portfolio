-- Client registration demo (ADR-0123, I62, Figma section J) — LOCAL ONLY. Run after `supabase db reset`
-- and `demo-dashboards.sql`:
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f scripts/db/demo-clients.sql
--
-- What it gives the local database, so the clients list, a client's page and the registration steps have
-- something true to show — the designer's names from the frames, not production data:
--   * every client a country (Iraq; Harbour Line Logistics the UAE, so a Monday-to-Friday week shows);
--   * Kite Card as CV-02 draws it: its business types, six brands with short names (each gets its four
--     folders from the brand trigger), three people at the client and four dos and don'ts with languages;
--   * a draft, "Luma", started by Inas Azmi and not yet activated (CV-01's draft row).
--
-- The seed's clients are written by the system, so they are active already; the draft is written as a
-- draft. Refuses to run unless the dev tenant from `supabase/seed.sql` is present.
begin;

do $$
begin
  if not exists (select 1 from tenants where id = 'd0000000-0000-4000-8000-000000000001') then
    raise exception 'demo-clients.sql: the dev tenant is not here — this is for the local stack only';
  end if;
end $$;

-- ------------------------------------------------------------------------------------ countries
update clients set country_code = 'IQ' where not is_internal and country_code is null;
update clients set country_code = 'AE' where name = 'Harbour Line Logistics';

-- ------------------------------------------------------------------------------------ Kite Card (CV-02)
update clients
   set profile = coalesce(profile, '{}'::jsonb) || jsonb_build_object(
         'businessTypes', jsonb_build_array('ecommerce', 'app', 'services'),
         'rules', jsonb_build_array(
           jsonb_build_object('kind', 'do', 'text', 'Arabic leads. English is never the master.', 'languages', jsonb_build_array('ar', 'en', 'ku')),
           jsonb_build_object('kind', 'do', 'text', 'Points are collected (جمعت). Rewards are redeemed (استبدلت).', 'languages', jsonb_build_array('ar')),
           jsonb_build_object('kind', 'dont', 'text', 'Never “free money”. The offer is a reward (مكافأة).', 'languages', jsonb_build_array('ar', 'en')),
           jsonb_build_object('kind', 'dont', 'text', 'LUMA is a section inside SuperKite. Never “download LUMA”.')))
 where name = 'Kite Card';

insert into brands (tenant_id, client_id, name, short_name)
select c.tenant_id, c.id, b.name, b.short_name
  from clients c
 cross join (values ('LUMA', 'LUMA'), ('Kite Card', 'Kite Card'), ('Kite Bills', 'Bills'), ('Kite Travel', 'Travel'),
                    ('SuperKite', 'SuperKite'), ('Borderless', 'Borderless')) as b(name, short_name)
 where c.name = 'Kite Card'
   and not exists (select 1 from brands x where x.client_id = c.id and x.name = b.name);

insert into client_contacts (tenant_id, client_id, name, role_title, reach, can_request, signs_off, is_copied, sort_order)
select c.tenant_id, c.id, p.name, p.role_title, p.reach, p.can_request, p.signs_off, p.is_copied, p.sort_order
  from clients c
 cross join (values
   ('Khalid Hamdan', 'Marketing lead', array['whatsapp', 'email'], true, true, false, 0),
   ('Adel Naseem', 'Brand manager', array['whatsapp', 'email'], true, false, true, 1),
   ('Salma Karam', 'Product', array['email'], false, false, true, 2)
 ) as p(name, role_title, reach, can_request, signs_off, is_copied, sort_order)
 where c.name = 'Kite Card'
   and not exists (select 1 from client_contacts x where x.client_id = c.id and x.name = p.name);

-- ------------------------------------------------------------------------------------ the draft (CV-01)
insert into clients (tenant_id, name, status, country_code, account_manager_id, profile)
select 'd0000000-0000-4000-8000-000000000001', 'Luma', 'draft', 'IQ', up.id,
       jsonb_build_object('businessTypes', jsonb_build_array('app', 'services'), 'rules', '[]'::jsonb)
  from user_profiles up
 where up.display_name = 'Inas Azmi'
   and not exists (select 1 from clients where name = 'Luma');

insert into brands (tenant_id, client_id, name, short_name)
select c.tenant_id, c.id, 'LUMA', 'LUMA' from clients c
 where c.name = 'Luma' and not exists (select 1 from brands x where x.client_id = c.id);

-- Started by Inas on Sunday: who made it is the audit columns', written here by hand.
set local session_replication_role = replica;
update clients c
   set created_by = up.id,
       created_at = date_trunc('week', now() at time zone 'Asia/Baghdad') - interval '1 day' + interval '10 hours'
  from user_profiles up
 where c.name = 'Luma' and up.display_name = 'Inas Azmi';

commit;
