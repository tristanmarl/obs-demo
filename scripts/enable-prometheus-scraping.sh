#!/usr/bin/env bash
# Prints the two manual steps required to enable Dynatrace Prometheus scraping.
# This script cannot automate those steps — both require Kubernetes cluster access
# and access to the Dynatrace SaaS UI respectively.
set -euo pipefail

cat <<'INFO'
──────────────────────────────────────────────────────────────────────────────
Dynatrace Prometheus scraping prerequisites
──────────────────────────────────────────────────────────────────────────────

NebulaTrace's cache-exporter and queue-exporter expose /metrics and are
annotated for ActiveGate scraping via the Istio merged endpoint (port 15020).

Two things must be true before metrics appear in Dynatrace:

 1. In-cluster ActiveGate with the kubernetes-monitoring module
    ──────────────────────────────────────────────────────────
    The DynaKube created by `make install-dynatrace` / `setup.sh` includes:

      activeGate:
        capabilities:
          - kubernetes-monitoring
          ...

    If you applied `dynakube-noactivegate.yaml.tpl` (no activeGate block),
    Prometheus scraping will NOT work unless a pre-existing in-cluster
    ActiveGate already has the kubernetes-monitoring module enabled.

    An external ActiveGate (running outside this cluster) cannot scrape pod
    endpoints at all.

    Verify the ActiveGate is running:
      kubectl -n dynatrace get pods -l app.kubernetes.io/component=active-gate

 2. Tenant setting: Monitor annotated Prometheus exporters
    ──────────────────────────────────────────────────────
    a. In your Dynatrace environment, open the Kubernetes page.
    b. Find this cluster and click Actions → Settings.
    c. Enable "Monitor Kubernetes namespaces, services, workloads, and pods".
    d. Enable "Monitor annotated Prometheus exporters".
    e. Save.

    Without this, the ActiveGate ignores metrics.dynatrace.com/* annotations
    cluster-wide, even though the pods are correctly annotated.

──────────────────────────────────────────────────────────────────────────────
Once both are in place, verify with:

  # Confirm Istio merged the app metrics into port 15020
  kubectl -n nebulatrace exec deploy/cache-exporter -c istio-proxy -- \
    curl -s localhost:15020/stats/prometheus | grep nebulatrace_

  # Query in Dynatrace Notebooks (DQL) after ~2 minutes:
  timeseries val = avg(nebulatrace_probe_value),
    by: { variant, k8s.pod.name, k8s.namespace.name }

  # Check what metrics Dynatrace registered:
  load "/dt/platform/metrics.metadata" | filter matchesValue(key, "nebulatrace_*")

──────────────────────────────────────────────────────────────────────────────
INFO
