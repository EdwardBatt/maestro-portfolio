-- I44 (ADR-0086 d.2/d.3) — the system says when a job looks like one it already has.
--
-- WHAT EXISTED. The only duplicate check was `uq_campaigns_tenant_name`: an exact match anywhere
-- in the tenant, refused with 23505. It catches "Ramadan teaser posts" twice, lets "Ramadan teaser
-- post" through, refuses rather than asks, and treats the same name for two different clients as a
-- collision, which it is not. The five "Al Waha KV" jobs ADR-0080 found — one piece of work
-- created five times in fourteen minutes — are the failure mode measured. That constraint STAYS
-- (d.4): two campaigns with literally the same name is a data error, not a judgement call.
--
-- WHAT THIS ADDS is a QUESTION, asked on Approve (ADR-0085 d.3): this client's open jobs whose
-- title is similar to the new one, with the score shown. Trigram similarity is the ordinary,
-- explainable way to say "92% name match" — a number the person can see is a number they can
-- disagree with. `pg_trgm` is a standard extension Supabase ships; it was not enabled (measured
-- in the ADR against `pg_extension`). Created in the `extensions` schema, where Supabase keeps
-- them and where every function's pinned search_path already looks.
--
-- THE THRESHOLD IS A CONSTANT, 0.4, DELIBERATELY LOOSE (d.3). This is a prompt, not a verdict: a
-- false alarm costs one dismissal, a miss costs a second job with a second clock.
--
-- "OPEN" (d.2): any kind, any status, with at least one deliverable still live — `draft`,
-- `in_progress`, `in_review` or `blocked`. A finished job (every deliverable `approved`,
-- `delivered` or `archived`) is not a duplicate risk. Campaigns have no archived status of their
-- own — archiving is a deliverable state (ADR-0080) — so "not archived" in the ADR is read as
-- "has live work", which is what it means. A wizard draft that has not reached submit has no
-- deliverables yet and so is never offered.
--
-- NEVER ACROSS CLIENTS (d.2). `p_client` is the fence and it is applied INSIDE the tenant: the
-- function is `security invoker`, so `campaigns_tenant_select` decides what it can see at all, and
-- the explicit `tenant_id = app.current_tenant_id()` is belt to those braces. A client id from
-- another tenant returns nothing.
--
-- `p_exclude_campaign` is the job being approved. The check runs on Approve, when the draft already
-- exists as a campaign row with its deliverable (ADR-0085 d.8), so without this it would find
-- itself at 100% and offer to attach a job to itself. Defaulted so the two-argument call works.
--
-- NO TRIGRAM INDEX, on purpose. The ADR mentions "a new index"; with the query fenced to one
-- client's campaigns the planner reaches them through `idx_campaigns_client_id` and
-- `similarity() >= 0.4` cannot use a GIN index anyway (only the `%` operator can, under a GUC).
-- An index nothing uses is dead weight, so it is left out and this line says why.

begin;

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
-- The function below is SECURITY INVOKER, so `similarity()` is resolved as the caller — and an
-- unqualified name is only found in a schema the caller has USAGE on. Supabase grants this on
-- `extensions` already; a bare Postgres (the verify container) does not, and the symptom is
-- "function similarity(text, text) does not exist" at call time, not at migration time.
grant usage on schema extensions to anon, authenticated, service_role;

create or replace function public.similar_open_jobs(
  p_client           uuid,
  p_title            text,
  p_exclude_campaign uuid default null
) returns table (
  campaign_id       uuid,
  name              text,
  score             numeric,
  kind              text,
  department_names  text[],
  deliverable_count int,
  raised_by         text,
  raised_at         timestamptz,
  status            text
)
language sql
stable
security invoker
set search_path = public, app, extensions as $$
  select
    c.id,
    c.name,
    round(similarity(c.name, p_title)::numeric, 2)                        as score,
    c.kind,
    coalesce(live.department_names, array[]::text[])                      as department_names,
    live.deliverable_count,
    am.display_name                                                       as raised_by,
    -- The clock's origin: the earliest CONFIRMED receipt (ADR-0066 d.5), else when the row was made.
    coalesce(rc.first_received_at, c.created_at)                          as raised_at,
    c.status
  from campaigns c
  left join user_profiles am on am.id = c.account_manager_id
  join lateral (
    select count(*)::int as deliverable_count,
           array_agg(distinct dp.name order by dp.name) filter (where dp.name is not null) as department_names
      from streams s
      join deliverables d on d.stream_id = s.id
      left join departments dp on dp.id = d.department_id
     where s.campaign_id = c.id
       and d.state in ('draft', 'in_progress', 'in_review', 'blocked')
  ) live on live.deliverable_count > 0
  left join lateral (
    select min(r.received_at) as first_received_at
      from campaign_brief_receipts r
     where r.campaign_id = c.id and r.confirmed_at is not null
  ) rc on true
  where c.tenant_id = app.current_tenant_id()
    and c.client_id = p_client
    and (p_exclude_campaign is null or c.id <> p_exclude_campaign)
    and p_title is not null
    and similarity(c.name, p_title) >= 0.4
  order by similarity(c.name, p_title) desc, c.created_at asc;
$$;

comment on function public.similar_open_jobs(uuid, text, uuid) is
  'ADR-0086 d.2/d.3 (SJ-A1): this client''s OPEN jobs — any kind, at least one live deliverable — '
  'whose title is trigram-similar to p_title at 0.4 or above, best match first, score shown. Never '
  'across clients; tenant-fenced by RLS and by the explicit check. p_exclude_campaign is the job '
  'being approved, so it does not find itself. A prompt, never a refusal: uq_campaigns_tenant_name '
  'still refuses an exact duplicate.';

revoke execute on function public.similar_open_jobs(uuid, text, uuid) from public;
revoke execute on function public.similar_open_jobs(uuid, text, uuid) from anon;
grant  execute on function public.similar_open_jobs(uuid, text, uuid) to authenticated;

commit;
