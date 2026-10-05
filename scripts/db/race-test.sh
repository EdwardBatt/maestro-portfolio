#!/usr/bin/env bash
# M4.4 — race-condition proof for the exclusion constraint.
# Two concurrent sessions try to CONFIRM overlapping bookings on the same
# EXCLUSIVE resource. Exactly one must win; the loser must get SQLSTATE 23P01.
# The second session's INSERT blocks on the first's in-flight constraint check
# and errors the moment the first commits — that ordering is what this proves.
set -euo pipefail
cd "$(dirname "$0")/../.."

DB=maestro_race
sudo -u postgres dropdb --if-exists $DB
sudo -u postgres createdb $DB
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d $DB -f scripts/db/local-stub.sql
for f in supabase/migrations/*.sql; do sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d $DB -f "$f"; done

sudo -u postgres psql -q -d $DB <<'SQL'
insert into tenants (id, name, slug) values ('aaaaaaaa-0000-0000-0000-000000000001', 'T', 't');
insert into resources (id, tenant_id, kind, name, capacity_model)
values ('aaaaaaaa-0000-0000-0000-00000000d002', 'aaaaaaaa-0000-0000-0000-000000000001', 'equipment', 'Camera', 'exclusive');
SQL

# Session 1: begin, insert confirmed, hold the transaction open 2s, commit.
sudo -u postgres psql -d $DB <<'SQL' &
begin;
insert into bookings (tenant_id, resource_id, starts_at, ends_at, state)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d002',
        '2026-08-10T09:00Z', '2026-08-10T13:00Z', 'confirmed');
select pg_sleep(2);
commit;
SQL
S1=$!

sleep 0.5
# Session 2: overlapping confirmed insert — must BLOCK until S1 commits, then fail 23P01.
set +e
OUT=$(sudo -u postgres psql -d $DB -c "
insert into bookings (tenant_id, resource_id, starts_at, ends_at, state)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d002',
        '2026-08-10T11:00Z', '2026-08-10T15:00Z', 'confirmed');" 2>&1)
S2_RC=$?
set -e
wait $S1

COUNT=$(sudo -u postgres psql -tAc "select count(*) from bookings where state='confirmed'" -d $DB)

echo "---"
echo "loser output: $OUT"
echo "confirmed bookings: $COUNT"
if [[ $S2_RC -ne 0 && "$OUT" == *"23P01"* || "$OUT" == *"conflicting key value violates exclusion constraint"* ]] && [[ "$COUNT" == "1" ]]; then
  echo "RACE TEST PASS: one winner, loser rejected by exclusion constraint"
  exit 0
else
  echo "RACE TEST FAIL"
  exit 1
fi
