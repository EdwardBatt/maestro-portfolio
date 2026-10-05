-- The reorder refusal joins the family: it names the PERSON, and it translates (I54.20).
--
-- `20260923100000` (an hour earlier, I54.18) gave it the right words and the right shape for a
-- reader of English — but it built the whole sentence in the database, and that is a sentence no
-- Arabic reader can ever be shown. The other eight, written straight afterwards, send `detail` (the
-- names) and `hint` (the action) instead and let the client compose in the reader's own language.
--
-- Edward's standing rule is English and Arabic, always. So this brings the first one into line
-- rather than leaving one refusal in the set that only half works. Forward-only: `20260923100000`
-- stays exactly as it was written.

begin;

CREATE OR REPLACE FUNCTION public.resequence_deliverable_tasks(p_deliverable uuid, p_ordered_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
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
    raise exception 'You cannot reorder this list: it is outside your reach.%',
            app.refusal_ask(app.refusal_names_deliverable_owner(p_deliverable))
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_owner(p_deliverable), ''''),
            hint = 'reorder_tasks';
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
end $function$;

commit;
