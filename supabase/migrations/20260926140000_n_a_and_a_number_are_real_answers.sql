-- I59 (Edward, 25 Sep) — "N/A" and a number on its own are real answers, not filler.
--
-- Track 8 found that the brief templates' own guidance asks for them (Budget, Audience — Secondary and
-- Offer say "…or N/A"; Average Order Value asks for a number), so under E10 (every field with text is
-- checked) a brief filled in exactly as its guidance says would be refused at release. Edward chose to
-- stop counting them as filler. "XYZ 123" is still filler: digits count only when EVERY run is digits.
--
-- Reproduced WHOLE from its latest definition (20260926134000); the two edits are marked [edit].
-- Mirrored case for case by src/lib/brief/filler.ts.

begin;

create or replace function app.is_filler_with(p_text text, p_words text[])
returns boolean
language plpgsql immutable
set search_path = public, app, extensions as $$
declare
  v_text   text := lower(btrim(coalesce(p_text, '')));
  v_runs   text[];
  v_run    text;
  v_single text[];
  v_phrase text[];
  v_w      text;
begin
  if v_text = '' then
    return false;                       -- blank is its own refusal, not filler
  end if;

  -- I59 (Edward, 25 Sep): "N/A" is a real answer — the templates' own guidance asks for it. [edit]
  if v_text ~ '^n\s*[/.]?\s*a\.?$' then
    return false;
  end if;

  -- The tenant's entries: one-word entries join the run list, several-word entries match the whole.
  v_single := array[]::text[];
  v_phrase := array[]::text[];
  foreach v_w in array coalesce(p_words, array[]::text[]) loop
    v_w := array_to_string(regexp_split_to_array(lower(btrim(v_w)), '[^[:alnum:]]+'), ' ');
    v_w := btrim(v_w);
    continue when v_w = '';
    if position(' ' in v_w) > 0 then
      v_phrase := v_phrase || v_w;
    else
      v_single := v_single || v_w;
    end if;
  end loop;

  select coalesce(array_agg(m[1]), array[]::text[]) into v_runs
    from regexp_matches(v_text, '([[:alnum:]]+)', 'g') as m;

  if cardinality(v_runs) = 0 then
    return true;                        -- "…", "...", "-", "?!"
  end if;

  -- I59 (settled 25 Sep): the placeholder paragraph, however long — "Lorem ipsum dolor sit amet…".
  if cardinality(v_runs) >= 2 and v_runs[1] = 'lorem' and v_runs[2] = 'ipsum' then
    return true;
  end if;

  -- I59 (Edward, 25 Sep): a number on its own is a real answer (a budget, an order value); digits
  -- beside placeholder words ("XYZ 123") are still filler. [edit]
  if (select bool_and(r ~ '^[0-9٠-٩۰-۹]+$') from unnest(v_runs) as r) then
    return false;
  end if;

  if array_to_string(v_runs, ' ') = any (v_phrase) then
    return true;
  end if;

  foreach v_run in array v_runs loop
    if v_run = any (array['xyz', 'tbd', 'tbc', 'tba', 'test', 'x', 'lorem', 'ipsum']) then continue; end if;
    if v_run ~ '^[0-9٠-٩۰-۹]+$' then continue; end if;          -- digits only (Latin, Arabic-Indic)
    if v_run ~ '^(.)\1*$' then continue; end if;                  -- one repeated character
    if v_run = any (v_single) then continue; end if;
    return false;
  end loop;
  return true;
end $$;

comment on function app.is_filler_with(text, text[]) is
  'ADR-0111 d.1 (I59.27, I59.31): is this text only placeholder? Built-ins + the given extra words; text '
  'beginning "lorem ipsum" is filler; "N/A" and a number on its own are NOT (Edward, 25 Sep). Mirrored by src/lib/brief/filler.ts (isFiller) case for case.';

commit;
