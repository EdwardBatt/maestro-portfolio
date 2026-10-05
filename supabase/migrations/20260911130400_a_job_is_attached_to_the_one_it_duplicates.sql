-- I44 (ADR-0086 d.5–d.7) — "add as a deliverable on that job": the draft's work moves onto the
-- existing job and the draft is discarded, in one transaction.
--
-- WHAT MOVES. The draft's deliverable(s), its brief, its receipt, and everything filed in its
-- folders — re-parented onto the target campaign. Then the draft campaign row is deleted. The
-- deliverable keeps its own due date, department and owner: a job may hold work for two
-- departments, which is what a campaign is for (d.5).
--
-- THREE THINGS THE SCHEMA REFUSED AS THE ADR WAS WRITTEN, and what was done about each:
--
-- 1. ONE RECEIPT PER CAMPAIGN. `campaign_brief_receipts.campaign_id` was UNIQUE (ADR-0066 d.1:
--    "one moment a brief arrived"). ADR-0086 d.5/d.6 need TWO on the target — "both proofs sit on
--    one evidence trail in arrival order", the clock reading the earliest. The later ADR wins:
--    the unique constraint goes, replaced by a plain index ordered by arrival. The clock is
--    unchanged by construction — every reader of it takes the earliest confirmed receipt — and
--    pgTAP 101 proves the order and the origin. The frontend's upsert on `campaign_id`
--    (`brief-receipt-api.ts`) can no longer rely on a unique target and is changed in the same
--    change set to update by id.
--
-- 2. ONE BRIEF PER DEPARTMENT PER CAMPAIGN. `uq_campaign_briefs_campaign_department` is
--    load-bearing (the department-brief generator upserts on it), so it stays — and the COMMON
--    attach is two single jobs for the SAME department, where the draft's brief cannot simply be
--    re-parented. Refusing would be a dead end on the modal that just offered the choice; dropping
--    the draft's brief would lose what the account manager wrote. So the draft's values are FOLDED
--    INTO the target's brief: each field the draft filled is appended to the target's same field
--    under a heading naming the attached job, so nothing is lost and the department tab shows one
--    brief, as it always has. The target brief's approval stamp is left as it is — resetting it
--    would make the target's EXISTING work unassignable (the ADR-0070 gate) because somebody
--    attached a second job to it. Where the department is new to the target, the brief row moves.
--
-- 3. A MOVE IS NOT AN EDIT. `tg_brief_receipt_stamp` re-stamps `confirmed_by`/`confirmed_at` on
--    every update of a confirmed row — "editing a confirmed receipt is a fresh act of standing
--    behind it". Re-parenting is not an edit: the person attaching did not read the screenshot.
--    The trigger is reproduced from `20260903100200` (its only definition) with one addition:
--    when no evidence column changed and the confirmation itself was not re-sent, the existing
--    stamp stands. Every write the wizard makes still re-stamps exactly as before.
--
-- THE FOLDERS. A campaign's tree is `client → Projects → <campaign> → Working Files | Deliverables
-- | Final Assets | References`, provisioned on insert. Files and any custom sub-folders under each
-- of the draft's folders are moved into the target's folder of the same name (a colliding
-- sub-folder name gets the attached job's name appended); the draft's own system folders are then
-- empty and go with the campaign row (`on delete cascade`). Library references to the draft
-- campaign and its stream are re-pointed.
--
-- WHO IS TOLD (d.7). The target's EXISTING deliverable owners receive ONE `deliverable_added`
-- each — a new type, because no existing one says this honestly (`assigned` claims an assignment
-- that did not happen; `deliverable_reassigned` claims an owner change). The attached
-- deliverable's own owner receives `campaign_approved` — the release notice ADR-0085 d.4 promises
-- — if the target is already approved; if it is still pending, `approve_campaign` will tell them
-- when it is. Nothing else fires. The actor is never told about their own act.
--
-- SECURITY DEFINER, authorised by ADR-0086 d.5 ("a real re-parenting… the RLS on each has to admit
-- the move"): deliverables are fenced by `project_tasks:manage`, assets and folders by
-- `assets:manage`, neither of which an account manager necessarily holds, and the transition
-- guard on deliverables refuses a stream change from anyone without the first. The function
-- decides authority ONCE, in its body — `projects:manage`, in scope over BOTH campaigns'
-- responsible account managers (ADR-0073), same client, same tenant — and then performs the move
-- as a system operation. The escape is switched off before it returns.

begin;

-- ---------------------------------------------------------------- 1. receipts: a trail ----
alter table campaign_brief_receipts
  drop constraint if exists campaign_brief_receipts_campaign_id_key;

create index if not exists idx_campaign_brief_receipts_campaign
  on campaign_brief_receipts (campaign_id, received_at);

comment on table campaign_brief_receipts is
  'ADR-0066: evidence that a brief was issued, and when. ADR-0086 d.5/d.6: a campaign may carry '
  'SEVERAL — a job attached to it brings its own — and the clock reads the EARLIEST confirmed one. '
  'received_at is the timestamp INSIDE the screenshot and is the clock''s origin; captured_at is '
  'when the screenshot reached us and is never the clock''s origin. The clock runs only on a '
  'CONFIRMED row.';

-- ---------------------------------------------------------------- 3. a move is not an edit ----
-- Reproduced whole from `20260903100200`. The one addition is the `elsif` branch.
create or replace function app.tg_brief_receipt_stamp()
returns trigger language plpgsql security invoker
set search_path = public, app, extensions as $$
begin
  if tg_op = 'INSERT' then
    new.captured_at := now();
  else
    new.captured_at := old.captured_at;
  end if;

  if new.confirmed_at is null then
    new.confirmed_by := null;
  elsif tg_op = 'UPDATE'
        and old.confirmed_at is not null
        and new.confirmed_at is not distinct from old.confirmed_at
        and new.subject      is not distinct from old.subject
        and new.received_at  is not distinct from old.received_at
        and new.received_tz  is not distinct from old.received_tz
        and new.asset_id     is not distinct from old.asset_id
        and new.source       is not distinct from old.source then
    -- ADR-0086 d.5: re-parenting a confirmed receipt onto another campaign changes nothing a
    -- person stood behind, so whoever stood behind it still does.
    new.confirmed_by := old.confirmed_by;
    new.confirmed_at := old.confirmed_at;
  else
    new.confirmed_by := auth.uid();
    new.confirmed_at := now();
  end if;

  return new;
end $$;

comment on function app.tg_brief_receipt_stamp() is
  'ADR-0066: captured_at is when the server saw the screenshot and cannot be back-dated by a '
  'caller; who confirmed comes from auth.uid(). received_at is NOT touched — it is read off the '
  'image and is the one timestamp a person is allowed to state. ADR-0086 d.5: a write that changes '
  'no evidence column and does not re-send the confirmation (a move between campaigns) keeps the '
  'existing stamp — a move is not an edit.';

-- ---------------------------------------------------------------- the notification type ----
-- Check with: grep -rln "notifications_type_check" supabase/migrations/*.sql | tail -1
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'assigned', 'review_requested', 'changes_requested', 'signed_off', 'blocked', 'due_soon',
    'dependency_ready', 'cancelled', 'resource_clash', 'resource_required',
    'campaign_approved', 'deliverable_reassigned', 'rescheduled', 'chat_added',
    'task_reinstated', 'brief_awaiting_approval', 'feedback_collected',
    'assignment_requested', 'assignment_approved', 'assignment_refused',
    'assignment_superseded', 'extension_requested', 'extension_approved', 'extension_refused',
    'deliverable_added'
  ));

comment on constraint notifications_type_check on notifications is
  'ADR-0028 + I31.7 + ADR-0068 d.6 + ADR-0070 d.6 + ADR-0086 d.7. Every value here needs COPY in '
  'notify-email or it is silently in-app only, AND copy under `notifications.type.*` in EN and AR '
  'or the inbox renders the raw key. src/test/notification-copy.test.ts fails on either gap.';

-- ---------------------------------------------------------------- the move ----
create or replace function public.attach_job_to_campaign(
  p_draft_campaign  uuid,
  p_target_campaign uuid
) returns uuid
language plpgsql
security definer
set search_path = public, app, extensions as $$
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

  -- 8. WHO IS TOLD (d.7). The target's EXISTING owners: one each, that a deliverable was added.
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  select distinct v_tenant, d.owner_user_id, 'deliverable_added', v_first_name, 'deliverable', v_first_moved, auth.uid()
    from deliverables d
    join streams s on s.id = d.stream_id
   where s.campaign_id = p_target_campaign
     and d.owner_user_id is not null
     and not (d.id = any (coalesce(v_moved, array[]::uuid[])))
     and d.owner_user_id is distinct from auth.uid()
     and v_first_moved is not null;

  -- The attached deliverable's own owner: the release notice, if the target is already released.
  -- Otherwise approve_campaign sends it when the target is approved. An owner who was just told a
  -- deliverable was added (the common case — same department, same lead) is not told twice.
  if v_target.status = 'approved' then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    select distinct v_tenant, d.owner_user_id, 'campaign_approved', v_target.name, 'campaign', p_target_campaign, auth.uid()
      from deliverables d
     where d.id = any (coalesce(v_moved, array[]::uuid[]))
       and d.owner_user_id is not null
       and d.owner_user_id is distinct from auth.uid()
       and not exists (
         select 1 from notifications n
          where n.type = 'deliverable_added'
            and n.entity_id = v_first_moved
            and n.user_id = d.owner_user_id
       );
  end if;

  perform set_config('app.system_op', 'off', true);
  return p_target_campaign;
end $$;

comment on function public.attach_job_to_campaign(uuid, uuid) is
  'ADR-0086 d.5–d.7 (SJ-A1, "add as a deliverable on that job"): re-parents the draft single '
  'job''s deliverables (onto the target''s existing stream), brief (moved, or folded into the '
  'target''s brief for the same department), receipts (the clock stays on the earliest) and files '
  '(into the target''s matching folders), deletes the draft, tells the target''s existing owners '
  'once, and returns the target id. Same client, same tenant, projects:manage in scope over both. '
  'SECURITY DEFINER: authority is decided once here and the move runs as a system operation.';

revoke execute on function public.attach_job_to_campaign(uuid, uuid) from public;
revoke execute on function public.attach_job_to_campaign(uuid, uuid) from anon;
grant  execute on function public.attach_job_to_campaign(uuid, uuid) to authenticated;

commit;
