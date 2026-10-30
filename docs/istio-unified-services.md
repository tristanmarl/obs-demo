# Istio routing

The ingress `VirtualService` is named `control-ui`. `/api` routes to `gateway-api`; all other paths route to the UI. The `cache-api` `VirtualService` and `DestinationRule` provide the mesh-abort scenario and stable subset.

Istio tracing uses the `dynatrace-otel` extension provider configured by the setup script. The Operator telemetry-ingest service receives Envoy spans directly; there is no generic collector hop in the application manifest. The app namespace enables sidecar injection and the data namespace disables it.

Inspect the route and provider:

```bash
kubectl -n obs-demo get virtualservice control-ui cache-api -o yaml
kubectl -n obs-demo get destinationrule cache-api -o yaml
istioctl proxy-config listeners deployment/gateway-api.obs-demo -o json | rg -i 'opentelemetry|telemetry-ingest|dynatrace'
```

The `mesh-aborts` scenario patches only the `cache-api` VirtualService to abort 50% of requests with HTTP 503. `make reset` or `scripts/reset-demo.sh` reapplies the stable route.
