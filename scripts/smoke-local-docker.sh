#!/usr/bin/env bash
# Runtime smoke test: start every built image via the local runner and prove each entrypoint loads.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SETTLE_SECONDS="${SMOKE_SETTLE_SECONDS:-15}"
URL="http://localhost:18000/api/status"

cleanup() { ./scripts/stop-local-docker.sh >/dev/null 2>&1 || true; }
trap cleanup EXIT

fail() {
  echo "SMOKE TEST FAILED: $1" >&2
  for c in $(docker ps -a --filter name=obs-demo- --filter status=exited --filter status=dead --format '{{.Names}}'); do
    echo "--- $c (exited, last logs) ---" >&2
    docker logs --tail 15 "$c" >&2 2>&1 || true
  done
  exit 1
}

./scripts/run-local-docker.sh || fail "run-local-docker.sh did not report ready"

sleep "$SETTLE_SECONDS"

running="$(docker ps --filter name=obs-demo- --format '{{.Names}}')"
all="$(docker ps -a --filter name=obs-demo- --format '{{.Names}}')"
down="$(comm -13 <(sort <<<"$running") <(sort <<<"$all"))"
[ -z "$down" ] || fail "containers not running: $(echo $down)"

code=000
for _ in 1 2 3 4 5; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$URL")"
  [ "$code" = 200 ] && break
  sleep 2
done
[ "$code" = 200 ] || fail "$URL returned $code"

echo "Smoke test passed: $(echo "$running" | wc -l | tr -d ' ') containers running, $URL returned 200"
