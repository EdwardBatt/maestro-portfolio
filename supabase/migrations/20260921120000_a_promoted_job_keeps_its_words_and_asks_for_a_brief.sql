-- I53.20 — A promoted job keeps its words and asks its department for a proper brief
-- (Edward, 21 Sep, option C).
--
-- What the inspection walk found. A single job carries a six-field `single_execution` brief in
-- `campaign_briefs`, approved with the job (ADR-0084 d.4). After *Promote* that row stood as the
-- department's CAMPAIGN brief — locked, approved, no Generate — so every deliverable added to the
-- promoted campaign afterwards (a Social Video, a TVC, a Key Visual × 3) was assignable on the
-- strength of a brief that never described it; and the campaign's own brief tab read "Nothing has
-- been written here yet", because the job's words live under `campaigns.brief.request.words` and
-- the tab shows only the wizard's fields.
--
-- The decision, in two halves:
--
--   1. THE JOB'S WORDS BECOME THE CAMPAIGN'S BRIEF. The request's words go into `background`
--      and the job brief's task into `task` (each only where the field is empty), and the whole
--      job brief is kept under `promotedJobBrief` — a record, never shown as a field.
--   2. THE DEPARTMENT WRITES ITS OWN BRIEF, AS ON ANY CAMPAIGN (ADR-0072 d.6). The job's brief
--      row is RE-OPENED and EMPTIED — approval cleared, values cleared, the row (and its concepts,
--      its audit history) kept — so the department tab offers Generate, the assignment gate holds
--      NEW assignments until the department approves the campaign-scale brief, and My Work says
--      the brief is owed (20260921130000). Work already assigned stays assigned: the gate is read
--      at assignment (ADR-0090 d.6), never afterwards. Audited as `department_brief_reset_on_promotion`,
--      with what the row held.
--
-- Also here, because it is the same document: `update_campaign_brief` used to REPLACE the JSON,
-- and the page sends only the string fields — so one edit dropped `request` (the words as asked,
-- ADR-0083), `phases`, `deliverables` and `performance`. It now MERGES: the fields sent win, the
-- rest stays. (I53.20, found in the same walk.)
--
-- promote_single_job reproduced from 20260911130600, update_campaign_brief from 20260920140000
-- (each its latest definition).

begin;

create or replace function public.promote_single_job(p_campaign uuid)
returns void
language plpgsql
security invoker
set search_path = public, app, extensions as $$
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
    raise exception 'promoting this job is outside your scope' using errcode = '42501';
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

  -- 2. The department writes its own brief for the campaign: the job's row is re-opened and
  --    emptied, so the tab offers Generate and the gate holds new assignments (ADR-0072 d.6).
  --    Re-opening goes through the door that exists for it — reopen_department_brief, audited as
  --    department_brief_reopened — because an approved row is closed to every direct write
  --    (I51.3); every role that may promote also holds briefs:approve, so the door is open to
  --    them. The emptying is an ordinary write on the now-unapproved row, under its own policy.
  if v_job_brief.id is not null then
    perform public.reopen_department_brief(v_job_brief.id);
    update campaign_briefs
       set "values" = '{}'::jsonb
     where id = v_job_brief.id;
    if not found then
      raise exception 'the job''s brief could not be reset for the department' using errcode = '42501';
    end if;
    insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
    values (v.tenant_id, auth.uid(), 'department_brief_reset_on_promotion', 'campaign_briefs', v_job_brief.id,
            jsonb_build_object('campaign_id', p_campaign, 'department_id', v_job_brief.department_id,
                               'brief_type', v_job_brief.brief_type, 'values', v_job_brief.values,
                               'was_approved_at', v_job_brief.approved_at, 'was_approved_by', v_job_brief.approved_by));
  end if;
end $$;

comment on function public.promote_single_job(uuid) is
  'ADR-0086 d.10/d.11: a single job becomes a campaign. One way: refused (22023) if it is already '
  'a campaign. projects:manage in scope. The only route past app.tg_campaign_kind_fence. I53.20 '
  '(21 Sep): the request''s words and the job brief''s task become the campaign brief (background, '
  'task; the job brief kept under promotedJobBrief); the department''s row is re-opened and emptied '
  'so it writes the campaign-scale brief before any NEW assignment (ADR-0072 d.6).';

-- --------------------------------------------------------------------------------------------
-- The page sends the fields; the document keeps the rest.
-- --------------------------------------------------------------------------------------------
create or replace function public.update_campaign_brief(p_campaign uuid, p_brief jsonb)
returns void
language plpgsql security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_status text;
begin
  if p_brief is null or jsonb_typeof(p_brief) <> 'object' then
    raise exception 'a brief is a document' using errcode = '22023';
  end if;
  select c.status into v_status from campaigns c where c.id = p_campaign and c.tenant_id = v_tenant;
  if v_status is null then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;
  -- Said here as well as in the guard: a caller whose row write RLS filters out would otherwise
  -- read "not found" for what is a refusal (ADR-0092 — worded, and the same words as the guard's).
  if v_status <> 'draft' and not app.is_campaign_authority(p_campaign) then
    raise exception
      'editing this campaign''s brief is outside your reach — its account manager, Traffic, an Account Director or a Power Admin can'
      using errcode = '42501';
  end if;
  -- I53.20: MERGE. The fields sent replace their own keys; `request`, `phases`, `deliverables`,
  -- `performance`, `promotedJobBrief` — whatever the page did not send — stay.
  update campaigns set brief = coalesce(brief, '{}'::jsonb) || p_brief
   where id = p_campaign and tenant_id = v_tenant;
end $$;

comment on function public.update_campaign_brief(uuid, jsonb) is
  'I53.4: rewrite a released campaign''s master brief on its page. Adds no authority — '
  'app.is_campaign_authority (the same people as approve) — and refuses in words. I53.20: merges '
  'the fields sent into the document; what the page did not send is kept.';

commit;
