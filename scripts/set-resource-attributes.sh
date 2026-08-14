#!/usr/bin/env bash
set -euo pipefail

APP_NAMESPACE="${APP_NAMESPACE:-nebulatrace}"
DATA_NAMESPACE="${DATA_NAMESPACE:-nebulatrace-data}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/set-resource-attributes.sh "key=value,key2=value2"
  scripts/set-resource-attributes.sh --append "key=value,key2=value2"
  scripts/set-resource-attributes.sh --show

Patches OTEL_RESOURCE_ATTRIBUTES on NebulaTrace workloads and restarts them.
Also updates .env when it exists so the next deploy keeps the same value.

Environment:
  APP_NAMESPACE=nebulatrace
  DATA_NAMESPACE=nebulatrace-data
EOF
}

trim_commas() {
  local value="$1"
  value="${value#,}"
  value="${value%,}"
  printf '%s' "$value"
}

current_from_env() {
  if [ -f .env ]; then
    sed -n 's/^OTEL_RESOURCE_ATTRIBUTES=//p' .env | tail -1
  fi
}

current_from_cluster() {
  kubectl -n "$APP_NAMESPACE" get deploy gateway-api \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="OTEL_RESOURCE_ATTRIBUTES")].value}' \
    2>/dev/null || true
}

update_env_file() {
  local attrs="$1"
  [ -f .env ] || return 0

  if grep -q '^OTEL_RESOURCE_ATTRIBUTES=' .env; then
    tmp="$(mktemp)"
    awk -v attrs="$attrs" '
      BEGIN { done = 0 }
      /^OTEL_RESOURCE_ATTRIBUTES=/ {
        if (!done) {
          print "OTEL_RESOURCE_ATTRIBUTES=" attrs
          done = 1
        }
        next
      }
      { print }
      END {
        if (!done) print "OTEL_RESOURCE_ATTRIBUTES=" attrs
      }
    ' .env > "$tmp"
    mv "$tmp" .env
  else
    printf '\nOTEL_RESOURCE_ATTRIBUTES=%s\n' "$attrs" >> .env
  fi
}

show_current() {
  echo "From .env:"
  current_from_env || true
  echo
  echo "From cluster gateway-api:"
  current_from_cluster || true
  echo
}

mode="set"
case "${1:-}" in
  ""|-h|--help)
    usage
    exit 0
    ;;
  --show)
    show_current
    exit 0
    ;;
  --append)
    mode="append"
    shift
    ;;
esac

if [ "$#" -ne 1 ]; then
  usage
  exit 1
fi

new_attrs="$(trim_commas "$1")"
if [ -z "$new_attrs" ]; then
  echo "OTEL_RESOURCE_ATTRIBUTES must not be empty."
  exit 1
fi

if [ "$mode" = "append" ]; then
  base="$(current_from_env)"
  if [ -z "$base" ]; then
    base="$(current_from_cluster)"
  fi
  base="$(trim_commas "$base")"
  if [ -n "$base" ]; then
    new_attrs="${base},${new_attrs}"
  fi
fi

echo "Setting OTEL_RESOURCE_ATTRIBUTES:"
echo "$new_attrs"
echo

update_env_file "$new_attrs"

for deployment in control-ui gateway-api catalog-api job-api cache-api job-worker result-api analysis-api mock-llm aws-lambda-trigger azure-functions-trigger google-cloud-function-trigger grpc-service load-generator cache-exporter queue-exporter; do
  kubectl -n "$APP_NAMESPACE" set env "deployment/$deployment" "OTEL_RESOURCE_ATTRIBUTES=$new_attrs"
done
for deployment in redis; do
  kubectl -n "$DATA_NAMESPACE" set env "deployment/$deployment" "OTEL_RESOURCE_ATTRIBUTES=$new_attrs"
done
for statefulset in postgres activemq; do
  kubectl -n "$DATA_NAMESPACE" set env "statefulset/$statefulset" "OTEL_RESOURCE_ATTRIBUTES=$new_attrs"
done

"$ROOT/scripts/restart-workloads.sh"

echo
echo "Done."
