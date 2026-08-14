#!/usr/bin/env bash
set -euo pipefail

IMAGE_REGISTRY="${IMAGE_REGISTRY:-nebulatrace}"
IMAGE_TAG="${IMAGE_TAG:-dev}"
SERVICES="control-ui gateway-api catalog-api job-api cache-api job-worker result-api analysis-api mock-llm load-generator function-trigger grpc-service cache-exporter queue-exporter"

for service in $SERVICES; do
  image="${IMAGE_REGISTRY}/${service}:${IMAGE_TAG}"
  echo "Loading ${image} into k3s..."
  docker save "$image" | sudo k3s ctr -n k8s.io images import -
done
