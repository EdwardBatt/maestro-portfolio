-- I59 integration (25 Sep, Edward: the walk escalates only its own job) — the sweep can be limited to one
-- deliverable. `p_deliverable` defaults to null: the cron and every existing caller behave exactly as before.
-- The review walk passes its own piece so one run on the long-lived local database does not escalate (and
-- email) every stale item left by earlier test runs.
--
-- `app.run_escalation_sweep` is reproduced WHOLE from 20260926133000; the edits are marked [edit]. The old
-- three-argument signature is dropped first so the call stays unambiguous.

begin;

drop function if exists app.run_escalation_sweep(timestamptz, boolean, text);

create or replace function app.run_escalation_sweep(
  p_now     timestamptz default now(),
  p_dry_run boolean default false,
  p_kind    text default null,
  -- [edit] only the causes on this deliverable (the review walk escalates its own piece, nothing else)
  p_deliverable uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, app, extensions as $$
declare
  r          app.escalation_due_row;
  v_people   jsonb;
  v_count    integer;
  v_log      uuid;
  v_type     text;
  v_sent     integer := 0;
  v_items    jsonb := '[]'::jsonb;
  v_fallback boolean;
  v_reason   text;
begin
  for r in select * from app.escalation_due(p_now) e where (p_kind is null or e.kind = p_kind)
             and (p_deliverable is null or e.deliverable_id = p_deliverable)   -- [edit]
           order by e.kind, e.since, e.subject_id loop
    v_fallback := false;
    v_reason := null;
    if r.kind = 'over_capacity' then
      select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'reasons', x.reasons) order by x.user_id), '[]'::jsonb)
        into v_people from app.over_capacity_recipients(r.subject_id) x;
    else
      select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'reasons', x.reasons) order by x.user_id), '[]'::jsonb)
        into v_people from app.escalation_recipients(r.kind, r.deliverable_id, r.sub_task_id, r.campaign_id) x;

      -- I59 E9: a rule that resolves to nobody goes to the Traffic Manager role.
      if jsonb_array_length(v_people) = 0 then
        v_fallback := true;
        v_reason := app.escalation_fallback_reason(r.kind, r.deliverable_id, r.sub_task_id, r.campaign_id);
        select coalesce(jsonb_agg(jsonb_build_object('user_id', up.id, 'reasons', jsonb_build_array('traffic_fallback'))
                                  order by up.id), '[]'::jsonb)
          into v_people
          from user_profiles up
          join roles ro on ro.id = up.role_id
         where up.tenant_id = r.tenant_id and ro.tenant_id = r.tenant_id
           and ro.key = 'scheduler' and up.is_active;
      end if;
    end if;
    v_count := jsonb_array_length(v_people);

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'kind', r.kind, 'entity_type', r.entity_type, 'entity_id', r.entity_id, 'label', r.label,
      'occurrence', r.occurrence, 'since', r.since, 'hours', round(r.hours, 1), 'threshold', r.threshold,
      'recipients', v_people, 'extra', r.extra,
      'fallback', v_fallback, 'fallback_reason', v_reason));

    if p_dry_run then
      continue;
    end if;

    if v_count = 0 then
      -- Nobody at all, not even the Traffic Manager: nothing sent, retried next run — but recorded.
      insert into escalation_unreached (tenant_id, kind, subject_id, occurrence, reason, first_tried_at, last_tried_at)
      values (r.tenant_id, r.kind, r.subject_id, r.occurrence, v_reason, p_now, p_now)
      on conflict (tenant_id, kind, subject_id, occurrence)
      do update set last_tried_at = excluded.last_tried_at, reason = excluded.reason;
      continue;
    end if;

    v_log := null;
    insert into escalation_log (tenant_id, kind, subject_id, occurrence, recipients, sent_at, fallback, fallback_reason)
    values (r.tenant_id, r.kind, r.subject_id, r.occurrence, v_count, p_now, v_fallback, v_reason)
    on conflict (tenant_id, kind, subject_id, occurrence) do nothing
    returning id into v_log;
    if v_log is null then
      continue;   -- another run sent this cause first
    end if;

    delete from escalation_unreached u
     where u.tenant_id = r.tenant_id and u.kind = r.kind and u.subject_id = r.subject_id
       and u.occurrence = r.occurrence;

    v_type := case r.kind when 'review_remind' then 'review_reminder'
                          when 'over_capacity' then 'over_capacity'
                          else 'escalated' end;

    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    select r.tenant_id, (p ->> 'user_id')::uuid, v_type, r.label, r.entity_type, r.entity_id, null,
           coalesce(r.extra, '{}'::jsonb) || jsonb_build_object(
             'kind', r.kind, 'occurrence', r.occurrence, 'since', r.since,
             'hours', case when r.hours is null then null else round(r.hours) end,
             'threshold', r.threshold, 'as', p -> 'reasons')
           || case when v_fallback then jsonb_build_object('fallback_reason', v_reason) else '{}'::jsonb end
      from jsonb_array_elements(v_people) p;

    -- The single-job rung's own stamp keeps its meaning ("when the unassigned escalation was sent").
    if r.kind = 'unassigned' then
      update deliverables set assignment_escalated_at = p_now
       where id = r.subject_id and assignment_escalated_at is null;
    end if;

    v_sent := v_sent + 1;
  end loop;

  return jsonb_build_object('dry_run', p_dry_run, 'now', p_now, 'sent', v_sent,
                            'due', jsonb_array_length(v_items), 'items', v_items);
end $$;

revoke all on function app.run_escalation_sweep(timestamptz, boolean, text, uuid) from public, anon, authenticated;
grant  execute on function app.run_escalation_sweep(timestamptz, boolean, text, uuid) to service_role;

-- The service role's door for one deliverable (the walk; any tool that must not touch the rest).
create or replace function public.run_escalation_sweep_for(p_deliverable uuid)
returns jsonb
language sql
security definer
set search_path = public, app, extensions as $$
  select app.run_escalation_sweep(now(), false, null, p_deliverable);
$$;
revoke all on function public.run_escalation_sweep_for(uuid) from public, anon, authenticated;
grant execute on function public.run_escalation_sweep_for(uuid) to service_role;

commit;
