-- ADR-0135 d.3 (I72) — every pair of jobs / campaigns whose names differ only by capitals or spaces.
--
-- READ-ONLY. Run it in the Supabase SQL editor on production BEFORE pushing
-- 20261002110000_a_name_that_differs_only_by_capitals_is_taken.sql — that migration refuses to apply
-- while this returns a row. Clear each pair first: close the duplicate (an approved job with no open
-- work; its files move to the one that stays, ADR-0134 d.21, once 20261002100000 is applied), or
-- rename it. A closed duplicate that already folded its files (merged_into_id set) is not listed.
--
-- Needs 20261002100000 applied first (it adds campaigns.merged_into_id). Before that, run it with
-- the two `merged_into_id is null` lines removed — the list is then every pair, folded or not.
--
-- A pair across two DIFFERENT clients is listed too: closing does not fold files across clients
-- (files never cross clients, ADR-0134), so such a pair is cleared by renaming one of them.

select
  t.name                          as tenant,
  a.id                            as first_id,
  a.name                          as first_name,
  ca.name                         as first_client,
  a.status                        as first_status,
  a.kind                          as first_kind,
  a.created_at                    as first_created_at,
  b.id                            as second_id,
  b.name                          as second_name,
  cb.name                         as second_client,
  b.status                        as second_status,
  b.kind                          as second_kind,
  b.created_at                    as second_created_at,
  (a.client_id = b.client_id)     as same_client
from campaigns a
join campaigns b
  on b.tenant_id = a.tenant_id
 and (b.created_at, b.id) > (a.created_at, a.id)
 and lower(regexp_replace(btrim(b.name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(a.name), '\s+', ' ', 'g'))
join tenants t  on t.id  = a.tenant_id
join clients ca on ca.id = a.client_id
join clients cb on cb.id = b.client_id
where a.merged_into_id is null
  and b.merged_into_id is null
order by t.name, lower(a.name), a.created_at;
