-- A deliverable gains its own idea, its language, and a code (I56.7, I56.8, I56.9 — section C).
--
-- All three are read off the campaign's own frames rather than from prose:
--
--   `CB-v3-P4` / `P8` (add and edit a piece) — a **Content idea** field under the name, captioned
--   *"The line the creative reads first"*, and a **Languages** row of pills: Arabic — master,
--   English, Kurdish adaptation.
--
--   `CB-v3-04` (timing) — every row is titled by a **code**: `DA-017 · Group mechanic explainer`,
--   `SF-022`, `MC-003`, `INF-013`, `LS-002`. Letters from the workstream, a number counting up
--   inside it.
--
-- **The code never changes** (I56.9). Not when the piece is renamed, not when it moves to another
-- workstream. It is how a person refers to a piece out loud and in a chat, so a code that moved
-- would be worse than no code at all — the whole value is that it is stable.

begin;

-- ---------------------------------------------------------------- the idea ----
alter table deliverables
  add column if not exists content_idea text;

comment on column deliverables.content_idea is
  'I56.8 (CB-v3-P4): the line the creative reads first. One sentence of intent, under the name — '
  'optional, because a piece can be listed before anybody has had the idea.';

-- ------------------------------------------------------------- the language ----
-- I56.7: ONE language per deliverable. Several languages is several pieces, because a language
-- that needs its own owner or its own status is not a property of one piece — it is another piece.
-- The frame says so in its own footnote: "Kurdish: its own owner and status."
alter table deliverables
  add column if not exists language text;

comment on column deliverables.language is
  'I56.7: the ONE language this piece ships in, from the `language` attribute list. Several '
  'languages means several pieces — a language needing its own owner or status is its own piece '
  '(CB-v3-P4''s footnote), which is why this is a scalar and not an array.';

-- The list itself, beside channel / format / orientation. Seeded with both names, because the
-- picker is read in Arabic too and a language list in English only would be its own joke.
insert into deliverable_attribute_values (tenant_id, attribute, code, label_en, label_ar, sort_order)
select t.id, 'language'::deliverable_attribute, v.code, v.en, v.ar, v.ord
  from tenants t
  cross join (values
    ('ar', 'Arabic',   'العربية',   1),
    ('en', 'English',  'الإنجليزية', 2),
    ('ku', 'Kurdish',  'الكردية',    3)
  ) as v(code, en, ar, ord)
where not exists (
  select 1 from deliverable_attribute_values x
   where x.tenant_id = t.id and x.attribute = 'language'::deliverable_attribute and x.code = v.code);

-- ---------------------------------------------------------------- the code ----
alter table deliverables
  add column if not exists code text;

create unique index if not exists uq_deliverables_campaign_code
  on deliverables (stream_id, code) where code is not null;

comment on column deliverables.code is
  'I56.9 (CB-v3-04): letters from the workstream plus a number counting up within it — DA-017. '
  'Generated once, at creation, and NEVER changed: not on a rename, not on a move to another '
  'workstream. It is how a person refers to a piece out loud, so a code that moved would be worse '
  'than none.';

-- Letters from the workstream's name: its initials where it has several words (Design & Animation
-- -> DA), otherwise its first two letters. Deliberately not unique on its own — the number after
-- it is what separates pieces, and two workstreams sharing letters is a cosmetic collision, not a
-- correctness one.
create or replace function app.workstream_code_letters(p_name text)
returns text
language sql
immutable as $$
  select case
    when p_name is null or btrim(p_name) = '' then 'WS'
    else (
      select case
        when count(*) >= 2 then string_agg(upper(left(w, 1)), '' order by n)
        else upper(left(regexp_replace(btrim(p_name), '[^A-Za-z]', '', 'g') || 'X', 2))
      end
      from (
        select w, row_number() over () as n
        from regexp_split_to_table(btrim(p_name), '\s+') w
        where regexp_replace(w, '[^A-Za-z]', '', 'g') <> ''
      ) parts
    )
  end
$$;

comment on function app.workstream_code_letters(text) is
  'I56.9: the letter part of a piece''s code, from its workstream''s name — initials for a '
  'multi-word name (Design & Animation -> DA), the first two letters otherwise.';

-- Stamped on insert, and only then. An UPDATE never touches it (see the comment on the column).
create or replace function app.tg_deliverable_stamp_code()
returns trigger
language plpgsql
security definer
set search_path = public, app, extensions as $$
declare
  v_letters text;
  v_next    integer;
begin
  if new.code is not null then
    return new;  -- carried deliberately (a restore, a migration): never re-issued
  end if;

  select app.workstream_code_letters(w.name) into v_letters
    from workstreams w where w.id = new.workstream_id;
  -- Ungrouped work still gets a code — grouping is optional (ADR-0099 d.1) and a piece without one
  -- could not be named on the timing screen.
  v_letters := coalesce(v_letters, 'WS');

  -- Counts up WITHIN the campaign, per letter set. `stream_id` is the campaign's join row.
  select coalesce(max(substring(d.code from '[0-9]+$')::integer), 0) + 1 into v_next
    from deliverables d
   where d.stream_id = new.stream_id
     and d.code like v_letters || '-%';

  new.code := v_letters || '-' || lpad(v_next::text, 3, '0');
  return new;
end $$;

drop trigger if exists deliverable_stamp_code on deliverables;
create trigger deliverable_stamp_code
  before insert on deliverables
  for each row execute function app.tg_deliverable_stamp_code();

commit;
