# Architecture

NebulaTrace models a software-delivery platform with small services whose boundaries make trace stitching visible.

```text
engineering-portal / load-generator / webhook-function
                         |
                         v
                    platform-api
                   /      |       \
                  v       v        v
          artifact-api  quota-api  incident-assistant -> mock-llm
              |           |
          PostgreSQL     Redis

platform-api -> release-api -> PostgreSQL
                    |
                    v
           ActiveMQ deployments.requested
                    |
                    v
       deployment-worker -> runner-agent (gRPC) -> audit-api
```

The `nebulatrace` namespace contains application workloads and Istio sidecars. `nebulatrace-data` contains PostgreSQL, Redis, and ActiveMQ Classic without Istio injection. Dynatrace Operator supplies OneAgent injection and OTLP exporter configuration; application code does not hardcode ingest endpoints or tokens.

`release-api` validates and persists a release, then publishes minimal JSON with W3C context in STOMP headers. `deployment-worker` extracts that context, calls `runner-agent.ExecuteRelease`, updates the release row, posts an audit callback, and only then acknowledges the ActiveMQ message. Any required failure is represented as a failing status and NACK.

`artifact-api` is Java/Spring Boot and reads PostgreSQL. `quota-api` is Go and increments `quota:staging:deployments` in Redis, making the dependency observable. `webhook-function` is a one-provider-at-a-time FaaS telemetry simulation configured by `FAAS_PROVIDER`; it sends the same release payload as the portal. The incident assistant is an optional connected GenAI-style path to `mock-llm`.
