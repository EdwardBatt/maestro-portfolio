#!/usr/bin/env bash
# ADR-0043 (I14.1) — race-condition proof for the mandatory-reviewer completion rule.
#
# Two mandatory reviewers approve the same task at the same moment. Each stamps their own row and
# then counts how many mandatory approvals are still outstanding — and under READ COMMITTED neither
# can see the other's uncommitted stamp. Without a lock both count the other as outstanding, both
# return "not yet", and the task is left with EVERY approval given, status `review` and approved_by
# null. Neither reviewer can approve again, so the task can never reach `done`.
#
# `select … for update` on the task row in app.maybe_complete_sub_task is what serialises it: the
# second session blocks until the first commits and then counts a set that includes it.
#
# WHY THIS IS A SCRIPT AND NOT A pgTAP TEST. pgTAP runs every file in ONE session inside ONE
# transaction that is rolled back, so an interleaving cannot be expressed there at all — a second
# connection cannot even see the uncommitted fixtures. This is the same shape, and the same reason,
# as scripts/db/race-test.sh (M4.4), which proves the booking exclusion constraint.
#
# The pgTAP suite still covers the half that CAN be expressed in one session: 057 builds the raced
# end-state by hand and proves it is no longer terminal.
#
# Backends, chosen automatically, exactly as scripts/db/verify.sh does:
#   native  a local postgres superuser via `sudo -u postgres` (Linux, CI)
#   docker  a throwaway postgres:16 container (Windows, or anywhere without that superuser)
# Force one with: scripts/db/race-test-reviewers.sh --docker | --native
set -euo pipefail
cd "$(dirname "$0")/../.."

DB=maestro_race_reviewers
CONTAINER=maestro-race-reviewers
BACKEND="${1:-auto}"

if [ "$BACKEND" = "auto" ]; then
  if sudo -n -u postgres true 2>/dev/null || sudo -u postgres true 2>/dev/null; then
    BACKEND=--native
  elif command -v docker >/dev/null 2>&1; then
    BACKEND=--docker
  else
    echo "No backend: need either a 'postgres' superuser via sudo, or Docker." >&2
    exit 1
  fi
fi

TENANT=aaaaaaaa-0000-0000-0000-000000000001
TASK=aaaaaaaa-0000-0000-0000-00000000aa01
R1=00000000-0000-0000-0000-0000000000a1
R2=00000000-0000-0000-0000-0000000000a2
MAKER=00000000-0000-0000-0000-0000000000a3

read -r -d '' SEED <<SQL || true
-- One transaction: the task and its reviewers must be written together, or the deferred
-- required-reviewer rule refuses the task at the end of its own implicit transaction. That is the
-- same constraint public.save_sub_task exists to satisfy.
begin;
insert into tenants (id, name, slug) values ('$TENANT', 'T', 't');
select app.seed_tenant_roles('$TENANT');
insert into auth.users (id, email) values
  ('$R1','r1@t.test'), ('$R2','r2@t.test'), ('$MAKER','m@t.test');
insert into user_profiles (id, tenant_id, display_name, role_id)
select v.id::uuid, '$TENANT'::uuid, v.n,
       (select id from roles where tenant_id = '$TENANT' and key = 'power_admin')
from (values ('$R1','R1'), ('$R2','R2'), ('$MAKER','Maker')) as v(id, n);

insert into clients (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000000c1','$TENANT','C');
insert into jobs (id, tenant_id, client_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000000b1','$TENANT','aaaaaaaa-0000-0000-0000-0000000000c1','J');
-- in_progress on purpose: the ad-hoc sign-off branch only fires from in_review, and this test is
-- about the task, not the deliverable.
insert into deliverables (id, tenant_id, job_id, name, state) values
  ('aaaaaaaa-0000-0000-0000-0000000000d1','$TENANT','aaaaaaaa-0000-0000-0000-0000000000b1','D','in_progress');
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status) values
  ('$TASK','$TENANT','aaaaaaaa-0000-0000-0000-0000000000d1','$MAKER','Raced','review');
insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory) values
  ('$TENANT','$TASK','$R1', true),
  ('$TENANT','$TASK','$R2', true);
commit;
SQL

claims () { echo "{\"sub\":\"$1\",\"app_metadata\":{\"tenant_id\":\"$TENANT\"}}"; }

# Session A holds its transaction open for 2s after approving, so B lands inside the window.
read -r -d '' SESSION_A <<SQL || true
begin;
set local role authenticated;
select set_config('request.jwt.claims', '$(claims $R1)', true);
select public.sub_task_approve('$TASK');
select pg_sleep(2);
commit;
SQL

read -r -d '' SESSION_B <<SQL || true
begin;
set local role authenticated;
select set_config('request.jwt.claims', '$(claims $R2)', true);
select public.sub_task_approve('$TASK');
commit;
SQL

# ---------------------------------------------------------------------------- native --
if [ "$BACKEND" = "--native" ]; then
  PSQL="sudo -u postgres psql -v ON_ERROR_STOP=1 -q"
  sudo -u postgres dropdb --if-exists $DB
  sudo -u postgres createdb $DB
  $PSQL -d $DB -f scripts/db/local-stub.sql
  for f in supabase/migrations/*.sql; do $PSQL -d $DB -f "$f"; done
  echo "$SEED" | $PSQL -d $DB

  echo "$SESSION_A" | sudo -u postgres psql -q -d $DB >/dev/null &
  A=$!
  sleep 0.5
  echo "$SESSION_B" | sudo -u postgres psql -q -d $DB >/dev/null
  wait $A
  RESULT=$(sudo -u postgres psql -tAc \
    "select status || '|' || coalesce(approved_by::text,'null') from sub_tasks where id = '$TASK'" -d $DB)

# ---------------------------------------------------------------------------- docker --
elif [ "$BACKEND" = "--docker" ]; then
  cleanup() { docker rm -f $CONTAINER >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  cleanup
  echo "starting throwaway postgres:16…"
  docker run -d --name $CONTAINER -e POSTGRES_PASSWORD=race -e POSTGRES_DB=$DB \
    docker.io/library/postgres:16 >/dev/null
  for _ in $(seq 1 60); do
    docker exec $CONTAINER pg_isready -U postgres -d $DB >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec $CONTAINER pg_isready -U postgres -d $DB >/dev/null

  PSQL="docker exec -i $CONTAINER psql -U postgres -v ON_ERROR_STOP=1 -q -d $DB"
  $PSQL < scripts/db/local-stub.sql
  for f in supabase/migrations/*.sql; do $PSQL < "$f"; done
  echo "$SEED" | $PSQL

  echo "$SESSION_A" | docker exec -i $CONTAINER psql -U postgres -q -d $DB >/dev/null &
  A=$!
  sleep 0.5
  echo "$SESSION_B" | docker exec -i $CONTAINER psql -U postgres -q -d $DB >/dev/null
  wait $A
  RESULT=$(docker exec -i $CONTAINER psql -U postgres -tA -d $DB -c \
    "select status || '|' || coalesce(approved_by::text,'null') from sub_tasks where id = '$TASK'")
else
  echo "Unknown backend '$BACKEND' (expected --native or --docker)." >&2
  exit 1
fi

STATUS="${RESULT%%|*}"
BY="${RESULT##*|}"
echo "---"
echo "task after both approvals: status=$STATUS approved_by=$BY"
if [ "$STATUS" = "done" ] && [ "$BY" != "null" ]; then
  echo "RACE TEST PASS: the second approval saw the first and completed the task"
  exit 0
fi
echo "RACE TEST FAIL: both reviewers approved and the task never completed —"
echo "  every approval given, status '$STATUS', approved_by $BY, and neither can approve again."
exit 1
