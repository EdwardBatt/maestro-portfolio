-- I59.24 / ADR-0108 d.2, d.3, d.6 (25 Sep, Edward) — every escalation is a tenant setting of hours
-- and recipients; the over-capacity percentage is a setting; the sweep keeps one log of what it sent.
--
--   * `tenant_escalation_rules` — one row per (tenant, kind): the hours before it escalates, any
--     roles (`role_ids`) and any people RELATIVE to the piece (`relative`). ADR-0108 d.3: recipients
--     are data, not code. Written by whoever may write `tenant_reminder_settings`
--     (`organization:manage`, 20260903100300 — the policy has not been redefined since), read by
--     everyone in the tenant (the clocks on screen need the hours to say "escalates in 4h").
--   * `tenant_reminder_settings.over_capacity_pct` — ADR-0108 d.6, default 110.
--   * `escalation_log` — the sweep's idempotence, one row per (kind, subject, occurrence): "once per
--     cause" (ADR-0045 d.1, ADR-0108 d.5). Append-only, written only by the sweep.
--   * `campaigns.submitted_at` — when a campaign last went to `pending_approval`. The "brief not
--     approved" clock (ADR-0108 d.2 row 2) needs it and nothing recorded it: `my_pending_approvals`
--     uses `created_at`, which is when the DRAFT was started, possibly days earlier.
--   * `app.seed_tenant_escalation_rules` — the defaults, for every tenant today and, through the
--     provisioning wrapper (reproduced WHOLE from 20260922150000, the last definition — grep
--     confirmed), for every tenant created later.
--
-- Defaults (ADR-0108 d.2). The Traffic Manager is the role keyed `scheduler`; the Account Director
-- the role keyed `account_director` (20260905190000 / ADR-0073).
--   unassigned       24h  Traffic Manager + owner         (hours copied from the tenant's existing
--                                                          assignment_escalation_hours)
--   task_list        24h  Traffic Manager + account manager
--   change_request    8h  owner's department lead + account manager
--   extension_owner   8h  owner's department lead
--   extension_am      8h  Account Director
--   blocked          24h  owner + account manager
--   review_remind    24h  reviewers
--   review_escalate  48h  account manager + owner

begin;

-- ---------------------------------------------------------------- the rules ----
create table tenant_escalation_rules (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  kind        text not null
                constraint chk_tenant_escalation_rules_kind check (kind in (
                  'unassigned', 'task_list', 'change_request', 'extension_owner', 'extension_am',
                  'blocked', 'review_remind', 'review_escalate')),
  hours       integer not null
                constraint chk_tenant_escalation_rules_hours check (hours > 0),
  role_ids    uuid[] not null default '{}',
  relative    text[] not null default '{}'
                constraint chk_tenant_escalation_rules_relative check (relative <@ array[
                  'owner', 'account_manager', 'owner_department_lead', 'assignee_team_lead', 'reviewers']::text[]),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  constraint uq_tenant_escalation_rules_kind unique (tenant_id, kind)
);

create index idx_tenant_escalation_rules_tenant_id on tenant_escalation_rules (tenant_id);

comment on table tenant_escalation_rules is
  'ADR-0108 d.2/d.3 (I59.24): per tenant, per stall — the REAL-TIME hours before the sweep escalates '
  'and who hears: any roles (role_ids) plus people relative to the piece (owner, account_manager, '
  'owner_department_lead, assignee_team_lead, reviewers). Admin → Reminders, behind organization:manage. '
  'A role id from another tenant resolves to nobody (the resolver joins within the tenant).';

alter table tenant_escalation_rules enable row level security;
alter table tenant_escalation_rules force row level security;

create policy tenant_escalation_rules_tenant_select on tenant_escalation_rules
  for select to authenticated
  using (tenant_id = app.current_tenant_id());

-- The same audience as tenant_reminder_settings_admin_write (20260903100300).
create policy tenant_escalation_rules_admin_write on tenant_escalation_rules
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));

create trigger set_updated_at before update on tenant_escalation_rules
  for each row execute function app.set_updated_at();
create trigger set_actor_columns before insert or update on tenant_escalation_rules
  for each row execute function app.set_actor_columns();
create trigger audit_row_change after insert or update or delete on tenant_escalation_rules
  for each row execute function app.audit_row_change();

-- ---------------------------------------------------------------- over capacity ----
alter table tenant_reminder_settings
  add column if not exists over_capacity_pct integer not null default 110
  constraint chk_reminder_over_capacity_pct check (over_capacity_pct between 1 and 1000);

comment on column tenant_reminder_settings.over_capacity_pct is
  'ADR-0108 d.6 (I59.24): a person booked OVER this percentage of their nominal week (Sunday–Saturday, '
  'the arithmetic of useTeamLoad) is raised to their team''s and department''s leads, once a week.';

comment on column tenant_reminder_settings.assignment_escalation_hours is
  'SUPERSEDED 26 Sep by tenant_escalation_rules (kind unassigned), ADR-0108. Its value was copied '
  'into that row once; the sweep no longer reads this column.';

-- ---------------------------------------------------------------- the log ----
create table escalation_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  -- a rule kind, or 'over_capacity'
  kind        text not null,
  subject_id  uuid not null,
  -- what makes a repeat a NEW cause: the review round for a review, the week for overload, '' else
  occurrence  text not null default '',
  recipients  integer not null default 0,
  sent_at     timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  constraint uq_escalation_log_cause unique (tenant_id, kind, subject_id, occurrence)
);

create index idx_escalation_log_tenant_id on escalation_log (tenant_id);

comment on table escalation_log is
  'ADR-0108 d.5 / ADR-0045 d.1: one row per cause the sweep has escalated — (kind, subject, '
  'occurrence) — so a re-run never sends twice. Append-only; written only by app.run_escalation_sweep.';

alter table escalation_log enable row level security;
alter table escalation_log force row level security;

-- Readable in the tenant by whoever administers the rules (the log says when each rule fired).
create policy escalation_log_admin_select on escalation_log
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));
-- No insert/update/delete policy: the sweep (security definer) is the only writer.
revoke insert, update, delete on escalation_log from authenticated, anon;

create trigger set_actor_columns before insert or update on escalation_log
  for each row execute function app.set_actor_columns();
create trigger audit_row_change after insert or update or delete on escalation_log
  for each row execute function app.audit_row_change();

-- The single-job rung's own stamp (20260922170000) already records what it sent: carried into the
-- log so the new sweep does not send those again.
insert into escalation_log (tenant_id, kind, subject_id, occurrence, sent_at)
select d.tenant_id, 'unassigned', d.id, '', d.assignment_escalated_at
  from deliverables d
 where d.assignment_escalated_at is not null
on conflict do nothing;

-- ---------------------------------------------------------------- the brief's clock ----
alter table campaigns add column if not exists submitted_at timestamptz;

comment on column campaigns.submitted_at is
  'ADR-0108 d.2 (I59.24): when the campaign last entered pending_approval — the start of the "brief '
  'not approved" clock. Stamped by trigger; back-filled from updated_at for campaigns already '
  'pending on 26 Sep (never earlier than the real submission, so nothing escalates early).';

create or replace function app.tg_campaign_stamp_submitted() returns trigger
language plpgsql as $$
begin
  if new.status = 'pending_approval'
     and (tg_op = 'INSERT' or old.status is distinct from 'pending_approval') then
    new.submitted_at := now();
  end if;
  return new;
end $$;

create trigger campaign_stamp_submitted
  before insert or update of status on campaigns
  for each row execute function app.tg_campaign_stamp_submitted();

do $$
begin
  perform set_config('app.system_op', 'on', true);
  alter table campaigns disable trigger user;
  update campaigns set submitted_at = updated_at
   where status = 'pending_approval' and submitted_at is null;
  alter table campaigns enable trigger user;
end $$;

-- ---------------------------------------------------------------- the defaults ----
create or replace function app.seed_tenant_escalation_rules(p_tenant uuid) returns void
language plpgsql
set search_path = public, app, extensions as $$
declare
  v_traffic uuid := (select id from roles where tenant_id = p_tenant and key = 'scheduler');
  v_ad      uuid := (select id from roles where tenant_id = p_tenant and key = 'account_director');
  v_hours   integer := coalesce(
    (select s.assignment_escalation_hours from tenant_reminder_settings s where s.tenant_id = p_tenant), 24);
begin
  insert into tenant_escalation_rules (tenant_id, kind, hours, role_ids, relative)
  values
    (p_tenant, 'unassigned',      v_hours, array_remove(array[v_traffic], null), array['owner']),
    (p_tenant, 'task_list',       24,      array_remove(array[v_traffic], null), array['account_manager']),
    (p_tenant, 'change_request',  8,       '{}',                                  array['owner_department_lead', 'account_manager']),
    (p_tenant, 'extension_owner', 8,       '{}',                                  array['owner_department_lead']),
    (p_tenant, 'extension_am',    8,       array_remove(array[v_ad], null),      '{}'),
    (p_tenant, 'blocked',         24,      '{}',                                  array['owner', 'account_manager']),
    (p_tenant, 'review_remind',   24,      '{}',                                  array['reviewers']),
    (p_tenant, 'review_escalate', 48,      '{}',                                  array['account_manager', 'owner'])
  on conflict (tenant_id, kind) do nothing;
end $$;

comment on function app.seed_tenant_escalation_rules(uuid) is
  'ADR-0108 d.2: the eight default escalation rows for a tenant. `on conflict do nothing` — a tenant''s '
  'own edits are never overwritten. Called by the provisioning wrapper after the Account Director '
  'seed (it names that role).';

select app.seed_tenant_escalation_rules(id) from tenants;

-- ---------------------------------------------------------------- the wrapper ----
-- Reproduced WHOLE from 20260922150000 (the last definition), plus the one new call at the end.
create or replace function public.seed_tenant_roles(p_tenant uuid) returns void
language sql as $$
  select app.seed_tenant_roles(p_tenant);
  -- Restored (20260903100300, lost again in 20260905090800): the grants, storage and reminder
  -- rows every tenant needs. All three are `on conflict do nothing`.
  select app.seed_tenant_asset_grants(p_tenant);
  select app.seed_tenant_storage_settings(p_tenant);
  select app.seed_tenant_reminder_settings(p_tenant);
  -- Restored (20260903130000, lost in 20260905090800): briefs:approve for the department's own
  -- people, the AM, Traffic and the deputy (ADR-0070 d.2).
  select app.seed_tenant_brief_approval_grants(p_tenant);
  select app.seed_tenant_brief_templates(p_tenant);
  select app.seed_tenant_deliverable_taxonomy(p_tenant);
  select app.seed_tenant_taxonomy_amendments(p_tenant);
  select app.seed_tenant_workflow_templates(p_tenant);
  select app.seed_tenant_workflow_step_corrections(p_tenant);
  select app.seed_tenant_step_review_modes(p_tenant);
  select app.seed_tenant_default_workflows(p_tenant);
  -- ---- I38 (ADR-0071) ----
  select app.seed_tenant_i38_deactivations(p_tenant);
  select app.seed_tenant_digital_build_brief(p_tenant);
  -- SJ-v3-01 (20260922130000): names and descriptions on the templates the two seeds above made.
  select app.seed_tenant_brief_template_names(p_tenant);
  -- SJ-v3-02 (20260922150000): which of each template's fields are the essentials.
  select app.seed_tenant_brief_essentials(p_tenant);
  select app.seed_tenant_i38_step_names(p_tenant);
  select app.seed_tenant_i38_direction_steps(p_tenant);
  select app.seed_tenant_i38_new_templates(p_tenant);
  select app.seed_tenant_i38_branding_components(p_tenant);
  -- last, because it joins deliverable_types by code and wants the taxonomy settled first
  select app.seed_tenant_brief_deliverable_types(p_tenant);
  -- ---- I40 (ADR-0073) ----
  -- After the roles seed, because it copies the Account Manager's grants and needs that role to
  -- exist first.
  select app.seed_account_director(p_tenant);
  -- ---- I59.24 (ADR-0108) ----
  -- After the reminder row (it copies assignment_escalation_hours) and after the Account Director
  -- (it names that role).
  select app.seed_tenant_escalation_rules(p_tenant);
$$;
revoke execute on function public.seed_tenant_roles(uuid) from public, anon, authenticated;
grant  execute on function public.seed_tenant_roles(uuid) to service_role;

comment on function public.seed_tenant_roles(uuid) is
  'The tenant provisioning wrapper. Every app.seed_tenant_* a tenant needs, in dependency order. '
  'REPRODUCE IT WHOLE FROM ITS LATEST DEFINITION when extending it (traps.md) — it has lost seeds '
  'twice (27 Aug, 5 Sep). supabase/tests/114 provisions a fresh tenant, asserts each seed landed, '
  'and fails if any app.seed_* function exists that this body does not call.';

commit;
