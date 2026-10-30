#!/usr/bin/env bash
set -euo pipefail

for container in \
  obs-demo-control-ui obs-demo-gateway-api obs-demo-load-generator \
  obs-demo-catalog-api obs-demo-job-api obs-demo-cache-api obs-demo-result-api \
  obs-demo-analysis-api obs-demo-mock-llm obs-demo-job-worker obs-demo-grpc-service \
  obs-demo-aws-lambda-trigger obs-demo-azure-functions-trigger obs-demo-google-cloud-function-trigger \
  obs-demo-cache-exporter obs-demo-queue-exporter \
  obs-demo-postgres obs-demo-activemq obs-demo-redis
do
  docker rm -f "$container" >/dev/null 2>&1 || true
done

docker network rm obs-demo >/dev/null 2>&1 || true
