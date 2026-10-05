-- Every row says who made it and who last changed it — and an approved department brief is locked.
--
-- I51.1 / I51.3 (ADR-0008 follow-through; ADR-0070 addendum, 16 Sep). Edward, on finding an audit
-- line reading "Department brief · 04e20210" edited by someone outside the department: *"all actions
-- on the site are required to be auditable with created by, modified by etc… WHY IS THE CREATED BY
-- ETC MISSING IN THE FIRST PLACE."*
--
-- WHY IT WAS MISSING. ADR-0008 put *who did what* into one append-only log (`audit_events`, written
-- by `app.audit_row_change` on every tenant table — enforced by pgTAP 092 since 6 Sep). That half
-- works. The half that puts the answer on the row, where a screen can show it, was never built:
-- 14 of ~60 tenant tables carry `created_by`, no work table does, and the log is readable only by
-- `audit:view` holders. So the drafts list could not say who started a brief, and nothing could.
--
-- THE RULE, ENFORCED NOT REMEMBERED (the 092 lesson): every table carrying `tenant_id` gets
-- `created_by` and `updated_by`, filled by ONE trigger from the signed-in user, and pgTAP 123 fails
-- the build for any tenant table without them. Back-filled here from the audit log, which has known
-- the answer all along. The exemptions are 092's four — the logs themselves and the content that IS
-- the record (`notifications`, `messages`, which already carry their author).
--
-- AND THE LOCK (I51.3). `campaign_briefs_manage_update` was `projects:manage` and nothing else —
-- no scope, no state — so any lead could rewrite any department's brief, approved or not. ADR-0070
-- d.8 had said editing an approved brief is allowed and keeps the approval; Edward reversed that:
-- approval locks the brief, and the person who could approve it re-opens it (recorded) to change
-- it. The assignment gate (`app.sub_task_brief_is_approved`, d.4) then holds NEW assignments until
-- it is approved again, which is what "approved" meant in the first place.

begin;

-- ---------------------------------------------------------------- the trigger ----
-- `created_by` is kept if the caller set it (an Edge Function acting for somebody, a back-fill);
-- otherwise the signed-in user. `updated_by` is the signed-in user on every UPDATE the database
-- can attribute; a service-role write (no auth.uid()) leaves the last attributable person in place
-- rather than blanking it.
create or replace function app.set_actor_columns() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.created_by is null then
      new.created_by := auth.uid();
    end if;
  elsif tg_op = 'UPDATE' then
    if auth.uid() is not null then
      new.updated_by := auth.uid();
    end if;
  end if;
  return new;
end $$;

comment on function app.set_actor_columns() is
  'I51.1: fills created_by (insert, unless already set) and updated_by (update, when the caller is '
  'a signed-in user) on every tenant-scoped table. Attached by 20260916120000 and required of every '
  'later table by pgTAP 123.';

-- ---------------------------------------------------------------- every tenant table ----
do $$
declare
  r record;
begin
  for r in
    select c.relname as tbl
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and not a.attisdropped
                      and a.attname in ('tenant_id', 'host_tenant_id'))
       and c.relname not in ('audit_events', 'sla_events', 'notifications', 'messages')
     order by c.relname
  loop
    -- Columns, where missing. A table that already has `created_by` (14 do) keeps its own — same
    -- meaning, sometimes NOT NULL, and the trigger's coalesce respects a value the caller set.
    --
    -- DELIBERATELY NO FOREIGN KEY to user_profiles. A foreign key is what PostgREST embeds ride on,
    -- and adding two more from EVERY table to user_profiles makes every existing unnamed embed —
    -- `clients(account_manager:user_profiles(display_name))`, `campaign_briefs(approver:user_profiles(...))`,
    -- dozens more — ambiguous, which PostgREST answers with an error or an EMPTY result (traps.md).
    -- The first cut did add them and the single-job release lost its deliverable's owner to exactly
    -- that. Names are resolved by id (the view below; `useUserNames` in the client). Profiles are
    -- deactivated, never deleted, so nothing dangles.
    execute format('alter table %I add column if not exists created_by uuid', r.tbl);
    execute format('alter table %I add column if not exists updated_by uuid', r.tbl);

    execute format('drop trigger if exists set_actor_columns on %I', r.tbl);
    execute format(
      'create trigger set_actor_columns
         before insert or update on %I
         for each row execute function app.set_actor_columns()', r.tbl);

    -- Back-fill from the log, for tables whose rows the log identifies (an `id` column). The first
    -- `insert` event's actor made the row; the latest event's actor last touched it. Rows the log
    -- never saw (seeded before 2 Aug, or written under the service role) stay null — honestly.
    if exists (select 1 from pg_attribute a
                where a.attrelid = ('public.' || quote_ident(r.tbl))::regclass
                  and a.attname = 'id' and not a.attisdropped
                  and a.atttypid = 'uuid'::regtype) then
      -- Triggers OFF for the back-fill: `set_updated_at` would stamp today on every row's "last
      -- edited", and `audit_row_change` would write one log line per row about the log itself.
      execute format('alter table %I disable trigger user', r.tbl);
      execute format($f$
        update %1$I t
           set created_by = coalesce(t.created_by, f.actor_user_id)
          from (
            select distinct on (entity_id) entity_id, actor_user_id
              from audit_events
             where entity = %1$L and action = 'insert' and actor_user_id is not null
             order by entity_id, created_at asc
          ) f
         where f.entity_id = t.id and t.created_by is null
      $f$, r.tbl);
      execute format($f$
        update %1$I t
           set updated_by = l.actor_user_id
          from (
            select distinct on (entity_id) entity_id, actor_user_id
              from audit_events
             where entity = %1$L and action = 'update' and actor_user_id is not null
             order by entity_id, created_at desc
          ) l
         where l.entity_id = t.id and t.updated_by is null
      $f$, r.tbl);
      execute format('alter table %I enable trigger user', r.tbl);
    end if;
  end loop;
end $$;

-- The two tables the client SELECTS these columns from by name (the campaign page, the deliverable
-- detail) are restated literally. The loop above already added them — `if not exists` makes this a
-- no-op at run time; it is here for the PostgREST scanner test, which learns columns by reading
-- migrations and cannot see through `execute format`.
alter table campaigns    add column if not exists created_by uuid, add column if not exists updated_by uuid;
alter table deliverables add column if not exists created_by uuid, add column if not exists updated_by uuid;

-- ---------------------------------------------------------------- the list shows it ----
-- Re-stated VERBATIM from 20260913130000 with four columns APPENDED — `create or replace view`
-- can only add at the end (traps.md). The drafts table reads these: started by / on, last edited
-- by / on.
create or replace view campaign_list_rows
with (security_invoker = true) as
select
  c.id,
  c.tenant_id,
  c.name,
  c.status,
  c.go_live_at,
  cl.name                as client_name,
  b.name                 as brand_name,
  am.display_name        as account_manager_name,
  coalesce(db.total, 0)    as department_brief_total,
  coalesce(db.approved, 0) as department_brief_approved,
  coalesce(ow.owners, array[]::text[]) as brief_owner_names,
  c.kind,
  coalesce(tl.total, 0)    as deliverable_total,
  coalesce(tl.approved, 0) as deliverable_tasks_approved,
  -- I51.1, appended.
  c.created_at,
  c.updated_at,
  mk.display_name        as created_by_name,
  ed.display_name        as updated_by_name
from campaigns c
join clients cl on cl.id = c.client_id
left join brands b on b.id = c.brand_id
left join user_profiles am on am.id = c.account_manager_id
left join user_profiles mk on mk.id = c.created_by
left join user_profiles ed on ed.id = c.updated_by
left join lateral (
  select count(*)::int as total,
         count(*) filter (where cb.approved_at is not null)::int as approved
    from campaign_briefs cb
   where cb.campaign_id = c.id
) db on true
left join lateral (
  select array_agg(distinct p.display_name order by p.display_name) as owners
    from streams s
    join deliverables d on d.stream_id = s.id
    join user_profiles p on p.id = d.owner_user_id
   where s.campaign_id = c.id
) ow on true
left join lateral (
  select count(*)::int as total,
         count(*) filter (where d.tasks_approved_at is not null)::int as approved
    from streams s2
    join deliverables d on d.stream_id = s2.id
   where s2.campaign_id = c.id
) tl on true;

-- ---------------------------------------------------------------- an approved brief is locked ----
-- ADR-0070 addendum (16 Sep) reversing d.8. Scope was always meant to be here — `approve` has
-- tested it since 3 Sep; `update` never did. The account manager is passed as in `approve`, so an
-- account-scoped manager reaches their own campaign's briefs and no other.
drop policy if exists campaign_briefs_manage_update on campaign_briefs;
create policy campaign_briefs_manage_update on campaign_briefs
  for update using (
    tenant_id = app.current_tenant_id()
    and app.has_permission('projects', 'manage')
    and app.in_write_scope(department_id, null, app.campaign_account_manager(campaign_id))
    and approved_at is null
  ) with check (
    tenant_id = app.current_tenant_id()
    and app.has_permission('projects', 'manage')
    and app.in_write_scope(department_id, null, app.campaign_account_manager(campaign_id))
    and approved_at is null
  );

comment on policy campaign_briefs_manage_update on campaign_briefs is
  'I51.3 / ADR-0070 addendum: projects:manage IN SCOPE, and only while unapproved. An approved '
  'brief is changed by re-opening it (reopen_department_brief) — recorded — then editing, then '
  'approving again.';

-- Re-opening: the same authority as approving (ADR-0070 d.2/d.3 — the department's leads by scope,
-- the account manager, and the two roles that carry the agency). Idempotent on an unapproved brief.
-- Logged as its own action, not as a column change, so the audit reads "re-opened" rather than
-- "approved_at: null".
create or replace function public.reopen_department_brief(p_brief uuid)
returns void
language plpgsql
security definer
set search_path = public, app, extensions as $$
declare
  v campaign_briefs;
begin
  select * into v from campaign_briefs
   where id = p_brief and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'campaign brief % not found', p_brief using errcode = 'P0002';
  end if;

  if not (app.has_permission('briefs', 'approve')
          and app.in_write_scope(v.department_id, null,
                                 app.campaign_account_manager(v.campaign_id))) then
    raise exception 're-opening this department''s brief is outside your scope'
      using errcode = '42501';
  end if;

  if v.approved_at is null then
    return;
  end if;

  update campaign_briefs
     set approved_at = null,
         approved_by = null
   where id = p_brief;

  insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
  values (v.tenant_id, auth.uid(), 'department_brief_reopened', 'campaign_briefs', p_brief,
          jsonb_build_object('campaign_id', v.campaign_id, 'department_id', v.department_id,
                             'was_approved_at', v.approved_at, 'was_approved_by', v.approved_by));
end $$;

comment on function public.reopen_department_brief(uuid) is
  'I51.3 / ADR-0070 addendum: clears a department brief''s approval so it can be edited, by whoever '
  'could approve it. Audited as department_brief_reopened. New assignments on its deliverables wait '
  'until it is approved again (d.4).';

revoke all on function public.reopen_department_brief(uuid) from public;
grant execute on function public.reopen_department_brief(uuid) to authenticated;

commit;
