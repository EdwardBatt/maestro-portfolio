-- I35.7 (ADR-0022, ADR-0066's filename thread) — `media_records` keeps the name it was given.
--
-- THE DEFECT. `review-media` receives `fileName` from the browser, builds an object key
-- `<tenant>/<deliverable>/<uuid>-<sanitised name>` out of it, signs the upload, and then
-- **discards the name**. `media_records` has no column for it. Compare `assets`, which has stored
-- `name` since ADR-0022 and does the right thing.
--
-- The visible consequence was a download called `a3f9c1e2-1234-4abc-9def-0123456789ab-Brief_v2.pdf`.
-- `I35.1` stopped that by recovering the name from the key (`_shared/download-name.ts`), but a key
-- carries only the SANITISED name — every space is an underscore, every non-word character is gone
-- — so recovery is a rescue, not a fix. This column is the fix.
--
-- WHY THE VERSION GOES IN THE DOWNLOADED NAME (Edward, 3 Sep). A reviewer downloading v1 and then
-- v3 of the same file gets two files with the identical name; the browser silently calls the second
-- one `Brief (1).pdf` and now nobody can tell which round it belongs to — on the one surface whose
-- entire job is telling rounds apart. `version` is already stored and already unique per
-- deliverable (`uq_media_records_deliverable_version`), so nothing new is needed to say it.
--
-- NULLABLE, DELIBERATELY. Existing rows genuinely do not know their filename; there is nowhere to
-- backfill it FROM except the key, and writing a sanitised guess into a column that means "the name
-- the person uploaded" would make every old row indistinguishable from a real one. Null means "this
-- predates the column", the signer falls back to `nameFromObjectKey`, and the difference stays
-- visible instead of being papered over.

begin;

alter table media_records add column if not exists file_name text;

comment on column media_records.file_name is
  'I35.7: the filename as uploaded, verbatim. NULL on rows created before 2026-09-03, which fall '
  'back to recovering the sanitised name from object_key (_shared/download-name.ts) — a rescue, '
  'not the original. The download name appends the version (Edward, 3 Sep): two rounds of one file '
  'must not arrive with the same name.';

commit;
