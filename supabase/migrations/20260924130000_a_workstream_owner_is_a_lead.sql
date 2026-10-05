-- I56.4 / ADR-0101 d.8 (Edward, 24 Sep) — a workstream's owner is a department lead, a team lead
-- or a deputy team lead.
--
-- ADR-0099 d.5 let a workstream's owner be anyone. Edward: *"It should allow an owner to be named
-- alongside the department. Eligible owners are dept leads and team leads"*, then *"Deputy team
-- leads included"*, and *"reassignment should be allowed"*.
--
-- A TRIGGER, not a check inside `save_workstream`, because three doors write this table — the
-- workstream RPC, the wizard's one-call submit (`20260924100000`) and anything that comes later —
-- and a rule held in one of them is a rule the others skip. It fires only when an owner is SET or
-- CHANGED: a workstream saved before this rule, whose owner is someone else, keeps that owner until
-- somebody changes it (ADR-0101 consequences). Clearing the owner is always allowed (d.5). Changing
-- it to another eligible person is reassignment, and is allowed.
--
-- SECURITY INVOKER. The caller can already read `user_profiles` and `roles` in their own tenant
-- (`roles_tenant_select`), which is all this needs; no definer, no ADR (AGENTS.md §6).

begin;

create or replace function app.tg_workstream_owner_is_a_lead()
returns trigger
language plpgsql
set search_path = public, app
as $$
begin
  if new.owner_user_id is not null
     and (tg_op = 'INSERT' or new.owner_user_id is distinct from old.owner_user_id)
     and not exists (
       select 1
         from user_profiles p
         join roles r on r.id = p.role_id
        where p.id = new.owner_user_id
          and p.tenant_id = new.tenant_id
          and r.key in ('department_lead', 'team_lead', 'deputy_team_lead')
     )
  then
    raise exception 'A workstream''s owner must be a department lead, a team lead or a deputy team lead.'
      using errcode = '22023', hint = 'workstream_owner';
  end if;
  return new;
end
$$;

comment on function app.tg_workstream_owner_is_a_lead() is
  'ADR-0101 d.8: a workstream owner, when set or changed, is a department lead, team lead or deputy team lead of the same tenant. Clearing is allowed; an older owner stays until changed.';

drop trigger if exists workstream_owner_is_a_lead on workstreams;
create trigger workstream_owner_is_a_lead
  before insert or update of owner_user_id on workstreams
  for each row execute function app.tg_workstream_owner_is_a_lead();

commit;
