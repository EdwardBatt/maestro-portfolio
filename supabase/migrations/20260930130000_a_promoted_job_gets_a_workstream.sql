-- I68.16 (Edward, 30 Sep, A): a promoted single job gets a workstream.
--
-- ADR-0116 d.3: every piece of a CAMPAIGN is in a workstream, and "Propose more" / "+ Add a deliverable" put new
-- pieces into one. A single job's piece is in none, and promotion (ADR-0086, ADR-0104) turned the job into a
-- campaign without giving it one — so a promoted job could not take a proposal (the job-to-campaign walk's
-- chapter E stopped there in both languages). Edward chose A: promotion creates the workstream itself.
--
-- 1) `app.group_promoted_job(campaign, tenant)` — for each department the campaign's ungrouped live pieces are in
--    (a piece's department follows its owner, ADR-0102, so a job usually has one), a workstream:
--      * name  = the department's name (a name already on the campaign in that department is reused instead);
--      * department_id = that department;
--      * owner = the owner of the department's first piece, when that person holds a lead role — the workstream
--        owner rule (ADR-0101 d.8, `tg_workstream_owner_is_a_lead`) refuses anyone else, and then it is left empty;
--      * letters = the existing rule (`tg_workstream_code_letters`, I59.53) — not passed, not re-derived.
--    Then every ungrouped live piece of that department goes into it. A piece's CODE is kept: it is re-issued only
--    when its stream changes (`tg_deliverable_stamp_code`), and promotion keeps the stream. Archived pieces and a
--    piece with no department are left as they are. Returns how many workstreams it made.
-- 2) `public.promote_single_job` — reproduced WHOLE from 20260925110000 (grep confirms it is the last definition);
--    the only change is step 3, which calls (1) after the kind flips.
-- 3) Backfill, once: every campaign that was promoted (its brief still carries the job's `request` record) with an
--    ungrouped live piece gets the same, and the count is said. Both writes are audited by the rows' own
--    `audit_row_change` triggers.

begin;

-- ---------------------------------------------------------------- 1) the grouping --------------------------------
create or replace function app.group_promoted_job(p_campaign uuid, p_tenant uuid)
returns integer
language plpgsql
set search_path = public, app, extensions as $$
declare
  v_dept   record;
  v_ws     uuid;
  v_owner  uuid;
  v_made   integer := 0;
begin
  for v_dept in
    select d.department_id, dep.name as department_name
      from deliverables d
      join streams s on s.id = d.stream_id
      join departments dep on dep.id = d.department_id
     where s.campaign_id = p_campaign
       and d.tenant_id = p_tenant
       and d.workstream_id is null
       and d.state <> 'archived'
       and d.department_id is not null
     group by d.department_id, dep.name
     order by dep.name
  loop
    -- A workstream already on the campaign for this department (a backfill of a campaign someone half-grouped by
    -- hand) is used rather than a second one made beside it.
    select w.id into v_ws
      from workstreams w
     where w.campaign_id = p_campaign and w.department_id = v_dept.department_id
     order by w.created_at
     limit 1;

    if v_ws is null then
      -- The owner of the department's first piece, when the workstream owner rule would take them.
      select d.owner_user_id into v_owner
        from deliverables d
        join streams s on s.id = d.stream_id
        join user_profiles p on p.id = d.owner_user_id
        join roles r on r.id = p.role_id
       where s.campaign_id = p_campaign
         and d.department_id = v_dept.department_id
         and d.workstream_id is null
         and d.state <> 'archived'
         and r.key in ('department_lead', 'team_lead', 'deputy_team_lead')
       order by d.created_at
       limit 1;

      insert into workstreams (tenant_id, campaign_id, name, department_id, owner_user_id)
      values (
        p_tenant, p_campaign,
        -- The department's name, unless the campaign already has a group called that in another department.
        case when exists (select 1 from workstreams w
                           where w.campaign_id = p_campaign
                             and lower(trim(w.name)) = lower(trim(v_dept.department_name)))
             then v_dept.department_name || ' work'
             else v_dept.department_name end,
        v_dept.department_id, v_owner)
      returning id into v_ws;
      v_made := v_made + 1;
    end if;

    update deliverables d
       set workstream_id = v_ws
      from streams s
     where s.id = d.stream_id
       and s.campaign_id = p_campaign
       and d.department_id = v_dept.department_id
       and d.workstream_id is null
       and d.state <> 'archived';
  end loop;
  return v_made;
end $$;
comment on function app.group_promoted_job(uuid, uuid) is
  'I68.16 (Edward, 30 Sep, A): puts a promoted job''s ungrouped live pieces into one workstream per department — '
  'named after the department, owned by the first piece''s owner when a lead, letters by the existing rule, codes '
  'kept. Reuses a workstream already on the campaign for that department. Returns how many it made.';
revoke all on function app.group_promoted_job(uuid, uuid) from public, anon;
grant execute on function app.group_promoted_job(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- 2) promotion ------------------------------------
CREATE OR REPLACE FUNCTION public.promote_single_job(p_campaign uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  v campaigns;
  v_prior text;
  v_job_brief campaign_briefs;
  v_words text;
  v_task text;
  v_next jsonb;
begin
  select * into v from campaigns
   where id = p_campaign and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'campaign % not found', p_campaign using errcode = 'P0002';
  end if;

  -- d.11: one way, and a second press is an error rather than a silent success — the modal has just
  -- said "this cannot be undone", and a no-op would make that sentence false in the other direction.
  if v.kind <> 'single_job' then
    raise exception 'this is already a campaign' using errcode = '22023';
  end if;

  -- ADR-0073: hold the grant AND be in scope over the campaign's responsible manager. The assigned
  -- AM passes by their account scope, the Account Director by ADR-0074's reach, Power Admin and
  -- Traffic Manager by being tenant-scoped. No role is named.
  if not app.has_permission('projects', 'manage')
     or not app.in_write_scope(null, null, app.campaign_account_manager(p_campaign)) then
    raise exception 'You cannot promote this job to a campaign: it is outside your reach.%',
            app.refusal_ask(app.refusal_names_campaign_am(p_campaign))
      using errcode = '42501',
            detail = coalesce(app.refusal_names_campaign_am(p_campaign), ''),
            hint = 'promote_job';
  end if;

  -- The job's one brief (ADR-0083 d.3: a single job is a campaign row with one department brief).
  select * into v_job_brief from campaign_briefs
   where campaign_id = p_campaign and tenant_id = app.current_tenant_id()
   order by created_at limit 1;
  v_words := nullif(trim(coalesce(v.brief -> 'request' ->> 'words', '')), '');
  v_task  := nullif(trim(coalesce(v_job_brief.values ->> 'task', '')), '');

  -- 1. The words become the campaign's brief. `kind` was the request record's marker and is not a
  --    field; the record itself (`request`) stays where it was.
  v_next := coalesce(v.brief, '{}'::jsonb) - 'kind';
  if v_words is not null and nullif(trim(coalesce(v_next ->> 'background', '')), '') is null then
    v_next := v_next || jsonb_build_object('background', v_words);
  end if;
  if v_task is not null and nullif(trim(coalesce(v_next ->> 'task', '')), '') is null then
    v_next := v_next || jsonb_build_object('task', v_task);
  end if;
  if v_job_brief.id is not null then
    v_next := v_next || jsonb_build_object('promotedJobBrief', jsonb_build_object(
      'briefType', v_job_brief.brief_type, 'values', v_job_brief.values,
      'approvedAt', v_job_brief.approved_at, 'approvedBy', v_job_brief.approved_by));
  end if;

  v_prior := coalesce(current_setting('app.campaign_kind_change', true), '');
  perform set_config('app.campaign_kind_change', 'on', true);
  update campaigns set kind = 'campaign', brief = v_next
   where id = p_campaign and tenant_id = app.current_tenant_id();
  perform set_config('app.campaign_kind_change', v_prior, true);

  -- 2. (ADR-0104 d.1) The job's department brief is left exactly as it was — approved and
  --    read-only, like every legacy department brief (ADR-0100). Its values travel above as
  --    `promotedJobBrief`; the campaign's own brief is generated or written on the Brief view (d.2).

  -- 3. (I68.16) A campaign's pieces are in workstreams (ADR-0116 d.3): the job's piece goes into one,
  --    named after its department, so "Propose more" and "+ Add a deliverable" work at once.
  perform app.group_promoted_job(p_campaign, v.tenant_id);
end $function$;

-- ---------------------------------------------------------------- 3) backfill -------------------------------------
do $$
declare
  v_c     record;
  v_made  integer := 0;
  v_camps integer := 0;
begin
  for v_c in
    select distinct c.id, c.tenant_id
      from campaigns c
      join streams s on s.campaign_id = c.id
      join deliverables d on d.stream_id = s.id
     where c.kind = 'campaign'
       and c.brief ? 'request'            -- promoted: the job's request record stays on the brief (ADR-0104)
       and d.workstream_id is null
       and d.state <> 'archived'
       and d.department_id is not null
  loop
    v_made  := v_made + app.group_promoted_job(v_c.id, v_c.tenant_id);
    v_camps := v_camps + 1;
  end loop;
  raise notice 'I68.16: % promoted campaign(s) grouped, % workstream(s) made', v_camps, v_made;
end $$;

commit;
