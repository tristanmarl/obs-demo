# Istio routing

The ingress `VirtualService` is named `control-ui`. `/api` routes to `gateway-api`; all other paths route to the UI. The `cache-api` `VirtualService` and `DestinationRule` provide the mesh-abort scenario and stable subset.

Istio tracing uses the `dynatrace-otel` extension provider configured by the setup script. The Operator telemetry-ingest service receives Envoy spans directly; there is no generic collector hop in the application manifest. The app namespace enables sidecar injection and the data namespace disables it.

Dynatrace-specific Istio settings (see https://docs.dynatrace.com/docs/ingest-from/opentelemetry/integrations/istio):

- `scripts/install-istio.sh` sets `ENABLE_NATIVE_SIDECARS=false` on istiod because Dynatrace does not support native sidecars (the default on Istio 1.28+ with Kubernetes 1.29+). The legacy `meshConfig.defaultConfig.tracing.sampling` is not set; sampling comes from the `Telemetry` resource.
- Optional Adaptive Traffic Management: when `DT_PLATFORM_TOKEN` (scope `adaptive-traffic-management:sampling-configuration:read`), `DT_TENANT_ID`, `DT_CLUSTER_ID` and `DT_TENANT_URL` are set in `.env`, the script adds a `dynatrace_sampler` to the extension provider. The token is stored in the Istio mesh config, which anyone who can read the `istio` ConfigMap in `istio-system` can see. Without the variables the provider has no sampler.
- OneAgent-injected pods carry `container.inject.dynatrace.com/istio-proxy: "false"` so OneAgent stays out of the sidecar. Keep the tenant-side "Monitor Envoy" toggle (Settings, Process and containers) off or review it, so Envoy is not monitored twice. This toggle lives in the tenant and cannot be verified from this repository.
- App pods carry `metrics.dynatrace.com/*` annotations that make ActiveGate scrape `15020/stats/prometheus`, filtered to `istio_requests_total`, `istio_request_duration_milliseconds` and `istio_tcp_connections_opened_total` (the exporters add `obs_demo_*`). Enable the tenant setting that monitors annotated Prometheus exporters; `make enable-prometheus-scraping` covers the prerequisites.

Inspect the route and provider:

```bash
kubectl -n obs-demo get virtualservice control-ui cache-api -o yaml
kubectl -n obs-demo get destinationrule cache-api -o yaml
istioctl proxy-config listeners deployment/gateway-api.obs-demo -o json | grep -iE 'opentelemetry|telemetry-ingest|dynatrace'
```

The `mesh-aborts` scenario patches only the `cache-api` VirtualService to abort 50% of requests with HTTP 503. `make reset` or `scripts/reset-demo.sh` reapplies the stable route.
