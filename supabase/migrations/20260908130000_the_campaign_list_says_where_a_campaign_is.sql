-- I40.21 — the campaigns list answers a question worth asking.
--
-- Edward, 8 Sep: "the columns do not provide any meaningful information… brief type and streams is
-- irrelevant." The list showed name, client, brand, brief type, stream count and go-live. Nothing
-- there says whether a campaign is MOVING — whether its brief is approved, who owns it, whether the
-- departments have signed off theirs, or who to chase.
--
-- WHY A VIEW AND NOT A NESTED SELECT.
--   * `department_brief_approvers` is per-campaign, so reading owners through it would be one RPC
--     per row — N+1 across the whole list.
--   * The equivalent PostgREST select nests four levels (campaign → streams → deliverables → owner)
--     and `deliverables` reaches `user_profiles` by TWO foreign keys (`owner_user_id`,
--     `reviewer_id`), so every embed would have to name its constraint or the whole query is
--     refused as ambiguous — the footgun AGENTS/CLAUDE both call out.
-- Shaping it in SQL costs one plain join and removes both problems.
--
-- SECURITY INVOKER is the whole safety claim (precedent: `audit_event_entities`, L1.23). The view
-- answers as the CALLER, so the RLS on campaigns, deliverables and user_profiles decides what comes
-- back and a tenant cannot read another's campaigns through it. A `security definer` view here
-- would be a cross-tenant read dressed as a convenience.
--
-- No table, column or policy is created, so there is no new gate to prove; `094` covers the shape
-- and the tenant fence.

create or replace view campaign_list_rows
with (security_invoker = true) as
select
  c.id,
  c.tenant_id,
  c.name,
  c.status,
  c.go_live_at,
  cl.name                as client_name,
  b.name                 as brand_name,
  am.display_name        as account_manager_name,
  -- Department briefs, COUNTED. Edward asked for "1 of 2 approved" rather than a list: on a list
  -- page the question is whether a campaign is waiting on anybody, not on whom.
  coalesce(db.total, 0)    as department_brief_total,
  coalesce(db.approved, 0) as department_brief_approved,
  -- Who owns the work, by name. `deliverables.department_id` is stamped from the OWNER (ADR-0050
  -- d.2), so one distinct owner per department is exactly "the brief owners" — the same people
  -- `department_brief_approvers` names on the campaign page, resolved here without the RPC.
  coalesce(ow.owners, array[]::text[]) as brief_owner_names
from campaigns c
join clients cl on cl.id = c.client_id
left join brands b on b.id = c.brand_id
left join user_profiles am on am.id = c.account_manager_id
left join lateral (
  select count(*)::int as total,
         count(*) filter (where cb.approved_at is not null)::int as approved
    from campaign_briefs cb
   where cb.campaign_id = c.id
) db on true
left join lateral (
  select array_agg(distinct p.display_name order by p.display_name) as owners
    from streams s
    join deliverables d on d.stream_id = s.id
    join user_profiles p on p.id = d.owner_user_id
   where s.campaign_id = c.id
) ow on true;

comment on view campaign_list_rows is
  'I40.21: one row per campaign for the Client Services list — brief status, account manager, '
  'department-brief progress as a count, and the owners by name. SECURITY INVOKER: it answers as '
  'the caller, so RLS on campaigns/deliverables/user_profiles decides what is visible. Exists to '
  'avoid one RPC per row (department_brief_approvers is per-campaign) and to avoid a four-level '
  'PostgREST embed where deliverables reaches user_profiles by two foreign keys.';

grant select on campaign_list_rows to authenticated;

-- The list orders by recency and the lateral joins key on campaign_id; both are already indexed
-- (`streams.campaign_id`, `campaign_briefs.campaign_id`), so nothing is added here. Revisit if the
-- tenant passes a few hundred campaigns — at the pilot's size this is a single sequential pass.
