-- A deliverable records when it finished (I61.3, ADR-0122; Edward, 28 Sep).
--
-- The role dashboards count work finished on time and finished per week (Figma section H: "Deliveries,
-- last four weeks", "On time"). Finished means approved or delivered (ADR-0118: approved once every task
-- is done or cancelled). Until now nothing on the row said WHEN: the moment lives only in `audit_events`,
-- which only holders of `audit:view` may read — an account manager's dashboard cannot.
--
-- 1. `deliverables.finished_at` — the moment the piece first became approved or delivered. Moving on from
--    approved to delivered keeps the first moment; going back to live work (a re-open, ADR-0103) clears it,
--    and finishing again stamps the new moment.
-- 2. Stamped by a BEFORE trigger on the row itself, so every path that finishes a piece (the automatic close,
--    a sign-off, marking it delivered) is covered without touching them. Not `security definer`: it only
--    sets a column on the row being written.
-- 3. Backfill: pieces already finished take the latest time the audit trail saw them become approved or
--    delivered, else their `updated_at` — the closest the row can say.
begin;

alter table public.deliverables add column finished_at timestamptz;

comment on column public.deliverables.finished_at is
  'When the piece first became approved or delivered; cleared if it goes back to live work (I61.3).';

create or replace function app.stamp_deliverable_finished()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_done_now boolean := new.state in ('approved', 'delivered');
  v_done_before boolean := tg_op = 'UPDATE' and old.state in ('approved', 'delivered');
begin
  if v_done_now and not v_done_before then
    new.finished_at := coalesce(new.finished_at, now());
  elsif v_done_now and v_done_before then
    new.finished_at := coalesce(old.finished_at, new.finished_at, now());
  elsif not v_done_now then
    new.finished_at := null;
  end if;
  return new;
end;
$$;

create trigger deliverables_stamp_finished
  before insert or update of state on public.deliverables
  for each row execute function app.stamp_deliverable_finished();

update public.deliverables d
   set finished_at = coalesce(
         (select max(a.created_at)
            from public.audit_events a
           where a.entity = 'deliverables'
             and a.entity_id = d.id
             and a.payload ->> 'state' in ('approved', 'delivered')),
         d.updated_at)
 where d.state in ('approved', 'delivered')
   and d.finished_at is null;

create index idx_deliverables_finished_at on public.deliverables (tenant_id, finished_at)
  where finished_at is not null;

commit;
