-- I59 integration (25 Sep) — two fixes the local browser suite found.
--
-- 1. The filler check read EVERY string in a single job's brief values, including ones the system stores
--    for itself: `inheritedRules` is saved as the text "[]", which has no letters and so counted as filler.
--    Every single-job release was refused ("InheritedRules still says '[]'"). E10 means every field a
--    person fills in — the fields the job's brief TEMPLATE defines. `app.campaign_brief_filler` is
--    reproduced WHOLE from 20260926134000; the one edit is marked [edit]. The campaign branch already
--    lists its fields by name and is unchanged.
-- 2. Three new tables had no table grants: RLS decides the rows, but `authenticated` also needs the
--    privilege (the CLI's local default grants none; the seed's stand-in covers only the tables that
--    existed when it ran). Granted explicitly, as 20260926111000 does for its table.

begin;
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
      -- [edit] only the template's own fields: a stored value no person types (inheritedRules, an internal
      -- JSON string) is not a brief field, and "[]" is not filler somebody wrote.
      join lateral (select e.el, e.pos from jsonb_array_elements(coalesce(t.fields, '[]'::jsonb))
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

grant select, insert, update on table public.tenant_escalation_rules to authenticated;
grant select, insert, delete on table public.tenant_filler_words to authenticated;
grant select on table public.escalation_log to authenticated;
revoke all on table public.tenant_escalation_rules, public.tenant_filler_words, public.escalation_log from anon;

commit;
