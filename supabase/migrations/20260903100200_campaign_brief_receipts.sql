-- I35.5 (ADR-0066) — evidence that a brief was issued, and when.
--
-- WHY THIS TABLE EXISTS. Everything after a campaign enters Maestro is measured; the interval
-- BEFORE it is invisible, and that interval is the agency's own responsiveness. `campaigns.status`
-- and `approved_at` (ADR-0048 d.8) already record the END of it to the second. Only the START was
-- missing — and an asserted start is worth little in the conversation this exists to have, which is
-- a conversation with a client about who was waiting for whom. Hence a screenshot of the request as
-- it actually arrived.
--
-- `received_at` IS NOT `captured_at`, AND THE WHOLE FEATURE TURNS ON IT (ADR-0066 d.5, Edward's
-- correction, 3 Sep). A brief that arrived Tuesday 14:32 and was screenshotted Wednesday 09:00 is
-- eighteen and a half hours old before the wizard opens — most of a 24-hour threshold, spent before
-- Maestro knew the campaign existed. Anchoring on the upload would forgive exactly the delay being
-- measured, and would do it INVISIBLY, because the number on screen would look reasonable. So the
-- two are separate columns and the clock reads only the first. A receipt may therefore be in
-- exception the moment it is entered; that is correct, not a bug to soften.
--
-- EVERYTHING IS NULLABLE, DELIBERATELY. The model proposes and a person confirms (d.4), so the row
-- exists in an unconfirmed state; and a partial timestamp stays partial (d.13) because screenshots
-- routinely do not state an absolute moment — WhatsApp shows `14:32`, mail clients show `Yesterday`
-- — and completing one is an inference the model is not permitted to make. A half-filled receipt is
-- a legitimate state that a person is about to finish. What the CHECK below enforces is only that a
-- CONFIRMED receipt is a complete one.
--
-- THE CLOCK NEVER RUNS ON AN UNCONFIRMED ROW. `received_at` alone starts nothing; `confirmed_at`
-- is what makes it a fact somebody stands behind, which is the entire reason option A (use the
-- model's reading directly) was rejected.
--
-- WHY THE IMAGE IS AN ORDINARY ASSET (d.2). Evidence lives in the Library with every other
-- document — versioned, permissioned and downloadable — rather than in a private column only this
-- feature can read. `on delete set null` rather than cascade: deleting the screenshot must not
-- silently delete the record that a brief was received, and a receipt whose evidence is gone is
-- something a reader should SEE rather than something that quietly disappears.
--
-- ONE RECEIPT PER CAMPAIGN (d.1), so `campaign_id` is unique. This is not `campaign_concepts`,
-- where many sets are the point: there is one moment a brief arrived, and a second row would be a
-- second answer to a question that has one.

begin;

create table campaign_brief_receipts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  campaign_id  uuid not null unique references campaigns(id) on delete cascade,
  -- The screenshot, filed in the campaign's References folder (d.2). Null once somebody deletes it
  -- from the Library — visible loss, not silent.
  asset_id     uuid references assets(id) on delete set null,
  -- The three things read off the image (d.4). Proposed by the model, confirmed by a person.
  subject      text,
  -- The timestamp INSIDE the image. The clock's origin, and never the upload moment.
  received_at  timestamptz,
  -- The zone `received_at` was interpreted in (d.14). A screenshot carries a wall-clock reading
  -- with no offset — the sender's mail client rendered it in the READER's zone and the image cannot
  -- say which — so a zone is chosen rather than assumed, and it is stored so it can be SHOWN. An
  -- IANA name (`Asia/Dubai`), not an offset: offsets change twice a year and names do not.
  received_tz  text,
  -- When the screenshot reached us. Stamped by the trigger below, never sent by the caller.
  captured_at  timestamptz not null default now(),
  -- Which path produced the fields, so "did a machine read this?" is answerable later.
  source       text not null default 'model' check (source in ('model', 'manual')),
  -- Which model read it. Null when a person typed the fields. Model choice is configuration
  -- (ADR-0049 d.9) and can change between two receipts, so the row records its own.
  model        text,
  -- Who stands behind the values, and when they said so. Stamped from auth.uid(), never trusted.
  confirmed_by uuid references user_profiles(id),
  confirmed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- A confirmed receipt is a complete one. Unconfirmed rows may be as partial as the image was.
  constraint chk_brief_receipt_confirmed_is_complete check (
    confirmed_at is null
    or (received_at is not null and received_tz is not null and confirmed_by is not null)
  )
);

create index idx_campaign_brief_receipts_tenant on campaign_brief_receipts (tenant_id);
-- The exception query (d.9) reads confirmed receipts by time. Partial: an unconfirmed receipt
-- starts no clock, so it is never in the answer.
create index idx_campaign_brief_receipts_clock
  on campaign_brief_receipts (tenant_id, received_at)
  where confirmed_at is not null;

comment on table campaign_brief_receipts is
  'ADR-0066: evidence that a brief was issued, and when. One per campaign. received_at is the '
  'timestamp INSIDE the screenshot and is the clock''s origin; captured_at is when the screenshot '
  'reached us and is never the clock''s origin (d.5). The clock runs only on a CONFIRMED row.';

comment on column campaign_brief_receipts.received_at is
  'ADR-0066 d.5: read off the image, NOT the upload time. A brief received Tuesday 14:32 and '
  'screenshotted Wednesday 09:00 is already 18.5 hours old; anchoring on upload would forgive '
  'exactly the delay this measures, invisibly. May be null while a person completes a partial '
  'timestamp the model was not allowed to guess at (d.13).';

comment on column campaign_brief_receipts.confirmed_at is
  'ADR-0066 d.4/d.5: the model PROPOSES and a person CONFIRMS. Nothing is measured from an '
  'unconfirmed row — an unchecked machine reading of a date invents a breach or hides one, and '
  'nothing on screen would say which.';

alter table campaign_brief_receipts enable row level security;
alter table campaign_brief_receipts force row level security;

-- Read: anyone in the tenant, mirroring the campaign it belongs to. Evidence that is only visible
-- to the person who filed it is not evidence.
create policy campaign_brief_receipts_tenant_select on campaign_brief_receipts
  for select to authenticated
  using (tenant_id = app.current_tenant_id());

-- Write: the campaign's own write rule, verbatim (`campaigns_tenant_write`, as narrowed by
-- `20260812130000_scope_project_writes`). A receipt is a property of the campaign, so recording one
-- is the same job as creating the campaign — ADR-0055's test is whether the JOB differs, and it does
-- not, so no new permission is added.
create policy campaign_brief_receipts_manage_write on campaign_brief_receipts
  for all to authenticated
  using (
    tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage')
    and app.in_write_scope(null, null, app.campaign_account_manager(campaign_id))
  )
  with check (
    tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage')
    and app.in_write_scope(null, null, app.campaign_account_manager(campaign_id))
  );

-- `captured_at` and the confirmation stamp come from the server, not the payload. The client could
-- set them honestly and intends to, but an RPC is a front door (ADR-0055's phrasing) and these are
-- the columns an accountability measure rests on — the things you want to be TRUE, not merely
-- intended, if a receipt is ever argued over.
--
-- Re-stamping on every confirmed write is deliberate: editing a confirmed receipt is a fresh act of
-- standing behind it, so `confirmed_by` names whoever last did, not whoever first did.
create or replace function app.tg_brief_receipt_stamp()
returns trigger language plpgsql security invoker
set search_path = public, app, extensions as $$
begin
  if tg_op = 'INSERT' then
    new.captured_at := now();
  else
    new.captured_at := old.captured_at;
  end if;

  if new.confirmed_at is not null then
    new.confirmed_by := auth.uid();
    new.confirmed_at := now();
  else
    new.confirmed_by := null;
  end if;

  return new;
end $$;

comment on function app.tg_brief_receipt_stamp() is
  'ADR-0066: captured_at is when the server saw the screenshot and cannot be back-dated by a '
  'caller; who confirmed comes from auth.uid(). received_at is NOT touched — it is read off the '
  'image and is the one timestamp a person is allowed to state.';

create trigger campaign_brief_receipt_stamp
  before insert or update on campaign_brief_receipts
  for each row execute function app.tg_brief_receipt_stamp();

create trigger set_updated_at before update on campaign_brief_receipts
  for each row execute function app.set_updated_at();

commit;
