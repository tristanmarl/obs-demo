#!/usr/bin/env bash
set -euo pipefail

APP_NAMESPACE="${APP_NAMESPACE:-traceforge}"
DATA_NAMESPACE="${DATA_NAMESPACE:-traceforge-data}"

case "${1:-}" in
  start) replicas=1 ;;
  stop) replicas=0 ;;
  *)
    echo "Usage: scripts/scale-demo.sh start|stop"
    exit 1
    ;;
esac

scale_kind() {
  local namespace="$1"
  local kind="$2"

  while IFS= read -r resource; do
    [ -n "$resource" ] || continue
    kubectl scale -n "$namespace" "$resource" --replicas="$replicas"
  done < <(kubectl get "$kind" -n "$namespace" -o name 2>/dev/null || true)
}

scale_kind "$APP_NAMESPACE" deployment
scale_kind "$DATA_NAMESPACE" deployment
scale_kind "$DATA_NAMESPACE" statefulset
