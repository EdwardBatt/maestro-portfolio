-- I67.2 (Edward, 30 Sep: "When a task is deleted my-work the schedule page need to be manually refreshed to update the
-- view, all related views should be reflected in real time").
--
-- The screens reload their task and booking reads when THIS person changes something (the client's one refresh,
-- `invalidateTaskViews`). What never reached them was ANOTHER person's change: the Schedule and Team polled every
-- 20 s, everything else waited for a reload. This migration sends a small nudge on the tenant's private topic
-- `tenant:{tid}:work` whenever tasks or bookings change; every open screen of that tenant hears it and reloads its
-- own reads under its own RLS. The payload names the table and the operation only — no row data travels, so the
-- channel cannot leak what a person may not read.
--
-- SECURITY DEFINER, and why that is safe (AGENTS.md — the ADR is owed with I67.2): `realtime.messages` has RLS and no INSERT
-- policy, so a send made as the signed-in person who changed a task is refused — and most task writes are theirs
-- (PostgREST, invoker RPCs). Granting clients INSERT on the table instead would let any browser broadcast on its
-- tenant's topic. The function takes NO input from the caller: a trigger function cannot be called directly, the
-- topic is built from the changed rows' own `tenant_id`, and the payload is two fixed words. `search_path` pinned.
--
-- ONE nudge per statement per tenant (statement-level triggers over the transition tables): approving a task list
-- that writes forty tasks sends one message, not forty.
--
-- Best-effort, as the notifications broadcast (20260818140000): a failed send is swallowed — the rows are the truth
-- and the screens still reconcile on their own polling and refreshes. `realtime.*` exists only on Supabase (local
-- stack included), not in the CI harness, so the send is guarded and the receive policy is created inside a guard.

create or replace function app.tg_work_changed_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_tenant uuid;
begin
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is null then
    return null;
  end if;
  for v_tenant in
    execute case tg_op
      when 'INSERT' then 'select distinct tenant_id from new_rows'
      when 'DELETE' then 'select distinct tenant_id from old_rows'
      else 'select tenant_id from new_rows union select tenant_id from old_rows'
    end
  loop
    begin
      perform realtime.send(
        jsonb_build_object('table', tg_table_name, 'op', lower(tg_op)),
        'work_changed',
        'tenant:' || v_tenant::text || ':work',
        true
      );
    exception when others then null;  -- transient realtime failure: the rows stand, the screens reconcile
    end;
  end loop;
  return null;
end $$;
comment on function app.tg_work_changed_broadcast() is
  'I67.2: nudge the tenant''s private work topic once per statement when tasks or bookings change. Payload is the '
  'table and the operation only; each screen re-reads under its own RLS. Best-effort — a failed send is swallowed.';

-- A transition table can serve one event only, so each table has three statement triggers on the one function.
create trigger sub_tasks_work_changed_ins after insert on sub_tasks
  referencing new table as new_rows for each statement execute function app.tg_work_changed_broadcast();
create trigger sub_tasks_work_changed_upd after update on sub_tasks
  referencing old table as old_rows new table as new_rows for each statement execute function app.tg_work_changed_broadcast();
create trigger sub_tasks_work_changed_del after delete on sub_tasks
  referencing old table as old_rows for each statement execute function app.tg_work_changed_broadcast();

create trigger bookings_work_changed_ins after insert on bookings
  referencing new table as new_rows for each statement execute function app.tg_work_changed_broadcast();
create trigger bookings_work_changed_upd after update on bookings
  referencing old table as old_rows new table as new_rows for each statement execute function app.tg_work_changed_broadcast();
create trigger bookings_work_changed_del after delete on bookings
  referencing old table as old_rows for each statement execute function app.tg_work_changed_broadcast();

-- ---- Realtime Authorization: an active member of the tenant may RECEIVE on its work topic, nobody else ----
-- Tenant from the person's own profile row (ADR-0037 d.6: identity from the database, not the token).
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages absent (CI harness) — skipping the work-topic Realtime Authorization policy';
    return;
  end if;
  execute 'drop policy if exists tenant_members_receive_work_broadcast on realtime.messages';
  execute $pol$
    create policy tenant_members_receive_work_broadcast on realtime.messages
      for select to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and exists (
          select 1
          from public.user_profiles up
          where up.id = (select auth.uid())
            and up.is_active
            and (select realtime.topic()) = 'tenant:' || up.tenant_id::text || ':work'
        )
      )
  $pol$;
end $$;
