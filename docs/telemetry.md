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
