-- Campaigns and single jobs past draft that have no language (ADR-0117 addendum, Q19, 4 Oct — I74.34).
--
-- From 20261004140000 a campaign or job cannot leave draft without at least one language. The ones that already had
-- left are NOT changed by that migration; this lists them so each can be given its languages by its account manager.
-- Read-only: run it in the SQL editor (or psql) against the database you want to look at.
--
--   psql "$DATABASE_URL" -f scripts/db/campaigns-without-language.sql
select cl.name                                                   as client,
       c.name                                                    as campaign,
       case c.kind when 'single_job' then 'single job' else 'campaign' end as kind,
       c.status,
       coalesce(am.display_name, cam.display_name, '(none named)') as account_manager,
       (select count(*) from streams s join deliverables d on d.stream_id = s.id
         where s.campaign_id = c.id and d.state <> 'archived')   as open_deliverables
  from campaigns c
  join clients cl on cl.id = c.client_id
  left join user_profiles am  on am.id  = c.account_manager_id
  left join user_profiles cam on cam.id = cl.account_manager_id
 where c.status <> 'draft'
   and cardinality(coalesce(c.languages, '{}')) = 0
 order by c.status = 'closed', cl.name, c.name;
