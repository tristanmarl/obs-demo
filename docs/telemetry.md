# Telemetry contract

## Resource identity

`apps/otel_setup.py` is the shared Python setup helper. Each OTel workload sets its own `service.name`; resources also contain `service.namespace=obs-demo`, `deployment.environment.name=demo`, and `service.version` from `SERVICE_VERSION` (derived from `IMAGE_TAG`). Values in `OTEL_RESOURCE_ATTRIBUTES` override those defaults; `service.name` always comes from code. `OTEL_RESOURCE_ATTRIBUTES` never contains `service.name` or `service.instance.id`.

## Layered resource attributes

`config/attributes.yaml` defines `global`, `teams`, `workloads` and `presets` (one optional `activePreset`). The effective set per workload is merged global, then preset, then team, then workload. It is stored in the ConfigMap `obs-demo-attributes`, seeded by the deploy scripts and the dist manifest, and applied by `gateway-api` (UI: Resource attributes, CLI: `make attributes`, preview with `make attributes PREVIEW=1`). Both use the same code (`apps/gateway-api/attributes.js`, `attributes-store.js`).

For each workload whose live state differs from the effective set, the gateway patches the pod template, which triggers a rollout:

- container env `OTEL_RESOURCE_ATTRIBUTES` (that workload's set; sorted `key=value,...`),
- pod annotations `metadata.dynatrace.com/<key>: <value>`; stale `metadata.dynatrace.com/*` keys are removed and `metadata.dynatrace.com/service` is kept,
- for OneAgent-injected workloads also `DT_CUSTOM_PROP` as space-separated `key=value` (whitespace in values becomes `_`).

What the Dynatrace documentation says (https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/guides/metadata-automation/k8s-metadata-telemetry-enrichment): pod annotations with the `metadata.dynatrace.com/` prefix enrich OneAgent data and OTLP data sent through the automatic OTLP exporter configuration without tenant-side rules, but only `dt.security_context`, `dt.cost.costcenter` and `dt.cost.product` also enrich Kubernetes metrics and events; other keys need central enrichment rules. The page also warns against combining manual annotations with settings-based enrichment rules, and notes a newer tagging model supersedes it. Workloads that use `OTEL_RESOURCE_ATTRIBUTES` carry every key on their OTLP resource regardless. The `DT_CUSTOM_PROP` format and the event properties below were not verifiable against a tenant here.

Optional deployment events: if the Secret `obs-demo-dt-events` (keys `DT_EVENTS_URL` = full Events API v2 ingest URL, `DT_EVENTS_TOKEN` with `events.ingest`) exists, `gateway-api` posts one `CUSTOM_DEPLOYMENT` event per changed workload (entity selector `type(SERVICE),entityName.equals("<workload>")`, diff summary in the `change` property). Without the Secret nothing is sent.

`service.name` and `service.instance.id` are rejected at every layer. Limits per effective set: 32 entries and 2,048 characters; keys also have to fit a pod annotation name (63 characters, ending in a letter or number); values must not contain commas or line breaks.

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

The workload uses `obs_demo.jobs.*`, `obs_demo.job.*`, `obs_demo.worker.*`, `obs_demo.grpc.duration`, `obs_demo.cache.*`, `obs_demo.function.*`, `obs_demo.analysis.*`, and non-duplicate `obs_demo.llm.*` metrics. Duration histograms declare unit `s`.

## Prometheus scraping

`cache-exporter` (Go, OneAgent) and `queue-exporter` (Python, OTLP) expose `/metrics` on port 8080 and are scraped by the Dynatrace ActiveGate via Istio's merged metrics endpoint (`15020/stats/prometheus`). The Dynatrace annotations point at the Istio port; the `prometheus.io/*` annotations tell Istio where the app's own metrics live so it merges them into the sidecar endpoint:

```yaml
prometheus.io/scrape: "true"
prometheus.io/port: "8080"
prometheus.io/path: /metrics
metrics.dynatrace.com/scrape: "true"
metrics.dynatrace.com/port: "15020"
metrics.dynatrace.com/path: /stats/prometheus
metrics.dynatrace.com/filter: '{"mode": "include", "names": ["obs_demo_*", "istio_requests_total", "istio_request_duration_milliseconds", "istio_tcp_connections_opened_total"]}'
```

The filter keeps only `obs_demo_*` and three Istio metrics to stay well within the 1,000-metrics-per-pod ActiveGate limit. Every other app pod carries the same scrape annotations with only the three Istio names.

Prometheus metric names use underscores (`obs_demo_*`); OTel metric names use dots (`obs_demo.*`). The two namespaces are intentionally distinct so each ingest path is identifiable without inspecting metadata.

### Metric contract

Both exporters emit identical control metrics for cross-variant comparison:

| Metric | Type | Labels | Description |
|---|---|---|---|
| `obs_demo_probe_scrapes_total` | counter | `exporter`, `variant` | Incremented on each `/metrics` render |
| `obs_demo_probe_value` | gauge | `exporter`, `variant` | Deterministic sawtooth: `epoch % 60` |
| `obs_demo_probe_build_info` | gauge | `exporter`, `variant`, `version` | Always 1 |

Domain metrics:

| Metric | Type | Labels | Source |
|---|---|---|---|
| `obs_demo_cache_keys` | gauge | `variant=oneagent` | Redis `DBSIZE` |
| `obs_demo_cache_counter_value` | gauge | `variant=oneagent` | Demo counter key |
| `obs_demo_jobs` | gauge | `status`, `variant=otlp` | Postgres jobs table per status |
| `obs_demo_jobs_pending` | gauge | `variant=otlp` | Jobs in `queued` state |

`obs_demo_jobs_pending` is the leading indicator for the `queue-backlog` failure scenario.

### Prerequisites

See `scripts/enable-prometheus-scraping.sh` or run `make enable-prometheus-scraping` for the exact steps. In short:

1. **In-cluster ActiveGate with `kubernetes-monitoring`** — provided by `make install-dynatrace` / `setup.sh`. The no-ActiveGate DynaKube variant (`dynakube-noactivegate.yaml.tpl`) does not include an ActiveGate; scraping requires one already running in-cluster with the `kubernetes-monitoring` module.
2. **Tenant setting** — Kubernetes cluster settings → enable "Monitor Kubernetes namespaces, services, workloads, and pods" and "Monitor annotated Prometheus exporters".
