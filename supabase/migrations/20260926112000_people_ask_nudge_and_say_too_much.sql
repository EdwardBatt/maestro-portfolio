-- ADR-0113 (Edward, 25 Sep; I59.25, I59.26) — until chat works, people ask, nudge and say "too much"
-- by notification and email, and each is recorded against the piece.
--
--   d.1  A NUDGE is a notification (and so an email, notify-email) to one named person about a piece,
--        recorded here. It stops no clock.
--   d.2  A QUESTION goes to the people the asker picks (anyone in the tenant — the picker orders the
--        piece's people first and pre-selects the account manager; that is the screen's job). A
--        recipient REPLIES; the reply goes back to the asker. Questions and replies are listed on
--        the piece (a plain select on this table).
--   d.3  TOO MUCH is raised by the task's ASSIGNEE, to whoever assigned it (`sub_tasks.assigned_by`),
--        with the maker's week and an optional note; answered Rebalance or Keep it with her by that
--        assigner only, and the maker is told. The task stays assigned.
--   d.5  Chat (ADR-0027) is not the carrier (`I59.40`); these rows stay when it is.
--
-- THE MAKER'S WEEK is computed here the way `useMyLoad` computes it for My Work, so the assigner
-- sees the same figure the maker does:
--   src/features/team/api/team-api.ts  38-44   the week: Sunday 00:00 → next Sunday 00:00, local;
--                                      46      NOMINAL_DAY_HOURS = 8;
--                                      201-233 the person's first human resource; nominal hours =
--                                              (office working days, else 5) × 8; booked hours =
--                                              the sum of each booking's hours, to 0.1; util % =
--                                              round(booked / nominal × 100); level by the
--                                              resource's warn / ceiling (100 / 120 by default).
--   src/features/bookings/api/bookings-api.ts 105 (ACTIVE_STATES soft_hold, tentative, confirmed),
--                                      135-152 (the person's bookings overlapping the week — the
--                                              WHOLE booking's hours, not clipped), 78 (hoursBetween,
--                                              to 0.1).
-- "Local" in the browser is the reader's clock; here it is the maker's office time zone, falling
-- back to Asia/Baghdad (ADR-0076) — a question if the two are meant to differ.
--
-- READ is tenant-wide — the same rule as `campaign_brief_receipts_tenant_select` and
-- `task_time_entries_tenant_select`, the other per-piece records. WRITE (the RLS policies, and the
-- RPCs re-asking the SAME function, `app.piece_message_may_insert`): the author is the signed-in
-- user; a reply only by a recipient of its question; too_much only by the task's assignee; a
-- too_much answered only by the task's assigner. Content is immutable after insert.
--
-- SECURITY DEFINER, with the reason (AGENTS.md §6): the RPCs write `notifications` (no client insert
-- policy) and the reply stamps its question's answered_by/at; each RPC decides with the same
-- predicate the policies use. search_path pinned on every function.
--
-- Tests: supabase/tests/167_people_ask_nudge_and_say_too_much.sql,
--        supabase/tests/168_running_the_week_records_stay_in_their_tenant.sql

begin;

-- ============================================================================
-- 1) the record
-- ============================================================================
create table piece_messages (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  -- the piece. A too_much on an ad-hoc task (no deliverable) carries the task alone.
  deliverable_id uuid references deliverables(id),
  sub_task_id    uuid references sub_tasks(id),
  kind           text not null
                 constraint chk_piece_messages_kind check (kind in ('question', 'reply', 'nudge', 'too_much')),
  parent_id      uuid references piece_messages(id),
  author_id      uuid not null references user_profiles(id),
  body           text,
  recipients     uuid[] not null default '{}',
  status         text
                 constraint chk_piece_messages_status check (status in ('open', 'rebalanced', 'kept')),
  answered_by    uuid,
  answered_at    timestamptz,
  created_by     uuid,
  updated_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint chk_piece_messages_has_piece check (deliverable_id is not null or sub_task_id is not null),
  constraint chk_piece_messages_reply_has_parent check ((kind = 'reply') = (parent_id is not null)),
  constraint chk_piece_messages_status_only_too_much check ((kind = 'too_much') = (status is not null)),
  constraint chk_piece_messages_too_much_is_a_task check (kind <> 'too_much' or sub_task_id is not null),
  constraint chk_piece_messages_has_recipients
    check (kind = 'too_much' or cardinality(recipients) > 0),
  constraint chk_piece_messages_words
    check (kind not in ('question', 'reply') or length(trim(coalesce(body, ''))) > 0)
);

create index idx_piece_messages_tenant_id   on piece_messages (tenant_id);
create index idx_piece_messages_deliverable on piece_messages (deliverable_id);
create index idx_piece_messages_sub_task    on piece_messages (sub_task_id);
create index idx_piece_messages_parent      on piece_messages (parent_id);
create index idx_piece_messages_recipients  on piece_messages using gin (recipients);
-- One open "too much" per task: a second press while the first is unanswered adds nothing.
create unique index uq_piece_messages_open_too_much
  on piece_messages (sub_task_id) where kind = 'too_much' and status = 'open';

comment on table piece_messages is
  'ADR-0113: questions, replies, nudges and "too much" about a piece, carried by notification and '
  'email while chat is not usable (I59.40). Read tenant-wide; written by the author, under '
  'app.piece_message_may_insert; content immutable; a too_much answered by the task''s assigner.';

grant select, insert, update on table public.piece_messages to authenticated;
-- Anonymous callers have no business here at all (Supabase's default privileges would grant them).
revoke all on table public.piece_messages from anon;

alter table piece_messages enable row level security;
alter table piece_messages force row level security;

-- ============================================================================
-- 2) who may write — ONE predicate, read by the policy and by every RPC
-- ============================================================================
create or replace function app.piece_message_may_insert(
  p_kind        text,
  p_parent      uuid,
  p_deliverable uuid,
  p_sub_task    uuid
) returns boolean
language plpgsql stable security definer
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_task   sub_tasks%rowtype;
begin
  if auth.uid() is null or v_tenant is null then return false; end if;
  -- the piece is in the caller's tenant
  if p_deliverable is not null
     and not exists (select 1 from deliverables d where d.id = p_deliverable and d.tenant_id = v_tenant) then
    return false;
  end if;
  if p_sub_task is not null then
    select * into v_task from sub_tasks st where st.id = p_sub_task and st.tenant_id = v_tenant;
    if not found then return false; end if;
    if p_deliverable is not null and v_task.deliverable_id is distinct from p_deliverable then
      return false;
    end if;
  end if;

  if p_kind in ('question', 'nudge') then
    return p_deliverable is not null or p_sub_task is not null;
  elsif p_kind = 'reply' then
    return exists (select 1 from piece_messages q
                    where q.id = p_parent and q.tenant_id = v_tenant and q.kind = 'question'
                      and auth.uid() = any (q.recipients));
  elsif p_kind = 'too_much' then
    return p_sub_task is not null and v_task.assignee_id = auth.uid();
  end if;
  return false;
end $$;

comment on function app.piece_message_may_insert(text, uuid, uuid, uuid) is
  'ADR-0113: whether the caller may write a piece message of this kind — a question or nudge about a '
  'piece in their tenant; a reply only to a question they received; a too_much only on a task '
  'assigned to them. The insert policy and the RPCs ask this, and nothing else.';

revoke execute on function app.piece_message_may_insert(text, uuid, uuid, uuid) from public, anon;
grant  execute on function app.piece_message_may_insert(text, uuid, uuid, uuid) to authenticated;

-- Whether the caller may answer a too_much: the task's assigner.
create or replace function app.piece_message_may_answer(p_message uuid) returns boolean
language sql stable security definer
set search_path = public, app, extensions as $$
  select exists (
    select 1 from piece_messages m join sub_tasks st on st.id = m.sub_task_id
     where m.id = p_message and m.tenant_id = app.current_tenant_id()
       and m.kind = 'too_much' and st.assigned_by = auth.uid())
$$;

revoke execute on function app.piece_message_may_answer(uuid) from public, anon;
grant  execute on function app.piece_message_may_answer(uuid) to authenticated;

create policy piece_messages_tenant_select on piece_messages
  for select to authenticated
  using (tenant_id = app.current_tenant_id());

create policy piece_messages_author_insert on piece_messages
  for insert to authenticated
  with check (
    tenant_id = app.current_tenant_id()
    and author_id = auth.uid()
    and app.piece_message_may_insert(kind, parent_id, deliverable_id, sub_task_id)
    and (kind <> 'too_much' or status = 'open')
  );

create policy piece_messages_assigner_update on piece_messages
  for update to authenticated
  using (tenant_id = app.current_tenant_id() and app.piece_message_may_answer(id))
  with check (tenant_id = app.current_tenant_id() and app.piece_message_may_answer(id));

-- No delete policy, and none may be added: the record is the point.
revoke delete on piece_messages from authenticated, anon;

-- Content is immutable; only an answer is written after insert.
create or replace function app.tg_piece_message_guard() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if app.is_system_op() then return new; end if;
  if new.tenant_id is distinct from old.tenant_id or new.deliverable_id is distinct from old.deliverable_id
     or new.sub_task_id is distinct from old.sub_task_id or new.kind is distinct from old.kind
     or new.parent_id is distinct from old.parent_id or new.author_id is distinct from old.author_id
     or new.body is distinct from old.body or new.recipients is distinct from old.recipients
     or new.created_at is distinct from old.created_at then
    raise exception 'a message is not edited after it is sent' using errcode = '42501';
  end if;
  if new.kind = 'too_much' then
    if new.status is distinct from old.status then
      if old.status <> 'open' or new.status not in ('rebalanced', 'kept') then
        raise exception 'this has already been answered' using errcode = '55000';
      end if;
      -- the answer is stamped, never typed
      new.answered_by := auth.uid();
      new.answered_at := now();
    elsif new.answered_by is distinct from old.answered_by or new.answered_at is distinct from old.answered_at then
      raise exception 'an answer is recorded by answering' using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status then
    raise exception 'only a "too much" is answered' using errcode = '22023';
  elsif (new.answered_by is distinct from old.answered_by or new.answered_at is distinct from old.answered_at)
        and old.answered_at is not null then
    -- a question's first reply is recorded once (reply_to_question), and then stands
    raise exception 'a message is not edited after it is sent' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger piece_message_guard
  before update on piece_messages
  for each row execute function app.tg_piece_message_guard();

create trigger set_updated_at before update on piece_messages
  for each row execute function app.set_updated_at();

create trigger set_actor_columns
  before insert or update on piece_messages
  for each row execute function app.set_actor_columns();

create trigger audit_row_change
  after insert or update or delete on piece_messages
  for each row execute function app.audit_row_change();

-- ============================================================================
-- 3) the maker's week — the SQL twin of useMyLoad (see the header for the lines)
-- ============================================================================
create or replace function app.person_week_load(p_user uuid) returns jsonb
language plpgsql stable security definer
set search_path = public, app, extensions as $$
declare
  v_res     resources%rowtype;
  v_tz      text;
  v_days    integer;
  v_today   date;
  v_sun     date;
  v_start   timestamptz;
  v_end     timestamptz;
  v_booked  numeric := 0;
  v_count   integer := 0;
  v_nominal numeric;
  v_util    integer := 0;
  v_level   text := 'ok';
begin
  select * into v_res from resources r
   where r.user_id = p_user and r.kind = 'human' and r.tenant_id = app.current_tenant_id()
   order by r.created_at, r.id
   limit 1;

  select o.timezone, cardinality(o.working_days) into v_tz, v_days
    from offices o where o.id = v_res.office_id;
  v_tz := coalesce(nullif(v_tz, ''), 'Asia/Baghdad');

  v_today := (now() at time zone v_tz)::date;
  v_sun   := v_today - extract(dow from v_today)::integer;          -- team-api.ts 39-40
  v_start := v_sun::timestamp at time zone v_tz;
  v_end   := (v_sun + 7)::timestamp at time zone v_tz;              -- team-api.ts 41

  if v_res.id is null then                                           -- team-api.ts 211-212
    return jsonb_build_object('has_resource', false, 'week_start', v_start, 'week_end', v_end,
                              'booked_hours', 0, 'booking_count', 0, 'nominal_hours', 0,
                              'util_pct', 0, 'level', 'ok');
  end if;

  select coalesce(sum(round(extract(epoch from (b.ends_at - b.starts_at)) / 3600.0, 1)), 0), count(*)
    into v_booked, v_count
    from bookings b
   where b.resource_id in (select r.id from resources r where r.user_id = p_user)   -- bookings-api 143
     and b.state in ('soft_hold', 'tentative', 'confirmed')                          -- bookings-api 105
     and b.starts_at < v_end and b.ends_at > v_start;                                -- bookings-api 145-146
  v_booked  := round(v_booked, 1);                                                   -- team-api.ts 215
  v_nominal := (case when v_res.office_id is null then 5 else coalesce(v_days, 0) end) * 8;   -- 214
  if v_nominal > 0 then v_util := round(v_booked / v_nominal * 100); end if;                 -- 216
  v_level := case when v_util >= coalesce(v_res.load_ceiling_pct, 120) then 'over'           -- 223, 53-55
                  when v_util >= coalesce(v_res.warn_at_pct, 100) then 'warn'
                  else 'ok' end;

  return jsonb_build_object('has_resource', true, 'week_start', v_start, 'week_end', v_end,
                            'booked_hours', v_booked, 'booking_count', v_count,
                            'nominal_hours', v_nominal, 'util_pct', v_util, 'level', v_level);
end $$;

comment on function app.person_week_load(uuid) is
  'ADR-0113 d.3: a person''s week as My Work''s "Your week" shows it (useMyLoad, team-api.ts 201-233) '
  '— booked hours of their active bookings overlapping this Sunday-to-Sunday week in their office''s '
  'zone, over (working days × 8). Called only by say_too_much.';

revoke execute on function app.person_week_load(uuid) from public, anon, authenticated;

-- ============================================================================
-- 4) the RPCs
-- ============================================================================
-- The label a notification carries: the task's title, or the deliverable's name.
create or replace function app.piece_message_label(p_deliverable uuid, p_sub_task uuid) returns text
language sql stable security definer
set search_path = public, app, extensions as $$
  select coalesce((select st.title from sub_tasks st where st.id = p_sub_task),
                  (select d.name from deliverables d where d.id = p_deliverable))
$$;
revoke execute on function app.piece_message_label(uuid, uuid) from public, anon, authenticated;

-- d.2 — ask the people you pick.
create or replace function public.ask_question(
  p_deliverable uuid,
  p_sub_task    uuid,
  p_recipients  uuid[],
  p_body        text
) returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := auth.uid();
  v_deliv  uuid := p_deliverable;
  v_to     uuid[];
  v_id     uuid;
  v_label  text;
begin
  if p_sub_task is not null and v_deliv is null then
    select st.deliverable_id into v_deliv from sub_tasks st where st.id = p_sub_task and st.tenant_id = v_tenant;
  end if;
  if not app.piece_message_may_insert('question', null, v_deliv, p_sub_task) then
    raise exception 'that piece is not in your organization' using errcode = '42501';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'write your question' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct u.id), '{}') into v_to
    from unnest(coalesce(p_recipients, '{}')) as r(id)
    join user_profiles u on u.id = r.id and u.tenant_id = v_tenant
   where u.id <> v_actor;
  if cardinality(v_to) = 0 then
    raise exception 'pick who the question goes to' using errcode = '22023';
  end if;
  if cardinality(v_to) < (select count(distinct x) from unnest(p_recipients) x where x <> v_actor) then
    raise exception 'somebody you picked is not in your organization' using errcode = '22023';
  end if;

  insert into piece_messages (tenant_id, deliverable_id, sub_task_id, kind, author_id, body, recipients)
  values (v_tenant, v_deliv, p_sub_task, 'question', v_actor, trim(p_body), v_to)
  returning id into v_id;

  v_label := app.piece_message_label(v_deliv, p_sub_task);
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  select v_tenant, u, 'question_asked', v_label,
         case when p_sub_task is not null then 'sub_task' else 'deliverable' end,
         coalesce(p_sub_task, v_deliv), v_actor,
         jsonb_build_object('message_id', v_id, 'body', trim(p_body))
    from unnest(v_to) as u;
  return v_id;
end $$;

-- d.2 — a recipient replies; the asker is told.
create or replace function public.reply_to_question(p_question uuid, p_body text)
returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := auth.uid();
  q        piece_messages%rowtype;
  v_id     uuid;
begin
  select * into q from piece_messages where id = p_question and tenant_id = v_tenant and kind = 'question';
  if not found then raise exception 'that question is not here' using errcode = 'P0002'; end if;
  if not app.piece_message_may_insert('reply', p_question, q.deliverable_id, q.sub_task_id) then
    raise exception 'only the people this question was sent to can reply to it' using errcode = '42501';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'write your reply' using errcode = '22023';
  end if;

  insert into piece_messages (tenant_id, deliverable_id, sub_task_id, kind, parent_id, author_id, body, recipients)
  values (v_tenant, q.deliverable_id, q.sub_task_id, 'reply', q.id, v_actor, trim(p_body), array[q.author_id])
  returning id into v_id;

  -- the question records its first answer
  update piece_messages set answered_by = v_actor, answered_at = now()
   where id = q.id and answered_at is null;

  if q.author_id <> v_actor then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (v_tenant, q.author_id, 'question_replied', app.piece_message_label(q.deliverable_id, q.sub_task_id),
            case when q.sub_task_id is not null then 'sub_task' else 'deliverable' end,
            coalesce(q.sub_task_id, q.deliverable_id), v_actor,
            jsonb_build_object('message_id', v_id, 'question_id', q.id, 'body', trim(p_body),
                               'question', q.body));
  end if;
  return v_id;
end $$;

-- d.1 — a nudge to one named person.
create or replace function public.nudge(
  p_deliverable uuid,
  p_sub_task    uuid,
  p_person      uuid,
  p_body        text default null
) returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := auth.uid();
  v_deliv  uuid := p_deliverable;
  v_id     uuid;
begin
  if p_sub_task is not null and v_deliv is null then
    select st.deliverable_id into v_deliv from sub_tasks st where st.id = p_sub_task and st.tenant_id = v_tenant;
  end if;
  if not app.piece_message_may_insert('nudge', null, v_deliv, p_sub_task) then
    raise exception 'that piece is not in your organization' using errcode = '42501';
  end if;
  if p_person is null or not exists (select 1 from user_profiles u where u.id = p_person and u.tenant_id = v_tenant) then
    raise exception 'pick who to nudge' using errcode = '22023';
  end if;
  if p_person = v_actor then
    raise exception 'a nudge goes to somebody else' using errcode = '22023';
  end if;

  insert into piece_messages (tenant_id, deliverable_id, sub_task_id, kind, author_id, body, recipients)
  values (v_tenant, v_deliv, p_sub_task, 'nudge', v_actor, nullif(trim(coalesce(p_body, '')), ''), array[p_person])
  returning id into v_id;

  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  values (v_tenant, p_person, 'nudged', app.piece_message_label(v_deliv, p_sub_task),
          case when p_sub_task is not null then 'sub_task' else 'deliverable' end,
          coalesce(p_sub_task, v_deliv), v_actor,
          jsonb_build_object('message_id', v_id, 'body', nullif(trim(coalesce(p_body, '')), '')));
  return v_id;
end $$;

-- d.3 — the maker says it is too much; whoever assigned it hears, with the maker's week.
create or replace function public.say_too_much(p_task uuid, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := auth.uid();
  v        sub_tasks%rowtype;
  v_week   jsonb;
  v_id     uuid;
begin
  select * into v from sub_tasks where id = p_task and tenant_id = v_tenant for update;
  if not found then raise exception 'sub_task % not found', p_task using errcode = 'P0002'; end if;
  if not app.piece_message_may_insert('too_much', null, v.deliverable_id, p_task) then
    raise exception 'only the person this task is assigned to can say it is too much' using errcode = '42501';
  end if;
  if v.status in ('done', 'cancelled') then
    raise exception 'this task is finished' using errcode = '22023';
  end if;
  if v.assigned_by is null or v.assigned_by = v_actor then
    raise exception 'nobody else gave you this task, so there is nobody to tell' using errcode = '22023';
  end if;
  if exists (select 1 from piece_messages m
              where m.sub_task_id = p_task and m.kind = 'too_much' and m.status = 'open') then
    raise exception 'you have already said this is too much — it is waiting for an answer' using errcode = '55000';
  end if;

  v_week := app.person_week_load(v_actor);

  insert into piece_messages (tenant_id, deliverable_id, sub_task_id, kind, author_id, body, recipients, status)
  values (v_tenant, v.deliverable_id, p_task, 'too_much', v_actor,
          nullif(trim(coalesce(p_note, '')), ''), array[v.assigned_by], 'open')
  returning id into v_id;

  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  values (v_tenant, v.assigned_by, 'too_much', v.title, 'sub_task', p_task, v_actor,
          jsonb_build_object('message_id', v_id, 'note', nullif(trim(coalesce(p_note, '')), ''),
                             'week', v_week));
  return v_id;
end $$;

-- d.3 — the assigner answers: Rebalance, or Keep it with her. The maker is told.
create or replace function public.answer_too_much(p_message uuid, p_answer text)
returns void
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := auth.uid();
  m        piece_messages%rowtype;
  v_title  text;
begin
  select * into m from piece_messages where id = p_message and tenant_id = v_tenant and kind = 'too_much' for update;
  if not found then raise exception 'that message is not here' using errcode = 'P0002'; end if;
  if not app.piece_message_may_answer(p_message) then
    raise exception 'only the person who assigned this task answers it' using errcode = '42501';
  end if;
  if m.status <> 'open' then
    raise exception 'this has already been answered' using errcode = '55000';
  end if;
  if p_answer is null or p_answer not in ('rebalance', 'keep') then
    raise exception 'rebalance, or keep it with them' using errcode = '22023';
  end if;

  update piece_messages
     set status = case when p_answer = 'rebalance' then 'rebalanced' else 'kept' end
   where id = p_message;

  select st.title into v_title from sub_tasks st where st.id = m.sub_task_id;
  if m.author_id <> v_actor then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (v_tenant, m.author_id, 'too_much_answered', v_title, 'sub_task', m.sub_task_id, v_actor,
            jsonb_build_object('message_id', p_message, 'answer', p_answer));
  end if;
end $$;

comment on function public.ask_question(uuid, uuid, uuid[], text) is
  'ADR-0113 d.2: ask the picked people a question about a piece (a deliverable, or a task on it). '
  'Each is told (question_asked). Returns the message id.';
comment on function public.reply_to_question(uuid, text) is
  'ADR-0113 d.2: a recipient of a question replies; the asker is told (question_replied).';
comment on function public.nudge(uuid, uuid, uuid, text) is
  'ADR-0113 d.1: nudge one named person about a piece (nudged). Stops no clock.';
comment on function public.say_too_much(uuid, text) is
  'ADR-0113 d.3: the task''s assignee tells whoever assigned it that it is too much, with their week '
  '(app.person_week_load) and an optional note (too_much). The task stays assigned.';
comment on function public.answer_too_much(uuid, text) is
  'ADR-0113 d.3: the task''s assigner answers a too_much — rebalance | keep. The maker is told '
  '(too_much_answered).';

revoke execute on function public.ask_question(uuid, uuid, uuid[], text),
                           public.reply_to_question(uuid, text),
                           public.nudge(uuid, uuid, uuid, text),
                           public.say_too_much(uuid, text),
                           public.answer_too_much(uuid, text) from public, anon;
grant  execute on function public.ask_question(uuid, uuid, uuid[], text),
                           public.reply_to_question(uuid, text),
                           public.nudge(uuid, uuid, uuid, text),
                           public.say_too_much(uuid, text),
                           public.answer_too_much(uuid, text) to authenticated;

-- ============================================================================
-- 5) Needs you
-- ============================================================================
create or replace function public.needs_me_messages()
returns table (
  id               uuid,
  kind             text,
  deliverable_id   uuid,
  sub_task_id      uuid,
  label            text,
  deliverable_name text,
  author_id        uuid,
  author_name      text,
  body             text,
  created_at       timestamptz
)
language sql stable security invoker
set search_path = public, app, extensions as $$
  select m.id, m.kind, m.deliverable_id, m.sub_task_id,
         coalesce(st.title, d.name), d.name, m.author_id, up.display_name, m.body, m.created_at
    from piece_messages m
    left join sub_tasks st    on st.id = m.sub_task_id
    left join deliverables d  on d.id = m.deliverable_id
    left join user_profiles up on up.id = m.author_id
   where m.tenant_id = app.current_tenant_id()
     and (
       -- a question to me that I have not replied to
       (m.kind = 'question' and auth.uid() = any (m.recipients)
        and not exists (select 1 from piece_messages r
                         where r.parent_id = m.id and r.kind = 'reply' and r.author_id = auth.uid()))
       -- a too_much on a task I assigned, still open
       or (m.kind = 'too_much' and m.status = 'open' and st.assigned_by = auth.uid())
     )
   order by m.created_at asc;
$$;

comment on function public.needs_me_messages() is
  'ADR-0113: the messages waiting on the caller — questions sent to them they have not replied to, '
  'and open too_much on tasks they assigned. Security invoker.';

revoke execute on function public.needs_me_messages() from public, anon;
grant  execute on function public.needs_me_messages() to authenticated;

commit;
