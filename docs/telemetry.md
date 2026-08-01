# Telemetry contract

## Resource identity

`apps/otel_setup.py` is the shared Python setup helper. Each OTel workload sets its own `service.name`; resources also contain `service.namespace=nebulatrace`, `deployment.environment.name=demo`, and `service.version` from `SERVICE_VERSION` (derived from `IMAGE_TAG`). Shared `OTEL_RESOURCE_ATTRIBUTES` never contains `service.name` or `service.instance.id`.

Dynatrace Operator injects OTLP exporter configuration into the labeled namespace. OneAgent annotations remain on the OneAgent workloads. Kubernetes workload names equal service names so service detection has one engineering identity.

## HTTP, database, and errors

FastAPI, requests, gRPC, PostgreSQL, Redis, and OneAgent instrumentation remain enabled where supported. Custom spans record exceptions and set error status. Proxy routes preserve downstream HTTP status; network timeouts become HTTP 503, not HTTP 200. The worker calls `raise_for_status()` for the audit callback.

## ActiveMQ

The queue is `/queue/deployments.requested`, with logical destination `deployments.requested`. Producer and consumer spans use:

```text
messaging.system=activemq
messaging.destination.name=deployments.requested
messaging.operation.name=send|process
messaging.operation.type=send|process
messaging.message.id=<release_id>
```

Span names are `send deployments.requested` and `process deployments.requested`; kinds are `PRODUCER` and `CONSUMER`. W3C context is injected into and extracted from STOMP headers.

## FaaS and GenAI

`webhook-function` emits one simulated provider per deployment (`FAAS_PROVIDER=aws|azure|gcp`) with `faas.name`, `faas.version`, `faas.trigger=pubsub`, `cloud.provider`, `cloud.region`, messaging attributes, and an invocation id. It is documented as a simulation.

The incident path uses `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens`, and `gen_ai.usage.output_tokens`. Prompt and response bodies are never recorded. Duration histograms use seconds and unit `s`; metric dimensions remain low-cardinality and exclude release IDs and versions.

## Custom metrics

The small domain metrics are `nebulatrace.releases.*`, `nebulatrace.release.*`, `nebulatrace.deployments.*`, `nebulatrace.deployment.duration`, `nebulatrace.runner.duration`, `nebulatrace.webhook.*`, `nebulatrace.incident_assistant.*`, and non-duplicate `nebulatrace.llm.*` metrics.
