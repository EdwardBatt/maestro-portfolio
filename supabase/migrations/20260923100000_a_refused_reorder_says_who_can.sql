-- A refused reorder says WHO can do it, in the same words as every other refusal (I54.18).
--
-- Edward, 23 Sep: *"Error messages must be explicit, they should state who to contact if they need
-- a task reordered."*
--
-- Two faults in one sentence, both exposed rather than caused by I53.28 (22 Sep), which stopped the
-- dialog INVENTING a refusal for any 42501 and made it show the server's own words:
--
--   1. It said "outside your **scope**" where every other refusal in the product says "outside your
--      **reach**" — two words for one idea, and it is the SAME check underneath
--      (`app.in_write_scope`), so there was never a distinction to carry.
--   2. It named nobody. The person is stopped and has nowhere to go, so they ask in a chat or give
--      up. Compare `deliverables.outsideReach`, which has always named who can.
--
-- Who actually can, for any one list: the campaign's own account manager (every department on that
-- campaign), the deliverable's department lead, a team leader over that team, the Account Director,
-- Traffic, or a Power Admin. The message names the three a maker would reasonably go to; listing all
-- six would be a paragraph, and the first three cover every real case.
--
-- **Nothing about the rule changes** — only the sentence. The function is reproduced whole because
-- migrations are forward-only: `20260828230000` stays as it was written.

begin;

create or replace function public.resequence_deliverable_tasks(
  p_deliverable uuid,
  p_ordered_ids uuid[]
) returns integer
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant  uuid := app.current_tenant_id();
  v_dept    uuid;
  v_team    uuid;
  v_updated integer;
begin
  if not exists (select 1 from deliverables d where d.id = p_deliverable and d.tenant_id = v_tenant) then
    raise exception 'deliverable % not found', p_deliverable using errcode = 'P0002';
  end if;

  -- Authority is judged on the deliverable, not on each task: reordering is one act on one list.
  select d.department_id, null::uuid into v_dept, v_team
    from deliverables d where d.id = p_deliverable;
  if not (app.has_permission('project_tasks', 'manage')
          and app.in_write_scope(v_dept, v_team, app.deliverable_account_manager(p_deliverable))) then
    -- The words the person reads. Kept in step with `deliverables.outsideReach` in the locales:
    -- the surface shows this verbatim (I53.28), so this IS the copy, not a developer's note.
    raise exception 'You cannot reorder this list: it is outside your reach. The campaign''s account manager, the department lead, or Traffic can.'
      using errcode = '42501';
  end if;

  -- d.14: sort_order and NOTHING else. No starts_at, no due_at. Order is presentation; a schedule
  -- is a commitment somebody has made, and rearranging a list must never quietly move it.
  update sub_tasks st
     set sort_order = ord.n
    from unnest(p_ordered_ids) with ordinality as ord(id, n)
   where st.id = ord.id
     and st.deliverable_id = p_deliverable
     and st.tenant_id = v_tenant;

  get diagnostics v_updated = row_count;
  return v_updated;
end $$;

comment on function public.resequence_deliverable_tasks(uuid, uuid[]) is
  'ADR-0052 d.14: set the presentation order of a deliverable''s tasks. Touches sort_order ONLY — '
  'never starts_at or due_at. Ids that do not belong to this deliverable are ignored rather than '
  'moved, so a stale list from another screen cannot reorder somebody else''s work. I54.18: the '
  'refusal names who CAN, in the same words as every other refusal, because the surface shows it '
  'verbatim.';

revoke execute on function public.resequence_deliverable_tasks(uuid, uuid[]) from public, anon;
grant execute on function public.resequence_deliverable_tasks(uuid, uuid[]) to authenticated;

commit;
