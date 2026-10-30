#!/usr/bin/env bash
set -euo pipefail

kubectl apply -f deploy/k8s/namespaces.yaml

DYNAKUBE_NAME="${DYNAKUBE_NAME:-obs-demo}"

if ! command -v istioctl >/dev/null 2>&1; then
  echo "istioctl is required. Install it from https://istio.io/latest/docs/setup/getting-started/"
  exit 1
fi

meshconfig="$(mktemp)"
cat > "$meshconfig" <<YAML
apiVersion: install.istio.io/v1alpha1
kind: IstioOperator
spec:
  profile: demo
  meshConfig:
    defaultConfig:
      tracing:
        sampling: 100
    extensionProviders:
      - name: dynatrace-otel
        opentelemetry:
          service: ${DYNAKUBE_NAME}-telemetry-ingest.dynatrace.svc.cluster.local
          port: 4318
          http:
            path: /v1/traces
            timeout: 10s
          resource_detectors:
            dynatrace: {}
YAML

istioctl install -y -f "$meshconfig"
rm -f "$meshconfig"
kubectl label namespace obs-demo istio-injection=enabled --overwrite
