#!/usr/bin/env bash
set -euo pipefail

IMAGE_REGISTRY_OVERRIDE="${IMAGE_REGISTRY:-}"
IMAGE_TAG_OVERRIDE="${IMAGE_TAG:-}"

load_env_file() {
  local line key value
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      ""|\#*) continue ;;
    esac
    key="${line%%=*}"
    value="${line#*=}"
    if [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      export "$key=$value"
    fi
  done < "$1"
}

if [ -f .env ]; then
  load_env_file .env
fi

export IMAGE_REGISTRY="${IMAGE_REGISTRY:-obs-demo}"
export IMAGE_TAG="${IMAGE_TAG:-dev}"
export LOADGEN_DELAY_MS="${LOADGEN_DELAY_MS:-750}"
export LOADGEN_BURST="${LOADGEN_BURST:-1}"
export FAAS_VERSION="${FAAS_VERSION:-1.0.0}"
export DEMO_CONTROLS_ENABLED="${DEMO_CONTROLS_ENABLED:-true}"
export LOADGEN_ERROR_RATE="${LOADGEN_ERROR_RATE:-0.05}"
export DT_TENANT_URL="${DT_TENANT_URL:-}"
export MEMORY_PRESSURE_MB="${MEMORY_PRESSURE_MB:-4}"
export MEMORY_SURVIVOR_BATCHES="${MEMORY_SURVIVOR_BATCHES:-8}"

if [ -n "$IMAGE_REGISTRY_OVERRIDE" ]; then
  export IMAGE_REGISTRY="$IMAGE_REGISTRY_OVERRIDE"
fi

if [ -n "$IMAGE_TAG_OVERRIDE" ]; then
  export IMAGE_TAG="$IMAGE_TAG_OVERRIDE"
fi

if ! command -v envsubst >/dev/null 2>&1; then
  echo "envsubst is required. Install gettext-base."
  exit 1
fi

kubectl apply -f deploy/k8s/namespaces.yaml
kubectl apply -f deploy/k8s/data/postgres-init.yaml
envsubst < deploy/k8s/data/data.yaml | kubectl apply -f -
envsubst < deploy/k8s/app/app.yaml.tpl | kubectl apply -f -
./scripts/attributes-configmap.sh | kubectl apply -f -
./scripts/flags-configmap.sh | kubectl apply -f -
kubectl apply -f deploy/k8s/istio/istio.yaml

kubectl -n obs-demo rollout status deployment/gateway-api --timeout=180s || true
./scripts/apply-attributes.sh || echo "Attributes not applied; run 'make attributes' once gateway-api is ready."
kubectl -n obs-demo get pods
