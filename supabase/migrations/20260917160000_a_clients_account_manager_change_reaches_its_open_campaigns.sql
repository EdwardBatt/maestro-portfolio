-- I52.19 (Edward, 17 Sep) — when a client's account manager changes, its open campaigns follow.
--
-- Edward: "it needs to propagate automatically — this was working yesterday." It was, by
-- accident: until ADR-0073 d.5 made the wizard's account-manager field required, campaigns carried
-- NO manager of their own and app.campaign_account_manager fell back to the client's for every one
-- of them — change the client, every campaign followed. Once every row carries its own value the
-- fallback never fires, and a change on the client reaches nothing. Nothing was changed to break
-- it; the required field quietly made it impossible.
--
-- The rule now: a change of `clients.account_manager_id` moves every campaign of that client that
-- (a) is not closed and (b) named the OLD manager — or nobody — onto the new one. A campaign that
-- was deliberately given a DIFFERENT manager (the field is editable, "a campaign often runs under
-- somebody other than the client's usual AM") keeps that person: the change was about the client's
-- usual manager, not about every arrangement ever made. Closed campaigns keep their record.
--
-- Written as a system operation so the per-campaign guard (20260917140000) does not re-test the
-- caller's reach against each row: whoever may change the client's manager has already been let
-- through by the clients policy, and this is the consequence of that one act.

begin;

create or replace function app.tg_client_account_manager_propagates() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
begin
  if new.account_manager_id is not distinct from old.account_manager_id then
    return new;
  end if;
  perform set_config('app.system_op', 'on', true);
  update campaigns c
     set account_manager_id = new.account_manager_id
   where c.client_id = new.id
     and c.tenant_id = new.tenant_id
     and c.status <> 'closed'
     and (c.account_manager_id is null or c.account_manager_id = old.account_manager_id);
  perform set_config('app.system_op', 'off', true);
  return new;
end $$;

comment on function app.tg_client_account_manager_propagates() is
  'I52.19: a change of the client''s account manager moves every open campaign that named the old '
  'manager (or nobody) onto the new one. A campaign given a different manager on purpose keeps it; '
  'closed campaigns keep their record.';

drop trigger if exists client_account_manager_propagates on clients;
create trigger client_account_manager_propagates
  after update of account_manager_id on clients
  for each row execute function app.tg_client_account_manager_propagates();

commit;
