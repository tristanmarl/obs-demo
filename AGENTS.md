# AGENTS.md

NebulaTrace is a small Kubernetes workload for exploring observability in a distributed system. Keep it understandable in one sitting and preserve the mixed OneAgent/OpenTelemetry demonstration.

## Architecture

- Namespaces stay `nebulatrace` and `nebulatrace-data`; Istio sidecars are enabled only for the app namespace.
- Keep PostgreSQL, Redis, ActiveMQ Classic, Istio, Dynatrace Operator, OneAgent, and OTLP auto-configuration.
- Main flow: `control-ui / load-generator -> gateway-api -> job-api -> PostgreSQL -> ActiveMQ jobs.requested -> job-worker -> grpc-service -> result-api`.
- Supporting flows: `gateway-api -> catalog-api -> PostgreSQL`, `gateway-api -> cache-api -> Redis`, and `gateway-api -> analysis-api -> mock-llm`.
- `aws-lambda-trigger`, `azure-functions-trigger`, and `google-cloud-function-trigger` are simulated FaaS workloads that submit ordinary jobs through `gateway-api`.
- Keep React/Vite, Node/Fastify, Java/Spring Boot, Go, and Python/FastAPI. Do not add Helm, Kustomize, Terraform, a frontend component library, a shared service framework, dashboards, or another narrative domain.

## Development

Builds happen inside Docker:

```bash
make verify
make build-images
make k3s-deploy
make reset
```

Use `npm ci` where a lockfile exists. Dockerfiles remain build boundaries; verification must not depend on host language packages.

## Contracts

Jobs use `{name, workUnits}`. `name` is 1–80 ASCII lowercase letters, numbers, `-`, `_`, or `.`; `workUnits` is an integer from 1 through 100. `job-api` persists the job, publishes minimal JSON to `/queue/jobs.requested`, and injects W3C trace context into STOMP headers.

`job-worker` has separate application-initiated `receive jobs.requested` and `process jobs.requested` operations, calls `grpc-service.ValidateJob`, `ExecuteJob`, and `VerifyJob`, updates PostgreSQL, calls `result-api` with `raise_for_status()`, and ACKs only after all required work succeeds. Failures propagate as failed HTTP/gRPC work and NACK the message.

## Telemetry

- `apps/otel_setup.py` is the only shared Python OTel setup helper.
- OTel resources set `service.name` per workload, `service.namespace=nebulatrace`, `deployment.environment.name=demo`, and `service.version` from `SERVICE_VERSION`/`IMAGE_TAG`.
- Never put `service.name` in shared `OTEL_RESOURCE_ATTRIBUTES`.
- Keep W3C propagation, current messaging attributes, current `gen_ai.*` attributes, seconds for duration histograms, and low-cardinality metric dimensions.
- Never record prompt or response bodies.

## Controls and security

`gateway-api` owns the scenario catalog and derives active state from explicit deployment reads plus the `cache-api` VirtualService. Mutation controls default to enabled for this private demo; `DEMO_CONTROLS_ENABLED=false` returns 404 and hides mutation controls. No production authentication is added; disable controls before exposing ingress publicly.

Resource-attribute validation is a trust boundary: 2,048 characters, 32 entries, non-empty key/value, key pattern `[A-Za-z][A-Za-z0-9_.-]{0,127}`, no duplicates, and no `service.name` or `service.instance.id`. RBAC uses exact `resourceNames` and no list permission. The allowlist includes application and data workloads, including all three simulated FaaS deployments.

Never commit `.env`, real Dynatrace tokens, GHCR tokens, tenant URLs, or kubeconfigs. Before committing:

```bash
git grep -n dt0 -- . ':!.env'
git grep -n live.dynatrace.com -- . ':!.env'
```

`.env.example` contains placeholders only.
