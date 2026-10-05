-- I34.1 (ADR-0065 d.6, d.8) — where a proposed concept lives.
--
-- `generate-brief` is a SORTING job and always was: its prompt forbids it inventing a number, a
-- name, a date or a budget, so a department brief is the campaign brief re-boxed with `N/A` where
-- nothing fits. ADR-0065 adds a second, separate call that may PROPOSE — an approach answerable to
-- that brief — and this is the table its answers land in.
--
-- WHY NOT ON `campaign_briefs`. The brief is approved (ADR-0048 d.8) and edited by hand. Concepts
-- get re-rolled three times before anyone is happy. Putting them in `campaign_briefs.values` means
-- a re-roll can overwrite an approved document, which is the one thing that must not happen —
-- ADR-0065 rejected that as option A. Approving a brief does not approve concepts, and the schema
-- is where that is made true rather than remembered.
--
-- WHY THE BRIEF IS THE ONLY PARENT. `campaign_briefs` is already unique on
-- `(campaign_id, department_id)`, so the brief row determines both; carrying copies here would be
-- two more columns that can drift from the row that owns the fact. The cascade comes free: a brief
-- deleted takes its concepts with it, because a proposal against a brief that no longer exists is
-- not a proposal about anything.
--
-- WHY NOT UNIQUE ON THE PARENT. `campaign_briefs` is one row per department per campaign; this is
-- deliberately MANY (ADR-0065 d.8). Each press of the button stores a new set beside the last:
-- re-running is cheap, but the model will not reproduce what it said the first time, so a replace
-- would make "actually, the first one was better" unrecoverable. An unwanted set costs a row.
--
-- WHY A SET IS IMMUTABLE. There is no UPDATE policy and `update` is revoked. A row here is the
-- record of WHAT THE MODEL PROPOSED, and editing it destroys the only evidence of that — which
-- matters because ADR-0065 d.2 makes "did it generate a fact?" a question somebody may need to
-- answer later. Discard (DELETE) is supported; correction is not. A concept somebody wants to
-- develop belongs in the brief, or in the work, where a human owns the words.
--
-- `unsupported` (d.5 — a proposal that cites no requirement is shown and marked, never hidden) is
-- NOT a column. It is `answers = []`, derived where it is rendered. Storing it would be a second
-- copy of a fact the data already carries, and the two would eventually disagree.

begin;

create table campaign_concepts (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  -- The brief this set was proposed against. Cascade: no brief, no proposal about it.
  campaign_brief_id uuid not null references campaign_briefs(id) on delete cascade,
  -- The four shapes of ADR-0065 d.3, as generated. An ARRAY, not an object: order is the model's
  -- own and a reviewer reads down it, so preserving it costs nothing and losing it is confusing.
  proposals         jsonb not null default '[]'::jsonb,
  -- Which model produced this set. ADR-0065 d.9 keeps model choice in configuration, which means
  -- it can change between two sets sitting side by side on one screen; without this column the
  -- honest answer to "why is this batch better?" is unavailable. Also what makes I34.5 answerable.
  model             text not null,
  -- Who asked for it. Stamped by the trigger below from `auth.uid()`, never from the payload.
  requested_by      uuid references user_profiles(id),
  created_at        timestamptz not null default now(),
  constraint chk_campaign_concepts_proposals_array check (jsonb_typeof(proposals) = 'array')
);

create index idx_campaign_concepts_tenant_id on campaign_concepts (tenant_id);
-- Newest first is the only read this table has (ADR-0065 d.8).
create index idx_campaign_concepts_brief on campaign_concepts (campaign_brief_id, created_at desc);

comment on table campaign_concepts is
  'ADR-0065: creative concepts PROPOSED against a department brief. Many sets per brief, newest '
  'first (d.8) — regeneration is additive because the model will not reproduce a discarded idea. '
  'Never part of the brief itself (d.6): approving a brief does not approve concepts.';

comment on column campaign_concepts.proposals is
  'ADR-0065 d.3/d.4: the four shapes — strategic thinking, creative direction, pillars, suggested '
  'content types — each carrying the brief field keys it answers. A proposal answering nothing is '
  'kept and marked at render time (d.5), not dropped and not flagged in a column.';

alter table campaign_concepts enable row level security;
alter table campaign_concepts force row level security;

-- Read: mirrors `campaign_briefs_tenant_select` exactly (ADR-0065 d.6). A concept is read by the
-- people doing the work, and narrowing it to the owning department would hide it from the account
-- team who commissioned the brief in the first place.
create policy campaign_concepts_tenant_select on campaign_concepts
  for select using (tenant_id = app.current_tenant_id());

-- Write: the same grant that already permits editing that department's brief (ADR-0065 d.7). No
-- new permission — ADR-0055's rule is that a permission is added when the JOB differs, and asking
-- for concepts on a brief you may already rewrite is not a different job.
create policy campaign_concepts_manage_insert on campaign_concepts
  for insert with check (
    tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage')
  );

-- Discard, per d.8. Deliberately no UPDATE policy beside it.
create policy campaign_concepts_manage_delete on campaign_concepts
  for delete using (
    tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage')
  );

-- A missing policy already denies under RLS; the revoke is belt-and-braces against a future
-- migration adding an UPDATE policy without reading the header above.
revoke update on campaign_concepts from authenticated, anon;

-- `requested_by` is stamped here rather than sent by the caller. The Edge Function could set it
-- honestly and intends to, but an RPC is a front door (ADR-0055's phrasing) and this column is the
-- only record of who asked the model for this — the thing you would want to be true, not merely
-- intended, if a proposal ever has to be accounted for. Overwrites whatever arrived.
create or replace function app.tg_campaign_concept_stamp_requester()
returns trigger language plpgsql security invoker
set search_path = public, app, extensions as $$
begin
  new.requested_by := auth.uid();
  return new;
end $$;

comment on function app.tg_campaign_concept_stamp_requester() is
  'ADR-0065: who asked for a concept set comes from auth.uid(), never from the payload.';

create trigger campaign_concept_stamp_requester
  before insert on campaign_concepts
  for each row execute function app.tg_campaign_concept_stamp_requester();

commit;
