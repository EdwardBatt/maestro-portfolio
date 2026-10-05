-- I38.11 (ADR-0071 d.13) — unassigned work is reported BY CAMPAIGN, with a real total.
--
-- Edward, 5 Sep: *"if the cap is 50 what is the actual qty reported as unassigned?"* — and then,
-- *"instead of listing all unassigned, list totals by campaign and allow a drill down."*
--
-- THE DEFECT. `UnassignedWork.tsx` caps its query at 50 rows and then renders `rows.length` as the
-- count, so 200 unassigned tasks report as **50** — and the "and N more" line beneath the list is
-- wrong by the same amount. It is the metric ADR-0052 d.11 exists to provide, answering Edward's
-- *"all of them up front, unassigned is a metric we need"*, and it has been silently truncating.
--
-- It has been harmless only because a deliverable produced one task per step. `20260905090000` is
-- what makes a single 30-post calendar produce thirty unassigned tasks, so this change is what
-- turns a dormant bug into a number wrong every month — which is why it is fixed here rather than
-- separately.
--
-- WHY GROUPING BEATS AN EXACT-COUNT PATCH. Adding a `count: 'exact'` query beside the truncated
-- list would have made the number honest and the tile no more useful: eight task titles out of two
-- hundred is noise. Grouped, the ROWS are campaigns — a number bounded by how many campaigns are
-- running — so there is nothing left to cap and nothing to be wrong about.
--
-- SERVER-SIDE, and not for tidiness: counting in the browser means shipping every unassigned row to
-- it, which is the thing the cap was there to avoid.
--
-- CAMPAIGN WORK IS THE ONLY WORK THIS CAN SHOW, and that is structural rather than a filter.
-- Edward: *"ad-hoc tasks cannot be unassigned."* Correct — `public.create_adhoc_deliverable` refuses
-- a null assignee (`20260820010000:35`) because ad-hoc work is CREATED BY ASSIGNING it on the
-- schedule; the assignee is the reason the row exists. An unassigned ad-hoc task is not a state the
-- system can reach, so the inner join through `streams` excludes nothing that could ever appear.
--
-- SECURITY INVOKER: the view runs as the caller, so `sub_tasks_tenant_select` and the campaign
-- policies decide visibility exactly as they do for the query it replaces. No new reach, and no
-- SECURITY DEFINER to justify under AGENTS.md §6.

begin;

create view public.unassigned_work_by_campaign
with (security_invoker = true) as
  select
    c.id        as campaign_id,
    c.tenant_id as tenant_id,
    c.name      as campaign_name,
    c.status    as campaign_status,
    count(*)::integer as unassigned_count,
    min(st.created_at) as oldest_at
  from sub_tasks st
  join deliverables d on d.id = st.deliverable_id
  join streams     s on s.id = d.stream_id
  join campaigns   c on c.id = s.campaign_id
  where st.assignee_id is null
    -- Live work only. An unassigned task that is finished is a contradiction the data can hold and
    -- the reader should not have to think about — the same predicate the tile uses today.
    and st.status not in ('done', 'cancelled')
  group by c.id, c.tenant_id, c.name, c.status;

comment on view public.unassigned_work_by_campaign is
  'ADR-0071 d.13: one row per campaign with work nobody has picked up, and the REAL total — the '
  'tile it replaces capped at 50 rows and rendered that as the count. Ad-hoc work cannot appear: '
  'create_adhoc_deliverable refuses a null assignee, so unassigned work is campaign work by '
  'construction. SECURITY INVOKER — RLS decides visibility exactly as it does for the tasks.';

revoke all on public.unassigned_work_by_campaign from public, anon;
grant select on public.unassigned_work_by_campaign to authenticated;

commit;
