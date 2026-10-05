-- ADR-0083 d.9 / I44.8 — a deliverable is owned by a lead, and a lead hands it on within their
-- department.
--
-- Edward, 10 Sep: "at this stage team members do not own deliverables, they are assigned tasks …
-- the Department Lead can re-assign to one of his team leads." The decision was accepted with
-- ADR-0083 and the single-job screen obeyed it (SJ-02 offers department leads only) — but nothing
-- else did: `app.tg_deliverable_owner_guard` (ADR-0055) tests the ACTOR's authority over the
-- incoming owner and says nothing about who the owner may be, `reassign_deliverable` adds nothing,
-- and the reassign picker on /deliverables offered every user. Found by the independent review,
-- 11 Sep; Edward chose to enforce it everywhere, campaigns included (option A).
--
-- THE RULE, in the scope model and never by a role's name (ADR-0074):
--
--   1. An owner is somebody whose ROLE reaches beyond themselves — `roles.scope <> 'self'`. A
--      team member (and a portal user) is `self`; a department lead, a team lead and a deputy are
--      not; neither are the account manager, Traffic and Power Admin, who may hold a deliverable
--      as the failsafe ADR-0090 d.4 already relies on.
--   2. Somebody whose own reach is a department or a team hands a deliverable on WITHIN the
--      department it sits in — "to one of his team leads". A tenant-wide or account-scoped actor
--      (Traffic, Power Admin, the campaign's account manager, the Account Director) may move it
--      to another department's lead: they are the people who could have placed it there in the
--      first place, and ADR-0050's stamp follows the new owner as it always has.
--
-- CAMPAIGN WORK ONLY — a deliverable under a stream. Two other kinds of deliverable name an owner
-- by their own design and are outside Edward's sentence: an AD-HOC deliverable's owner is its
-- assignee (`create_adhoc_deliverable`, 20260829090000 — one person, one task, and the path is
-- being retired by ADR-0082 d.9), and an INTERNAL PROJECT's deliverables are owned by the project's
-- PM (`internal_deliverables_given_their_pm`), who may be anybody the project names. Both are
-- `job_id` work with no stream; the rule reads `stream_id` and leaves them alone.
--
-- The existing guard stays exactly as it is — it answers "may THIS caller change the owner?"; this
-- one answers "may THAT person be the owner?". Two questions, two triggers, both BEFORE, both
-- escaping on a system op or a superuser path with no actor (migrations, seeders, fixtures).
--
-- EXISTING ROWS ARE NOT REWRITTEN. The trigger fires on a change of owner, so a deliverable a team
-- member owns today keeps them until somebody reassigns it — and that reassignment must name a
-- lead. The count is reported by notice below so it can be read off the push; Edward decided the
-- live rows are reassigned by hand before or after, not by a migration choosing a lead for them.
--
-- Tests: supabase/tests/107_a_deliverable_is_owned_by_a_lead.sql. (062's deliverable is job
-- work with no stream, so ADR-0055's suite is untouched by this rule.)

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
    return new;                                   -- clearing the owner is the other guard's business
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
  'ADR-0083 d.9, held by Postgres, for CAMPAIGN deliverables (stream_id set): an owner''s role '
  'reaches beyond themselves (scope <> self — never a role name), and a department- or team-scoped '
  'actor reassigns within the deliverable''s department. Companion to app.tg_deliverable_owner_guard, which decides whether the CALLER may '
  'change the owner at all. Existing rows are untouched until reassigned.';

-- Fires BEFORE the department stamp (alphabetical: owner_guard, owner_is_a_lead, stamp_department)
-- so old.department_id is still the department the deliverable sits in.
create trigger deliverable_owner_is_a_lead
  before insert or update of owner_user_id on deliverables
  for each row execute function app.tg_deliverable_owner_is_a_lead();

-- ---------------------------------------------------------------- the measurement ----
do $$
declare r record;
begin
  for r in
    select d.tenant_id, count(*) as n
      from deliverables d
      join user_profiles p on p.id = d.owner_user_id
      join roles ro on ro.id = p.role_id
     where ro.scope = 'self'
       and d.stream_id is not null
       and d.state not in ('archived', 'delivered', 'approved')
     group by d.tenant_id
  loop
    raise notice 'ADR-0083 d.9: tenant % has % live deliverable(s) owned by a team member — reassign each to a lead by hand', r.tenant_id, r.n;
  end loop;
end $$;

commit;
