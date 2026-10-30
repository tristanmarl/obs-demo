#!/usr/bin/env bash
# Prints the obs-demo-attributes ConfigMap seeded from config/attributes.yaml.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cat <<YAML
apiVersion: v1
kind: ConfigMap
metadata:
  name: obs-demo-attributes
  namespace: obs-demo
data:
  attributes.yaml: |
YAML
sed 's/^/    /' "$ROOT/config/attributes.yaml"
