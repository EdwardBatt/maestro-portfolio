-- URGENT, 3 Sep. Second half of the live report: an Account Manager still could not start a
-- campaign after `20260903140000`, because the person raising the brief was **not the client's
-- assigned account manager**.
--
-- WHY THE FIRST FIX WAS NOT ENOUGH. That one made the INSERT read the account manager from the row
-- being written instead of looking up a campaign that does not exist yet — correct, and necessary.
-- But `app.in_write_scope` for an account-scoped caller is `p_account_manager = auth.uid()`, so it
-- still only admitted an AM creating a campaign THEY would own. One AM raising a brief on a
-- colleague's client is refused, and that is an ordinary thing to do.
--
-- THE DECISION (Edward, 3 Sep): *"anyone with project:manage can create, edit and delete… we have
-- audit tracking anyway."*
--
-- So scope stops governing campaign writes and the PERMISSION governs them. This replaces the
-- account-scoping added by `20260812130000` ("ADR-0010 follow-up: scope campaign/stream/job WRITES
-- to the Account Manager's assigned campaigns"). Reads were always tenant-wide and are untouched.
--
-- WHAT THIS LOOSENS, PLAINLY. Any holder of `projects:manage` — Power Admin, Traffic Manager and
-- every Account Manager — may now create, edit and delete ANY campaign in the tenant, not only
-- those on their own accounts. A Team Member still cannot: the permission is unchanged and is what
-- decides. The control Edward named for this is the audit trail: `campaigns` carries the universal
-- audit trigger, so every insert, update and delete records who did it and what changed
-- (`20260802103000_universal_audit_triggers.sql`), and a DELETE stores the full row.
--
-- STREAMS TOO, AND THAT IS NOT SCOPE CREEP. `complete_campaign_draft` and
-- `create_campaign_from_brief` insert the campaign's ONE stream (ADR-0050). Leaving `streams`
-- account-scoped would have moved the refusal from step 1 to submit — the same error, four steps
-- later, and harder to attribute. A stream has no meaning apart from its campaign, so the two
-- rules have to say the same thing.
--
-- `jobs` KEEPS ITS SCOPE, deliberately. That migration scoped campaigns, streams AND jobs; jobs are
-- ad-hoc work, a separate flow nobody has reported, and widening it was not asked for. Left as it
-- is rather than swept along.
--
-- NEEDS A DECISION RECORD. This changes an authorization boundary on Edward's explicit instruction
-- and is written down here in full, but the ADR-level note belongs in the log — see `I37` in
-- docs/TASKS.md, which carries the follow-up.

begin;

-- ---------------------------------------------------------------- campaigns ----
-- Replaces the three policies `20260903140000` split out hours earlier. That split existed to make
-- the INSERT check readable; with scope gone from all three operations there is nothing left to
-- differentiate, and one policy is the honest shape.
drop policy if exists campaigns_manage_insert on campaigns;
drop policy if exists campaigns_manage_update on campaigns;
drop policy if exists campaigns_manage_delete on campaigns;
drop policy if exists campaigns_tenant_write on campaigns;

create policy campaigns_tenant_write on campaigns
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage'));

comment on policy campaigns_tenant_write on campaigns is
  'Edward, 3 Sep: anyone with projects:manage may create, edit and delete a campaign — the audit '
  'trail is the control, not scope. Replaces the account-scoping of 20260812130000, which refused '
  'every Account Manager on creation (the id lookup resolves to NULL before the row exists) and '
  'refused them afterwards on any campaign they did not personally own.';

-- ---------------------------------------------------------------- streams ----
drop policy if exists streams_tenant_write on streams;

create policy streams_tenant_write on streams
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage'));

comment on policy streams_tenant_write on streams is
  'Follows campaigns_tenant_write. A campaign''s single stream (ADR-0050) is written by the same '
  'call that creates the campaign, so a stricter rule here would only move the refusal from step 1 '
  'to submit.';

commit;
