-- I59.27 / ADR-0111 (25 Sep, Edward) — filler is not a brief: releasing a single job and approving a
-- campaign refuse a required brief field that holds only placeholder text, naming the field and its
-- text ("The Task still says 'XYZ 123' — write the real task.").
--
-- WHERE THE CHECK GOES. Today the only "required field" refusal is in the SCREENS — `briefMissing`
-- (src/features/intake/lib/single-job.ts:259, the single job's required key: 'task' when the template
-- has it, else the template's first field — `requiredBriefKeys` :253) and the campaign wizard's
-- `proposition` (BriefWizard.tsx `requiredFields={['proposition']}`). No database function refuses a
-- blank field: `app.approve_campaign` (the release of a single job AND the approval of a campaign —
-- `public.approve_campaign` is its only door) checks permission and state only. ADR-0111's
-- Consequences want "one shared checker used by both the screen and the database gate", so the gate is
-- added HERE, to `app.approve_campaign`, for exactly those required fields:
--   single job  each of its campaign_briefs rows: the template's required key (as requiredBriefKeys)
--   campaign    campaigns.proposition
-- A BLANK field is not refused here (unchanged: the screens refuse it); only filler is new.
--
-- THE RULE (d.1) — `app.is_filler(text)`, mirrored exactly by src/lib/brief/filler.ts (same cases in
-- both test suites): trimmed and lower-cased, the text is split into runs of letters/digits. It is
-- filler when it is not blank and EVERY run is filler — or there is no run at all ("…", "...", "-"):
--   built-in words  xyz, tbd, tbc, tba, test, x, lorem, ipsum   (N/A splits to "n" "a")
--   digits only     "123", "٢٠٢٦"
--   one repeated character   "aaaa", "a", "..."
--   the tenant's own words (`tenant_filler_words`, d.3): a one-word entry counts as a filler run; a
--   several-word entry ("coming soon") matches the whole text.
-- So "XYZ 123" and "TBD." are filler; "Test the new pack shot" and "1080x1920" are not.
-- The built-ins live in the function, so an admin can add words and never remove these.
--
-- app.approve_campaign reproduced WHOLE from 20260921150000 (its latest definition — grep confirmed);
-- the only change is the marked filler block after the permission check.

begin;

-- ---------------------------------------------------------------- the tenant's words ----
create table tenant_filler_words (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  word        text not null
                constraint chk_tenant_filler_words_word check (
                  word = lower(btrim(word)) and length(word) between 1 and 100),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  constraint uq_tenant_filler_words_word unique (tenant_id, word)
);

create index idx_tenant_filler_words_tenant_id on tenant_filler_words (tenant_id);

comment on table tenant_filler_words is
  'ADR-0111 d.3 (I59.27): words and phrases this tenant also treats as placeholder text in a required '
  'brief field, on top of the built-ins in app.is_filler (which cannot be removed). Stored lower-case, '
  'trimmed. Admin-managed (organization:manage), readable in the tenant so the screen can warn first.';

alter table tenant_filler_words enable row level security;
alter table tenant_filler_words force row level security;

create policy tenant_filler_words_tenant_select on tenant_filler_words
  for select to authenticated
  using (tenant_id = app.current_tenant_id());

create policy tenant_filler_words_admin_write on tenant_filler_words
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));

create trigger set_updated_at before update on tenant_filler_words
  for each row execute function app.set_updated_at();
create trigger set_actor_columns before insert or update on tenant_filler_words
  for each row execute function app.set_actor_columns();
create trigger audit_row_change after insert or update or delete on tenant_filler_words
  for each row execute function app.audit_row_change();

-- ---------------------------------------------------------------- the rule ----
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
  'ADR-0111 d.1 (I59.27): is this text only placeholder? Built-ins + the given extra words. Mirrored '
  'by src/lib/brief/filler.ts (isFiller) case for case.';

create or replace function app.is_filler(p_text text)
returns boolean
language sql stable
set search_path = public, app, extensions as $$
  select app.is_filler_with(
    p_text,
    coalesce((select array_agg(w.word) from tenant_filler_words w
               where w.tenant_id = app.current_tenant_id()), array[]::text[]));
$$;

comment on function app.is_filler(text) is
  'ADR-0111 d.1/d.3 (I59.27): app.is_filler_with with the caller''s tenant''s own words.';

-- The first required brief field on a campaign that holds only filler, or nothing.
create or replace function app.campaign_brief_filler(p_campaign uuid)
returns table (field_key text, field_label text, field_text text)
language sql stable
set search_path = public, app, extensions as $$
  with c as (select * from campaigns where id = p_campaign),
  single_job as (
    select k.key, coalesce(f.el ->> 'en', k.key) as label, btrim(b."values" ->> k.key) as txt, 1 as ord
      from c
      join campaign_briefs b on b.campaign_id = c.id
      left join brief_templates t on t.tenant_id = c.tenant_id and t.brief_type = b.brief_type
      -- requiredBriefKeys: 'task' when the template has it, otherwise the template's first field.
      cross join lateral (
        select case
                 when exists (select 1 from jsonb_array_elements(coalesce(t.fields, '[]'::jsonb)) e where e ->> 'key' = 'task')
                   then 'task'
                 else (coalesce(t.fields, '[]'::jsonb) -> 0) ->> 'key'
               end as key) k
      left join lateral (select e as el from jsonb_array_elements(coalesce(t.fields, '[]'::jsonb)) e
                          where e ->> 'key' = k.key limit 1) f on true
     where c.kind = 'single_job' and k.key is not null
  ),
  campaign as (
    select 'proposition', 'The proposition', btrim(c.proposition), 2
      from c where c.kind = 'campaign'
  )
  select key, label, txt from (select * from single_job union all select * from campaign) x
   where coalesce(txt, '') <> '' and app.is_filler(txt)
   order by ord, key
   limit 1;
$$;

comment on function app.campaign_brief_filler(uuid) is
  'ADR-0111 (I59.27): the first REQUIRED brief field of this campaign or single job that holds only '
  'filler — the single job''s template-required key (as requiredBriefKeys in single-job.ts), a '
  'campaign''s proposition — with its label and text; no row when the brief is real.';

-- ---------------------------------------------------------------- the gate ----
create or replace function app.approve_campaign(p_campaign uuid)
 returns void
 language plpgsql
 security definer
 set search_path = public, app, extensions
as $$
declare v campaigns; v_am uuid; v_am_name text; v_fill record;
begin
  select * into v from campaigns
   where id = p_campaign and tenant_id = app.current_tenant_id();
  if v.id is null then
    raise exception 'campaign % not found', p_campaign using errcode = 'P0002';
  end if;
  if v.status = 'approved' then
    raise exception 'this campaign is already approved' using errcode = '22023';
  end if;

  select coalesce(v.account_manager_id, cl.account_manager_id) into v_am
    from clients cl where cl.id = v.client_id;

  if not app.has_permission('projects', 'manage')
     or not app.in_write_scope(null, null, v_am) then
    -- ADR-0083 addendum d.15: say WHO can, not just that the caller cannot. The name rides in
    -- DETAIL so the screen can put it in a sentence; an unset manager is said as such.
    select up.display_name into v_am_name from user_profiles up where up.id = v_am;
    raise exception 'you cannot approve this campaign'
      using errcode = '42501',
            detail = coalesce(v_am_name, ''),
            hint = case when v_am is null then 'no_account_manager' else 'account_manager' end;
  end if;

  -- ---- ADR-0111 (I59.27): nothing fake. A required brief field holding only filler is refused,
  -- the field and its text named. DETAIL carries both as JSON so the screen can say it in Arabic.
  select * into v_fill from app.campaign_brief_filler(p_campaign);
  if v_fill.field_key is not null then
    raise exception '% still says ''%'' — write the real %.',
            v_fill.field_label, v_fill.field_text,
            lower(regexp_replace(v_fill.field_label, '^the\s+', '', 'i'))
      using errcode = '22023',
            detail = jsonb_build_object('field', v_fill.field_key, 'label', v_fill.field_label,
                                        'text', v_fill.field_text)::text,
            hint = 'brief_filler';
  end if;

  update campaigns
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_campaign;

  -- ADR-0084 d.4 / ADR-0085 d.2: a SINGLE JOB's brief is approved with the job.
  if v.kind = 'single_job' then
    update campaign_briefs
       set approved_at = now(), approved_by = auth.uid()
     where campaign_id = p_campaign
       and approved_at is null;
  end if;

  -- I52 Action 1 (Edward, 17 Sep): the deliverable's OWNER, and nobody else — not department leads
  -- by role, not reviewers. I53.19 (Edward, 21 Sep): ONE row per owner, on the campaign, carrying
  -- how many deliverables are theirs and which — each with its phase and its due date, so the mail
  -- lists them ("Teaser — Phase 1: Pre-Launch, due Saturday 26 September") and says what is
  -- required. Never the approver.
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  select v.tenant_id, d.owner_user_id, 'campaign_approved', v.name, 'campaign', v.id, auth.uid(),
         jsonb_build_object(
           'deliverable_count', count(*),
           'deliverables', jsonb_agg(jsonb_build_object(
             'name', d.name, 'due_at', d.due_at,
             'phase_number', p.number, 'phase_name', p.name) order by d.created_at),
           'due_at', min(d.due_at))
    from deliverables d
    join streams s on s.id = d.stream_id
    left join campaign_phases p on p.id = d.phase_id
   where s.campaign_id = p_campaign
     and d.owner_user_id is not null
     and d.owner_user_id is distinct from auth.uid()
   group by d.owner_user_id;
end $$;

comment on function app.approve_campaign(uuid) is
  'ADR-0048 d.9 / ADR-0073: approve a campaign under projects:manage in scope of its account '
  'manager. Action 1: each deliverable owner is told — I53.19: once, on the campaign, with the '
  'count of what they own and each piece''s name, phase and due date in detail. ADR-0111 (26 Sep): '
  'refused (22023, hint brief_filler) while a required brief field holds only filler.';

commit;
