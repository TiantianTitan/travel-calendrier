#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Never connect this script to a hosted or existing database. No ports are exposed.
trip_test_container="travel-calendrier-pg-test-$$"
trip_test_log="$(mktemp)"
cleanup() {
  docker rm -f "$trip_test_container" >/dev/null 2>&1 || true
  rm -f "$trip_test_log"
}
trap cleanup EXIT

docker run --rm -d --name "$trip_test_container" -e POSTGRES_PASSWORD=disposable-test-only postgres:17-alpine -c wal_level=logical >/dev/null
for attempt in $(seq 1 60); do
  if docker exec "$trip_test_container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.25
done
docker exec "$trip_test_container" pg_isready -h 127.0.0.1 -U postgres >/dev/null

docker exec -i "$trip_test_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres <<'SQL'
create role anon nologin;
create role authenticated nologin;
SQL

for trip_migration in supabase/migrations/*.sql; do
  docker exec -i "$trip_test_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres < "$trip_migration"
done
# It must be safe to re-run the SQL Editor file without resetting any data.
for trip_migration in supabase/migrations/*.sql; do
  docker exec -i "$trip_test_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres < "$trip_migration"
done
if ! docker exec -i "$trip_test_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres < tests/sql/behavior.sql >"$trip_test_log" 2>&1; then
  cat "$trip_test_log"
  exit 1
fi
rg 'PASS:' "$trip_test_log"
if ! docker exec -i "$trip_test_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres < tests/sql/participation-choices.sql >"$trip_test_log" 2>&1; then
  cat "$trip_test_log"
  exit 1
fi
rg 'PASS:' "$trip_test_log"
if ! docker exec -i "$trip_test_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres < tests/sql/choice-guards.sql >"$trip_test_log" 2>&1; then
  cat "$trip_test_log"
  exit 1
fi
rg 'PASS:' "$trip_test_log"
if ! docker exec -i "$trip_test_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres < tests/sql/overlapping-choices.sql >"$trip_test_log" 2>&1; then
  cat "$trip_test_log"
  exit 1
fi
rg 'PASS:' "$trip_test_log"
if ! docker exec -i "$trip_test_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres < tests/sql/member-profiles.sql >"$trip_test_log" 2>&1; then
  cat "$trip_test_log"
  exit 1
fi
rg 'PASS:' "$trip_test_log"
python3 scripts/test-database.py "$trip_test_container"
npx tsx -e 'import fs from "node:fs"; import {SEED_STATE} from "./src/lib/seed.ts"; const seed=JSON.parse(fs.readFileSync("supabase/seed.json","utf8")); if(JSON.stringify(seed)!==JSON.stringify(SEED_STATE)) throw new Error("SQL and TS seed differ"); console.log("PASS: SQL and TypeScript seed match")'
