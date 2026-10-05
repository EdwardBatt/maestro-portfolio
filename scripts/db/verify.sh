#!/usr/bin/env bash
# Database verification: fresh DB → Supabase stubs → all migrations → pgTAP suite.
#
# Two backends, chosen automatically:
#
#   native  a local postgres superuser reachable via `sudo -u postgres` (Linux, and the CI job).
#           Needs pgTAP + pg_prove installed on the host.
#   docker  a throwaway postgres:16 container with pgTAP installed into it. Works with Docker or
#           Podman — the image is fully qualified (docker.io/library/...) because Podman refuses
#           short names unless the host configures a search registry. Used when there is
#           no `sudo -u postgres` — notably on Windows, where the native path cannot work at all.
#           Nothing is left behind: the container is removed on exit, success or failure.
#
# The docker path exists because the repo is remote-only for DEVELOPMENT (no local Supabase stack,
# README "Getting started") — that rules out a local *Supabase*, not a disposable Postgres for
# running the test suite. It touches no project database.
#
# Force one with: scripts/db/verify.sh --docker  |  --native
set -euo pipefail
cd "$(dirname "$0")/../.."

DB=maestro_verify
# MAESTRO_VERIFY_CONTAINER lets parallel runs (several worktrees at once) keep their own container.
CONTAINER="${MAESTRO_VERIFY_CONTAINER:-maestro-pgtap-verify}"
BACKEND="${1:-auto}"

if [ "$BACKEND" = "auto" ]; then
  if sudo -n -u postgres true 2>/dev/null || sudo -u postgres true 2>/dev/null; then
    BACKEND=--native
  elif command -v docker >/dev/null 2>&1; then
    BACKEND=--docker
  else
    echo "No verification backend: need either a 'postgres' superuser via sudo, or Docker." >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------- native --
if [ "$BACKEND" = "--native" ]; then
  PSQL="sudo -u postgres psql -v ON_ERROR_STOP=1 -q"

  sudo -u postgres dropdb --if-exists $DB
  sudo -u postgres createdb $DB

  $PSQL -d $DB -f scripts/db/local-stub.sql
  $PSQL -d $DB -c "create extension if not exists pgtap;"

  for f in supabase/migrations/*.sql; do
    echo "applying $(basename "$f")"
    $PSQL -d $DB -f "$f"
  done

  echo "running pgTAP suite…"
  sudo -u postgres pg_prove -d $DB supabase/tests/*.sql
  exit $?
fi

# ---------------------------------------------------------------------- docker --
if [ "$BACKEND" != "--docker" ]; then
  echo "Unknown backend '$BACKEND' (expected --native or --docker)." >&2
  exit 1
fi

cleanup() { docker rm -f $CONTAINER >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "starting throwaway postgres:16…"
docker run -d --name $CONTAINER -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=$DB docker.io/library/postgres:16 >/dev/null

# Wait for the server, not a fixed sleep — first boot initialises the cluster.
for _ in $(seq 1 60); do
  if docker exec $CONTAINER pg_isready -U postgres -d $DB >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec $CONTAINER pg_isready -U postgres -d $DB >/dev/null

echo "installing pgTAP + pg_prove…"
docker exec $CONTAINER bash -c \
  "apt-get update -qq && apt-get install -y -qq postgresql-16-pgtap libtap-parser-sourcehandler-pgtap-perl" >/dev/null

PSQL="docker exec -i $CONTAINER psql -U postgres -v ON_ERROR_STOP=1 -q -d $DB"

$PSQL < scripts/db/local-stub.sql
echo "create extension if not exists pgtap;" | $PSQL

for f in supabase/migrations/*.sql; do
  echo "applying $(basename "$f")"
  $PSQL < "$f"
done

echo "running pgTAP suite…"
docker cp supabase/tests "$CONTAINER:/tests" >/dev/null
# via a shell: `exec` has no glob expansion, so pg_prove would get the literal "/tests/*.sql".
docker exec $CONTAINER bash -c "pg_prove -U postgres -d $DB /tests/*.sql"
