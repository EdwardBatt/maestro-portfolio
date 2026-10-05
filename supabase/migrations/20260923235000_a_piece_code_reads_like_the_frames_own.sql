-- A piece's code reads like the ones on the frame (I56.9).
--
-- `20260923230000`'s first cut was wrong twice, caught by running it against the frame's own names:
--
--   Short Format · Meridian Squad  ->  SFES   the frame says SF-022
--   العربية                    ->  X      a name with no Latin letters produced a letter
--
-- The rule the frame actually follows, read off `CB-v3-04`'s rows and `CB-v3-P3`'s list:
--
--   Design & Animation  ->  DA     two or more words: the first letter of the first two
--   Short Format …      ->  SF     ("&" is not a word, so it is skipped)
--   Live Streams        ->  LS
--   Mini Copies         ->  MC
--   Influencers         ->  INF    one word: its first three letters
--
-- And a workstream named in Arabic — which this product must expect, not treat as a curiosity —
-- has no Latin letters to take. It falls back to `WS`, which is honest, rather than to whatever a
-- `left()` happens to return.

begin;

create or replace function app.workstream_code_letters(p_name text)
returns text
language plpgsql
immutable as $$
declare
  v_words text[];
begin
  if p_name is null or btrim(p_name) = '' then
    return 'WS';
  end if;

  -- Words that actually carry Latin letters. "&", "·" and "-" are separators, not words, and a
  -- name written in Arabic yields none at all.
  select array_agg(w order by n) into v_words
    from (
      select regexp_replace(w, '[^A-Za-z]', '', 'g') as w, row_number() over () as n
      from regexp_split_to_table(btrim(p_name), '[\s·\-–—/&]+') w
    ) parts
   where w <> '';

  if v_words is null or array_length(v_words, 1) = 0 then
    return 'WS';
  end if;

  if array_length(v_words, 1) = 1 then
    -- One word: three letters, so "Influencers" reads INF and not IN.
    return upper(left(v_words[1] || 'XX', 3));
  end if;

  -- Two or more: the first letter of the first two. Never more, however many words follow.
  return upper(left(v_words[1], 1) || left(v_words[2], 1));
end $$;

comment on function app.workstream_code_letters(text) is
  'I56.9: the letter part of a piece''s code, matching the codes on CB-v3-04 — the first letters '
  'of the first two words (Design & Animation -> DA, Short Format · Meridian Squad -> SF), or three '
  'letters for a one-word name (Influencers -> INF). A name with no Latin letters falls back to '
  'WS rather than inventing one.';

commit;
