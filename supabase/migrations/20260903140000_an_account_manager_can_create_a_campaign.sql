-- URGENT, reported live 3 Sep: "all fields are filled in but it is not letting them proceed to the
-- next step" on the Brief Wizard. The user holds `projects:manage`.
--
-- THE CAUSE IS THE SCOPE CHECK, NOT THE PERMISSION. `campaigns_tenant_write`
-- (`20260812130000_scope_project_writes.sql`) applies one clause to every operation:
--
--     app.in_write_scope(null, null, app.campaign_account_manager(id))
--
-- `app.campaign_account_manager(id)` LOOKS THE CAMPAIGN UP BY ITS ID. On an INSERT there is no row
-- to look up, so it resolves to NULL — and `app.in_write_scope` for an account-scoped caller is:
--
--     when 'account' then p_account_manager is not null and p_account_manager = auth.uid()
--
-- NULL fails the first half. So **no account-scoped user has ever been able to create a campaign**,
-- however complete the form and whatever permission they hold. Power Admin and Traffic Manager are
-- tenant-scoped, return `true` unconditionally, and never saw it — which is why campaigns have
-- always been created successfully by the people who happened to try.
--
-- NOT A REGRESSION, BUT TODAY IS WHY IT SURFACED. Before ADR-0067 the INSERT happened at SUBMIT, on
-- step 5 of five; an Account Manager filled in a whole brief and was refused at the end. From today
-- the campaign is created on leaving step 1 (d.1), so the same refusal arrives immediately and
-- reads as "it will not let me continue". Moving it forward is what made a long-standing bug
-- reportable — the wizard was never usable by an Account Manager, which is the role that raises
-- briefs.
--
-- THE FIX. Split the policy by operation. On INSERT the account manager is read from the ROW BEING
-- WRITTEN — its own `account_manager_id`, falling back to the client's, which is exactly what
-- `app.approve_campaign` resolves (`coalesce(campaign, client)`, ADR-0048 d.9) and what
-- `create_campaign_from_brief` and `start_campaign_draft` both write. On UPDATE and DELETE the row
-- exists, so the existing lookup is kept **byte for byte**: this migration must not quietly widen
-- who may change or delete a campaign, and the only behaviour that changes is that creating one
-- now works for the person meant to do it.

begin;

drop policy if exists campaigns_tenant_write on campaigns;

-- INSERT: the row being written names its own account manager, or inherits the client's.
create policy campaigns_manage_insert on campaigns
  for insert to authenticated
  with check (
    tenant_id = app.current_tenant_id()
    and app.has_permission('projects', 'manage')
    and app.in_write_scope(
          null, null,
          coalesce(
            account_manager_id,
            (select cl.account_manager_id from clients cl where cl.id = client_id)
          ))
  );

comment on policy campaigns_manage_insert on campaigns is
  'ADR-0048 d.9 + the 3 Sep fix. Reads the account manager from the NEW ROW rather than looking the '
  'campaign up by an id that does not exist yet — which resolved to NULL and refused every '
  'account-scoped caller, i.e. every Account Manager, for as long as the scoped policy existed.';

-- UPDATE and DELETE: unchanged from `20260812130000`. The row exists, so the lookup works, and
-- reproducing it exactly is what keeps this fix to the one thing it is for.
create policy campaigns_manage_update on campaigns
  for update to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage')
    and app.in_write_scope(null, null, app.campaign_account_manager(id)))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage')
    and app.in_write_scope(null, null, app.campaign_account_manager(id)));

create policy campaigns_manage_delete on campaigns
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage')
    and app.in_write_scope(null, null, app.campaign_account_manager(id)));

commit;
