#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

deployments=(catalog-api job-worker cache-api mock-llm grpc-service result-api aws-lambda-trigger azure-functions-trigger google-cloud-function-trigger)

kubectl -n obs-demo set env "${deployments[@]/#/deployment/}" SCENARIO_MODE=stable
kubectl apply -f deploy/k8s/istio/istio.yaml
kubectl -n obs-demo rollout restart "${deployments[@]/#/deployment/}"
for deployment in "${deployments[@]}"; do
  kubectl -n obs-demo rollout status "deployment/$deployment" --timeout=180s
done
