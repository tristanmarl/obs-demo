# Telemetry contract

## Resource identity

`apps/otel_setup.py` is the shared Python setup helper. Each OTel workload sets its own `service.name`; resources also contain `service.namespace=nebulatrace`, `deployment.environment.name=demo`, and `service.version` from `SERVICE_VERSION` (derived from `IMAGE_TAG`). Shared `OTEL_RESOURCE_ATTRIBUTES` never contains `service.name` or `service.instance.id`.

Kubernetes workload names equal service names. OneAgent annotations and Dynatrace OTLP auto-configuration remain on the workloads that use them.

## HTTP, database, Redis, and errors

FastAPI, requests, gRPC, PostgreSQL, Redis, and OneAgent instrumentation remain enabled where supported. Custom spans record exceptions and set error status. Proxy routes preserve downstream HTTP status; network timeouts become HTTP 503, not HTTP 200. The worker calls `raise_for_status()` for the result callback.

## ActiveMQ

The queue is `/queue/jobs.requested`, with logical destination `jobs.requested`. Producer, receive, and process spans use:

```text
messaging.system=activemq
messaging.destination.name=jobs.requested
messaging.operation.name=send|receive|process
messaging.operation.type=send|receive|process
messaging.message.id=<job_id>
```

Span names are `send jobs.requested`, `receive jobs.requested`, and `process jobs.requested`; kinds are `PRODUCER`, `CLIENT`, and `CONSUMER`. W3C context is injected into and extracted from STOMP headers. The listener only transfers frames into a bounded application queue; the worker explicitly pulls from that queue before starting processing, so receive and process are separate operations without a second dequeue or ACK.

## FaaS and GenAI

The shared `function-trigger` image runs as `aws-lambda-trigger`, `azure-functions-trigger`, and `google-cloud-function-trigger`. Each has a distinct `service.name`/`faas.name`, provider, region, `faas.version`, `faas.trigger=pubsub`, `cloud.resource_id`, and messaging attributes. These are simulations, not real cloud runtimes.

The analysis path uses `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens`, and `gen_ai.usage.output_tokens`. Prompt and response bodies are never recorded. Duration histograms use seconds and unit `s`; metric dimensions remain low-cardinality and exclude job IDs.

## Custom metrics

The workload uses `nebulatrace.jobs.*`, `nebulatrace.job.*`, `nebulatrace.worker.*`, `nebulatrace.grpc.duration`, `nebulatrace.cache.*`, `nebulatrace.function.*`, `nebulatrace.analysis.*`, and non-duplicate `nebulatrace.llm.*` metrics. Duration histograms declare unit `s`.

## Prometheus scraping

`cache-exporter` (Go, OneAgent) and `queue-exporter` (Python, OTLP) expose `/metrics` on port 8080 and are scraped by the Dynatrace ActiveGate via Istio's merged metrics endpoint (`15020/stats/prometheus`). The Dynatrace annotations point at the Istio port; the `prometheus.io/*` annotations tell Istio where the app's own metrics live so it merges them into the sidecar endpoint:

```yaml
prometheus.io/scrape: "true"
prometheus.io/port: "8080"
prometheus.io/path: /metrics
metrics.dynatrace.com/scrape: "true"
metrics.dynatrace.com/port: "15020"
metrics.dynatrace.com/path: /stats/prometheus
metrics.dynatrace.com/filter: '{"mode": "include", "names": ["nebulatrace_*"]}'
```

The filter keeps only `nebulatrace_*` metrics to stay well within the 1,000-metrics-per-pod ActiveGate limit and avoid ingesting the Istio/Envoy metric set.

Prometheus metric names use underscores (`nebulatrace_*`); OTel metric names use dots (`nebulatrace.*`). The two namespaces are intentionally distinct so each ingest path is identifiable without inspecting metadata.

### Metric contract

Both exporters emit identical control metrics for cross-variant comparison:

| Metric | Type | Labels | Description |
|---|---|---|---|
| `nebulatrace_probe_scrapes_total` | counter | `exporter`, `variant` | Incremented on each `/metrics` render |
| `nebulatrace_probe_value` | gauge | `exporter`, `variant` | Deterministic sawtooth: `epoch % 60` |
| `nebulatrace_probe_build_info` | gauge | `exporter`, `variant`, `version` | Always 1 |

Domain metrics:

| Metric | Type | Labels | Source |
|---|---|---|---|
| `nebulatrace_cache_keys` | gauge | `variant=oneagent` | Redis `DBSIZE` |
| `nebulatrace_cache_counter_value` | gauge | `variant=oneagent` | Demo counter key |
| `nebulatrace_jobs` | gauge | `status`, `variant=otlp` | Postgres jobs table per status |
| `nebulatrace_jobs_pending` | gauge | `variant=otlp` | Jobs in `pending`/`requested` state |

`nebulatrace_jobs_pending` is the leading indicator for the `queue-backlog` failure scenario.

### Prerequisites

See `scripts/enable-prometheus-scraping.sh` or run `make enable-prometheus-scraping` for the exact steps. In short:

1. **In-cluster ActiveGate with `kubernetes-monitoring`** — provided by `make install-dynatrace` / `setup.sh`. The no-ActiveGate DynaKube variant (`dynakube-noactivegate.yaml.tpl`) does not include an ActiveGate; scraping requires one already running in-cluster with the `kubernetes-monitoring` module.
2. **Tenant setting** — Kubernetes cluster settings → enable "Monitor Kubernetes namespaces, services, workloads, and pods" and "Monitor annotated Prometheus exporters".
