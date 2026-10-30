#!/usr/bin/env bash
# Applies a scoped obs-demo DynaKube to an existing Dynatrace Operator installation.
# Does NOT install the operator or create an ActiveGate — assumes both already exist.
set -euo pipefail

source <(sed 's/\r$//' .env)

if [[ "${DT_API_TOKEN:-}" == dt0s16* ]]; then
  echo "DT_API_TOKEN looks like a Dynatrace Platform Token (dt0s16...)."
  echo "Use an environment Access Token with DataExport, activeGateTokenManagement.create, InstallerDownload."
  exit 1
fi

if ! kubectl get deployment dynatrace-operator -n dynatrace &>/dev/null; then
  echo "Dynatrace Operator not found in namespace 'dynatrace'."
  echo "Run 'make install-dynatrace' for a fresh install."
  exit 1
fi

if kubectl get dynakube obs-demo -n dynatrace &>/dev/null; then
  echo "DynaKube 'obs-demo' already exists — re-applying."
fi

DT_API_URL="${DT_TENANT_URL%/}"
DT_API_URL="${DT_API_URL/.apps./.}"
export DT_API_URL

if ! command -v envsubst >/dev/null 2>&1; then
  echo "envsubst is required. Install gettext-base."
  exit 1
fi

envsubst < deploy/k8s/dynatrace/dynakube-noactivegate.yaml.tpl | kubectl apply -f -
echo "DynaKube 'obs-demo' applied. The obs-demo namespace is labelled obs-demo.dev/oneagent=true"
echo "and obs-demo.dev/otel=true — restart deployments after injection webhooks are ready:"
echo "  kubectl rollout restart deployment -n obs-demo"
