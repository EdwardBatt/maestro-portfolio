-- ADR-0010 follow-up: scope campaign/stream/job WRITES to the Account Manager's
-- assigned campaigns (scope=account) or the tenant-wide roles. Reads stay tenant-wide.
-- DELIVERABLES are intentionally NOT scoped here: who may transition a deliverable's
-- review/submit state is not yet specified (brief-lifecycle review flow), so its
-- write policy keeps its grant-only form until that flow is defined — a documented
-- follow-up. Uses the invoker-side scope helpers from 20260812120100.

create or replace function app.campaign_account_manager(p_campaign uuid)
returns uuid language sql stable as $$
  select coalesce(c.account_manager_id, cl.account_manager_id)
  from public.campaigns c
  join public.clients cl on cl.id = c.client_id
  where c.id = p_campaign
$$;

drop policy campaigns_tenant_write on campaigns;
create policy campaigns_tenant_write on campaigns
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage')
    and app.in_write_scope(null, null, app.campaign_account_manager(id)))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage')
    and app.in_write_scope(null, null, app.campaign_account_manager(id)));

drop policy streams_tenant_write on streams;
create policy streams_tenant_write on streams
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage')
    and app.in_write_scope(null, null, app.campaign_account_manager(campaign_id)))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage')
    and app.in_write_scope(null, null, app.campaign_account_manager(campaign_id)));

drop policy jobs_tenant_write on jobs;
create policy jobs_tenant_write on jobs
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage')
    and app.in_write_scope(null, null, coalesce(
      app.campaign_account_manager(campaign_id),
      (select cl.account_manager_id from public.clients cl where cl.id = jobs.client_id))))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage')
    and app.in_write_scope(null, null, coalesce(
      app.campaign_account_manager(campaign_id),
      (select cl.account_manager_id from public.clients cl where cl.id = jobs.client_id))));
