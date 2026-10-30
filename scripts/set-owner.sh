#!/usr/bin/env bash
set -euo pipefail

APP_NAMESPACE="${APP_NAMESPACE:-traceforge}"
DATA_NAMESPACE="${DATA_NAMESPACE:-traceforge-data}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$#" -ne 1 ] || [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "Usage: scripts/set-owner.sh TEAM_IDENTIFIER"
  echo "Example: scripts/set-owner.sh service-monitoring"
  exit 1
fi

owner="$1"
custom_prop="dt.owner=${owner}"
owner_label="dt.owner=${owner}"

if [ -f .env ]; then
  tmp="$(mktemp)"
  awk -v value="$custom_prop" '
    BEGIN { done = 0 }
    /^DT_CUSTOM_PROP=/ {
      if (!done) {
        print "DT_CUSTOM_PROP=" value
        done = 1
      }
      next
    }
    { print }
    END {
      if (!done) print "DT_CUSTOM_PROP=" value
    }
  ' .env > "$tmp"
  mv "$tmp" .env
fi

kubectl -n "$APP_NAMESPACE" set env deployment --all "DT_CUSTOM_PROP=$custom_prop"
kubectl -n "$DATA_NAMESPACE" set env deployment --all "DT_CUSTOM_PROP=$custom_prop"
kubectl -n "$DATA_NAMESPACE" set env statefulset --all "DT_CUSTOM_PROP=$custom_prop"

kubectl label namespace "$APP_NAMESPACE" "$owner_label" --overwrite
kubectl label namespace "$DATA_NAMESPACE" "$owner_label" --overwrite
kubectl -n "$APP_NAMESPACE" label deployment --all "$owner_label" --overwrite
kubectl -n "$APP_NAMESPACE" label service --all "$owner_label" --overwrite
kubectl -n "$DATA_NAMESPACE" label deployment --all "$owner_label" --overwrite
kubectl -n "$DATA_NAMESPACE" label statefulset --all "$owner_label" --overwrite
kubectl -n "$DATA_NAMESPACE" label service --all "$owner_label" --overwrite

patch_template_label() {
  local namespace="$1"
  local kind="$2"

  while IFS= read -r resource; do
    [ -n "$resource" ] || continue
    kubectl patch -n "$namespace" "$resource" --type merge \
      -p "{\"spec\":{\"template\":{\"metadata\":{\"labels\":{\"dt.owner\":\"${owner}\"}}}}}"
  done < <(kubectl get "$kind" -n "$namespace" -o name 2>/dev/null || true)
}

patch_template_label "$APP_NAMESPACE" deployment
patch_template_label "$DATA_NAMESPACE" deployment
patch_template_label "$DATA_NAMESPACE" statefulset

"$ROOT/scripts/restart-workloads.sh"
