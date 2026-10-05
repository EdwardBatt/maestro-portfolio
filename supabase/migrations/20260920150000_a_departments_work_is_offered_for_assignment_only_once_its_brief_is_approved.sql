-- ADR-0072 d.6, enforced; ADR-0090 d.3a, applied to campaigns.
--
-- Edward, 20 Sep, on LUMA Season 2: *"you are making deliverables available for assignment on the
-- schedule when the tasks have not been approved."* Two things were wrong, and both had an answer
-- already written down:
--
--   1. `app.sub_task_brief_is_approved` (20260903130000) read ADR-0070 d.5 — "absence is not
--      refusal" — so a campaign whose department had never GENERATED its brief passed the gate.
--      ADR-0072 d.6 (5 Sep) settled the ordering two days later: the account manager approves the
--      campaign → the department is told → the department generates, reviews its tasks, and
--      approves → *only then* are that department's tasks assignable. Edward, 11 Sep, quoted in
--      ADR-0090: *"only once approved do they surface for selection."* A brief that does not exist
--      has not been approved. And d.5's "a deliverable with no department is not blocked" goes
--      with it: every door that creates a deliverable requires an OWNER (ADR-0083 d.8, ADR-0055
--      d.10, the wizard, add_campaign_deliverable), and the department is stamped from the owner
--      (ADR-0050 d.2) -- so "no department" is not a state the product produces, and a rule that
--      exempted it would be a hole, not a rule. No department, no acceptance.
--
--   2. The `+` picker on /schedule listed every deliverable of the campaign and left the gate to
--      find out on submit. ADR-0090 d.3a: a held task is not offered anywhere assignment starts —
--      absence, not a disabled entry. The dialog applied that to single jobs only, in the client.
--      `public.assignable_deliverables` below answers it for every kind of job, from the same
--      function the gate itself asks, so the picker and the trigger cannot disagree.
--
-- Nothing already assigned is touched: the gate governs NEW assignments only, as it always has.
begin;

-- ---------------------------------------------------------------- the brief gate ----
create or replace function app.deliverable_brief_is_approved(p_deliverable uuid) returns boolean
language sql stable security definer
set search_path = public, app, extensions as $$
  select case
    -- Ad-hoc work hangs off a job, not a campaign: this gate was never about it (ADR-0090 d.6).
    when s.campaign_id is null then true
    else exists (
      select 1 from campaign_briefs b
       where b.campaign_id = s.campaign_id
         and b.department_id = d.department_id
         and b.approved_at is not null)
  end
  from deliverables d
  left join streams s on s.id = d.stream_id
  where d.id = p_deliverable;
$$;
comment on function app.deliverable_brief_is_approved(uuid) is
  'ADR-0072 d.6: the deliverable''s department has an APPROVED brief on its campaign. A brief '
  'nobody has generated is not approved, and a deliverable with no department (which every door '
  'refuses to create -- the owner is required) has no acceptance either. Ad-hoc work has no '
  'campaign and is not gated (ADR-0090 d.6).';

-- Reproduced from `20260903130000`, its last definition. The change: the department must have an
-- APPROVED brief on the campaign -- a missing brief is unapproved, and so is a missing department.
create or replace function app.sub_task_brief_is_approved(p_sub_task uuid) returns boolean
language sql stable security definer
set search_path = public, app, extensions as $$
  select app.deliverable_brief_is_approved(st.deliverable_id)
    from sub_tasks st
   where st.id = p_sub_task;
$$;
comment on function app.sub_task_brief_is_approved(uuid) is
  'ADR-0070 d.4 + ADR-0072 d.6: has the DELIVERABLE''s department approved its brief on this '
  'campaign? Reads the deliverable''s department, never the task''s. False when the brief has not '
  'been generated yet (ADR-0072 d.6 -- the department writes, reviews and approves before its work '
  'is assignable). Only asked of campaign work: ad-hoc work has no campaign and is not gated.';

-- ---------------------------------------------------------------- one question, per deliverable ----
-- "Has the department accepted this work?" asked of the DELIVERABLE, so a listing can ask it once
-- per row. The sub-task form keeps its signature and delegates; the messages are unchanged.
create or replace function app.deliverable_work_acceptance_refusal(p_deliverable uuid) returns text
language sql stable security definer
set search_path = public, app, extensions as $$
  select case
    when c.id is null then null
    when c.kind = 'single_job' then
      case when d.tasks_approved_at is not null then null
           else format('the task list for "%s" has not been approved by %s yet, so its work cannot be assigned',
                       d.name, coalesce(own.display_name, 'its owner'))
      end
    else
      case when app.deliverable_brief_is_approved(d.id) then null
           else 'this department has not approved its brief yet, so its work cannot be assigned'
      end
  end
  from deliverables d
  left join streams s on s.id = d.stream_id
  left join campaigns c on c.id = s.campaign_id
  left join user_profiles own on own.id = d.owner_user_id
  where d.id = p_deliverable;
$$;
comment on function app.deliverable_work_acceptance_refusal(uuid) is
  'ADR-0090 d.6 asked of a deliverable: NULL when its department has accepted the work, else the '
  'refusal. A campaign answers with its department brief (ADR-0070 d.4, ADR-0072 d.6); a single '
  'job with deliverables.tasks_approved_at. The gate and the /schedule picker both read this.';

create or replace function app.sub_task_work_acceptance_refusal(p_sub_task uuid) returns text
language sql stable security definer
set search_path = public, app, extensions as $$
  select app.deliverable_work_acceptance_refusal(st.deliverable_id)
    from sub_tasks st
   where st.id = p_sub_task;
$$;

-- ---------------------------------------------------------------- what the picker may offer ----
-- The campaign's deliverables whose work can actually be assigned: the campaign approved
-- (ADR-0048 d.8), the department's brief approved or the owner's task list approved (ADR-0090
-- d.6), the deliverable still live. Security INVOKER: the caller sees only the rows RLS shows them.
-- What is left out is left out — absence, not a disabled entry (ADR-0090 d.3a).
create or replace function public.assignable_deliverables(p_campaign uuid)
returns table (id uuid, name text)
language sql stable security invoker
set search_path = public, app, extensions as $$
  select d.id, d.name
    from deliverables d
    join streams s on s.id = d.stream_id
   where s.campaign_id = p_campaign
     and d.state <> 'archived'
     and app.campaign_is_approved(p_campaign)
     and app.deliverable_work_acceptance_refusal(d.id) is null
   order by d.name;
$$;
comment on function public.assignable_deliverables(uuid) is
  'ADR-0090 d.3a: the deliverables of a campaign that the /schedule picker may offer — the ones '
  'whose work the assignment gate would accept, read from the same function the gate reads. A '
  'held deliverable is absent, not disabled.';

revoke execute on function public.assignable_deliverables(uuid) from public;
revoke execute on function public.assignable_deliverables(uuid) from anon;
grant  execute on function public.assignable_deliverables(uuid) to authenticated;

commit;
