-- ADR-0104 (Edward, 25 Sep) — a promoted job asks for its campaign brief; a single job's brief is
-- edited by hand.
--
--   d.1  promote_single_job no longer re-opens and empties the job's department brief. Reproduced
--        WHOLE from 20260923110000 (grep confirmed it is the last definition); the only change is
--        that step 2 is gone.
--   d.3  update_single_job_brief: a released single job's brief, edited by the campaign's approval
--        authority (the same test as update_campaign_brief, I53.4). Words only — never the
--        deliverable, its tasks or its dates. Audited by the row's own audit trigger.

begin;

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
end $function$;

-- ---- d.3: a single job's brief, by hand ------------------------------------
create or replace function public.update_single_job_brief(p_campaign uuid, p_values jsonb)
returns void
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v campaigns;
  v_brief uuid;
begin
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    raise exception 'a brief is a set of fields' using errcode = '22023';
  end if;
  select * into v from campaigns where id = p_campaign and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'campaign % not found', p_campaign using errcode = 'P0002';
  end if;
  if v.kind <> 'single_job' then
    raise exception 'a campaign''s brief is edited on its Brief view' using errcode = '22023';
  end if;
  if not app.is_campaign_authority(p_campaign) then
    raise exception
      'editing this job''s brief is outside your reach — its account manager, Traffic, an Account Director or a Power Admin can'
      using errcode = '42501';
  end if;
  select id into v_brief from campaign_briefs
   where campaign_id = p_campaign and tenant_id = v.tenant_id
   order by created_at limit 1;
  if v_brief is null then
    raise exception 'this job has no brief to edit' using errcode = 'P0002';
  end if;
  update campaign_briefs set "values" = coalesce("values", '{}'::jsonb) || p_values
   where id = v_brief;
end $$;

comment on function public.update_single_job_brief(uuid, jsonb) is
  'ADR-0104 d.3: a released single job''s brief, edited by hand by the campaign''s approval authority. '
  'Merges the fields given; the approval stamp stays (the words changed, not the decision).';

revoke execute on function public.update_single_job_brief(uuid, jsonb) from public, anon;
grant  execute on function public.update_single_job_brief(uuid, jsonb) to authenticated;

commit;
