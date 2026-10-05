-- I59.53 (Edward, 27 Sep: "fix the letters when the workstream is created").
--
-- A piece's code is its workstream's LETTERS and a number (I56.9): "Design & Animation" gives DA-001.
-- Until now the letters were read from the workstream's CURRENT name each time a piece was created,
-- so renaming "Design & Animation" to "Motion" left its old pieces DA-001…DA-021 and started the new
-- ones at MO-001 — two prefixes in one workstream, with nothing on screen saying why.
--
-- Now a workstream's letters are worked out ONCE, from its name when it is made, stored on it, and
-- never changed — a rename keeps them. Every piece created in it takes those letters. Existing
-- workstreams take the letters their current name gives (the name their newest pieces were coded
-- from); no piece's code changes — a code, once given, never does.
--
-- Not changed here: pieces with no workstream still take 'WS' (an open question for Edward), and
-- the letters are not yet something a person types — the rule makes them.

begin;

alter table workstreams add column if not exists code_letters text;

comment on column workstreams.code_letters is
  'I59.53: the letters every piece in this workstream is coded with (DA in DA-001) — worked out from '
  'the name when the workstream is made, and never changed after, not even by a rename.';

-- Existing workstreams: from the name they have now.
update workstreams set code_letters = app.workstream_code_letters(name) where code_letters is null;

-- Set once on insert (unless the writer supplied them); a later update cannot change them.
create or replace function app.tg_workstream_code_letters()
returns trigger
language plpgsql
set search_path = public, app, extensions
as $$
begin
  if tg_op = 'INSERT' then
    new.code_letters := coalesce(nullif(btrim(new.code_letters), ''), app.workstream_code_letters(new.name));
  else
    new.code_letters := old.code_letters;   -- fixed for life: a rename does not move them
  end if;
  return new;
end $$;

comment on function app.tg_workstream_code_letters() is
  'I59.53: a workstream''s code letters are set from its name when it is made and never change.';

drop trigger if exists workstream_code_letters on workstreams;
create trigger workstream_code_letters
  before insert or update on workstreams
  for each row execute function app.tg_workstream_code_letters();

-- The piece stamp reads the stored letters (the name only as a fallback for a row the trigger above
-- has not seen). Everything else is 20260924092000's function as it was.
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

  select coalesce(nullif(w.code_letters, ''), app.workstream_code_letters(w.name)) into v_letters
    from workstreams w where w.id = new.workstream_id;
  -- Ungrouped work still gets a code — grouping is optional (ADR-0099 d.1) and a piece without one
  -- could not be named on the timing screen.
  v_letters := coalesce(v_letters, 'WS');

  new.code := app.next_deliverable_code(new.stream_id, v_letters);
  return new;
end $$;

commit;
