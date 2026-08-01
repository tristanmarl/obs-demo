# CLAUDE.md

NebulaTrace is a Kubernetes software-delivery observability lab for Dynatrace.

## Commands

```bash
make verify
make build-images
make k3s-deploy
make status
make reset
```

No host Node, Go, Maven, Java, or Python packages are required.

## Flow

```text
engineering-portal / load-generator / webhook-function -> platform-api
platform-api -> release-api -> PostgreSQL -> ActiveMQ deployments.requested
deployment-worker -> runner-agent (gRPC) -> audit-api
platform-api -> artifact-api -> PostgreSQL
platform-api -> quota-api -> Redis
platform-api -> incident-assistant -> mock-llm
```

Workload names and OTel `service.name` values are identical. `apps/otel_setup.py` adds `service.namespace=nebulatrace`, `deployment.environment.name=demo`, and the `SERVICE_VERSION` value. Do not hardcode OTLP endpoints or tokens.

## Trace stitching

FastAPI and requests instrumentation stay enabled. ActiveMQ producer/consumer spans propagate W3C context in STOMP headers and use `messaging.operation.name/type`. The worker calls the runner over gRPC and calls audit over HTTP before acknowledging.

## Controls

Scenario state is backend-derived. Resource attributes are parsed server-side, patched only to the explicit application/data allowlist, and protected by RBAC `resourceNames` without list permission. `DEMO_CONTROLS_ENABLED=false` hides mutation controls and returns 404 for mutations.

Keep the bounded Java allocation scenario, truthful downstream status propagation, accessibility basics, and complete reset reliability. Do not add dashboards, packaging layers, framework churn, or compatibility routes without a real consumer.

## Secrets

Never commit `.env`, tenant-specific values, tokens, or kubeconfigs. Run the repository secret checks before commits:

```bash
git grep -n dt0 -- . ':!.env'
git grep -n live.dynatrace.com -- . ':!.env'
```
