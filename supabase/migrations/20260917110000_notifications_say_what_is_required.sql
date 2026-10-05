-- I52 (17 Sep, Edward) — every notification says who it is for and what is required of them.
--
-- Read against `docs/reference/notification-emails-as-sent.md`, Edward decided the fifteen actions
-- one at a time (`docs/reference/notification-email-copy.md`, "Decided one action at a time"):
-- *"None of the messages are clear on what is actually required. And some are wildly inaccurate."*
-- The words live in `notify-email` and the inbox strings; THIS migration is the part the rows have to
-- carry for those words to be true:
--
--   A. `notifications.detail` — a small bag of facts the emitter knows at the moment and the mail
--      cannot re-derive later (the days a booking was moved FROM, which prerequisite was approved).
--   B. Action 1: approval tells the DELIVERABLE OWNERS only, one row per deliverable, pointing at the
--      deliverable. Not department leads by role, not reviewers. The "your brief is waiting" notice
--      (ADR-0070 d.6) fired only when a brief already existed at approval, which never happens —
--      briefs are generated after approval — so it goes, and its type with it.
--   C. Action 2: the NEW owner is told what is now theirs (`deliverable_reassigned`); the OLD owner
--      gets its own type (`deliverable_owner_removed`) naming who has it now.
--   D. Action 3: the person a task is taken FROM is told (`task_reassigned_away`, new) — today only
--      the new assignee hears anything.
--   E. Actions 4 and 11: it is the TASK being reviewed, so the row names the task, not the deliverable
--      (submit, a late appointment, and "everyone has answered");
--      a REQUIRED reviewer gets `review_requested`, an OPTIONAL one `feedback_requested` (new) — they are
--      asked different things (ADR-0089).
--   F. Action 6b: "you can start" names the task that was approved (detail), and a waiting task with
--      no assignee tells the deliverable's owner instead of nobody.
--   G. Action 8: a moved booking records the days it moved FROM and TO.
--   H. Action 13: a required person's booking records its days and who is doing the task.
--   I. Action 15: an attached request tells the NEW deliverable's owner first; other owners on the
--      job get one line. The release notice it used to send instead is redundant and goes.
--   J. `blocked` is removed: nothing has ever raised it (ADR-0069 named the input; ADR-0030 dropped
--      the status).
--
-- Every function is reproduced WHOLE from the live definition (pg_get_functiondef, 17 Sep), search_path
-- pinned (ADR-0033). The constraint is drop-and-recreate, from the live one.

begin;

-- ============================================================================
-- A) the facts bag
-- ============================================================================
alter table notifications add column if not exists detail jsonb not null default '{}'::jsonb;
comment on column notifications.detail is
  'I52: facts the emitter knew at the moment and the mail cannot re-derive later — the days a booking '
  'was moved from/to, which prerequisite was just approved, who a task or deliverable went to. Read by '
  'notify-email and the inbox; never authoritative for anything but the words.';

-- ============================================================================
-- J) the type list: minus blocked and brief_awaiting_approval, plus three
-- ============================================================================
-- Check with: grep -rln "notifications_type_check" supabase/migrations/*.sql | tail -1
alter table notifications drop constraint if exists notifications_type_check;

-- Rows of the two retired types exist on PRODUCTION (the first push failed on the constraint below,
-- 17 Sep) though never on an empty database — the I48.31 trap. They are inbox history for types the
-- app no longer has words for, so they would render as a raw key; they go. Nothing else refers to a
-- notification row.
delete from notifications where type in ('blocked', 'brief_awaiting_approval');

alter table notifications add constraint notifications_type_check
  check (type in (
    'assigned', 'review_requested', 'changes_requested', 'signed_off', 'due_soon',
    'dependency_ready', 'cancelled', 'resource_clash', 'resource_required',
    'campaign_approved', 'deliverable_reassigned', 'rescheduled', 'chat_added',
    'task_reinstated', 'feedback_collected',
    'assignment_requested', 'assignment_approved', 'assignment_refused', 'assignment_superseded',
    'extension_requested', 'extension_approved', 'extension_refused',
    'deliverable_added',
    'deliverable_owner_removed', 'task_reassigned_away', 'feedback_requested'
  ));
comment on constraint notifications_type_check on notifications is
  'I52 (17 Sep). Every value here needs COPY in notify-email AND `notifications.type.*` in EN and AR, '
  'or it is silently in-app only / renders its raw key; src/test/notification-copy.test.ts holds the '
  'three together. blocked and brief_awaiting_approval removed 17 Sep: nothing raised the first, and '
  'the second could only fire for a brief that existed before approval, which none does.';

-- ============================================================================
-- B) Action 1 — approval tells the deliverable owners, one row per deliverable
-- ============================================================================
CREATE OR REPLACE FUNCTION app.approve_campaign(p_campaign uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 set search_path = public, app, extensions
AS $$
declare v campaigns; v_am uuid; v_am_name text;
begin
  select * into v from campaigns
   where id = p_campaign and tenant_id = app.current_tenant_id();
  if v.id is null then
    raise exception 'campaign % not found', p_campaign using errcode = 'P0002';
  end if;
  if v.status = 'approved' then
    raise exception 'this campaign is already approved' using errcode = '22023';
  end if;

  select coalesce(v.account_manager_id, cl.account_manager_id) into v_am
    from clients cl where cl.id = v.client_id;

  if not app.has_permission('projects', 'manage')
     or not app.in_write_scope(null, null, v_am) then
    -- ADR-0083 addendum d.15: say WHO can, not just that the caller cannot. The name rides in
    -- DETAIL so the screen can put it in a sentence; an unset manager is said as such.
    select up.display_name into v_am_name from user_profiles up where up.id = v_am;
    raise exception 'you cannot approve this campaign'
      using errcode = '42501',
            detail = coalesce(v_am_name, ''),
            hint = case when v_am is null then 'no_account_manager' else 'account_manager' end;
  end if;

  update campaigns
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_campaign;

  -- ADR-0084 d.4 / ADR-0085 d.2: a SINGLE JOB's brief is approved with the job.
  if v.kind = 'single_job' then
    update campaign_briefs
       set approved_at = now(), approved_by = auth.uid()
     where campaign_id = p_campaign
       and approved_at is null;
  end if;

  -- I52 Action 1 (Edward, 17 Sep): the deliverable's OWNER, and nobody else — not department leads
  -- by role, not reviewers. One row per deliverable the person owns, pointing at that deliverable,
  -- because that is where the brief and the tasks they must review and approve live. The label is
  -- the deliverable; the campaign arrives in context_label. Never the approver.
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  select v.tenant_id, d.owner_user_id, 'campaign_approved', d.name, 'deliverable', d.id, auth.uid(),
         jsonb_build_object('due_at', d.due_at)
    from deliverables d
    join streams s on s.id = d.stream_id
   where s.campaign_id = p_campaign
     and d.owner_user_id is not null
     and d.owner_user_id is distinct from auth.uid();
end $$;

-- ============================================================================
-- C) Action 2 — the new owner is told what is theirs; the old owner who has it
-- ============================================================================
CREATE OR REPLACE FUNCTION app.tg_deliverable_owner_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 set search_path = public, app, extensions
AS $$
begin
  if new.owner_user_id is not distinct from old.owner_user_id then
    return null;
  end if;

  -- Nobody to tell when a migration or seeder moves it, and no actor to attribute it to.
  if auth.uid() is null or app.is_system_op() then
    return null;
  end if;

  -- I52 Action 2 (Edward, 17 Sep). The NEW owner is told what is now theirs; the OLD owner is told,
  -- in one line, who has it now. Never the person who made the change.
  if new.owner_user_id is not null and new.owner_user_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (new.tenant_id, new.owner_user_id, 'deliverable_reassigned', new.name, 'deliverable', new.id, auth.uid());
  end if;
  if old.owner_user_id is not null and old.owner_user_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    select new.tenant_id, old.owner_user_id, 'deliverable_owner_removed', new.name, 'deliverable', new.id, auth.uid(),
           jsonb_build_object('new_owner', up.display_name)
      from (select 1) x
      left join user_profiles up on up.id = new.owner_user_id;
  end if;

  return null;
end $$;

-- ============================================================================
-- D) Action 3 — the person a task is taken from is told
-- ============================================================================
CREATE OR REPLACE FUNCTION app.tg_subtask_notify_assignee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 set search_path = public, app
AS $$
begin
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and new.assignee_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (new.tenant_id, new.assignee_id, 'assigned', new.title, 'sub_task', new.id, auth.uid());
  end if;
  -- I52 Action 3 (Edward, 17 Sep): the person the task was taken FROM is told, naming who has it.
  if tg_op = 'UPDATE' and old.assignee_id is not null
     and new.assignee_id is distinct from old.assignee_id
     and new.assignee_id is not null
     and old.assignee_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    select new.tenant_id, old.assignee_id, 'task_reassigned_away', new.title, 'sub_task', new.id, auth.uid(),
           jsonb_build_object('new_assignee', up.display_name)
      from (select 1) x
      left join user_profiles up on up.id = new.assignee_id;
  end if;
  return new;
end $$;

-- ============================================================================
-- E) Actions 4/11 — the task is the thing reviewed; required and optional differ
-- ============================================================================
CREATE OR REPLACE FUNCTION app.tg_subtask_notify_reviewer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 set search_path = public, app, extensions
AS $$
declare v_name text;
begin
  if new.status <> 'review' or new.status is not distinct from old.status then
    return new;
  end if;
  select d.name into v_name from deliverables d where d.id = new.deliverable_id;
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  -- I52 Action 4 (Edward, 17 Sep): it is the TASK being reviewed, so the task is the name and the
  -- entity; a REQUIRED reviewer approves or sends back, an OPTIONAL one answers (ADR-0089), and the
  -- two are asked different things.
  select new.tenant_id, r.user_id,
         case when r.is_mandatory then 'review_requested' else 'feedback_requested' end,
         new.title, 'sub_task', new.id, auth.uid()
  from sub_task_reviewers r
  where r.sub_task_id = new.id
    and r.user_id is distinct from auth.uid();   -- never notify the actor about their own action
  return new;
end $$;

CREATE OR REPLACE FUNCTION app.tg_sub_task_reviewer_appointed_in_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 set search_path = public, app, extensions
AS $$
declare v sub_tasks; v_label text;
begin
  select * into v from public.sub_tasks st where st.id = new.sub_task_id;
  if not found or v.status <> 'review' then
    return null;
  end if;
  if new.user_id is not distinct from auth.uid() then
    return null;   -- never notify the actor about their own action
  end if;
  select d.name into v_label from public.deliverables d where d.id = v.deliverable_id;
  insert into public.notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  values (new.tenant_id, new.user_id,
          case when new.is_mandatory then 'review_requested' else 'feedback_requested' end,
          v.title, 'sub_task', v.id, auth.uid());   -- I52 Action 4: the task, not its container
  return null;
end $$;

-- ============================================================================
-- F) Action 6b — "you can start" names what was approved; unassigned → the owner
-- ============================================================================
CREATE OR REPLACE FUNCTION app.notify_dependents_ready(p_sub_task uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 set search_path = public, app, extensions
AS $$
declare v_approved sub_tasks;
begin
  select * into v_approved from sub_tasks where id = p_sub_task;
  -- I52 Action 6b (Edward, 17 Sep): the mail names the task that was APPROVED, carries a link to its
  -- approved file, and goes to the waiting task's assignee — or, when it has none, to the
  -- deliverable's OWNER, so it is assigned rather than sitting released and silent.
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  select b.tenant_id, coalesce(b.assignee_id, d.owner_user_id), 'dependency_ready', b.title, 'sub_task', b.id, auth.uid(),
         jsonb_build_object('approved_task', v_approved.title, 'approved_task_id', v_approved.id,
                            'unassigned', b.assignee_id is null)
    from sub_task_dependencies dep
    join sub_tasks b on b.id = dep.sub_task_id
    left join deliverables d on d.id = b.deliverable_id
   where dep.depends_on_sub_task_id = p_sub_task
     and coalesce(b.assignee_id, d.owner_user_id) is not null
     -- Nobody is told to start work that is finished, cancelled, or already under way.
     and b.status = 'todo'
     -- Never to the person who just did the approving; they know.
     and coalesce(b.assignee_id, d.owner_user_id) is distinct from auth.uid()
     and not app.sub_task_has_unmet_prereqs(b.id);
end $$;

-- ============================================================================
-- G) Action 8 — a moved booking says from and to
-- ============================================================================
CREATE OR REPLACE FUNCTION app.tg_booking_notify_reschedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 set search_path = public, app, extensions
AS $$
declare v sub_tasks;
begin
  if new.sub_task_id is null then return new; end if;

  -- The DAY is what a person needs to hear about. A load or state change on the same day is not a
  -- move, and telling somebody their Tuesday is still their Tuesday is noise that trains people to
  -- ignore the channel.
  if new.starts_at is not distinct from old.starts_at
     and new.ends_at is not distinct from old.ends_at then
    return new;
  end if;

  -- The materialiser never UPDATEs — it deletes and re-inserts (20260817120000) — so reaching here
  -- means a human moved it. The same property `schedule_overridden` relies on.
  select * into v from sub_tasks where id = new.sub_task_id;
  if v.assignee_id is null or v.assignee_id is not distinct from auth.uid() then
    return new;                               -- unassigned, or you moved your own work
  end if;

  -- I52 Action 8 (Edward, 17 Sep): the mail says which days it moved FROM and TO; the old days are
  -- gone from the row once this trigger returns, so they travel in detail.
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  values (v.tenant_id, v.assignee_id, 'rescheduled', v.title, 'sub_task', v.id, auth.uid(),
          jsonb_build_object('from_start', old.starts_at, 'from_end', old.ends_at,
                             'to_start', new.starts_at, 'to_end', new.ends_at));
  return new;
end $$;

-- ============================================================================
-- H) Action 13 — a required person hears the days and who is doing the task
-- ============================================================================
CREATE OR REPLACE FUNCTION app.tg_booking_notify_resource()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 set search_path = public, app, extensions
AS $$
declare
  v_user     uuid;
  v_label    text;
  v_assignee uuid;
begin
  select user_id into v_user from resources where id = new.resource_id;
  -- Equipment has no user to tell, and nobody needs telling about their own action.
  if v_user is null or v_user is not distinct from auth.uid() then return new; end if;

  if new.sub_task_id is not null then
    select assignee_id into v_assignee from sub_tasks where id = new.sub_task_id;

    -- The task's own assignee: the sub-task trigger already told them. No double-notify.
    if v_user is not distinct from v_assignee then return new; end if;

    -- Anyone else on a task booking is a REQUIRED resource (ADR-0042). Their time is being taken,
    -- and the label is the WORK — the task they are needed on. It used to prefer the deliverable's
    -- name whenever the task had one, which is how an email came to say "assigned you to
    -- 'Creative'": the container, not the step. `sub_tasks.title` is NOT NULL, so this always
    -- resolves; the campaign now arrives separately in context_label.
    select s.title into v_label from sub_tasks s where s.id = new.sub_task_id;

    -- I52 Action 13 (Edward, 17 Sep): the days, and who is doing the task, ride in detail.
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    select new.tenant_id, v_user, 'resource_required', v_label, 'sub_task', new.sub_task_id, auth.uid(),
           jsonb_build_object('starts_at', new.starts_at, 'ends_at', new.ends_at,
                              'assignee', up.display_name)
      from (select 1) x
      left join user_profiles up on up.id = v_assignee;
    return new;
  end if;

  -- No task on this booking, so the deliverable IS the thing assigned and its name is the label.
  if new.deliverable_id is not null then
    select name into v_label from deliverables where id = new.deliverable_id;
  else
    v_label := new.title;
  end if;
  if v_label is null then return new; end if;   -- plain reservation (no task/title) → nothing to say
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  values (new.tenant_id, v_user, 'assigned', v_label, 'booking', new.id, auth.uid());
  return new;
end $$;

-- ============================================================================
-- I) Action 15 — an attached request tells its new owner first
-- ============================================================================
CREATE OR REPLACE FUNCTION public.attach_job_to_campaign(p_draft_campaign uuid, p_target_campaign uuid)
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

  -- 8. WHO IS TOLD — I52 Action 15 (Edward, 17 Sep). The NEW deliverable's owner first: it is theirs
  -- to brief and task, exactly as an approval is. Other owners already on the job get one line
  -- naming who owns the new one. The release notice this used to send to the new owner instead is
  -- covered by that first row and goes. Never the account manager who attached it.
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  select v_tenant, d.owner_user_id, 'deliverable_added', d.name, 'deliverable', d.id, auth.uid(),
         jsonb_build_object('for_owner', true, 'due_at', d.due_at)
    from deliverables d
   where d.id = any (coalesce(v_moved, array[]::uuid[]))
     and d.owner_user_id is not null
     and d.owner_user_id is distinct from auth.uid();

  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  select distinct v_tenant, d.owner_user_id, 'deliverable_added', v_first_name, 'deliverable', v_first_moved, auth.uid(),
         jsonb_build_object('for_owner', false, 'owner', up.display_name)
    from deliverables d
    join streams s on s.id = d.stream_id
    left join deliverables nd on nd.id = v_first_moved
    left join user_profiles up on up.id = nd.owner_user_id
   where s.campaign_id = p_target_campaign
     and d.owner_user_id is not null
     and not (d.id = any (coalesce(v_moved, array[]::uuid[])))
     and d.owner_user_id is distinct from auth.uid()
     and d.owner_user_id is distinct from nd.owner_user_id
     and v_first_moved is not null;

  perform set_config('app.system_op', 'off', true);
  return p_target_campaign;
end $$;

-- ============================================================================
-- E, continued) Action 11 — "everyone has answered" names the task, not its container
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sub_task_respond(p_sub_task uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 set search_path = public, app, extensions
AS $$
declare
  v       sub_tasks;
  v_mine  sub_task_reviewers;
  v_kind  text;
  v_label text;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002';
  end if;
  if v.status <> 'review' then
    raise exception 'task cannot be answered from % (only a submitted task is under review)', v.status
      using errcode = '22023';
  end if;

  select * into v_mine from sub_task_reviewers
   where sub_task_id = p_sub_task and user_id = auth.uid();
  if not found then
    raise exception 'only an appointed reviewer may answer on this task' using errcode = '42501';
  end if;
  -- A required reviewer approves; so does a lone unmarked one, who is required by definition (d.2).
  if v_mine.is_mandatory
     or not exists (select 1 from sub_task_reviewers r
                     where r.sub_task_id = p_sub_task and r.is_mandatory) then
    raise exception 'your approval is required on this task — approve or request changes rather than answering'
      using errcode = '42501';
  end if;
  if v_mine.responded_at is not null then
    raise exception 'you have already answered on this version' using errcode = '22023';
  end if;

  -- One press; the kind is derived, the moment is not.
  v_kind := app.reviewer_feedback_kind(p_sub_task, auth.uid());

  perform set_config('app.reviewer_verdict', 'on', true);
  update sub_task_reviewers set responded_at = now(), response = v_kind where id = v_mine.id;
  perform set_config('app.reviewer_verdict', 'off', true);

  -- ADR-0089 d.9: when this was the LAST outstanding answer, every required reviewer whose approval
  -- is still owed is told the round is complete. Without it they either poll the task or approve
  -- early, and the single run never actually happens. A task with no other optional reviewer
  -- sends exactly one; the label and entity follow tg_subtask_notify_reviewer so the inbox opens
  -- the same place for both.
  if not exists (select 1 from sub_task_reviewers r
                  where r.sub_task_id = p_sub_task and not r.is_mandatory and r.responded_at is null) then
    -- I52 Action 11 (Edward, 17 Sep): the TASK is the thing awaiting approval, so the row names it.
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    select v.tenant_id, r.user_id, 'feedback_collected', v.title, 'sub_task', v.id, auth.uid()
      from sub_task_reviewers r
     where r.sub_task_id = p_sub_task and r.is_mandatory and r.approved_at is null
       and r.user_id is distinct from auth.uid();
  end if;

  -- The answer can be the last thing the task was waiting for: every required approval already
  -- given (a required reviewer removed after the others approved — 057's hatch, one tick longer).
  perform app.maybe_complete_sub_task(p_sub_task);
end $$;

commit;
