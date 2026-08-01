# Istio routing

The ingress `VirtualService` is named `engineering-portal`. `/api` routes to `platform-api`; all other paths route to the portal. The `quota-api` `VirtualService` and `DestinationRule` provide the mesh-abort scenario and the stable subset.

Istio tracing uses the `dynatrace-otel` extension provider configured by the setup script. The Operator telemetry-ingest service receives Envoy spans directly; there is no generic collector hop in the application manifest. The app namespace enables sidecar injection and the data namespace disables it.

To inspect the route and provider:

```bash
kubectl -n nebulatrace get virtualservice engineering-portal quota-api -o yaml
kubectl -n nebulatrace get destinationrule quota-api -o yaml
istioctl proxy-config listeners deployment/platform-api.nebulatrace -o json | rg -i 'opentelemetry|telemetry-ingest|dynatrace'
```

The `mesh-aborts` scenario patches only the `quota-api` VirtualService to abort 50% of requests with HTTP 503. `make reset` or `scripts/reset-demo.sh` reapplies the stable route.
