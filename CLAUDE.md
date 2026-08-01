# CLAUDE.md

NebulaTrace is a Kubernetes workload for exploring observability in a distributed system.

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
control-ui / load-generator -> gateway-api
aws-lambda-trigger ---------> gateway-api
azure-functions-trigger ----> gateway-api
google-cloud-function-trigger -> gateway-api
gateway-api -> catalog-api -> PostgreSQL
gateway-api -> cache-api -> Redis
gateway-api -> analysis-api -> mock-llm
gateway-api -> job-api -> PostgreSQL -> ActiveMQ jobs.requested
job-worker -> grpc-service (ValidateJob, ExecuteJob, VerifyJob) -> result-api
```

Workload names and OTel `service.name` values are identical. `apps/otel_setup.py` adds `service.namespace=nebulatrace`, `deployment.environment.name=demo`, and the `SERVICE_VERSION` value. Do not hardcode OTLP endpoints or tokens.

## Trace stitching

FastAPI and requests instrumentation stay enabled. ActiveMQ producer, receive, and process spans propagate W3C context in STOMP headers and use `messaging.operation.name/type`. The worker ACKs only after all gRPC, PostgreSQL, and result callback work succeeds.

## Controls

Scenario state is backend-derived. Resource attributes are parsed server-side, patched only to the explicit application/data allowlist, and protected by RBAC `resourceNames` without list permission. `DEMO_CONTROLS_ENABLED=false` hides mutation controls and returns 404 for mutations.

Keep the bounded Java allocation scenario, truthful downstream status propagation, accessibility basics, and complete reset reliability. Do not add dashboards, packaging layers, framework churn, or compatibility routes without a real consumer.

## Secrets

Never commit `.env`, tenant-specific values, tokens, or kubeconfigs. Run the repository secret checks before commits:

```bash
git grep -n dt0 -- . ':!.env' ':!.env.example'
git grep -n live.dynatrace.com -- . ':!.env' ':!.env.example'
```
