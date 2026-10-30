#!/usr/bin/env bash
set -euo pipefail

kubectl -n traceforge set env deployment/catalog-api deployment/job-worker deployment/cache-api deployment/mock-llm deployment/grpc-service SCENARIO_MODE=stable
kubectl apply -f deploy/k8s/istio/istio.yaml
kubectl -n traceforge rollout restart deployment/catalog-api deployment/job-worker deployment/cache-api deployment/mock-llm deployment/grpc-service deployment/aws-lambda-trigger deployment/azure-functions-trigger deployment/google-cloud-function-trigger
kubectl -n traceforge rollout status deployment/catalog-api --timeout=180s
