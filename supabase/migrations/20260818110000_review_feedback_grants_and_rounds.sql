-- ADR-0025 (I3.2, §5/§7): review_feedback — server-stamp `round` and `source`, and move the
-- write policies off the pre-ADR-0008 jwt_role check to grant-driven RLS.
--
--   * `round` is derived from the parent deliverable's revision_round (+1, 1-based), so review
--     rounds line up with I1's revision loop automatically — the client never sets it.
--   * `source` is forced to 'internal' this phase; the 'client' capture-at-source path arrives
--     with the portal (M10) through its own privileged route.
--
-- Reads stay tenant-wide; audit is already universal on this table (20260802103000).

-- 1) round + source stamping ------------------------------------------------
create or replace function app.tg_review_feedback_set_round()
returns trigger language plpgsql as $$
declare v_round integer;
begin
  select d.revision_round into v_round
    from media_records m
    join deliverables d on d.id = m.deliverable_id
   where m.id = new.media_record_id;
  new.round := coalesce(v_round, 0) + 1;   -- 1-based: first pass (revision_round 0) → round 1
  new.source := 'internal';                -- internal-only this phase (client source = M10)
  return new;
end $$;
comment on function app.tg_review_feedback_set_round() is
  'ADR-0025: BEFORE INSERT — stamp review_feedback.round = deliverable.revision_round + 1 and force source = internal. Client never sets either.';

create trigger review_feedback_set_round
  before insert on review_feedback
  for each row execute function app.tg_review_feedback_set_round();

-- 2) grant-driven policies (retire jwt_role) --------------------------------
-- Insert: any internal user may comment on their own behalf (reads are tenant-wide, so review is
-- collaborative); the row must be internal and authored by the caller.
drop policy review_feedback_tenant_insert on review_feedback;
create policy review_feedback_internal_insert on review_feedback
  for insert to authenticated
  with check (
    tenant_id = app.current_tenant_id()
    and author_user_id = auth.uid()
    and source = 'internal'
  );

-- Update (resolve / edit): the author, or anyone holding reviews:moderate (leads).
drop policy review_feedback_author_update on review_feedback;
create policy review_feedback_resolve_update on review_feedback
  for update to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and (author_user_id = auth.uid() or app.has_permission('reviews', 'moderate'))
  )
  with check (tenant_id = app.current_tenant_id());
