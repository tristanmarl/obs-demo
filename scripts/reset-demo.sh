#!/usr/bin/env bash
set -euo pipefail

kubectl -n nebulatrace set env deployment/artifact-api deployment/release-api deployment/quota-api deployment/deployment-worker deployment/mock-llm deployment/runner-agent SCENARIO_MODE=stable
kubectl apply -f deploy/k8s/istio/istio.yaml
kubectl -n nebulatrace rollout restart deployment/artifact-api deployment/release-api deployment/quota-api deployment/deployment-worker deployment/mock-llm deployment/runner-agent
