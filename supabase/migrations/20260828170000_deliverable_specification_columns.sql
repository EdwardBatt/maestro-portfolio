-- I18.3 (ADR-0051 d.7, d.8, d.9) — the specification moves onto the deliverable row.
--
-- `create_campaign_from_brief` receives `quantity` in `p_brief` and writes a deliverable row
-- without it. Nothing is lost and nothing is reachable either: a value inside
-- `campaigns.brief -> 'deliverables'` cannot be filtered on a list screen, counted in a report,
-- constrained by a check, joined to an SLA profile, or used to decide what work a deliverable
-- implies. It can only be read back by the wizard that wrote it.
--
-- That was a reasonable call when a deliverable was a line on a brief. It stops being one the
-- moment the deliverable is the thing the system schedules, reviews and ships.
--
-- `deliverable_type_id` IS NULLABLE AND STAYS NULLABLE (d.7). Every deliverable that exists today
-- has no type, and each must keep working untouched — on the list screens, in review, in
-- scheduling, in the dashboards. An untyped deliverable is a legal, permanent state, not a
-- migration failure waiting to be cleaned up. d.8: it is shown as "no type set" and never filtered
-- out of a list it would otherwise appear in.
--
-- The six attribute columns hold the CODE of a `deliverable_attribute_values` row as text, not an
-- FK. A tenant deactivating a value must not orphan or block the deliverables already carrying it,
-- and a code that no longer resolves renders as the raw code rather than blank (d.8).

begin;

alter table deliverables
  add column deliverable_type_id uuid references deliverable_types(id),
  -- Quantity describes what the deliverable IS — "500 business cards" is one artwork and one
  -- approval with a print run of 500. It does NOT expand into separate deliverables: ADR-0058
  -- supersedes the d.11 that said it did, because approval was always per sub-task and only the
  -- FILE was attached to the wrong row.
  add column quantity integer not null default 1 check (quantity >= 1),
  add column channel text,
  add column format text,
  add column orientation text,
  add column production_type text,
  add column complexity text,
  add column client_approval text;

create index idx_deliverables_deliverable_type_id on deliverables (deliverable_type_id);

comment on column deliverables.deliverable_type_id is
  'ADR-0051 d.7: nullable FOREVER. Every deliverable created before this migration has no type and '
  'must keep working; an untyped deliverable is a legal permanent state, never filtered out (d.8).';
comment on column deliverables.quantity is
  'ADR-0051 d.9, as corrected by ADR-0058: how many of this thing the deliverable covers. It does '
  'NOT split into separate deliverables — six reels are six SUB-TASKS under one deliverable, each '
  'with its own artefact and its own approval.';
comment on column deliverables.channel is
  'ADR-0051 d.9: the CODE of a deliverable_attribute_values row, held as text rather than an FK so '
  'deactivating a value cannot orphan or block the deliverables already carrying it. Same for '
  'format, orientation, production_type, complexity and client_approval.';

-- ------------------------------------------------------------------ read-across ----
-- What the wizard already captured, lifted out of the jsonb it was filed into. `quantity` is the
-- only specification value that has ever been collected (`campaign-api.ts:158`), and it is matched
-- by NAME against the same campaign's deliverables, because the jsonb rows carry no id.
--
-- A name that matches more than one deliverable in the same campaign is SKIPPED, not guessed: two
-- rows called "Key visual" give no way to tell which quantity belongs to which, and a silently
-- wrong 6 is worse than a visible 1 that somebody corrects. The count is reported so the size of
-- that residue is known rather than assumed.
with candidate as (
  select
    d.id,
    (b.row_value ->> 'quantity')::int as qty,
    count(*) over (partition by c.id, lower(trim(b.row_value ->> 'name'))) as name_hits
  from campaigns c
  cross join lateral jsonb_array_elements(coalesce(c.brief -> 'deliverables', '[]'::jsonb)) as b(row_value)
  join streams s on s.campaign_id = c.id
  join deliverables d on d.stream_id = s.id
    and lower(trim(d.name)) = lower(trim(b.row_value ->> 'name'))
  where jsonb_typeof(c.brief -> 'deliverables') = 'array'
    and (b.row_value ->> 'quantity') ~ '^[0-9]+$'
    and (b.row_value ->> 'quantity')::int >= 1
),
applied as (
  update deliverables d set quantity = cnd.qty
  from candidate cnd
  where d.id = cnd.id and cnd.name_hits = 1 and cnd.qty <> d.quantity
  returning 1
)
select count(*) as quantities_read_across_from_campaign_brief from applied;

commit;
