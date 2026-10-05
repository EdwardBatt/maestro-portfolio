-- I37.1 / I37.2 (ADR-0070) — a department brief is approved by the department, and work waits.
--
-- Until now there was ONE gate: ADR-0048 d.8 made a campaign's work unassignable until the campaign
-- is `approved`, and the account manager's single click released every department at once —
-- including one that had not read its brief, let alone agreed it could be done.
--
-- WHAT DID NOT EXIST. `campaign_briefs` has carried `values` and `brief_type` since 27 August and
-- no approval state at all. And nobody is named as THE lead of a department: `department_lead` is a
-- ROLE with scope `department` (ADR-0009), so the set of people who may approve is derived, and may
-- be empty.
--
-- THE DEADLOCK THIS AVOIDS, BECAUSE IT HAS HAPPENED. On 29 August a campaign under a client with no
-- account manager could be approved by NOBODY: it sat at `pending_approval` for ever with nothing
-- under it assignable, and it took a migration to fix. A second gate per department is the same
-- shape, multiplied. Edward's answer widens the route rather than adding an override — department
-- leads AND team leads — and names a failsafe: Power Admin and Traffic Manager.
--
-- The failsafe needs no exception in the code. Both are account-scoped, so `app.in_write_scope`
-- already passes them for every department; the failsafe falls OUT of the scope model instead of
-- being bolted beside it, and therefore cannot drift from it.
--
-- WHY A SEPARATE PERMISSION. Approving is a different job from editing — "is this something my
-- department can do?" is not "is this brief well written?" — so ADR-0055's test applies and
-- `briefs:approve` is its own row rather than riding on `projects:manage`.
--
-- It was first argued as a separation between the person who WRITES a brief and the person who
-- ACCEPTS it. Edward overruled that on 3 Sep — *"the account manager can approve their own brief,
-- even if they created it"* — so the AM holds it too, limited by their `account` scope to the
-- campaigns they own. What the separate permission still buys is that holding it is a deliberate
-- grant: a Team Member cannot accept work on their department behalf, and nobody acquires the
-- ability by being able to edit.
--
-- WHY AN RPC RATHER THAN A SECOND UPDATE POLICY. Two UPDATE policies OR together, so a policy
-- admitting `briefs:approve` would also let a department lead rewrite `values` — approving would
-- silently become editing. A SECURITY DEFINER function is the same shape `approve_campaign` and
-- `sub_task_approve` already use: one door, one authority check, and the columns it may touch fixed
-- by its own body.

begin;

-- ---------------------------------------------------------------- the state ----
alter table campaign_briefs
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references user_profiles(id);

comment on column campaign_briefs.approved_at is
  'ADR-0070 d.1: when the department accepted this brief. NULL is unapproved — the absence of a '
  'timestamp, the way campaigns.approved_at already does it, so there is no parallel status column '
  'to keep in step. Nothing under this brief''s deliverables can be ASSIGNED until it is set (d.4).';

comment on column campaign_briefs.approved_by is
  'ADR-0070: who accepted it. Stamped from auth.uid() by approve_department_brief, never sent by a '
  'caller — this is the column an argument about who agreed to the work would turn on.';

-- The exception query (d.7) reads the unapproved ones. Partial: an approved brief is not in it.
create index if not exists idx_campaign_briefs_awaiting
  on campaign_briefs (tenant_id, campaign_id)
  where approved_at is null;

-- ---------------------------------------------------------------- the permission ----
-- The after-insert trigger on permission_catalog grants this to every tenant's power_admin,
-- existing ones included, so that role needs no backfill.
insert into permission_catalog (resource, action, description) values
  ('briefs', 'approve',
   'Accept a department brief (ADR-0070). Held by Department Leads and Team Leaders for their own '
   'department, by the Account Manager for campaigns they own (amended 3 Sep — they may approve a '
   'brief they wrote), and by Power Admin and Traffic Manager for any, the failsafe when a lead is '
   'absent. SCOPE is what limits each of them. Still distinct from projects:manage so that holding '
   'it is a deliberate grant rather than a side effect of being able to edit.')
on conflict do nothing;

-- A small dedicated seeder composed by the wrapper, the shape `seed_tenant_asset_grants` and
-- `seed_tenant_default_workflows` already use — rather than reproducing the 200-line
-- `app.seed_tenant_roles` to add three rows to it.
create or replace function app.seed_tenant_brief_approval_grants(p_tenant uuid) returns void
language plpgsql as $$
begin
  -- Power Admin's grants are fenced by protect_system_role_grants, so writes run under the
  -- system-op flag exactly as the role seeder does. (It already holds this via the catalog
  -- trigger; the flag is set once for the whole statement below regardless.)
  perform set_config('app.system_op', 'on', true);

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, r.id, 'briefs', 'approve'
    from roles r
   where r.tenant_id = p_tenant
     -- The department's own people, the ACCOUNT MANAGER, and the two roles that carry the whole
     -- agency (ADR-0070 d.2, amended 3 Sep).
     --
     -- `deputy_team_lead`: ADR-0017 makes it the same authority as the Team Leader, and a deputy
     -- who cannot stand in during exactly the absence this failsafe exists for would be a deputy
     -- in name only.
     --
     -- `account_manager`: Edward, 3 Sep — *"the account manager can approve their own brief, even
     -- if they created it."* This overrules the writer/approver separation d.2 first argued for.
     -- Their scope is `account`, so it reaches only campaigns they own; it does not make them able
     -- to approve another AM's work.
     and r.key in ('department_lead', 'team_lead', 'deputy_team_lead',
                   'account_manager', 'power_admin', 'scheduler')
  on conflict do nothing;

  perform set_config('app.system_op', 'off', true);
end $$;

select app.seed_tenant_brief_approval_grants(id) from tenants;

-- Reproduced whole from `20260903100300`, plus the new seeder. Nothing is removed.
create or replace function public.seed_tenant_roles(p_tenant uuid) returns void
language sql as $$
  select app.seed_tenant_roles(p_tenant);
  select app.seed_tenant_asset_grants(p_tenant);
  select app.seed_tenant_storage_settings(p_tenant);
  select app.seed_tenant_reminder_settings(p_tenant);
  select app.seed_tenant_brief_approval_grants(p_tenant);
  select app.seed_tenant_brief_templates(p_tenant);
  select app.seed_tenant_deliverable_taxonomy(p_tenant);
  select app.seed_tenant_taxonomy_amendments(p_tenant);
  select app.seed_tenant_workflow_templates(p_tenant);
  select app.seed_tenant_workflow_step_corrections(p_tenant);
  select app.seed_tenant_step_review_modes(p_tenant);
  select app.seed_tenant_default_workflows(p_tenant);
$$;
revoke execute on function public.seed_tenant_roles(uuid) from public, anon, authenticated;
grant  execute on function public.seed_tenant_roles(uuid) to service_role;

-- ---------------------------------------------------------------- approving ----
create or replace function public.approve_department_brief(p_brief uuid)
returns void
language plpgsql
security definer
set search_path = public, app, extensions as $$
declare
  v campaign_briefs;
begin
  select * into v from campaign_briefs
   where id = p_brief and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'campaign brief % not found', p_brief using errcode = 'P0002';
  end if;

  -- Idempotent. Approving twice is not an error, and it must not move the timestamp: the FIRST
  -- acceptance is the fact, and a second click would otherwise quietly rewrite when the department
  -- agreed — which is the number any question about this would be asked of.
  if v.approved_at is not null then
    return;
  end if;

  -- The department's own leads by scope; Power Admin and Traffic Manager by being account-scoped,
  -- which `in_write_scope` already resolves. No branch for the failsafe, deliberately (d.3).
  if not (app.has_permission('briefs', 'approve')
          and app.in_write_scope(v.department_id, null, null)) then
    raise exception 'approving this department''s brief is outside your scope'
      using errcode = '42501';
  end if;

  update campaign_briefs
     set approved_at = now(),
         approved_by = auth.uid()
   where id = p_brief;
end $$;

comment on function public.approve_department_brief(uuid) is
  'ADR-0070 d.1–d.3: the department accepts its brief, releasing its deliverables'' tasks for '
  'assignment. An RPC rather than a second UPDATE policy, because two UPDATE policies OR together '
  'and approving would have become editing. Idempotent, and the first timestamp stands.';

revoke execute on function public.approve_department_brief(uuid) from anon;
grant  execute on function public.approve_department_brief(uuid) to authenticated;

-- ---------------------------------------------------------------- the gate ----
-- Is the brief governing this task approved?
--
-- THE DELIVERABLE'S DEPARTMENT, NOT THE TASK'S (d.4). `sub_tasks.department_id` is stamped from the
-- ASSIGNEE (ADR-0050 d.2, ADR-0060), so a Creative deliverable with one step done by Production is
-- ordinary — and reading the task's own department would gate that step against a brief it has
-- nothing to do with, and would change which brief governs it every time the assignee changed.
-- One deliverable, one brief, whoever ends up doing the steps.
--
-- ABSENCE IS NOT REFUSAL (d.5). No deliverable, no department on it, or no brief for that
-- department yet: TRUE. Briefs are generated on demand, and refusing work until one existed would
-- stop a campaign whose briefs nobody has generated, with nothing on screen saying why. What is
-- missing is shown as an exception instead.
create or replace function app.sub_task_brief_is_approved(p_sub_task uuid) returns boolean
language sql stable security definer
set search_path = public, app, extensions as $$
  select not exists (
    select 1
      from sub_tasks st
      join deliverables d on d.id = st.deliverable_id
      join streams s      on s.id = d.stream_id
      join campaign_briefs b
        on b.campaign_id = s.campaign_id
       and b.department_id = d.department_id
     where st.id = p_sub_task
       and b.approved_at is null
  );
$$;

comment on function app.sub_task_brief_is_approved(uuid) is
  'ADR-0070 d.4: has the DELIVERABLE''s department brief been approved? Reads the deliverable''s '
  'department, never the task''s — the task''s is stamped from the assignee and would change which '
  'brief governs it. True when there is no such brief (d.5): absence is not refusal.';

create or replace function app.tg_sub_task_assignment_gate() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v_campaign uuid;
begin
  -- Only an ASSIGNMENT is gated. A pending campaign's tasks can still be created, renamed and
  -- re-dated while the account manager reads them — that is what reviewing is.
  if new.assignee_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then
    return new;
  end if;

  -- Migrations and seeders escape, the same way ADR-0040's assignment trigger lets them.
  if auth.uid() is null or app.is_system_op() then return new; end if;

  v_campaign := app.sub_task_campaign(new.id);
  if not app.campaign_is_approved(v_campaign) then
    raise exception
      'this campaign is waiting for the account manager to approve it, so its work cannot be assigned yet'
      using errcode = '42501';
  end if;

  -- ADR-0070 d.4: the second stage. The campaign being approved is no longer enough — the
  -- department that will do this work has to have accepted its own brief.
  if not app.sub_task_brief_is_approved(new.id) then
    raise exception
      'this department has not approved its brief yet, so its work cannot be assigned'
      using errcode = '42501';
  end if;

  return new;
end $$;

commit;
