# CLAUDE.md

Observability Demo is a Kubernetes workload for exploring observability in a distributed system.

## Commands

```bash
make verify
make build-images
make k3s-deploy
make status
make attributes   # PREVIEW=1 for a diff
make reset
```

No host Node, Go, Maven, Java, or Python packages are required.

## Flow

```text
control-ui / load-generator -> gateway-api
aws-lambda-trigger ---------> gateway-api
azure-functions-trigger ----> gateway-api
google-cloud-function-trigger -> gateway-api
gateway-api -> catalog-api -> PostgreSQL
gateway-api -> cache-api -> Redis
gateway-api -> analysis-api -> mock-llm
gateway-api -> job-api -> PostgreSQL -> ActiveMQ jobs.requested
job-worker -> grpc-service (ValidateJob, ExecuteJob, VerifyJob) -> result-api
obs-edge-agent (EC2, systemd) -> istio ingress -> gateway-api
result-api -> host-db (MariaDB on EC2)
flagd <-- gateway-api /internal/flags.json (ConfigMap obs-demo-flags); catalog-api, cache-api, result-api, job-worker, grpc-service, mock-llm evaluate flags (OpenFeature, gRPC 8013)
cache-exporter (Go, OneAgent)  -- polls Redis, exposes /metrics (Prometheus scrape, variant=oneagent)
queue-exporter (Python, OTLP)  -- polls PostgreSQL, exposes /metrics (Prometheus scrape, variant=otlp)
```

Both exporters are scraped by ActiveGate via Istio's merged endpoint (`15020/stats/prometheus`). Prometheus names use underscores (`obs_demo_*`); OTel names use dots (`obs_demo.*`). Run `make enable-prometheus-scraping` for prerequisites.

Workload names and OTel `service.name` values are identical. `apps/otel_setup.py` adds `service.namespace=obs-demo`, `deployment.environment.name=demo`, and the `SERVICE_VERSION` value. Do not hardcode OTLP endpoints or tokens.

## Trace stitching

FastAPI and requests instrumentation stay enabled. ActiveMQ producer, receive, and process spans propagate W3C context in STOMP headers and use `messaging.operation.name/type`. The worker ACKs only after all gRPC, PostgreSQL, and result callback work succeeds.

## Controls

Scenario state is backend-derived from the flag store (ConfigMap `obs-demo-flags`, served to `flagd` at `/internal/flags.json`); exactly four scenarios exist (`database-latency`, `queue-backlog`, `error-spike`, `memory-pressure`), one active at a time, and there is no `SCENARIO_MODE` and scenarios never restart workloads. `/internal/*` must never be routed by the ingress. Resource attributes are layered (`config/attributes.yaml` -> ConfigMap `obs-demo-attributes`; global -> preset -> team -> workload), validated server-side in `apps/gateway-api/attributes.js`, applied per workload (env, `metadata.dynatrace.com/*` annotations, `DT_CUSTOM_PROP`) only to the explicit application/data allowlist, via the UI or `make attributes` (same code path), and protected by RBAC `resourceNames` without list permission. `DEMO_CONTROLS_ENABLED=false` hides mutation controls and returns 404 for mutations.

Keep the bounded Java allocation scenario, truthful downstream status propagation, accessibility basics, and complete reset reliability. Do not add dashboards, packaging layers, framework churn, or compatibility routes without a real consumer.

## Secrets

Never commit `.env`, tenant-specific values, tokens, or kubeconfigs. Run the repository secret checks before commits:

```bash
git grep -n dt0 -- . ':!.env' ':!.env.example'
git grep -n live.dynatrace.com -- . ':!.env' ':!.env.example'
```
