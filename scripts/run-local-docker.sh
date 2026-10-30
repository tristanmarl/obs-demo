#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

./scripts/stop-local-docker.sh >/dev/null 2>&1 || true
docker network create obs-demo >/dev/null

python3 - <<'PY' >/tmp/obs-demo-init.sql
from pathlib import Path

text = Path("deploy/k8s/data/postgres-init.yaml").read_text()
start = text.index("    create table")
print("\n".join(line[4:] if line.startswith("    ") else line for line in text[start:].splitlines()))
PY

docker run -d --name obs-demo-postgres --network obs-demo --network-alias postgres \
  -e POSTGRES_USER=obs_demo -e POSTGRES_PASSWORD=obs_demo -e POSTGRES_DB=obs_demo \
  -v /tmp/obs-demo-init.sql:/docker-entrypoint-initdb.d/001-schema.sql:ro postgres:16-alpine >/dev/null
docker run -d --name obs-demo-activemq --network obs-demo --network-alias activemq apache/activemq-classic:6.1.7 >/dev/null
docker run -d --name obs-demo-redis --network obs-demo --network-alias redis redis:7-alpine >/dev/null

for _ in $(seq 1 40); do
  docker exec obs-demo-postgres pg_isready -U obs_demo >/dev/null 2>&1 && break
  sleep 1
done
for _ in $(seq 1 60); do
  docker exec obs-demo-activemq bash -lc 'test -S /tmp/activemq/activemq.pid || pgrep -f activemq' >/dev/null 2>&1 && break
  sleep 1
done

otel_env=(-e OTEL_TRACES_EXPORTER=none -e OTEL_METRICS_EXPORTER=none -e OTEL_LOGS_EXPORTER=none)
image="${IMAGE_REGISTRY:-obs-demo}"
tag="${IMAGE_TAG:-dev}"

docker run -d --name obs-demo-catalog-api --network obs-demo --network-alias catalog-api \
  -e SPRING_DATASOURCE_URL=jdbc:postgresql://postgres:5432/obs_demo \
  -e SPRING_DATASOURCE_USERNAME=obs_demo -e SPRING_DATASOURCE_PASSWORD=obs_demo "$image/catalog-api:$tag" >/dev/null
docker run -d --name obs-demo-cache-api --network obs-demo --network-alias cache-api \
  -e REDIS_URL=redis://redis:6379 "$image/cache-api:$tag" >/dev/null
docker run -d --name obs-demo-result-api --network obs-demo --network-alias result-api "$image/result-api:$tag" >/dev/null
docker run -d --name obs-demo-mock-llm --network obs-demo --network-alias mock-llm "${otel_env[@]}" "$image/mock-llm:$tag" >/dev/null
docker run -d --name obs-demo-analysis-api --network obs-demo --network-alias analysis-api \
  "${otel_env[@]}" -e LLM_URL=http://mock-llm:8080 "$image/analysis-api:$tag" >/dev/null
docker run -d --name obs-demo-grpc-service --network obs-demo --network-alias grpc-service "${otel_env[@]}" "$image/grpc-service:$tag" >/dev/null
docker run -d --name obs-demo-job-api --network obs-demo --network-alias job-api \
  "${otel_env[@]}" -e DATABASE_URL=postgresql://obs_demo:obs_demo@postgres:5432/obs_demo \
  -e ACTIVEMQ_HOST=activemq -e ACTIVEMQ_STOMP_PORT=61613 "$image/job-api:$tag" >/dev/null
docker run -d --name obs-demo-job-worker --network obs-demo --network-alias job-worker \
  "${otel_env[@]}" -e DATABASE_URL=postgresql://obs_demo:obs_demo@postgres:5432/obs_demo \
  -e ACTIVEMQ_HOST=activemq -e ACTIVEMQ_STOMP_PORT=61613 -e RESULT_URL=http://result-api:8080 \
  -e GRPC_ADDRESS=grpc-service:50051 "$image/job-worker:$tag" >/dev/null
docker run -d --name obs-demo-gateway-api --network obs-demo --network-alias gateway-api \
  -e CATALOG_URL=http://catalog-api:8080 -e CACHE_URL=http://cache-api:8080 \
  -e JOB_URL=http://job-api:8080 -e ANALYSIS_URL=http://analysis-api:8080 "$image/gateway-api:$tag" >/dev/null
for provider in aws azure gcp; do
  case "$provider" in
    aws) name=aws-lambda-trigger ;;
    azure) name=azure-functions-trigger ;;
    gcp) name=google-cloud-function-trigger ;;
  esac
  docker run -d --name "obs-demo-$name" --network obs-demo "${otel_env[@]}" \
    -e SERVICE_NAME="$name" -e FAAS_FUNCTION_NAME="$name" -e FAAS_PROVIDER="$provider" \
    -e GATEWAY_URL=http://gateway-api:8080 "$image/function-trigger:$tag" >/dev/null
done
docker run -d --name obs-demo-load-generator --network obs-demo \
  -e GATEWAY_URL=http://gateway-api:8080 -e LOADGEN_DELAY_MS="${LOADGEN_DELAY_MS:-750}" \
  -e LOADGEN_BURST="${LOADGEN_BURST:-1}" "$image/load-generator:$tag" >/dev/null
docker run -d --name obs-demo-cache-exporter --network obs-demo --network-alias cache-exporter \
  -e REDIS_URL=redis://redis:6379 "$image/cache-exporter:$tag" >/dev/null
docker run -d --name obs-demo-queue-exporter --network obs-demo --network-alias queue-exporter \
  "${otel_env[@]}" -e DATABASE_URL=postgresql://obs_demo:obs_demo@postgres:5432/obs_demo \
  "$image/queue-exporter:$tag" >/dev/null
docker run -d --name obs-demo-control-ui --network obs-demo -p 18000:8080 \
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
  echo "Observability Demo did not become ready. Check logs with: docker logs obs-demo-control-ui" >&2
  exit 1
fi

echo "Observability Demo is running: http://localhost:18000"
