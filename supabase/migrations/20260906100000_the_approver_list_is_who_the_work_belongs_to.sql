-- I40.15 — the "Brief approvers" list names who the work belongs to, and nobody else.
--
-- **What Edward saw, 6 Sep**, one day after I40.12 rebuilt this list in Postgres: *"it should name
-- the assigned owner of the deliverables as the Brief Approver… It should not list the failsafe
-- backup approvers. Currently it lists all account managers and all team leads as well as the dept
-- lead."*
--
-- **Measured, not guessed.** In the live tenant, several people hold a per-user scope grant
-- (`user_scope_grants`) covering CREATIVE and CONTENT: Account Managers, the Account Director,
-- a Team Leader and a Team Member. Most of them hold `briefs:approve` through their role, so
-- they appeared under CREATIVE's name — exactly the list Edward describes. Not one of them
-- was given work on the campaign, and not one leads the department.
--
-- **The cause is the third branch this function had.** I40.12 admitted three kinds of person: the
-- department's own lead (by role scope), whoever the campaign assigned the work to, and anyone
-- holding an ADR-0036 per-user SCOPE grant over the department. The third was written for a
-- stand-in covering an absent lead. It does not mean that here, and it cannot be made to: a scope
-- grant widens what somebody may WRITE — bookings, tasks, campaigns — and this tenant hands them out
-- for exactly that reason. Reading "may write in Creative" as "answers for Creative's brief" turns a
-- scheduling convenience into a name under a heading that says they must act.
--
-- **So the rule loses that branch and keeps the other two**: the department's own lead, and whoever
-- this campaign gave the work to. Both still filtered by `briefs:approve` through
-- `app.user_has_permission`, so the list can never promise somebody the RPC would refuse.
--
-- **Being off the list is not being unable, and that is the existing principle, not a new one.**
-- ADR-0070 d.6 already keeps Power Admin, the Traffic Manager and the Account Director off it while
-- leaving them able to approve anything — *the failsafe is a capability, not a queue*. A per-user
-- scope grant is the same shape of thing: the holder can still accept the brief, and
-- `approve_department_brief` is untouched by this migration, so nothing anybody could do yesterday
-- becomes refused today. The only change is who the screen NAMES.
--
-- **The per-user overlay is still visible where it decides the answer**, which is what ADR-0072 asked
-- for. `user_grants` — the PERMISSION half — is still read, through `app.user_has_permission`: an
-- allow puts an assigned owner on the list and a deny takes them off again, and test 090 asserts
-- both directions unchanged. It is only the SCOPE half that stops being a reason to be named.
--
-- Reproduced WHOLE per `20260905190100`'s warning: a bare `create or replace` resets `proconfig` and
-- silently drops the ADR-0033 `search_path` pin. The ONLY edit is the removed branch.

begin;

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
    -- saves as it advances (I40.11), and the department is read from the owner exactly as
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
       -- Or the campaign gave THEM the work. Not their team, and not their department: a lead whose
       -- colleague was assigned is not this brief's approver, and naming them is what made the list
       -- unreadable. An owner who does not hold `briefs:approve` is not named either — the list
       -- must never promise somebody the RPC would refuse.
       or exists (select 1 from work w2
                   where w2.department_id = w.department_id and w2.owner_user_id = up.id)
       -- I40.15: the `user_scope_grants` branch that stood here is GONE. It named five people in
       -- the live tenant who had neither work on the campaign nor the department to lead — a scope
       -- grant says what somebody may write, not whose brief they answer for. They can all still
       -- approve; `approve_department_brief` is unchanged. See this file's header.
     )
   order by w.department_id, up.display_name
$$;
comment on function public.department_brief_approvers(uuid) is
  'I40.15 / ADR-0070 d.2, d.6: the people who will accept this department''s brief — its own lead, '
  'and whoever this campaign actually assigned work to. Computed from grants and scope, never from '
  'role names (ADR-0072). Nobody is named for holding a per-user SCOPE grant over the department: '
  'that widens what they may write, not whose brief they answer for, and it named five uninvolved '
  'people in the live tenant. They can still approve — being off the list is not being unable, the '
  'same rule that keeps the agency-wide failsafe off it. An empty result is d.7''s "no possible '
  'approver", not a failure.';

-- `create or replace` keeps the existing ACL; restated so the grant is readable in one file.
revoke execute on function public.department_brief_approvers(uuid) from anon;
grant  execute on function public.department_brief_approvers(uuid) to authenticated;

commit;
