-- I52.17 (Edward, 17 Sep) — a campaign's account manager can be changed on its page.
--
-- On production a campaign named the Account Director as its account manager although the client's
-- is Mais, who created it. Nothing could correct it: the wizard writes the field at creation and
-- no surface touches it afterwards, so she could not approve her own campaign and — with the screen
-- offering Approve to the one resolved name only — neither could a Power Admin. The screen half is
-- I52.16 (client). This is the database half: the column gains a rule and a door.
--
-- Who may change it: the campaign's CURRENT account manager (resolved as approval resolves it —
-- coalesce(campaign, client)), or somebody with projects:manage whose reach covers them — the
-- tenant-wide and all-accounts roles: Power Admin, Traffic, Account Director. The same test as
-- app.approve_campaign, on purpose: whoever may approve it may say who approves it.
-- Who may be named: a person holding account_manager:manage (the eligibility grant,
-- 20260823140000), or nobody (null — approval then falls back to the client's manager).
--
-- The shape is ADR-0055's for the owner: the rule is a trigger on the column, so a PATCH is
-- governed exactly as the RPC (ADR-0037); the RPC exists for one call with one clear error.

begin;

create or replace function app.tg_campaign_account_manager_guard() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
declare v_current uuid;
begin
  if new.account_manager_id is not distinct from old.account_manager_id then
    return new;
  end if;
  -- Migrations, seeders and definer paths that stamp the field (the wizard's draft functions).
  if auth.uid() is null or app.is_system_op() then
    return new;
  end if;
  if new.account_manager_id is not null
     and not app.user_has_permission(new.account_manager_id, 'account_manager', 'manage') then
    raise exception 'that person cannot be an account manager (account_manager:manage)' using errcode = '22023';
  end if;
  v_current := app.campaign_account_manager(old.id);
  if app.has_permission('projects', 'manage') and app.in_write_scope(null, null, v_current) then
    return new;
  end if;
  raise exception
    'changing this campaign''s account manager is outside your reach — its account manager, Traffic, an Account Director or a Power Admin can'
    using errcode = '42501';
end $$;

comment on function app.tg_campaign_account_manager_guard() is
  'I52.17: who may change campaigns.account_manager_id — the current manager, or projects:manage '
  'with reach over them (tenant-wide / all-accounts). The named person must hold '
  'account_manager:manage. Held in Postgres so a PATCH and public.set_campaign_account_manager are '
  'governed identically (ADR-0037).';

drop trigger if exists campaign_account_manager_guard on campaigns;
create trigger campaign_account_manager_guard
  before update of account_manager_id on campaigns
  for each row execute function app.tg_campaign_account_manager_guard();

-- SECURITY INVOKER: RLS and the trigger decide.
create or replace function public.set_campaign_account_manager(p_campaign uuid, p_user uuid)
returns void
language plpgsql security invoker
set search_path = public, app, extensions as $$
begin
  update campaigns set account_manager_id = p_user where id = p_campaign;
  if not found then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;
end $$;

comment on function public.set_campaign_account_manager(uuid, uuid) is
  'I52.17: the supported way to change a campaign''s account manager. Adds no authority — '
  'app.tg_campaign_account_manager_guard decides. NULL clears it; approval then falls back to the '
  'client''s manager.';

revoke execute on function public.set_campaign_account_manager(uuid, uuid) from public;
revoke execute on function public.set_campaign_account_manager(uuid, uuid) from anon;
grant  execute on function public.set_campaign_account_manager(uuid, uuid) to authenticated;

commit;
