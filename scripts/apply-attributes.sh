#!/usr/bin/env bash
# Uploads config/attributes.yaml to the obs-demo-attributes ConfigMap and runs the gateway-api
# implementation (merge, validate, patch). Usage: scripts/apply-attributes.sh [--preview]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAMESPACE="${APP_NAMESPACE:-obs-demo}"

case "${1:-}" in
  ""|--preview) ;;
  *) echo "Usage: scripts/apply-attributes.sh [--preview]"; exit 1 ;;
esac

"$ROOT/scripts/attributes-configmap.sh" | kubectl apply -f -
kubectl -n "$APP_NAMESPACE" rollout status deployment/gateway-api --timeout=180s
kubectl -n "$APP_NAMESPACE" exec deploy/gateway-api -c gateway-api -- node apply-attributes.js ${1:-}
