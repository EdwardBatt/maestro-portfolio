-- I40 — who will approve this department's brief, answered by the database.
--
-- **What was wrong.** Step 5 listed "Brief approvers" from a role list written in the CLIENT —
-- `['department_lead', 'team_lead', 'deputy_team_lead']` — and named everyone in the department who
-- held one. Edward, 5 Sep: *"it shows the brief approvers as the assigned owner, the Department
-- Lead and 2 other team leaders and a team member for the same department."* Every one of those
-- names came from that list. It is wrong three separate ways:
--
--   1. It enumerates ROLES. ADR-0072 exists because of this exact mistake, and the rule it settled
--      is that authorization is read from grants and scope, never from role names. A per-user grant
--      (ADR-0036) — the documented way to hand approval to a stand-in — was invisible to it, and a
--      role renamed or a grant revoked would have left the screen confidently naming the wrong
--      people with nothing failing.
--   2. It ignores SCOPE, so it named leads of OTHER teams who have nothing to do with this
--      campaign. Edward, 5 Sep, on who is responsible: *"the Dept Lead or Assigned Team Lead."*
--   3. `deputy_team_lead` was on the list, which is almost certainly the "team member" — a name
--      the reader could not place, appearing under a heading that says they must act.
--
-- **What this returns instead.** Two kinds of person, and nobody else: the department's own lead,
-- and whoever THIS CAMPAIGN ASSIGNED THE WORK TO. Both must hold `briefs:approve` — by role grant
-- or by the ADR-0036 per-user overlay, minus any deny — because a list that promises somebody the
-- RPC would refuse is worse than one that named a department.
--
-- "Assigned" means the person on the deliverable, not their team and not their department. Reading
-- it as the team was the second version of this mistake: it still listed a lead whose COLLEAGUE was
-- assigned, which is not an answer to "who do I chase about this brief".
--
-- **The agency-wide failsafe is deliberately absent** (ADR-0070 d.6). Power Admin, Traffic Manager
-- and the Account Director can approve any brief; listing them would put the same three names under
-- every department and bury the answer the reader wants. The same reasoning already keeps them off
-- the `brief_awaiting_approval` notification: the failsafe is a capability, not a queue.
--
-- **An empty result is a real answer**, not an error — ADR-0070 d.7's "no possible approver" case.
-- The failsafe roles can still open it, which is why nothing is ever stuck.

begin;

-- ---------------------------------------------------------------- a team lead is in it ----
-- Found while building the list below, and it had to be settled before the list could be honest: a
-- screen naming somebody the RPC would refuse is worse than one naming a department.
--
-- `approve_department_brief` asks `app.in_write_scope(department, null, null)`. The `team` branch
-- read `p_team is not null and p_team = current_team_id()`, so with no team named it was FALSE and
-- a Team Leader could not accept their own department's brief — contradicting ADR-0070 d.3, which
-- says in as many words that they may. Nothing caught it: test 082 exercises a Department Lead and
-- the failsafe roles, never a team lead.
--
-- `create or replace` reproduced WHOLE (`20260905190100`'s warning): a bare replace resets
-- `proconfig` and silently drops the ADR-0033 `search_path` pin. The ONLY edit is the `team` branch.

create or replace function app.in_write_scope(p_department uuid, p_team uuid, p_account_manager uuid)
returns boolean language sql stable security definer
set search_path = public, app, extensions as $$
  select
    case app.current_scope()
      when 'tenant'     then true
      when 'department' then
        (p_department is not null and p_department = app.current_department_id())
        or (p_team is not null and exists (
              select 1 from public.teams t
              where t.id = p_team and t.department_id = app.current_department_id()))
      -- ADR-0070 d.3 states it plainly: *"A team lead may approve their own department's brief."*
      -- The code did not do it. Every OTHER call site passes a team alongside the department, and
      -- the two that do not — accepting a department brief, and generating one — are exactly the
      -- department-level questions the ADR is about, so a team lead was refused both.
      --
      -- Where a team IS named the original test stands unchanged, which is what keeps a team lead
      -- out of a sibling team's work. Only a question asked with NO team — "is this department
      -- yours?" — is answered by the department their team sits in.
      when 'team'       then
        (p_team is not null and p_team = app.current_team_id())
        or (p_team is null and p_department is not null and exists (
              select 1 from public.teams t
              where t.id = app.current_team_id() and t.department_id = p_department))
      -- ADR-0073 d.3. An Account Director oversees every account, so the named-manager test that
      -- bounds an Account Manager does not bound them. Read from `roles.key` rather than from a
      -- claim, so revoking the role takes effect on the next request (ADR-0037).
      when 'account'    then
        (p_account_manager is not null and p_account_manager = auth.uid())
        or exists (
             select 1 from public.roles r
             where r.id = app.current_role_id() and r.key = 'account_director')
      else false
    end
    or (exists (
          select 1 from public.user_scope_grants usg
          where usg.user_id   = auth.uid()
            and usg.tenant_id = app.current_tenant_id()
            and usg.department_id is not null
            and (
              (p_department is not null and usg.department_id = p_department)
              or (p_team is not null and exists (
                    select 1 from public.teams t
                    where t.id = p_team and t.department_id = usg.department_id))
            )))
    or (p_team is not null and exists (
          select 1 from public.user_scope_grants usg
          where usg.user_id   = auth.uid()
            and usg.tenant_id = app.current_tenant_id()
            and usg.team_id = p_team))
$$;

comment on function app.in_write_scope(uuid, uuid, uuid) is
  'ADR-0037 write scope. ADR-0073 d.3 gives the Account Director every account; I40 lets a team '
  'lead answer a DEPARTMENT-level question about the department their team sits in (ADR-0070 d.3), '
  'while a question that names a team still requires that team.';

-- ---------------------------------------------------------------- and so is the manager ----
-- The same fault a second time, found by asserting the failsafe rather than assuming it. The call
-- above passes `null` where `in_write_scope` expects the campaign's account manager, so an
-- account-scoped person could never match — and `account_manager` holds `briefs:approve` precisely
-- so they can accept a brief on their own campaign (ADR-0070 d.2, amended 3 Sep). The grant was
-- unreachable, and `may_generate_department_brief` already passed the argument, so a manager could
-- be invited to generate a brief and then refused permission to accept it.
--
-- Reproduced WHOLE, per `20260905190100`'s warning about `create or replace` and `proconfig`.

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

  -- The department's own leads by scope; Power Admin and Traffic Manager by being tenant-scoped,
  -- which `in_write_scope` already resolves. No branch for the failsafe, deliberately (d.3).
  --
  -- I40: the campaign's ACCOUNT MANAGER is passed, where before this argument was null. ADR-0070
  -- d.2 was amended on 3 Sep — Edward: *"the account manager can approve their own brief, even if
  -- they created it"* — and the permission catalog says so in as many words, but an account-scoped
  -- person is matched by exactly this argument, so passing null made the grant unreachable. It is
  -- also what `may_generate_department_brief` already passes, so until now a manager could be told
  -- to generate a brief they would then be refused permission to accept. Same call, same argument.
  if not (app.has_permission('briefs', 'approve')
          and app.in_write_scope(v.department_id, null,
                                 app.campaign_account_manager(v.campaign_id))) then
    raise exception 'approving this department''s brief is outside your scope'
      using errcode = '42501';
  end if;

  update campaign_briefs
     set approved_at = now(),
         approved_by = auth.uid()
   where id = p_brief;
end $$;

comment on function public.approve_department_brief(uuid) is
  'ADR-0070 d.1-d.3: the department accepts its brief, releasing its deliverables'' tasks for '
  'assignment. An RPC rather than a second UPDATE policy, because two UPDATE policies OR together '
  'and approving would have become editing. Idempotent, and the first timestamp stands. I40 passes '
  'the campaign''s account manager into the scope test, which d.2''s 3 Sep amendment requires and '
  'the original call made unreachable.';

-- ---------------------------------------------------------------- the permission, for anyone ----
-- `app.has_permission` answers for the CALLER, from their JWT claims. Listing other people needs
-- the same question asked about somebody else, so this is that rule over a different input —
-- deliberately the same three parts in the same order (role grant, allow overlay, deny overrides),
-- because the screen and the refusal disagreeing is the failure this whole file exists to prevent.
-- `090` asserts the two agree for every seeded person; if a fourth part is ever added to one, that
-- test fails rather than the screen quietly going wrong.
create or replace function app.user_has_permission(p_user uuid, p_resource text, p_action text)
returns boolean language sql stable security definer
set search_path = public, app, extensions as $$
  select
    (
      exists (
        select 1 from public.user_profiles up
          join public.role_grants rg on rg.role_id = up.role_id and rg.tenant_id = up.tenant_id
        where up.id = p_user and rg.resource = p_resource and rg.action = p_action
      )
      or exists (
        select 1 from public.user_grants ug
          join public.user_profiles up on up.id = ug.user_id and up.tenant_id = ug.tenant_id
        where ug.user_id = p_user and ug.resource = p_resource and ug.action = p_action
          and ug.effect = 'allow'
      )
    )
    and not exists (
      select 1 from public.user_grants ug
        join public.user_profiles up on up.id = ug.user_id and up.tenant_id = ug.tenant_id
      where ug.user_id = p_user and ug.resource = p_resource and ug.action = p_action
        and ug.effect = 'deny'
    )
$$;

comment on function app.user_has_permission(uuid, text, text) is
  'ADR-0037 read about a NAMED user rather than the caller — for listing who can do a thing. The '
  'same rule as app.has_permission over a different input; test 090 asserts the two never disagree.';

-- ---------------------------------------------------------------- the people ----
-- A cast that cannot raise. The draft branch below reads owner ids out of jsonb the wizard wrote,
-- and a half-filled row holds an empty string rather than a uuid — which would abort the whole
-- listing rather than skip one row.
create or replace function app.try_uuid(p_text text) returns uuid
language plpgsql immutable as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end $$;

-- One call for the WHOLE campaign rather than one per department: step 5 shows a tab per
-- department, and a query per tab is how a list becomes slow at exactly the moment it is useful.
create or replace function public.department_brief_approvers(p_campaign uuid)
returns table (department_id uuid, user_id uuid, display_name text, is_assigned_owner boolean)
language sql stable security definer
set search_path = public, app, extensions as $$
  with tenant as (select app.current_tenant_id() as id),
  -- Who this campaign actually gives work to, and in which department. `deliverables.department_id`
  -- is stamped from the OWNER (ADR-0050 d.2), so this is one row per person-with-work.
  work as (
    select distinct d.department_id, d.owner_user_id
      from public.deliverables d
      join public.streams s on s.id = d.stream_id
     where s.campaign_id = p_campaign
       and d.department_id is not null
       and d.owner_user_id is not null
    union
    -- A DRAFT has no deliverable ROWS yet — they are written once, at submit (ADR-0067) — and step
    -- 5 is inside the wizard, before that. Its owners live in `campaigns.brief`, which the wizard
    -- now saves as it advances (I40), and the department is read from the owner exactly as
    -- `tg_deliverable_stamp_department` will read it at submit. Same rule, one step earlier.
    select distinct owner.department_id, owner.id
      from public.campaigns c
      cross join lateral jsonb_array_elements(
        case jsonb_typeof(c.brief->'deliverables')
          when 'array' then c.brief->'deliverables' else '[]'::jsonb end) as e
      join public.user_profiles owner on owner.id = app.try_uuid(e->>'ownerUserId')
     where c.id = p_campaign
       and c.tenant_id = (select id from tenant)
       and owner.department_id is not null
  )
  select w.department_id, up.id, up.display_name,
         -- True where they are here because THIS CAMPAIGN GAVE THEM THE WORK, rather than because
         -- they lead the department. Edward, 5 Sep: the only names that belong here are the person
         -- assigned and the department lead.
         exists (select 1 from work w1
                  where w1.department_id = w.department_id
                    and w1.owner_user_id = up.id) as is_assigned_owner
    from (select distinct department_id from work) w
    join public.user_profiles up on up.tenant_id = (select id from tenant) and up.is_active
    join public.roles r on r.id = up.role_id
   where app.user_has_permission(up.id, 'briefs', 'approve')
     and (
       -- Theirs by DEPARTMENT scope — the department's own lead. Read from the scope model, which
       -- is also why the agency-wide failsafe needs no exclusion written for it: `tenant` and
       -- `account` scope simply do not match a department, exactly as ADR-0070 d.3 argued.
       (r.scope = 'department' and up.department_id = w.department_id)
       -- Or handed this department by an ADR-0036 per-user scope grant — a stand-in while a lead
       -- is away, which is audited and revocable where a role change is not.
       or exists (
            select 1 from public.user_scope_grants usg
             where usg.user_id = up.id and usg.tenant_id = up.tenant_id
               and usg.department_id = w.department_id)
       -- Or the campaign gave THEM the work. Not their team, and not their department: a lead whose
       -- colleague was assigned is not this brief's approver, and naming them is what made the list
       -- unreadable. An owner who does not hold `briefs:approve` is not named either — the list
       -- must never promise somebody the RPC would refuse.
       or exists (select 1 from work w2
                   where w2.department_id = w.department_id and w2.owner_user_id = up.id)
     )
   order by w.department_id, up.display_name
$$;
comment on function public.department_brief_approvers(uuid) is
  'I40 / ADR-0070 d.2, d.6: the people who will accept this department''s brief — its own lead, and '
  'whoever this campaign actually assigned work to. Computed from grants and scope, never from role '
  'names (ADR-0072). The agency-wide failsafe is excluded on purpose: it can approve everything, so '
  'listing it would name the same people under every department. An empty result is d.7''s "no '
  'possible approver", not a failure.';

revoke execute on function public.department_brief_approvers(uuid) from anon;
grant  execute on function public.department_brief_approvers(uuid) to authenticated;

commit;
