#!/usr/bin/env bash
set -euo pipefail

for container in \
  traceforge-control-ui traceforge-gateway-api traceforge-load-generator \
  traceforge-catalog-api traceforge-job-api traceforge-cache-api traceforge-result-api \
  traceforge-analysis-api traceforge-mock-llm traceforge-job-worker traceforge-grpc-service \
  traceforge-aws-lambda-trigger traceforge-azure-functions-trigger traceforge-google-cloud-function-trigger \
  traceforge-cache-exporter traceforge-queue-exporter \
  traceforge-postgres traceforge-activemq traceforge-redis
do
  docker rm -f "$container" >/dev/null 2>&1 || true
done

docker network rm traceforge >/dev/null 2>&1 || true
