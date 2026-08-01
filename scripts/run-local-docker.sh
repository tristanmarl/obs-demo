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

docker run -d --name nebulatrace-artifact-api --network nebulatrace --network-alias artifact-api \
  -e SPRING_DATASOURCE_URL=jdbc:postgresql://postgres:5432/nebulatrace \
  -e SPRING_DATASOURCE_USERNAME=nebulatrace -e SPRING_DATASOURCE_PASSWORD=nebulatrace \
  "$image/artifact-api:$tag" >/dev/null
docker run -d --name nebulatrace-quota-api --network nebulatrace --network-alias quota-api \
  -e REDIS_URL=redis://redis:6379 "$image/quota-api:$tag" >/dev/null
docker run -d --name nebulatrace-audit-api --network nebulatrace --network-alias audit-api \
  "$image/audit-api:$tag" >/dev/null
docker run -d --name nebulatrace-mock-llm --network nebulatrace --network-alias mock-llm \
  "${otel_env[@]}" "$image/mock-llm:$tag" >/dev/null
docker run -d --name nebulatrace-incident-assistant --network nebulatrace --network-alias incident-assistant \
  "${otel_env[@]}" -e LLM_URL=http://mock-llm:8080 "$image/incident-assistant:$tag" >/dev/null
docker run -d --name nebulatrace-runner-agent --network nebulatrace --network-alias runner-agent \
  "${otel_env[@]}" "$image/runner-agent:$tag" >/dev/null
docker run -d --name nebulatrace-release-api --network nebulatrace --network-alias release-api \
  "${otel_env[@]}" -e DATABASE_URL=postgresql://nebulatrace:nebulatrace@postgres:5432/nebulatrace \
  -e ACTIVEMQ_HOST=activemq -e ACTIVEMQ_STOMP_PORT=61613 "$image/release-api:$tag" >/dev/null
docker run -d --name nebulatrace-deployment-worker --network nebulatrace --network-alias deployment-worker \
  "${otel_env[@]}" -e DATABASE_URL=postgresql://nebulatrace:nebulatrace@postgres:5432/nebulatrace \
  -e ACTIVEMQ_HOST=activemq -e ACTIVEMQ_STOMP_PORT=61613 -e AUDIT_URL=http://audit-api:8080 \
  -e RUNNER_ADDRESS=runner-agent:50051 "$image/deployment-worker:$tag" >/dev/null
docker run -d --name nebulatrace-platform-api --network nebulatrace --network-alias platform-api \
  -e ARTIFACT_URL=http://artifact-api:8080 -e QUOTA_URL=http://quota-api:8080 \
  -e RELEASE_URL=http://release-api:8080 -e INCIDENT_ASSISTANT_URL=http://incident-assistant:8080 \
  "$image/platform-api:$tag" >/dev/null
docker run -d --name nebulatrace-webhook-function --network nebulatrace \
  "${otel_env[@]}" -e PLATFORM_URL=http://platform-api:8080 "$image/webhook-function:$tag" >/dev/null
docker run -d --name nebulatrace-load-generator --network nebulatrace \
  -e PLATFORM_URL=http://platform-api:8080 -e LOADGEN_DELAY_MS="${LOADGEN_DELAY_MS:-750}" \
  -e LOADGEN_BURST="${LOADGEN_BURST:-1}" "$image/load-generator:$tag" >/dev/null
docker run -d --name nebulatrace-engineering-portal --network nebulatrace -p 18000:8080 \
  "$image/engineering-portal:$tag" >/dev/null

ready=false
for _ in $(seq 1 30); do
  if [ "$(curl -s -o /dev/null -w "%{http_code}" http://localhost:18000/api/status)" = "200" ]; then
    ready=true
    break
  fi
  sleep 1
done

if [ "$ready" != true ]; then
  echo "NebulaTrace did not become ready. Check logs with: docker logs nebulatrace-engineering-portal" >&2
  exit 1
fi

echo "NebulaTrace is running: http://localhost:18000"
