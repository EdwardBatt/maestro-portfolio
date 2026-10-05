-- The second gate changes hands: the deliverable's OWNER approves the task list (ADR-0100 d.2).
--
-- Edward, 23 Sep: *"The assigned deliverables owner has to review and approve the tasks before the
-- tasks can be assigned. This is now the second gate."*
--
-- Until now `app.deliverable_work_acceptance_refusal` forked on the campaign's kind:
--
--     single_job  ->  has the OWNER approved the task list?     (ADR-0090)
--     campaign    ->  has the DEPARTMENT approved its brief?    (ADR-0072 d.6)
--
-- ADR-0100 deletes the second branch. One rule for all work: the person accountable for a
-- deliverable reads its task list and accepts it before anybody is assigned. It is a better gate
-- than the one it replaces — per deliverable rather than per department, and answered by the named
-- person who owns the work rather than by whoever in a department happens to hold `briefs:approve`.
--
-- **Work already running is not stopped** (d.7). Measured 23 Sep: 115 campaign deliverables sit on
-- approved campaigns with no approved task list, because they never needed one. Applying the new
-- rule to them would make every one unassignable the day this ships. So the gate applies to
-- campaigns approved AFTER this migration, by date. The quicker alternative — stamping 115 rows as
-- approved — would put a lie in the audit trail: a deliverable marked accepted by nobody, for ever.

begin;

-- The cutover. A campaign approved before this moment keeps the old world's freedom; one approved
-- after it needs its owners to accept their task lists. Stored rather than inlined so the date is
-- one fact in one place, readable by a test and by a person wondering why an old campaign behaves
-- differently.
create table if not exists app_settings (
  key         text primary key,
  value       text not null,
  created_at  timestamptz not null default now()
);

comment on table app_settings is
  'Small, tenant-independent facts the SCHEMA needs to know about itself — cutover moments and the '
  'like. Not configuration: nothing here is edited by a person or varies by tenant.';

grant select on table public.app_settings to authenticated, service_role;
alter table app_settings enable row level security;
alter table app_settings force row level security;
create policy app_settings_read on app_settings for select to authenticated using (true);

insert into app_settings (key, value)
values ('task_list_gate_from', now()::text)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The gate itself: one rule, with the date exemption.
-- ---------------------------------------------------------------------------
create or replace function app.deliverable_work_acceptance_refusal(p_deliverable uuid)
returns text
language sql
stable
security definer
set search_path = public, app, extensions as $$
  select case
    -- Ad-hoc work hangs off a job, not a campaign: this gate was never about it (ADR-0090 d.6).
    when c.id is null then null
    -- ADR-0100 d.7: approved before the cutover, so its owners were never asked. Left alone.
    when c.kind <> 'single_job'
         and c.approved_at is not null
         and c.approved_at < (select value::timestamptz from app_settings
                               where key = 'task_list_gate_from') then null
    -- ADR-0100 d.2: ONE rule for all work. The `single_job` / `campaign` fork is gone.
    when d.tasks_approved_at is not null then null
    else format('the task list for "%s" has not been approved by %s yet, so its work cannot be assigned',
                d.name, coalesce(own.display_name, 'its owner'))
  end
  from deliverables d
  left join streams s on s.id = d.stream_id
  left join campaigns c on c.id = s.campaign_id
  left join user_profiles own on own.id = d.owner_user_id
  where d.id = p_deliverable;
$$;

comment on function app.deliverable_work_acceptance_refusal(uuid) is
  'ADR-0100 d.2: why this deliverable''s work cannot be assigned yet, or NULL. ONE rule for every '
  'kind of work — the owner has approved the task list — replacing the fork where a campaign asked '
  'whether the DEPARTMENT had approved its brief (ADR-0072 d.6, superseded). Campaigns approved '
  'before `app_settings.task_list_gate_from` are exempt: their owners were never asked, and '
  'stopping work already running was not on the table (d.7).';

-- ---------------------------------------------------------------------------
-- Who may answer it: nothing to change.
-- ---------------------------------------------------------------------------
-- `public.approve_deliverable_tasks` and `app.may_approve_deliverable_tasks` were read before
-- writing this and need no amendment. Neither forks on the campaign's kind — the restriction to
-- single jobs lived in the GATE above and in the screen, never in the authority. So a campaign
-- deliverable is already a legal subject for the existing RPC, and the rule stays exactly as
-- ADR-0090 d.4 set it (amended 12 Sep): the owner, or `deliverable_owner:manage` within the
-- department's scope, never the account manager.
--
-- Left alone deliberately. The first draft of this migration reproduced the function and would
-- have broken it twice over: it is SECURITY DEFINER, not invoker, and it sets `app.task_list_approval`
-- around its UPDATE for the fence trigger to see.

commit;
