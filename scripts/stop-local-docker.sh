#!/usr/bin/env bash
set -euo pipefail

for container in \
  nebulatrace-engineering-portal \
  nebulatrace-platform-api \
  nebulatrace-load-generator \
  nebulatrace-artifact-api \
  nebulatrace-release-api \
  nebulatrace-quota-api \
  nebulatrace-audit-api \
  nebulatrace-incident-assistant \
  nebulatrace-mock-llm \
  nebulatrace-deployment-worker \
  nebulatrace-runner-agent \
  nebulatrace-postgres \
  nebulatrace-activemq \
  nebulatrace-redis
do
  docker rm -f "$container" >/dev/null 2>&1 || true
done

docker network rm nebulatrace >/dev/null 2>&1 || true
