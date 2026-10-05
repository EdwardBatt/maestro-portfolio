-- Feedback triage (resolve + action-taken note). A Power Admin can mark a
-- feedback item resolved and record what action was taken. Adds a new admin
-- ability `admin.feedback:manage` (deny-by-default, ADR-0008) — auto-granted to
-- every tenant's Power Admin via the catalog-insert trigger + whole-catalog seed
-- — and the table's first UPDATE policy, gated on that ability. Feedback content
-- stays immutable: a BEFORE-UPDATE guard freezes the original submission and
-- stamps the resolver server-side (never client-attributed), mirroring the
-- actor-pin on insert. Reading is unchanged (admin.feedback:view). [alpha-feedback]

create type feedback_status as enum ('open', 'resolved');

alter table app_feedback
  add column status          feedback_status not null default 'open',
  add column resolution_note text,
  add column resolved_by     uuid references user_profiles(id),
  add column resolved_at     timestamptz,
  add constraint chk_app_feedback_resolution_note_len
    check (resolution_note is null or char_length(btrim(resolution_note)) between 1 and 4000);

create index idx_app_feedback_status on app_feedback (status);

-- New admin ability: triage (resolve / record action taken). Inserting this
-- catalog row auto-grants it to every existing tenant's Power Admin via the
-- ADR-0008 catalog-insert trigger; Power Admin's whole-catalog seed covers
-- future tenants. No starter role gets it, so seed_tenant_roles needs no edit.
insert into permission_catalog (resource, action, description) values
  ('admin.feedback', 'manage', 'Admin: triage product feedback (resolve, record action taken)')
on conflict do nothing;

-- Triage write: the sole UPDATE policy. Row access is granted to
-- admin.feedback:manage holders in the caller's tenant; column-level integrity
-- (only triage fields change, resolver pinned to the actor) is enforced by the
-- guard trigger below rather than a WITH CHECK that cannot see OLD.
create policy app_feedback_admin_update on app_feedback
  for update to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('admin.feedback', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('admin.feedback', 'manage'));

-- Guard: the submission (content + provenance) is frozen after insert; only the
-- triage fields may move. The resolver identity and timestamp are stamped
-- server-side from the request's auth context — the client cannot attribute a
-- resolution to someone else, and re-saving an already-resolved item (e.g. to
-- edit the note) preserves the original resolved_at.
create or replace function app.guard_feedback_triage() returns trigger
  language plpgsql security definer set search_path = public, app as $$
begin
  if new.tenant_id      is distinct from old.tenant_id
     or new.submitted_by is distinct from old.submitted_by
     or new.category     is distinct from old.category
     or new.message      is distinct from old.message
     or new.page_path    is distinct from old.page_path
     or new.app_version  is distinct from old.app_version
     or new.created_at   is distinct from old.created_at then
    raise exception 'app_feedback: only triage fields (status, resolution_note) are mutable';
  end if;

  if new.status = 'resolved' then
    if old.status is distinct from 'resolved' then
      new.resolved_at := now();
    end if;
    new.resolved_by := auth.uid();
  else
    -- Reopened (or never resolved): clear the resolution entirely.
    new.status := 'open';
    new.resolved_by := null;
    new.resolved_at := null;
    new.resolution_note := null;
  end if;
  return new;
end;
$$;

-- Fires before app.set_updated_at() (alphabetical: guard_… < set_updated_at);
-- both only touch NEW, so ordering is immaterial to correctness.
create trigger guard_feedback_triage before update on app_feedback
  for each row execute function app.guard_feedback_triage();
