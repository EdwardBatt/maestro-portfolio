-- Section C, the foundation: workstreams, a chosen department, a required owner, and the second
-- gate changing hands (ADR-0099, ADR-0100 — both accepted 23 Sep). `I56.1`, `I56.2`.
--
-- Everything else in section C reads these columns, so this lands first and alone.
--
-- **A note on shape, because the ADR guessed differently.** ADR-0099's context paragraph expected
-- workstreams to be a *promotion of `streams`*. The data says otherwise: `streams` is one row per
-- campaign (193 campaigns, 193 streams, each named after its campaign) and it is how EVERY query
-- reaches a deliverable's campaign — `streams!inner(campaign_id)` appears throughout `src/`.
-- Making it optional, which ADR-0099 d.1 requires of a workstream, would break all of them. So
-- `streams` stays the invisible campaign join and `workstreams` is its own table. The DECISIONS
-- (d.1–d.11) name no table; only the cost estimate did, and it was wrong.

begin;

-- ============================================================================
-- 1) workstreams — the optional named grouping (ADR-0099 d.1)
-- ============================================================================
create table if not exists workstreams (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  campaign_id   uuid not null references campaigns(id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  -- d.3: required. A group without a department cannot be reached, assigned or briefed, so it is
  -- not a legal state.
  department_id uuid not null references departments(id),
  -- d.5: chosen, not inferred, and may be left empty.
  owner_user_id uuid references user_profiles(id),
  created_by    uuid,
  updated_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_workstreams_tenant_id on workstreams (tenant_id);
create index if not exists idx_workstreams_campaign  on workstreams (campaign_id);

-- d.7: unique within a campaign, case-insensitively — "Always-on" and "always-on" are the same
-- group to everyone but a computer. Two campaigns may each have one.
create unique index if not exists uq_workstreams_campaign_name
  on workstreams (campaign_id, lower(trim(name)));

comment on table workstreams is
  'ADR-0099: a campaign''s work MAY be grouped into named workstreams — the v3 Figma''s '
  '"Design & Animation", "Always-on". Grouping is OPTIONAL (d.1): a deliverable may belong to none '
  'and a campaign may have none. The group carries a required department and an owner; adding or '
  'moving a deliverable into it SETS that deliverable''s department (d.3), which is the whole '
  'convenience the group provides. Not a promotion of `streams`: see this migration''s header.';

grant select, insert, update, delete on table public.workstreams to authenticated, service_role;

alter table workstreams enable row level security;
alter table workstreams force row level security;

create policy workstreams_tenant_select on workstreams
  for select to authenticated
  using (tenant_id = app.current_tenant_id());

-- Written by whoever may manage the campaign's work, in scope. Same authority as adding a
-- deliverable, because that is what making a group is a part of.
create policy workstreams_tenant_write on workstreams
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage'));

create trigger set_updated_at before update on workstreams
  for each row execute function app.set_updated_at();

create trigger set_actor_columns
  before insert or update on workstreams
  for each row execute function app.set_actor_columns();

create trigger audit_row_change
  after insert or update or delete on workstreams
  for each row execute function app.audit_row_change();

-- ============================================================================
-- 2) a deliverable's group — nullable, because grouping is optional
-- ============================================================================
alter table deliverables
  add column if not exists workstream_id uuid references workstreams(id);

create index if not exists idx_deliverables_workstream
  on deliverables (workstream_id) where workstream_id is not null;

comment on column deliverables.workstream_id is
  'ADR-0099 d.1: the group this deliverable sits in, or NULL. Ungrouped is a normal, permanent '
  'state — not a step on the way to being grouped.';

-- d.8: deleting a group that still holds work is refused, with the count. `on delete` is left as
-- NO ACTION deliberately: a cascade would make deleting a group a way to delete work.

-- ============================================================================
-- 3) the department is CHOSEN, not stamped from the owner (ADR-0099 d.2)
-- ============================================================================
-- This is the rule that caused the 22 Sep production incident: a Creative lead could not assign her
-- own team member because the deliverable's owner sat in another department, so the DEPARTMENT had
-- moved because one person's name changed. ADR-0050 d.2 is superseded for deliverables.
-- (`sub_tasks` keep their own stamp — ADR-0060 — untouched.)
create or replace function app.tg_deliverable_stamp_department()
returns trigger
language plpgsql
security definer
set search_path = public, app, extensions as $$
begin
  -- d.3: the group fills the department in. On insert with a group, or whenever the group changes,
  -- the deliverable takes the group's department. This is the convenience a workstream exists to
  -- provide, and it happens because a person put the deliverable in the group.
  if new.workstream_id is not null
     and (tg_op = 'INSERT' or new.workstream_id is distinct from old.workstream_id) then
    select w.department_id into new.department_id
      from workstreams w where w.id = new.workstream_id;
  end if;

  -- d.4: taking a deliverable OUT of a group changes nothing but the grouping. Removing a grouping
  -- must never silently move work between departments, so there is no `else` here.
  --
  -- And no branch on the owner at all any more: naming somebody no longer moves the work.
  return new;
end $$;

comment on function app.tg_deliverable_stamp_department() is
  'ADR-0099 d.2/d.3/d.4: a deliverable''s department is its own and CHOSEN. The only thing that '
  'writes it here is joining or moving between workstreams. It is no longer derived from the '
  'owner (ADR-0050 d.2, superseded for deliverables) — that derivation is what moved a '
  'deliverable''s department when its owner was changed, and refused a lead her own team member '
  'on 22 Sep (I53.29).';

-- ============================================================================
-- 4) an owner and a department are REQUIRED (ADR-0100 d.8, ADR-0099 d.2)
-- ============================================================================
-- `I22.5`, 28 Aug: *"the PM is now required — a campaign cannot be created without an owner per
-- deliverable either."* That was built as a SCREEN rule: the wizard refuses to submit without one,
-- the column stayed nullable, and any other path could write work nobody owns. Edward, 23 Sep:
-- *"this is now the second time I have had to mention this."*
--
-- It is load-bearing now: ADR-0100 d.2 makes the OWNER the one who accepts the task list, so an
-- unowned deliverable is work nobody can accept and nobody can start.
--
-- Safe to enforce: 0 of 293 rows are unowned and 0 have no department (measured 23 Sep).
--
-- REMOVED 26 Sep, before this migration reached production (it had only run locally): the two
-- `set not null` statements that stood here. `20260923170000`, an hour later, drops both again in
-- favour of a guard (`tg_deliverable_requires_owner`), so the schema ends the same without them —
-- but production holds 100 ad-hoc/internal deliverables with no owner and no department (legacy
-- work from before ad-hoc tasks took their assignee as owner, 29 Aug), so `supabase db push` would
-- have stopped here. The "293 rows" above was the local database. Owners stay required of every
-- new deliverable a person creates, by the guard.

comment on column deliverables.owner_user_id is
  'ADR-0100 d.8: required. The owner answers the second gate (they approve the task list), so an '
  'unowned deliverable would be work nobody can accept. Decided in I22.5 on 28 Aug and enforced '
  'only by a dialog until now.';

commit;
