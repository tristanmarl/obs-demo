#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

./scripts/stop-local-docker.sh >/dev/null 2>&1 || true
docker network create nebulatrace >/dev/null

python3 - <<'PY' >/tmp/nebulatrace-init.sql
from pathlib import Path

text = Path("deploy/k8s/data/postgres-init.yaml").read_text()
start = text.index("    create table")
print("\n".join(line[4:] if line.startswith("    ") else line for line in text[start:].splitlines()))
PY

docker run -d --name nebulatrace-postgres --network nebulatrace --network-alias postgres \
  -e POSTGRES_USER=nebulatrace -e POSTGRES_PASSWORD=nebulatrace -e POSTGRES_DB=nebulatrace \
  -v /tmp/nebulatrace-init.sql:/docker-entrypoint-initdb.d/001-schema.sql:ro postgres:16-alpine >/dev/null
docker run -d --name nebulatrace-activemq --network nebulatrace --network-alias activemq apache/activemq-classic:6.1.7 >/dev/null
docker run -d --name nebulatrace-redis --network nebulatrace --network-alias redis redis:7-alpine >/dev/null

for _ in $(seq 1 40); do
  docker exec nebulatrace-postgres pg_isready -U nebulatrace >/dev/null 2>&1 && break
  sleep 1
done
for _ in $(seq 1 60); do
  docker exec nebulatrace-activemq bash -lc 'test -S /tmp/activemq/activemq.pid || pgrep -f activemq' >/dev/null 2>&1 && break
  sleep 1
done

otel_env=(-e OTEL_TRACES_EXPORTER=none -e OTEL_METRICS_EXPORTER=none -e OTEL_LOGS_EXPORTER=none)
image="${IMAGE_REGISTRY:-nebulatrace}"
tag="${IMAGE_TAG:-dev}"

docker run -d --name nebulatrace-catalog-api --network nebulatrace --network-alias catalog-api \
  -e SPRING_DATASOURCE_URL=jdbc:postgresql://postgres:5432/nebulatrace \
  -e SPRING_DATASOURCE_USERNAME=nebulatrace -e SPRING_DATASOURCE_PASSWORD=nebulatrace "$image/catalog-api:$tag" >/dev/null
docker run -d --name nebulatrace-cache-api --network nebulatrace --network-alias cache-api \
  -e REDIS_URL=redis://redis:6379 "$image/cache-api:$tag" >/dev/null
docker run -d --name nebulatrace-result-api --network nebulatrace --network-alias result-api "$image/result-api:$tag" >/dev/null
docker run -d --name nebulatrace-mock-llm --network nebulatrace --network-alias mock-llm "${otel_env[@]}" "$image/mock-llm:$tag" >/dev/null
docker run -d --name nebulatrace-analysis-api --network nebulatrace --network-alias analysis-api \
  "${otel_env[@]}" -e LLM_URL=http://mock-llm:8080 "$image/analysis-api:$tag" >/dev/null
docker run -d --name nebulatrace-grpc-service --network nebulatrace --network-alias grpc-service "${otel_env[@]}" "$image/grpc-service:$tag" >/dev/null
docker run -d --name nebulatrace-job-api --network nebulatrace --network-alias job-api \
  "${otel_env[@]}" -e DATABASE_URL=postgresql://nebulatrace:nebulatrace@postgres:5432/nebulatrace \
  -e ACTIVEMQ_HOST=activemq -e ACTIVEMQ_STOMP_PORT=61613 "$image/job-api:$tag" >/dev/null
docker run -d --name nebulatrace-job-worker --network nebulatrace --network-alias job-worker \
  "${otel_env[@]}" -e DATABASE_URL=postgresql://nebulatrace:nebulatrace@postgres:5432/nebulatrace \
  -e ACTIVEMQ_HOST=activemq -e ACTIVEMQ_STOMP_PORT=61613 -e RESULT_URL=http://result-api:8080 \
  -e GRPC_ADDRESS=grpc-service:50051 "$image/job-worker:$tag" >/dev/null
docker run -d --name nebulatrace-gateway-api --network nebulatrace --network-alias gateway-api \
  -e CATALOG_URL=http://catalog-api:8080 -e CACHE_URL=http://cache-api:8080 \
  -e JOB_URL=http://job-api:8080 -e ANALYSIS_URL=http://analysis-api:8080 "$image/gateway-api:$tag" >/dev/null
for provider in aws azure gcp; do
  case "$provider" in
    aws) name=aws-lambda-trigger ;;
    azure) name=azure-functions-trigger ;;
    gcp) name=google-cloud-function-trigger ;;
  esac
  docker run -d --name "nebulatrace-$name" --network nebulatrace "${otel_env[@]}" \
    -e SERVICE_NAME="$name" -e FAAS_FUNCTION_NAME="$name" -e FAAS_PROVIDER="$provider" \
    -e GATEWAY_URL=http://gateway-api:8080 "$image/function-trigger:$tag" >/dev/null
done
docker run -d --name nebulatrace-load-generator --network nebulatrace \
  -e GATEWAY_URL=http://gateway-api:8080 -e LOADGEN_DELAY_MS="${LOADGEN_DELAY_MS:-750}" \
  -e LOADGEN_BURST="${LOADGEN_BURST:-1}" "$image/load-generator:$tag" >/dev/null
docker run -d --name nebulatrace-cache-exporter --network nebulatrace --network-alias cache-exporter \
  -e REDIS_URL=redis://redis:6379 "$image/cache-exporter:$tag" >/dev/null
docker run -d --name nebulatrace-queue-exporter --network nebulatrace --network-alias queue-exporter \
  "${otel_env[@]}" -e DATABASE_URL=postgresql://nebulatrace:nebulatrace@postgres:5432/nebulatrace \
  "$image/queue-exporter:$tag" >/dev/null
docker run -d --name nebulatrace-control-ui --network nebulatrace -p 18000:8080 \
  "$image/control-ui:$tag" >/dev/null

ready=false
for _ in $(seq 1 30); do
  if [ "$(curl -s -o /dev/null -w "%{http_code}" http://localhost:18000/api/status)" = "200" ]; then
    ready=true
    break
  fi
  sleep 1
done

if [ "$ready" != true ]; then
  echo "NebulaTrace did not become ready. Check logs with: docker logs nebulatrace-control-ui" >&2
  exit 1
fi

echo "NebulaTrace is running: http://localhost:18000"
