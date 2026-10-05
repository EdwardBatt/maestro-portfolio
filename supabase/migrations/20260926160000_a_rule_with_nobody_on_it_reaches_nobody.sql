-- I59 E9 (ADR-0108 addendum, 25 Sep): "An escalation that resolves to nobody goes to the Traffic
-- Manager, and the admin setting shows it as 'reaches nobody' so the gap is fixed at its source."
--
-- `escalation_rules_reaching_nobody()` (20260926133000) listed only the kinds that HAD resolved to
-- nobody in the last 7 days — read from the sweep's log. A rule saved with no roles and no people
-- reaches nobody for every cause, before any has come due, and the setting said nothing about it
-- until the first one fell back to Traffic, hours later. The gap at its source is the rule itself.
--
-- Reproduced whole from 20260926133000 (the one definition before this), with one addition: a rule
-- of the caller's tenant with no roles AND no relative recipients is listed too — with its counts
-- from the log where it has any, 0 and 0 where it has none. Same signature, same grants, same
-- permission check, still security invoker.

begin;

create or replace function public.escalation_rules_reaching_nobody()
returns table (
  kind            text,
  fell_back       integer,        -- sent to the Traffic Manager instead, in the last 7 days
  unreached       integer,        -- not even the Traffic Manager, still being retried
  last_at         timestamptz,
  reasons         text[]
)
language plpgsql stable security invoker
set search_path = public, app, extensions as $$
begin
  if not app.has_permission('organization', 'manage') then
    raise exception 'only an administrator sees which escalations reach nobody' using errcode = '42501';
  end if;
  return query
  with f as (
    select l.kind, count(*)::int as n, max(l.sent_at) as last_at,
           array_agg(distinct l.fallback_reason) filter (where l.fallback_reason is not null) as reasons
      from escalation_log l
     where l.tenant_id = app.current_tenant_id() and l.fallback
       and l.sent_at >= now() - interval '7 days'
     group by l.kind
  ), u as (
    select x.kind, count(*)::int as n, max(x.last_tried_at) as last_at,
           array_agg(distinct x.reason) filter (where x.reason is not null) as reasons
      from escalation_unreached x
     where x.tenant_id = app.current_tenant_id()
       and x.last_tried_at >= now() - interval '7 days'
     group by x.kind
  ), seen as (
    select coalesce(f.kind, u.kind) as kind, coalesce(f.n, 0) as fell_back, coalesce(u.n, 0) as unreached,
           greatest(f.last_at, u.last_at) as last_at,
           (select array_agg(distinct z order by z)
              from unnest(coalesce(f.reasons, '{}') || coalesce(u.reasons, '{}')) z) as reasons
      from f full join u on u.kind = f.kind
  ), empty_rules as (
    -- E9 at its source: a rule that names no role and no person on the piece.
    select r.kind
      from tenant_escalation_rules r
     where r.tenant_id = app.current_tenant_id()
       and coalesce(cardinality(r.role_ids), 0) = 0
       and coalesce(cardinality(r.relative), 0) = 0
  )
  select coalesce(s.kind, e.kind), coalesce(s.fell_back, 0), coalesce(s.unreached, 0), s.last_at, s.reasons
    from seen s full join empty_rules e on e.kind = s.kind
   order by 1;
end $$;

revoke execute on function public.escalation_rules_reaching_nobody() from public, anon;
grant  execute on function public.escalation_rules_reaching_nobody() to authenticated;

comment on function public.escalation_rules_reaching_nobody() is
  'I59 E9: for the escalation settings screen (organization:manage) — each rule kind that reaches '
  'nobody: saved with no roles and no people (20260926160000), or resolved to nobody in the last 7 days '
  '— how often it fell back to the Traffic Manager, how many causes even the fallback could not reach '
  '(still retried), when last, and why. Security invoker over admin-only tables.';

commit;
