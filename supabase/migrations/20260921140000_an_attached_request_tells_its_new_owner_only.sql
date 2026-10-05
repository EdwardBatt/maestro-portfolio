-- I53.18 (Edward, 21 Sep) — attaching a request to an existing job tells its new owner only.
--
-- Action 15 (17 Sep) sent two things when a duplicate request was ATTACHED to the job it
-- duplicates: the new deliverable's owner got the full message, and every OTHER owner on the job
-- got one line — "<new deliverable> was added to <job>; <owner> owns it." Edward's rule of 21 Sep,
-- *"existing owners should only be notified of changes to their existing deliverables"*, applied
-- the same day to Add deliverable and Propose more (20260921100000), now applies here too: the
-- one-liner goes. The new owner's message is unchanged.
--
-- attach_job_to_campaign reproduced from 20260917110000 (its latest definition); the second insert
-- of step 8 removed, nothing else touched.

begin;

create or replace function public.attach_job_to_campaign(p_draft_campaign uuid, p_target_campaign uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 set search_path = public, app, extensions
AS $$
declare
  v_tenant        uuid := app.current_tenant_id();
  v_draft         campaigns;
  v_target        campaigns;
  v_target_stream uuid;
  v_moved         uuid[];
  v_first_moved   uuid;
  v_first_name    text;
  v_brief         campaign_briefs;
  v_target_brief  campaign_briefs;
  v_merged        jsonb;
  v_kv            record;
  v_folder        record;
  v_target_folder uuid;
begin
  if p_draft_campaign is null or p_target_campaign is null then
    raise exception 'both campaigns are required' using errcode = '22023';
  end if;
  if p_draft_campaign = p_target_campaign then
    raise exception 'a job cannot be attached to itself' using errcode = '22023';
  end if;

  select * into v_draft from campaigns
   where id = p_draft_campaign and tenant_id = v_tenant;
  if not found then
    raise exception 'campaign % not found', p_draft_campaign using errcode = 'P0002';
  end if;
  select * into v_target from campaigns
   where id = p_target_campaign and tenant_id = v_tenant;
  if not found then
    raise exception 'campaign % not found', p_target_campaign using errcode = 'P0002';
  end if;

  -- d.2: never across clients. The check that offered this only looks at one client's jobs; the
  -- move refuses anything else regardless of what the caller sends.
  if v_draft.client_id <> v_target.client_id then
    raise exception 'a job can only be attached to a job for the same client' using errcode = '22023';
  end if;
  -- The thing being discarded is the single-job DRAFT from SJ-02 — not a released job, which has
  -- its own clock and its own history, and not a campaign.
  if v_draft.kind <> 'single_job' then
    raise exception 'only a single job can be attached to another job' using errcode = '22023';
  end if;
  if v_draft.status = 'approved' then
    raise exception 'this job has already been released; it cannot be attached to another' using errcode = '22023';
  end if;

  -- ADR-0073: the grant, and scope over BOTH campaigns' responsible account managers.
  if not app.has_permission('projects', 'manage')
     or not app.in_write_scope(null, null, app.campaign_account_manager(p_draft_campaign))
     or not app.in_write_scope(null, null, app.campaign_account_manager(p_target_campaign)) then
    raise exception 'attaching this job is outside your scope' using errcode = '42501';
  end if;

  -- From here on the move is a SYSTEM OPERATION: authority was decided above, once. The transition
  -- guard on deliverables would otherwise refuse the stream change to anyone without
  -- project_tasks:manage. Switched off again before returning.
  perform set_config('app.system_op', 'on', true);

  -- 1. THE STREAM. Onto the target's existing stream — a campaign has ONE, named for it (ADR-0050),
  --    and re-parenting the draft's stream would give the target a second one named for a job that
  --    no longer exists. Created only if the target somehow has none.
  select s.id into v_target_stream from streams s
   where s.campaign_id = p_target_campaign
   order by s.created_at, s.id limit 1;
  if v_target_stream is null then
    insert into streams (tenant_id, campaign_id, name)
    values (v_tenant, p_target_campaign, v_target.name)
    returning id into v_target_stream;
  end if;

  -- 2. THE DELIVERABLES. Due date, department, owner and tasks all travel with the row.
  with moved as (
    update deliverables d
       set stream_id = v_target_stream
     where d.stream_id in (select s.id from streams s where s.campaign_id = p_draft_campaign)
    returning d.id, d.name, d.created_at
  )
  select array_agg(id order by created_at, id), (array_agg(id order by created_at, id))[1],
         (array_agg(name order by created_at, id))[1]
    into v_moved, v_first_moved, v_first_name
    from moved;

  -- 3. THE BRIEF. Moved where the department is new to the target; folded in where it is not.
  for v_brief in
    select * from campaign_briefs b where b.campaign_id = p_draft_campaign
  loop
    select * into v_target_brief from campaign_briefs t
     where t.campaign_id = p_target_campaign and t.department_id = v_brief.department_id;

    if not found then
      update campaign_briefs set campaign_id = p_target_campaign where id = v_brief.id;
    else
      v_merged := v_target_brief.values;
      for v_kv in select key, value from jsonb_each_text(v_brief.values) loop
        if coalesce(v_kv.value, '') = '' then
          continue;
        end if;
        if coalesce(v_merged ->> v_kv.key, '') = '' then
          v_merged := v_merged || jsonb_build_object(v_kv.key, v_kv.value);
        else
          v_merged := v_merged || jsonb_build_object(
            v_kv.key,
            (v_merged ->> v_kv.key) || E'\n\n— ' || v_draft.name || E' —\n' || v_kv.value);
        end if;
      end loop;
      update campaign_briefs set values = v_merged where id = v_target_brief.id;
      delete from campaign_briefs where id = v_brief.id;
    end if;
  end loop;

  -- 4. THE RECEIPT. Onto the target's trail; the stamp trigger keeps who confirmed it (see above).
  --    The clock is untouched (d.6): readers take the earliest confirmed receipt.
  update campaign_brief_receipts
     set campaign_id = p_target_campaign
   where campaign_id = p_draft_campaign;

  -- 5. THE FILES. Folder by folder: the draft's campaign root and its four system folders each
  --    have a counterpart on the target (same kind, same name). Assets and custom sub-folders move
  --    across; the draft's system folders go with the campaign row.
  for v_folder in
    select f.id, f.kind, f.name from asset_folders f
     where f.campaign_id = p_draft_campaign and f.kind in ('campaign', 'asset_type')
  loop
    select t.id into v_target_folder from asset_folders t
     where t.campaign_id = p_target_campaign and t.kind = v_folder.kind
       and (v_folder.kind = 'campaign' or t.name = v_folder.name)
     limit 1;
    if v_target_folder is null then
      -- The target's tree is provisioned on insert; a missing folder means it was deleted by hand.
      -- Re-provisioning is idempotent and puts it back.
      perform app.provision_campaign_folders(p_target_campaign);
      select t.id into v_target_folder from asset_folders t
       where t.campaign_id = p_target_campaign and t.kind = v_folder.kind
         and (v_folder.kind = 'campaign' or t.name = v_folder.name)
       limit 1;
    end if;
    if v_target_folder is null then
      raise exception 'the target job has no folder to receive "%"', v_folder.name using errcode = 'P0002';
    end if;

    update assets set folder_id = v_target_folder where folder_id = v_folder.id;

    -- Custom sub-folders (never the draft's own system folders, which have their own iteration).
    update asset_folders c
       set parent_id   = v_target_folder,
           campaign_id = p_target_campaign,
           name        = case
                           when exists (select 1 from asset_folders x
                                         where x.parent_id = v_target_folder and x.name = c.name)
                           then c.name || ' (' || v_draft.name || ')'
                           else c.name
                         end
     where c.parent_id = v_folder.id
       and not (c.campaign_id = p_draft_campaign and c.kind = 'asset_type');
  end loop;
  -- Deeper descendants that carried the draft's id.
  update asset_folders set campaign_id = p_target_campaign
   where campaign_id = p_draft_campaign and kind not in ('campaign', 'asset_type');

  -- Library references to the draft, and to its stream. A reference the target already holds is
  -- dropped rather than duplicated (uq_asset_references).
  delete from asset_references ar
   where ar.ref_type = 'campaign' and ar.ref_id = p_draft_campaign
     and exists (select 1 from asset_references x
                  where x.asset_id = ar.asset_id and x.ref_type = 'campaign' and x.ref_id = p_target_campaign);
  update asset_references set ref_id = p_target_campaign
   where ref_type = 'campaign' and ref_id = p_draft_campaign;
  delete from asset_references ar
   where ar.ref_type = 'stream'
     and ar.ref_id in (select s.id from streams s where s.campaign_id = p_draft_campaign)
     and exists (select 1 from asset_references x
                  where x.asset_id = ar.asset_id and x.ref_type = 'stream' and x.ref_id = v_target_stream);
  update asset_references set ref_id = v_target_stream
   where ref_type = 'stream'
     and ref_id in (select s.id from streams s where s.campaign_id = p_draft_campaign);

  -- 6. Anything else that names the draft campaign by plain FK (no cascade). A draft has none in
  --    practice; re-pointing costs nothing and a stray row would otherwise refuse the delete.
  update bookings set campaign_id = p_target_campaign where campaign_id = p_draft_campaign;
  update jobs     set campaign_id = p_target_campaign where campaign_id = p_draft_campaign;

  -- 7. THE DRAFT GOES. Its streams are empty now; its folders, receipts and briefs have moved, and
  --    what remains under it cascades.
  delete from streams   where campaign_id = p_draft_campaign;
  delete from campaigns where id = p_draft_campaign and tenant_id = v_tenant;

  -- 8. WHO IS TOLD — I52 Action 15 (Edward, 17 Sep): the NEW deliverable's owner — it is theirs to
  -- brief and task, exactly as an approval is. Never the account manager who attached it.
  -- I53.18 (Edward, 21 Sep): the one-line notice the OTHER owners on the job used to get is GONE —
  -- "existing owners should only be notified of changes to their existing deliverables".
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  select v_tenant, d.owner_user_id, 'deliverable_added', d.name, 'deliverable', d.id, auth.uid(),
         jsonb_build_object('for_owner', true, 'due_at', d.due_at)
    from deliverables d
   where d.id = any (coalesce(v_moved, array[]::uuid[]))
     and d.owner_user_id is not null
     and d.owner_user_id is distinct from auth.uid();

  perform set_config('app.system_op', 'off', true);
  return p_target_campaign;
end $$;

comment on function public.attach_job_to_campaign(uuid, uuid) is
  'ADR-0086 d.5–d.7 (SJ-A1, "add as a deliverable on that job"): re-parents the draft single '
  'job''s deliverables (onto the target''s existing stream), brief (moved, or folded into the '
  'target''s brief for the same department), receipts (the clock stays on the earliest) and files '
  '(into the target''s matching folders), deletes the draft. Action 15 / I53.18 (21 Sep): tells the '
  'NEW deliverable''s owner, and nobody else; returns the target id. Same client, same tenant, '
  'projects:manage in scope over both. SECURITY DEFINER: authority is decided once here and the '
  'move runs as a system operation.';

commit;
