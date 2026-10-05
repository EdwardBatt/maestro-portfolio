-- A piece moving to another campaign takes that campaign's numbering (I56.9).
--
-- `20260923230000` stamps a code on insert and never again, and `uq_deliverables_campaign_code`
-- makes it unique per stream — that is, per campaign. Both are right. What neither accounted for
-- is that a deliverable can CHANGE campaign: `attach_job_to_campaign` moves every row of a draft
-- job's stream onto the campaign it duplicates, and the code goes with it.
--
-- pgTAP `106` failed on exactly that:
--
--   duplicate key value violates unique constraint "uq_deliverables_campaign_code"
--   Key (stream_id, code)=(…e9301, WS-001) already exists.
--
-- `WS` is the fallback letters for ungrouped work, so `WS-001` is the FIRST code almost every
-- campaign issues. Two campaigns meeting is therefore the common case, not the unlucky one.
--
-- THE RULE, STATED PROPERLY. "The code never changes" means it never changes *within its
-- campaign* — not on a rename, and not on a move between workstreams, which is what `I56.9` was
-- guarding. It cannot mean more than that, because the code is only unique inside a campaign: a
-- piece arriving in a new one has to take a number in that campaign's sequence or it is not an
-- identifier at all. So the code is re-issued when, and only when, the campaign changes.
--
-- The trigger is NOT restricted with `update of stream_id`. A column-restricted trigger does not
-- fire for a statement that does not name the column, which is the trap `20260923220000` was
-- written to fix; the guard belongs in the body where it cannot be bypassed.

begin;

-- The numbering, in one place. Both the insert and the move need it, and two copies of a
-- "max + 1" is how they drift.
create or replace function app.next_deliverable_code(p_stream uuid, p_letters text)
returns text
language sql
security definer
set search_path = public, app, extensions as $$
  select p_letters || '-' || lpad(
    (coalesce(max(substring(d.code from '[0-9]+$')::integer), 0) + 1)::text, 3, '0')
    from deliverables d
   where d.stream_id = p_stream
     and d.code like p_letters || '-%'
$$;

comment on function app.next_deliverable_code(uuid, text) is
  'I56.9: the next free code for a letter set within one campaign. Shared by the insert stamp and '
  'the re-stamp a piece gets when it joins another campaign, so the two cannot disagree.';

create or replace function app.tg_deliverable_stamp_code()
returns trigger
language plpgsql
security definer
set search_path = public, app, extensions as $$
declare
  v_letters text;
begin
  -- A move between campaigns, and nothing else about the row matters here.
  if tg_op = 'UPDATE' then
    if new.stream_id is not distinct from old.stream_id then
      return new;
    end if;
    -- Keep the letters: they come from the workstream, which this move does not touch. Only the
    -- number is re-issued, and only because it now counts inside a different campaign.
    v_letters := coalesce(nullif(regexp_replace(coalesce(old.code, ''), '-[0-9]+$', ''), ''), 'WS');
    new.code := app.next_deliverable_code(new.stream_id, v_letters);
    return new;
  end if;

  if new.code is not null then
    return new;  -- carried deliberately (a restore, a migration): never re-issued
  end if;

  select app.workstream_code_letters(w.name) into v_letters
    from workstreams w where w.id = new.workstream_id;
  -- Ungrouped work still gets a code — grouping is optional (ADR-0099 d.1) and a piece without one
  -- could not be named on the timing screen.
  v_letters := coalesce(v_letters, 'WS');

  new.code := app.next_deliverable_code(new.stream_id, v_letters);
  return new;
end $$;

comment on function app.tg_deliverable_stamp_code() is
  'I56.9: issues a piece''s code on insert, and re-issues the NUMBER when the piece joins another '
  'campaign — the code is unique per campaign, so it has to. The letters follow the workstream '
  'and are kept, and a move between workstreams inside one campaign changes nothing.';

drop trigger if exists deliverable_stamp_code on deliverables;
create trigger deliverable_stamp_code
  before insert or update on deliverables
  for each row execute function app.tg_deliverable_stamp_code();

commit;
