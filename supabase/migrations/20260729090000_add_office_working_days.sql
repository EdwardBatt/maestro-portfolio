-- ADR-0005: working week is per-office data (ISO weekday numbers, 1=Mon…7=Sun).
-- Display always renders 7 days; these drive shading, non-working-day warnings,
-- and (later) SLA business-hours clocks — never column hiding.

alter table offices
  add column working_days smallint[] not null default '{1,2,3,4,5}',
  add constraint chk_offices_working_days_valid
    check (
      working_days <@ '{1,2,3,4,5,6,7}'::smallint[]
      -- cardinality, not array_length: array_length('{}') is NULL and a NULL
      -- CHECK passes silently — cardinality('{}') is 0 and fails correctly
      and cardinality(working_days) between 1 and 7
    );

comment on column offices.working_days is
  'ISO weekday numbers (1=Mon..7=Sun) this office works. ADR-0005: calendar always renders 7 days; non-working days shade + warn, never hide/block.';
