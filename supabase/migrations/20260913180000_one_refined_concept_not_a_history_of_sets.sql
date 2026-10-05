-- I48.15 (ADR-0065 addendum, 13 Sep) — one refined concept, not a history of sets.
--
-- Edward, testing: *"once a proposed concept is created the user should be able to select delete or
-- keep in individual fields, and if propose another set is selected it should only regenerate those
-- fields that were removed."* This reverses d.8 ("sets accumulate, nothing is overwritten") and
-- d.3's fourth shape:
--
--   d.9  — no content types. Deliverables are already defined on the campaign; the model no longer
--          suggests formats. Existing `content_types` items are dropped from stored proposals.
--   d.10 — ONE working concept per brief, refined in place. Each item can be kept or deleted.
--   d.11 — regeneration fills only what was removed. Deleting an item opens a SLOT in its shape;
--          "Regenerate removed" asks the model for exactly that many new items, with the kept ones
--          as fixed context, and they take the deleted ones' place in the same concept.
--
-- WHAT CHANGES IN THE STORE. `campaign_concepts` was append-only (no UPDATE policy, `revoke update`),
-- because a set was "what the model said" and editing it destroyed the evidence. A working concept
-- is a different thing: it is refined by a person, so it MUST be updatable — but only in the two
-- ways the addendum names. The UPDATE policy is behind `projects:manage` (the same grant that
-- proposes, d.7); the per-item operations go through `campaign_concept_mark_item`, and the
-- regeneration through `propose-concepts` on the caller's client. Every change is audited by
-- `audit_row_change`, which is how the per-press "who/when" the addendum keeps survives without a
-- history of whole sets.
--
-- ITEMS CARRY AN ID. Keep/delete addresses an item; position in an array is not an address once
-- items can be removed. Existing items are given one here.
--
-- EXISTING SETS COLLAPSE TO THE NEWEST. Older sets per brief are deleted (d.10: there is one
-- concept). They were proposals, never approved content, and the addendum says the history "is
-- not" kept. Their audit rows remain.
--
-- Tests: supabase/tests/078_campaign_concepts.sql (amended) and 113_one_refined_concept.sql

begin;

-- ============================================================================
-- 1) collapse to one concept per brief, drop content types, give items an id
-- ============================================================================
delete from campaign_concepts c
 where exists (
   select 1 from campaign_concepts newer
    where newer.campaign_brief_id = c.campaign_brief_id
      and (newer.created_at > c.created_at or (newer.created_at = c.created_at and newer.id > c.id))
 );

update campaign_concepts c
   set proposals = coalesce((
     select jsonb_agg(
              case when item ? 'id' then item
                   else item || jsonb_build_object('id', gen_random_uuid()::text) end
              order by ord)
       from jsonb_array_elements(c.proposals) with ordinality as e(item, ord)
      where item ->> 'shape' <> 'content_types'
   ), '[]'::jsonb);

alter table campaign_concepts
  add constraint uq_campaign_concepts_one_per_brief unique (campaign_brief_id);

-- ============================================================================
-- 2) the slots opened by deletions, and the regeneration stamp
-- ============================================================================
alter table campaign_concepts
  add column slots           jsonb not null default '{}'::jsonb
    check (jsonb_typeof(slots) = 'object'),
  add column regenerated_at  timestamptz,
  add column regenerated_by  uuid,
  add column regenerations   integer not null default 0 check (regenerations >= 0),
  add column updated_at      timestamptz not null default now();

-- Named, so the frontend can embed it by constraint (`user_profiles!campaign_concepts_regenerated_by_fkey`)
-- — this table now has TWO paths to user_profiles, and an unnamed embed silently returns nothing
-- (traps.md).
alter table campaign_concepts
  add constraint campaign_concepts_regenerated_by_fkey foreign key (regenerated_by) references user_profiles(id);

comment on table campaign_concepts is
  'ADR-0065 + addendum (13 Sep): the ONE working concept proposed against a department brief, '
  'refined in place — items are kept or deleted (d.10), and regeneration fills only the slots the '
  'deletions opened (d.11). Never part of the brief itself (d.6). Audited row-by-row.';
comment on column campaign_concepts.proposals is
  'ADR-0065 d.3/d.4 minus content types (addendum d.9): strategic thinking, creative direction and '
  'pillars, each with an `id`, the brief field keys it answers, and `kept: true` once a person '
  'confirmed it. A proposal answering nothing is kept and marked at render time (d.5).';
comment on column campaign_concepts.slots is
  'Addendum d.11: {shape: count} of items deleted since the last regeneration — what "Regenerate '
  'removed" asks the model to fill. Reset to {} when it does.';

create trigger set_updated_at before update on campaign_concepts
  for each row execute function app.set_updated_at();

-- ============================================================================
-- 3) the update policy — the grant that proposes may refine (d.7 / d.10)
-- ============================================================================
create policy campaign_concepts_manage_update on campaign_concepts
  for update using (
    tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage')
  ) with check (
    tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage')
  );
grant update on campaign_concepts to authenticated;

-- A regeneration is stamped from auth.uid() when the proposals change through it, never from the
-- payload — the same rule as `requested_by`.
create or replace function app.tg_campaign_concept_stamp_regeneration()
returns trigger language plpgsql security invoker
set search_path = public, app, extensions as $$
begin
  if new.regenerations > old.regenerations then
    new.regenerated_at := now();
    new.regenerated_by := auth.uid();
  end if;
  return new;
end $$;

create trigger campaign_concept_stamp_regeneration
  before update on campaign_concepts
  for each row execute function app.tg_campaign_concept_stamp_regeneration();

-- ============================================================================
-- 4) keep / delete one item (d.10)
-- ============================================================================
-- 'keep' marks the item confirmed. 'delete' removes it and opens a slot in its shape (d.11). Runs
-- under the caller's own rights: the UPDATE policy above decides, and RLS hides a concept the
-- caller cannot see, which reads as not found.
create or replace function public.campaign_concept_mark_item(
  p_concept uuid,
  p_item_id text,
  p_action  text
) returns void
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_item  jsonb;
  v_shape text;
begin
  if p_action not in ('keep', 'delete') then
    raise exception using errcode = 'check_violation', message = 'action must be keep or delete';
  end if;

  select item into v_item
    from campaign_concepts c, jsonb_array_elements(c.proposals) as item
   where c.id = p_concept and item ->> 'id' = p_item_id;
  if v_item is null then
    raise exception using errcode = 'no_data_found', message = 'that concept item was not found';
  end if;

  if p_action = 'keep' then
    update campaign_concepts c
       set proposals = (
         select jsonb_agg(case when item ->> 'id' = p_item_id then item || '{"kept": true}'::jsonb else item end order by ord)
           from jsonb_array_elements(c.proposals) with ordinality as e(item, ord))
     where c.id = p_concept;
  else
    v_shape := v_item ->> 'shape';
    update campaign_concepts c
       set proposals = coalesce((
             select jsonb_agg(item order by ord)
               from jsonb_array_elements(c.proposals) with ordinality as e(item, ord)
              where item ->> 'id' <> p_item_id), '[]'::jsonb),
           slots = c.slots || jsonb_build_object(v_shape, coalesce((c.slots ->> v_shape)::int, 0) + 1)
     where c.id = p_concept;
  end if;

  if not found then
    raise exception using errcode = 'insufficient_privilege', message = 'you cannot change this concept';
  end if;
end $$;

comment on function public.campaign_concept_mark_item(uuid, text, text) is
  'ADR-0065 addendum d.10/d.11: keep confirms an item; delete removes it and opens a slot in its '
  'shape for "Regenerate removed" to fill.';

revoke execute on function public.campaign_concept_mark_item(uuid, text, text) from public, anon;
grant  execute on function public.campaign_concept_mark_item(uuid, text, text) to authenticated;

commit;
