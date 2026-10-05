-- I59.31 / E10 and the settled "lorem ipsum" item (Edward, 25 Sep; ADR-0111 addendum) — filler is
-- checked on EVERY brief field that has text, not only the required one; a blank optional field stays
-- allowed. Text that BEGINS "lorem ipsum" is filler ("Lorem ipsum dolor sit amet…").
--
-- WHICH FIELDS (read 26 Sep from what the screens write):
--   single job  every text value of each `campaign_briefs.values` (the template's fields — every
--               brief_templates field is free text, `multiline: true`), in the template's order,
--               labelled by the template's English label (the key when the template no longer has it).
--   campaign    the master brief's strategy fields in `campaigns.brief` — background, task,
--               beautifulProblem, audiencePrimary, audienceSecondary, brandFunctionalBenefit,
--               brandEmotionalBenefit, insight, proposition (BriefStrategy, campaign-api.ts) — and the
--               performance brief's objective, budget, audience, geography, platforms (PerformanceBrief).
--               `briefType` (a code such as "360"), the deliverables, phases and workstreams are not
--               brief text and are not read.
--
-- Reproduced WHOLE from 20260926123000 (their only definitions, grep confirmed 26 Sep):
--   app.is_filler_with         — "lorem ipsum …" at the start is filler;
--   app.campaign_brief_filler  — every field with text. Same signature and row shape, so
--                                app.approve_campaign (its only caller) is unchanged.
-- src/lib/brief/filler.ts mirrors the rule, and its test carries the same cases as pgTAP 178.
--
-- Tests: supabase/tests/178_blocks_filler_and_blocked_time.sql

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
  'beginning "lorem ipsum" is filler. Mirrored by src/lib/brief/filler.ts (isFiller) case for case.';

-- The first brief field of a campaign or single job, in the form's order, that holds only filler.
create or replace function app.campaign_brief_filler(p_campaign uuid)
returns table (field_key text, field_label text, field_text text)
language sql stable
set search_path = public, app, extensions as $$
  with c as (select * from campaigns where id = p_campaign),
  single_job as (
    select v.key,
           coalesce(f.el ->> 'en', v.key) as label,
           btrim(v.value #>> '{}') as txt,
           1 as grp,
           coalesce(f.pos, 100000) as pos,
           b.created_at as brief_at
      from c
      join campaign_briefs b on b.campaign_id = c.id
      left join brief_templates t on t.tenant_id = c.tenant_id and t.brief_type = b.brief_type
      cross join lateral jsonb_each(coalesce(b."values", '{}'::jsonb)) v
      left join lateral (select e.el, e.pos from jsonb_array_elements(coalesce(t.fields, '[]'::jsonb))
                           with ordinality as e(el, pos)
                          where e.el ->> 'key' = v.key limit 1) f on true
     where c.kind = 'single_job' and jsonb_typeof(v.value) = 'string'
  ),
  campaign as (
    -- The proposition also lives in its own column (mirrored from the brief by
    -- tg_campaign_brief_guard); read there when the document has none, as 20260926123000 did.
    select k.key, k.label,
           btrim(case when jsonb_typeof(c.brief -> k.key) = 'string' then c.brief ->> k.key
                      when k.key = 'proposition' then c.proposition end) as txt,
           2 as grp, k.pos, null::timestamptz as brief_at
      from c
      cross join (values
        ('background', 'Background', 1), ('task', 'The task', 2), ('beautifulProblem', 'The beautiful problem', 3),
        ('audiencePrimary', 'Audience — primary', 4), ('audienceSecondary', 'Audience — secondary', 5),
        ('brandFunctionalBenefit', 'Brand — functional benefit', 6),
        ('brandEmotionalBenefit', 'Brand — emotional benefit', 7),
        ('insight', 'Insight', 8), ('proposition', 'The proposition', 9)) as k(key, label, pos)
     where c.kind = 'campaign'
    union all
    select 'performance.' || k.key, k.label, btrim(c.brief -> 'performance' ->> k.key), 2, 100 + k.pos, null
      from c
      cross join (values
        ('objective', 'Performance — objective', 1), ('budget', 'Performance — budget', 2),
        ('audience', 'Performance — audience', 3), ('geography', 'Performance — geography', 4),
        ('platforms', 'Performance — platforms', 5)) as k(key, label, pos)
     where c.kind = 'campaign' and jsonb_typeof(c.brief -> 'performance' -> k.key) = 'string'
  )
  select key, label, txt from (select * from single_job union all select * from campaign) x
   where coalesce(txt, '') <> '' and app.is_filler(txt)
   order by grp, brief_at nulls first, pos, key
   limit 1;
$$;

comment on function app.campaign_brief_filler(uuid) is
  'ADR-0111 + addendum (I59.31 E10): the first brief field of this campaign or single job that has '
  'text and holds only filler, in the form''s order — every text field of a single job''s briefs, a '
  'campaign''s strategy and performance fields — with its label and text; no row when the brief is '
  'real. A blank field is never returned.';

commit;
