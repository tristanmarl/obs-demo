#!/usr/bin/env bash
set -euo pipefail

kubectl apply -f deploy/k8s/namespaces.yaml

DYNAKUBE_NAME="${DYNAKUBE_NAME:-obs-demo}"

load_env_file() {
  local line key value
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in ""|\#*) continue ;; esac
    key="${line%%=*}"; value="${line#*=}"
    if [[ "$key" =~ ^(DT_TENANT_URL|DT_PLATFORM_TOKEN|DT_TENANT_ID|DT_CLUSTER_ID)$ ]]; then
      [ -n "${!key:-}" ] || export "$key=$value"
    fi
  done < "$1"
}
[ ! -f .env ] || load_env_file .env

if ! command -v istioctl >/dev/null 2>&1; then
  echo "istioctl is required. Install it from https://istio.io/latest/docs/setup/getting-started/"
  exit 1
fi

# Optional Adaptive Traffic Management sampler:
# https://docs.dynatrace.com/docs/ingest-from/opentelemetry/integrations/istio
sampler=""
dt_host=""
if [ -n "${DT_PLATFORM_TOKEN:-}" ] && [ -n "${DT_TENANT_ID:-}" ] && [ -n "${DT_CLUSTER_ID:-}" ]; then
  dt_host="${DT_TENANT_URL:-}"; dt_host="${dt_host#*://}"; dt_host="${dt_host%%/*}"
  if [ -z "$dt_host" ]; then
    echo "DT_TENANT_URL is required to reach the sampling configuration API; skipping dynatrace_sampler."
  else
    echo "WARNING: DT_PLATFORM_TOKEN is written into the Istio mesh config (istio-system/istio ConfigMap) and is readable by anyone who can read it."
    sampler="
          dynatrace_sampler:
            tenant: ${DT_TENANT_ID}
            cluster_id: ${DT_CLUSTER_ID}
            http_service:
              service: istio-system/${dt_host}
              port: 80
              http:
                path: /api/v2/samplingConfiguration
                timeout: 10s
                headers:
                  - name: Authorization
                    value: Bearer ${DT_PLATFORM_TOKEN}"
  fi
fi

meshconfig="$(mktemp)"
trap 'rm -f "$meshconfig"' EXIT
cat > "$meshconfig" <<YAML
apiVersion: install.istio.io/v1alpha1
kind: IstioOperator
spec:
  profile: demo
  components:
    pilot:
      k8s:
        env:
          # Dynatrace does not support Istio native sidecars (default on Istio >= 1.28 with Kubernetes >= 1.29).
          - name: ENABLE_NATIVE_SIDECARS
            value: "false"
  meshConfig:
    extensionProviders:
      - name: dynatrace-otel
        opentelemetry:
          service: ${DYNAKUBE_NAME}-telemetry-ingest.dynatrace.svc.cluster.local
          port: 4318
          http:
            path: /v1/traces
            timeout: 10s
          resource_detectors:
            dynatrace: {}${sampler}
YAML

if [ -n "$sampler" ]; then
  # The sampler calls the tenant through the mesh egress, which needs a ServiceEntry and DestinationRule.
  kubectl apply -n istio-system -f - <<YAML
apiVersion: networking.istio.io/v1
kind: ServiceEntry
metadata:
  name: dynatrace-sampling-config
spec:
  hosts: ["${dt_host}"]
  ports:
    - {number: 80, name: http, protocol: HTTP, targetPort: 443}
  resolution: DNS
  location: MESH_EXTERNAL
---
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: dynatrace-sampling-config
spec:
  host: "${dt_host}"
  trafficPolicy:
    tls:
      mode: SIMPLE
YAML
fi

istioctl install -y -f "$meshconfig"
kubectl label namespace obs-demo istio-injection=enabled --overwrite
