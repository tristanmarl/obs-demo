#!/usr/bin/env bash
set -euo pipefail

APP_NAMESPACE="${APP_NAMESPACE:-traceforge}"
DATA_NAMESPACE="${DATA_NAMESPACE:-traceforge-data}"
DYNAKUBE_NAME="${DYNAKUBE_NAME:-traceforge}"

echo "Context: $(kubectl config current-context 2>/dev/null || echo unknown)"
echo

echo "DynaKube:"
kubectl get dynakube -n dynatrace "$DYNAKUBE_NAME" 2>/dev/null || kubectl get dynakube -n dynatrace 2>/dev/null || true
echo

echo "Dynatrace pods:"
kubectl get pods -n dynatrace 2>/dev/null || true
echo

echo "App pods:"
kubectl get pods -n "$APP_NAMESPACE" 2>/dev/null || true
echo

echo "Data pods:"
kubectl get pods -n "$DATA_NAMESPACE" 2>/dev/null || true
echo

echo "Istio ingress:"
kubectl get svc -n istio-system istio-ingressgateway 2>/dev/null || true
echo

node_port="$(kubectl get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.ports[?(@.port==80)].nodePort}' 2>/dev/null || true)"
if [ -n "$node_port" ] && command -v curl >/dev/null 2>&1; then
  echo "Local ingress probe:"
  curl -fsS -m 5 "http://127.0.0.1:${node_port}/api/status" || true
  echo
fi
