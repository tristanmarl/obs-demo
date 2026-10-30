#!/usr/bin/env bash
# Observability Demo full setup: Istio + Dynatrace Operator + app
# Usage:
#   DT_TENANT_URL=https://abc123.live.dynatrace.com DT_API_TOKEN=dt0c01.xxx bash setup.sh
#   curl -sL https://raw.githubusercontent.com/tristanmarl/obs-demo/main/setup.sh | DT_TENANT_URL=... DT_API_TOKEN=... bash
set -euo pipefail

# ── Config (all overridable via env) ─────────────────────────────────────────

: "${DT_TENANT_URL:?DT_TENANT_URL is required (e.g. https://abc123.live.dynatrace.com)}"
: "${DT_API_TOKEN:?DT_API_TOKEN is required (environment Access Token, dt0c01.*)}"

if [[ "${DT_API_TOKEN}" == dt0s16* ]]; then
  echo "ERROR: DT_API_TOKEN looks like a Platform Token (dt0s16.*). Use an environment Access Token (dt0c01.*)." >&2
  exit 1
fi

export DT_DATA_INGEST_TOKEN="${DT_DATA_INGEST_TOKEN:-$DT_API_TOKEN}"
export DYNAKUBE_NAME="${DYNAKUBE_NAME:-obs-demo}"
export K8S_CLUSTER_NAME="${K8S_CLUSTER_NAME:-obs-demo}"
export IMAGE_REGISTRY="${IMAGE_REGISTRY:-ghcr.io/tristanmarl/obs-demo}"
export IMAGE_TAG="${IMAGE_TAG:-latest}"
export LOADGEN_DELAY_MS="${LOADGEN_DELAY_MS:-750}"
export LOADGEN_BURST="${LOADGEN_BURST:-1}"
export FAAS_VERSION="${FAAS_VERSION:-1.0.0}"
export DEMO_CONTROLS_ENABLED="${DEMO_CONTROLS_ENABLED:-true}"
export LOADGEN_ERROR_RATE="${LOADGEN_ERROR_RATE:-0.05}"
export MEMORY_PRESSURE_MB="${MEMORY_PRESSURE_MB:-4}"
export MEMORY_SURVIVOR_BATCHES="${MEMORY_SURVIVOR_BATCHES:-8}"

DT_API_URL="${DT_TENANT_URL%/}"
DT_API_URL="${DT_API_URL/.apps./.}"
export DT_API_URL

# ── Helpers ───────────────────────────────────────────────────────────────────

need() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: $1 is required but not installed." >&2; exit 1; }; }

step() { echo; echo "==> $*"; }

# ── Preflight ─────────────────────────────────────────────────────────────────

need kubectl
need helm
need istioctl
need envsubst

step "Preflight: checking cluster access"
kubectl cluster-info --request-timeout=10s >/dev/null

# ── Namespaces ────────────────────────────────────────────────────────────────

step "Creating namespaces"
kubectl apply -f deploy/k8s/namespaces.yaml

# ── Istio ─────────────────────────────────────────────────────────────────────

step "Installing Istio (profile: demo)"
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

# ── Dynatrace Operator ────────────────────────────────────────────────────────

step "Installing Dynatrace Operator (v1.10.1)"
helm upgrade --install dynatrace-operator oci://public.ecr.aws/dynatrace/dynatrace-operator \
  --version 1.10.1 \
  --namespace dynatrace \
  --create-namespace \
  --atomic

step "Applying DynaKube"
DYNAKUBE_MANIFEST="$(mktemp)"
cat > "$DYNAKUBE_MANIFEST" <<'YAML'
apiVersion: v1
kind: Secret
metadata:
  name: "${DYNAKUBE_NAME}"
  namespace: dynatrace
type: Opaque
stringData:
  apiToken: "${DT_API_TOKEN}"
  dataIngestToken: "${DT_DATA_INGEST_TOKEN}"
---
apiVersion: dynatrace.com/v1beta6
kind: DynaKube
metadata:
  name: "${DYNAKUBE_NAME}"
  namespace: dynatrace
  annotations:
    feature.dynatrace.com/automatic-injection: "false"
spec:
  apiUrl: "${DT_API_URL}/api"
  tokens: "${DYNAKUBE_NAME}"
  enableIstio: true
  metadataEnrichment:
    enabled: true
  logMonitoring: {}
  telemetryIngest:
    protocols:
      - otlp
  oneAgent:
    applicationMonitoring:
      namespaceSelector:
        matchLabels:
          obs-demo.dev/oneagent: "true"
  activeGate:
    capabilities:
      - kubernetes-monitoring
      - routing
      - dynatrace-api
    resources:
      requests:
        cpu: 500m
        memory: 1.5Gi
      limits:
        cpu: 1000m
        memory: 1.5Gi
  otlpExporterConfiguration:
    namespaceSelector:
      matchLabels:
        obs-demo.dev/otel: "true"
    signals:
      metrics: {}
      traces: {}
      logs: {}
YAML
envsubst < "$DYNAKUBE_MANIFEST" | kubectl apply -f -
rm -f "$DYNAKUBE_MANIFEST"

# ── App ───────────────────────────────────────────────────────────────────────

step "Deploying Observability Demo app"
MANIFEST_URL="https://raw.githubusercontent.com/tristanmarl/obs-demo/main/deploy/dist/obs-demo.yaml"
if [ -f "deploy/dist/obs-demo.yaml" ]; then
  # Running from repo checkout — use local copy with env substitution
  envsubst < deploy/dist/obs-demo.yaml | kubectl apply -f -
else
  # Running via curl — fetch and apply the pre-rendered public manifest
  curl -sL "$MANIFEST_URL" | kubectl apply -f -
fi

step "Waiting for app rollout"
kubectl -n obs-demo rollout status deployment/gateway-api --timeout=180s || true
# Layered resource attributes (config/attributes.yaml) are applied by the gateway; skip when run without the repo.
if [ -f scripts/apply-attributes.sh ]; then
  ./scripts/apply-attributes.sh || echo "Attributes not applied; run 'make attributes' once gateway-api is ready."
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo
echo "Setup complete."
echo
echo "App URL:"
kubectl -n istio-system get svc istio-ingressgateway \
  --output=jsonpath='  http://{.status.loadBalancer.ingress[0].ip}{"\n"}' 2>/dev/null || \
  echo "  Run: kubectl -n istio-system get svc istio-ingressgateway"
echo
echo "Dynatrace Operator status:"
echo "  kubectl get dynakubes -n dynatrace"
