-- ADR-0083 d.11 (12 Sep) — a campaign deliverable always has an owner; it cannot be cleared.
--
-- `tg_deliverable_owner_is_a_lead` (d.9, `20260911130700`) enforced WHO may own a campaign
-- deliverable (a lead, never a team member) but wrote "clearing the owner is the other guard's
-- business" and let a null through — and the other guard never refused it either. So the reassign
-- picker could offer "Nobody" and the database accepted it, leaving a campaign deliverable ownerless
-- and its task list approvable only by the ADR-0090 d.4 failsafe. Edward, testing 12 Sep: *"Who the
-- hell decided no-one is a valid option?"* — no one did; it fell out of a nullable column.
--
-- THE RULE (d.11): on CAMPAIGN work (`stream_id` set), an owner that is already set may not be
-- cleared. A deliverable may still be BORN without a lead — a department with no lead yet — which is
-- the case d.12 answers in the UI by naming a team lead; that born-null state is allowed. Only
-- stripping an EXISTING owner back to nobody is refused. Ad-hoc and internal-project deliverables
-- (no stream) keep their own owners (d.9 header) and are untouched.
--
-- Reproduced WHOLE from `20260911130700`, its last definition. The ONLY change is the null branch at
-- the top, which now refuses the clear on stream work by a real actor; the system-op / superuser
-- escape (migrations, seeders, fixtures) and every later check are byte-identical.

begin;

create or replace function app.tg_deliverable_owner_is_a_lead() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_scope     text;
  v_dept      uuid;
  v_team_dept uuid;
begin
  if new.owner_user_id is null then
    -- d.11: a campaign deliverable that HAS an owner may not be cleared back to nobody. Born-null
    -- is allowed (a department with no lead yet — d.12 names a team lead in the UI); only stripping
    -- an existing owner is refused, and only for a real actor (migrations/seeders clear freely).
    if tg_op = 'UPDATE'
       and new.stream_id is not null
       and old.owner_user_id is not null
       and auth.uid() is not null
       and not app.is_system_op() then
      raise exception
        'a campaign deliverable keeps an owner — reassign it to a lead, it cannot be set to nobody'
        using errcode = '42501';
    end if;
    return new;                                   -- born without a lead yet, or a non-campaign row
  end if;
  if new.stream_id is null then
    return new;                                   -- ad-hoc and internal-project work: see the header
  end if;
  if tg_op = 'UPDATE' and new.owner_user_id is not distinct from old.owner_user_id then
    return new;
  end if;
  if auth.uid() is null or app.is_system_op() then
    return new;                                   -- migrations, seeders, fixtures
  end if;

  select r.scope, p.department_id, t.department_id
    into v_scope, v_dept, v_team_dept
    from public.user_profiles p
    join public.roles r on r.id = p.role_id
    left join public.teams t on t.id = p.team_id
   where p.id = new.owner_user_id and p.tenant_id = new.tenant_id;
  if not found then
    return new;                                   -- "not in your organization" is the other guard's line
  end if;

  -- 1. A team member is assigned tasks; they do not own the deliverable (ADR-0083 d.9).
  if coalesce(v_scope, 'self') = 'self' then
    raise exception
      'a deliverable is owned by a department lead or a team lead — team members are assigned its tasks'
      using errcode = '42501';
  end if;

  -- 2. A lead hands work on within their own department. The department the deliverable sits in
  --    is the one stamped from its current owner (ADR-0050 d.2); the incoming owner's is read
  --    from their profile, or from their team's department where the profile carries none.
  if tg_op = 'UPDATE'
     and old.department_id is not null
     and app.current_scope() in ('department', 'team')
     and coalesce(v_dept, v_team_dept) is distinct from old.department_id then
    raise exception
      'a department lead hands a deliverable to a lead in the same department — moving it to another department is the account manager''s or Traffic''s call'
      using errcode = '42501';
  end if;

  return new;
end $$;

comment on function app.tg_deliverable_owner_is_a_lead() is
  'ADR-0083 d.9 + d.11, held by Postgres, for CAMPAIGN deliverables (stream_id set): an owner''s '
  'role reaches beyond themselves (scope <> self — never a role name); a department- or team-scoped '
  'actor reassigns within the deliverable''s department; and an owner that is already set may not be '
  'cleared to nobody (born-null is allowed). Companion to app.tg_deliverable_owner_guard, which '
  'decides whether the CALLER may change the owner at all. Existing rows are untouched until reassigned.';

commit;
