#!/usr/bin/env bash
set -euo pipefail

IMAGE_REGISTRY="${IMAGE_REGISTRY:-nebulatrace}"
IMAGE_TAG="${IMAGE_TAG:-dev}"
SERVICES="engineering-portal platform-api artifact-api release-api quota-api deployment-worker audit-api incident-assistant mock-llm load-generator webhook-function runner-agent"

for service in $SERVICES; do
  image="${IMAGE_REGISTRY}/${service}:${IMAGE_TAG}"
  echo "Loading ${image} into k3s..."
  docker save "$image" | sudo k3s ctr -n k8s.io images import -
done
