#!/usr/bin/env bash
# Prints the obs-demo-flags ConfigMap seeded from config/flags.json (all scenario flags off).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cat <<YAML
apiVersion: v1
kind: ConfigMap
metadata:
  name: obs-demo-flags
  namespace: obs-demo
data:
  flags.json: |
YAML
sed 's/^/    /' "$ROOT/config/flags.json"
