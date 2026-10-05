-- ADR-0135 (I72) — a job or campaign name that differs from another only by capitals or spaces is taken.
--
-- `uq_campaigns_tenant_name unique (tenant_id, name)` refused only an EXACT repeat; "Borderless card"
-- and "Borderless Card" both got in, and each got its own Library folder (Figma LB-01, LB-NOTES 06).
-- This replaces the constraint with a unique INDEX of the same name over the normalised name —
-- lower-cased, trimmed, inner runs of spaces collapsed — so the wizard and the single-job flow keep
-- reading the same `23505` they map to "A campaign with this name already exists" today
-- (`BriefWizard.tsx`, `SingleJobWizard.tsx` map the code, not the name; the name is kept anyway).
--
-- A closed duplicate whose files were folded into the job that stays (`campaigns.merged_into_id`,
-- ADR-0134 d.21, migration 20261002100000) is left out: that is how ADR-0135 d.3's order works —
-- close the duplicates first, then the rule goes on. Reopening one meets the index and is refused.
--
-- d.3: this migration REFUSES TO APPLY while any look-alike pair remains, and says which. Run
-- `scripts/db/lookalike-names.sql` on production first; push this only when it returns nothing.

begin;

do $$
declare
  v_pairs text;
begin
  select string_agg(format('%s: "%s" (%s) / "%s" (%s)', t.name, a.name, a.id, b.name, b.id), E'\n'
                    order by t.name, a.created_at)
    into v_pairs
    from campaigns a
    join campaigns b
      on b.tenant_id = a.tenant_id
     and b.id > a.id
     and lower(regexp_replace(btrim(b.name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(a.name), '\s+', ' ', 'g'))
    join tenants t on t.id = a.tenant_id
   where a.merged_into_id is null and b.merged_into_id is null;

  if v_pairs is not null then
    raise exception E'ADR-0135: look-alike job / campaign names remain — close or rename the duplicates first (scripts/db/lookalike-names.sql):\n%', v_pairs
      using errcode = '23505';
  end if;
end $$;

alter table campaigns drop constraint if exists uq_campaigns_tenant_name;
drop index if exists uq_campaigns_tenant_name;

create unique index uq_campaigns_tenant_name
  on campaigns (tenant_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')))
  where merged_into_id is null;

comment on index uq_campaigns_tenant_name is
  'ADR-0135: a job or campaign name is taken when it matches another in the company ignoring capitals and '
  'leading, trailing and repeated spaces. A closed duplicate folded into the job that stays is left out.';

commit;
