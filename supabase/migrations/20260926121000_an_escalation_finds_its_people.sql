-- I59.24 / ADR-0108 d.3 (25 Sep, Edward) — who hears about a stall: the rule's roles plus the people
-- relative to the piece.
--
-- `app.escalation_recipients(kind, deliverable, sub_task[, campaign])` reads the tenant's rule for the
-- kind (tenant_escalation_rules, 20260926120000) and returns each ACTIVE person once, with why:
--
--   role                   every active holder of any of the rule's role_ids, in the tenant
--   owner                  the deliverable's owner (deliverables.owner_user_id)
--   account_manager        the deliverable's (or the campaign's) account manager —
--                          app.deliverable_account_manager / app.campaign_account_manager, the
--                          campaign's own manager, else the client's
--   owner_department_lead  active users whose role scope is 'department' in the OWNER's department
--                          (the deliverable's own department when the owner has none — ADR-0102
--                          makes the two the same)
--   assignee_team_lead     active users whose role scope is 'team' in the task ASSIGNEE's team —
--                          the team lead AND the deputy (a scope-'team' clone, ADR-0017)
--   reviewers              the task's reviewers who have not answered this round (neither approved
--                          nor responded — ADR-0043 / ADR-0089)
--
-- FALLBACK (ADR-0108 Consequences: "where none exists the row falls back to its role recipients").
-- The role recipients are always included, so a relative that resolves to nobody leaves the rule's
-- roles standing — that IS the fallback. A rule with NO roles whose relatives all resolve to nobody
-- returns nobody; the sweep then sends nothing, logs nothing, and tries again on the next run.
--
-- No other kind of recipient exists: nothing here names a role key. Service role / the sweep only.

begin;

create or replace function app.escalation_recipients(
  p_kind        text,
  p_deliverable uuid,
  p_sub_task    uuid,
  p_campaign    uuid default null
) returns table (user_id uuid, reasons text[])
language plpgsql
stable
security definer
set search_path = public, app, extensions as $$
declare
  v_deliverable uuid := p_deliverable;
  v_campaign    uuid := p_campaign;
  v_tenant      uuid;
  v_rule        tenant_escalation_rules;
  v_owner       uuid;
  v_owner_dept  uuid;
  v_am          uuid;
  v_assignee_team uuid;
begin
  if v_deliverable is null and p_sub_task is not null then
    select t.deliverable_id into v_deliverable from sub_tasks t where t.id = p_sub_task;
  end if;

  if v_deliverable is not null then
    select d.tenant_id, d.owner_user_id, coalesce(own.department_id, d.department_id),
           app.deliverable_account_manager(d.id),
           coalesce(v_campaign, s.campaign_id, j.campaign_id)
      into v_tenant, v_owner, v_owner_dept, v_am, v_campaign
      from deliverables d
      left join user_profiles own on own.id = d.owner_user_id
      left join streams s on s.id = d.stream_id
      left join jobs j on j.id = d.job_id
     where d.id = v_deliverable;
  elsif v_campaign is not null then
    select c.tenant_id, app.campaign_account_manager(c.id)
      into v_tenant, v_am
      from campaigns c where c.id = v_campaign;
  end if;

  if v_tenant is null then
    return;
  end if;

  select * into v_rule from tenant_escalation_rules r where r.tenant_id = v_tenant and r.kind = p_kind;
  if v_rule.id is null then
    return;
  end if;

  if p_sub_task is not null then
    select au.team_id into v_assignee_team
      from sub_tasks t join user_profiles au on au.id = t.assignee_id
     where t.id = p_sub_task;
  end if;

  return query
  with found (user_id, reason) as (
    select up.id, 'role'
      from user_profiles up
     where up.tenant_id = v_tenant and up.role_id = any (v_rule.role_ids)
    union all
    select v_owner, 'owner' where 'owner' = any (v_rule.relative) and v_owner is not null
    union all
    select v_am, 'account_manager' where 'account_manager' = any (v_rule.relative) and v_am is not null
    union all
    select up.id, 'owner_department_lead'
      from user_profiles up join roles ro on ro.id = up.role_id
     where 'owner_department_lead' = any (v_rule.relative)
       and up.tenant_id = v_tenant and ro.scope = 'department'
       and v_owner_dept is not null and up.department_id = v_owner_dept
    union all
    select up.id, 'assignee_team_lead'
      from user_profiles up join roles ro on ro.id = up.role_id
     where 'assignee_team_lead' = any (v_rule.relative)
       and up.tenant_id = v_tenant and ro.scope = 'team'
       and v_assignee_team is not null and up.team_id = v_assignee_team
    union all
    select rv.user_id, 'reviewers'
      from sub_task_reviewers rv
     where 'reviewers' = any (v_rule.relative)
       and p_sub_task is not null and rv.sub_task_id = p_sub_task
       and rv.approved_at is null and rv.responded_at is null
  )
  select f.user_id, array_agg(distinct f.reason order by f.reason)
    from found f
    join user_profiles up on up.id = f.user_id
   where up.tenant_id = v_tenant and up.is_active
   group by f.user_id;
end $$;

revoke execute on function app.escalation_recipients(text, uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function app.escalation_recipients(text, uuid, uuid, uuid) to service_role;

comment on function app.escalation_recipients(text, uuid, uuid, uuid) is
  'ADR-0108 d.3 (I59.24): the people one escalation of p_kind goes to — the rule''s role holders plus '
  'the relatives it names (owner, account_manager, owner_department_lead, assignee_team_lead, '
  'reviewers), active only, once each with the reasons. The role holders are the fallback when a '
  'relative resolves to nobody. SECURITY DEFINER because the sweep runs without a caller; it '
  'returns only people of the subject''s own tenant.';

commit;
