#!/usr/bin/env bash
set -euo pipefail

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

load_env_file .env

if [[ "${DT_API_TOKEN:-}" == dt0s16* ]]; then
  echo "DT_API_TOKEN looks like a Dynatrace Platform Token (dt0s16...)."
  echo "Use an environment Access Token from Access Tokens with the Kubernetes: Dynatrace Operator template."
  exit 1
fi

export DT_DATA_INGEST_TOKEN="${DT_DATA_INGEST_TOKEN:-$DT_API_TOKEN}"
export DYNAKUBE_NAME="${DYNAKUBE_NAME:-obs-demo}"
export DT_HOST_GROUP="${DT_HOST_GROUP:-obs-demo}"

DT_API_URL="${DT_TENANT_URL%/}"
DT_API_URL="${DT_API_URL/.apps./.}"
export DT_API_URL

kubectl apply -f deploy/k8s/namespaces.yaml
helm upgrade --install dynatrace-operator oci://public.ecr.aws/dynatrace/dynatrace-operator \
  --version 1.10.1 \
  --namespace dynatrace \
  --create-namespace \
  --atomic

if ! command -v envsubst >/dev/null 2>&1; then
  echo "envsubst is required. Install gettext-base."
  exit 1
fi

envsubst < deploy/k8s/dynatrace/dynakube.yaml.tpl | kubectl apply -f -
