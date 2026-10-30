#!/usr/bin/env bash
set -euo pipefail

APP_NAMESPACE="${APP_NAMESPACE:-obs-demo}"
DATA_NAMESPACE="${DATA_NAMESPACE:-obs-demo-data}"

restart_kind() {
  local namespace="$1"
  local kind="$2"

  while IFS= read -r resource; do
    [ -n "$resource" ] || continue
    kubectl rollout restart -n "$namespace" "$resource"
  done < <(kubectl get "$kind" -n "$namespace" -o name 2>/dev/null || true)
}

wait_kind() {
  local namespace="$1"
  local kind="$2"

  while IFS= read -r resource; do
    [ -n "$resource" ] || continue
    kubectl rollout status -n "$namespace" "$resource" --timeout=240s
  done < <(kubectl get "$kind" -n "$namespace" -o name 2>/dev/null || true)
}

restart_kind "$APP_NAMESPACE" deployment
restart_kind "$DATA_NAMESPACE" deployment
restart_kind "$DATA_NAMESPACE" statefulset

wait_kind "$APP_NAMESPACE" deployment
wait_kind "$DATA_NAMESPACE" deployment
wait_kind "$DATA_NAMESPACE" statefulset
