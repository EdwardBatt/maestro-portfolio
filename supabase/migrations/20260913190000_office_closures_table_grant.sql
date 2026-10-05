-- I41.11 follow-up (13 Sep) — the table privilege the closures table was created without.
--
-- `20260913150000` created `office_closures` with RLS and policies, and — like every migration on
-- this project (traps.md, "42501 permission denied for table … with RLS never consulted") — granted
-- no TABLE privilege. The seed's stand-in (`grant … on all tables in schema public`) covers a table
-- only if it exists when the seed runs; applied by `migration up` after a reset, the new table had
-- no key at all and the schedule's `offices(…, office_closures(…))` embed returned 403 on every
-- resource read. Explicit here, as `20260911122000` did for its two tables. Idempotent.

begin;
grant select, insert, update, delete on table public.office_closures to authenticated, service_role;
commit;
