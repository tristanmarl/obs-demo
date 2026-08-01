#!/usr/bin/env bash
set -euo pipefail

for container in \
  nebulatrace-control-ui nebulatrace-gateway-api nebulatrace-load-generator \
  nebulatrace-catalog-api nebulatrace-job-api nebulatrace-cache-api nebulatrace-result-api \
  nebulatrace-analysis-api nebulatrace-mock-llm nebulatrace-job-worker nebulatrace-grpc-service \
  nebulatrace-aws-lambda-trigger nebulatrace-azure-functions-trigger nebulatrace-google-cloud-function-trigger \
  nebulatrace-postgres nebulatrace-activemq nebulatrace-redis
do
  docker rm -f "$container" >/dev/null 2>&1 || true
done

docker network rm nebulatrace >/dev/null 2>&1 || true
