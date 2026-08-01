# AGENTS.md

NebulaTrace is a small Kubernetes software-delivery observability lab. Keep it understandable in one sitting and preserve the mixed OneAgent/OpenTelemetry demonstration.

## Architecture

- Namespaces stay `nebulatrace` and `nebulatrace-data`; Istio sidecars are enabled only for the app namespace.
- Keep PostgreSQL, Redis, ActiveMQ Classic, Istio, Dynatrace Operator, OneAgent, and OTLP auto-configuration.
- Main flow: `platform-api -> release-api -> PostgreSQL -> ActiveMQ deployments.requested -> deployment-worker -> runner-agent -> audit-api`.
- Supporting flows: `platform-api -> artifact-api -> PostgreSQL`, `platform-api -> quota-api -> Redis`, and `platform-api -> incident-assistant -> mock-llm`.
- `webhook-function` is a simulated SCM release webhook, not a real cloud function runtime.
- Keep React/Vite, Node/Fastify, Java/Spring Boot, Go, and Python/FastAPI. Do not add Helm, Kustomize, Terraform, a frontend component library, a shared service framework, or dashboards.

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

Release input is `{service, version, environment}`. Service is 1–80 ASCII lowercase letters, numbers, `-`, `_`, or `.`; version is 1–80 non-whitespace characters; environment is `development`, `test`, `staging`, or `production`.

ActiveMQ carries minimal release JSON and W3C context in STOMP headers. The worker starts a consumer span, calls `Runner.ExecuteRelease` over gRPC, updates PostgreSQL, calls `audit-api` with `raise_for_status()`, and ACKs only after all required work succeeds. Failures propagate as failed HTTP/gRPC work and NACK the message.

## Telemetry

- `apps/otel_setup.py` is the only Python OTel setup helper.
- OTel resources set `service.name` per workload, `service.namespace=nebulatrace`, `deployment.environment.name=demo`, and `service.version` from `SERVICE_VERSION`/`IMAGE_TAG`.
- Never put `service.name` in shared `OTEL_RESOURCE_ATTRIBUTES`.
- Keep W3C propagation, current messaging attributes, current `gen_ai.*` attributes, seconds for duration histograms, and low-cardinality metric dimensions.
- Never record prompt or response bodies.

## Controls and security

`platform-api` owns the scenario catalog and derives active state from explicit deployment reads plus the `quota-api` VirtualService. Mutation controls are disabled with `DEMO_CONTROLS_ENABLED=false`; this is a private demo control surface and intentionally has no production authentication.

Resource-attribute validation is a trust boundary: 2,048 characters, 32 entries, non-empty key/value, key pattern `[A-Za-z][A-Za-z0-9_.-]{0,127}`, no duplicates, and no `service.name` or `service.instance.id`. RBAC uses exact `resourceNames` and no list permission.

Never commit `.env`, real Dynatrace tokens, GHCR tokens, tenant URLs, or kubeconfigs. Before committing:

```bash
git grep -n dt0 -- . ':!.env'
git grep -n live.dynatrace.com -- . ':!.env'
```

`.env.example` contains placeholders only.
