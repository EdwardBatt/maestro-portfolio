-- I68.2 / ADR-0132 d.2: a piece's channel, language and brief lines are edited on the campaign page's panel.
--
-- Nothing wrote them after the brief: `update_campaign_deliverable` takes name, type and quantity, and the wizard's
-- `write_campaign_content` is the only other writer. The brief lines are the piece's `notes` — the brief's own words
-- kept against the piece (ADR-0097 d.2).
--
-- SECURITY INVOKER, as `update_campaign_deliverable`: the caller's own RLS applies. `app.tg_deliverable_edit_guard`
-- guards name, type and quantity only, and `deliverables_reviewer_update` lets a designated reviewer write the row, so
-- this function asks the guard's own question itself — the owner, the account manager, or `project_tasks:manage` with
-- reach over the piece's department and account manager — rather than letting a reviewer rewrite the brief lines.
--
-- A piece's language is one of its campaign's languages (ADR-0117 d.7) when the campaign has any; empty clears it.

create or replace function public.update_piece_details(
  p_deliverable uuid,
  p_channel     text,
  p_language    text,
  p_notes       text
) returns void
language plpgsql security invoker
set search_path = public, app, extensions as $$
declare
  d      deliverables;
  v_am   uuid;
  v_langs text[];
begin
  select * into d from deliverables where id = p_deliverable and tenant_id = app.current_tenant_id();
  if d.id is null then
    raise exception 'deliverable not found' using errcode = 'P0002';
  end if;

  v_am := app.deliverable_account_manager(d.id);
  -- coalesce: a piece with no owner or no account manager makes those comparisons NULL, and NOT NULL is not true —
  -- without it the refusal below never fires for anybody on such a piece (found by pgTAP 204).
  if not coalesce(d.owner_user_id = auth.uid()
          or v_am = auth.uid()
          or (app.has_permission('project_tasks', 'manage') and app.in_write_scope(d.department_id, null, v_am)), false) then
    raise exception
      'editing this deliverable is outside your reach — its owner, its department''s leads or the account manager can'
      using errcode = '42501';
  end if;

  select c.languages into v_langs
    from streams s join campaigns c on c.id = s.campaign_id
   where s.id = d.stream_id;
  if nullif(trim(p_language), '') is not null
     and coalesce(array_length(v_langs, 1), 0) > 0
     and not (trim(p_language) = any (v_langs)) then
    raise exception 'that language is not one this campaign is made in — add it to the campaign first'
      using errcode = '22023';
  end if;

  update deliverables
     set channel  = nullif(trim(p_channel), ''),
         language = nullif(trim(p_language), ''),
         notes    = nullif(trim(p_notes), '')
   where id = d.id;
end $$;

comment on function public.update_piece_details(uuid, text, text, text) is
  'I68.2 / ADR-0132 d.2: a piece''s channel, language (one of the campaign''s) and brief lines (notes). Invoker; the '
  'edit guard''s own authority — owner, account manager, or project_tasks:manage with reach.';

revoke execute on function public.update_piece_details(uuid, text, text, text) from public, anon;
grant  execute on function public.update_piece_details(uuid, text, text, text) to authenticated;
