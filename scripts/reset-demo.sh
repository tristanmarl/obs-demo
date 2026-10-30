#!/usr/bin/env bash
# Resets every scenario: all flags off (ConfigMap rewritten directly, so this works with the gateway down)
# and the stable cache-api VirtualService. No workload restarts; flagd re-syncs within seconds.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

./scripts/flags-configmap.sh | kubectl apply -f -
kubectl apply -f deploy/k8s/istio/istio.yaml
kubectl -n obs-demo rollout status deployment/flagd --timeout=120s
echo "Scenarios reset; flagd picks up the stable flags within a few seconds."
