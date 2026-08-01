# Incident scenarios

Apply scenarios from the portal or `POST /api/scenarios/{id}`. The backend resets all targets before applying one named scenario, so switching is deterministic. Every runbook ends with `POST /api/scenarios/reset` or `make reset`; stable means the portal shows no active scenario, the target environment is `SCENARIO_MODE=stable`, and the quota VirtualService has no fault block.

## database-latency

1. Trigger: apply **Database latency**.
2. Symptom: artifact catalog requests take about two seconds.
3. Evidence: `artifact-api` spans show a slow PostgreSQL call and propagated facade latency; PostgreSQL query activity shows `pg_sleep(2)`.
4. Dynatrace entry: open the `platform-api -> artifact-api -> PostgreSQL` trace and drill into the database span.
5. Reset: reset scenarios or run `make reset`.
6. Stable confirmation: catalog latency returns to baseline and the scenario label disappears after reload.

## queue-backlog

1. Trigger: apply **Queue backlog**.
2. Symptom: releases remain queued while the worker pauses before ACK.
3. Evidence: ActiveMQ `deployments.requested` depth rises; consumer spans show the delay and asynchronous latency grows.
4. Dynatrace entry: open the ActiveMQ queue/deployment-worker topology and a release trace.
5. Reset: reset scenarios or run `make reset`.
6. Stable confirmation: queue depth drains and worker spans ACK normally.

## quota-errors

1. Trigger: apply **Quota errors**.
2. Symptom: quota checks frequently return HTTP 500.
3. Evidence: OneAgent HTTP errors on `quota-api`; successful baseline checks still show real Redis calls.
4. Dynatrace entry: open `platform-api -> quota-api -> Redis` and filter the quota service for failed requests.
5. Reset: reset scenarios or run `make reset`.
6. Stable confirmation: quota checks return JSON with `allowed`, `used`, and `limit`.

## mesh-aborts

1. Trigger: apply **Mesh aborts**.
2. Symptom: about half of quota requests return HTTP 503 without pod execution.
3. Evidence: Istio VirtualService fault configuration, Envoy 503 access logs, and missing application-server work for aborted requests.
4. Dynatrace entry: open the `quota-api` service flow and inspect the Istio/Envoy edge.
5. Reset: reset scenarios or run `make reset`.
6. Stable confirmation: the VirtualService has only the stable route and quota requests succeed.

## runner-deadline

1. Trigger: apply **Runner deadline**, then create a release.
2. Symptom: the worker's gRPC call exceeds its deadline and the release fails/NACKs.
3. Evidence: gRPC deadline status in the worker/runner trace, failed release status in PostgreSQL, and no successful audit acknowledgement.
4. Dynatrace entry: open the release trace at `deployment-worker -> runner-agent` and inspect the RPC status.
5. Reset: reset scenarios, then create a new release.
6. Stable confirmation: a new release reaches `succeeded` and audit records it.

## ai-latency

1. Trigger: apply **AI latency**, then request an incident recommendation.
2. Symptom: recommendation latency increases by about two seconds.
3. Evidence: `gen_ai.*` spans show the mock model call and increased duration; prompt/response bodies are absent.
4. Dynatrace entry: open `platform-api -> incident-assistant -> mock-llm` and inspect GenAI latency.
5. Reset: reset scenarios or run `make reset`.
6. Stable confirmation: recommendation returns promptly with the normal mock response.

## allocation-pressure

1. Trigger: apply **Allocation pressure**, then request the artifact catalog repeatedly.
2. Symptom: Java allocation and survivor activity increase while the process remains bounded.
3. Evidence: the `buildDependencyMetadataBatch` method allocates metadata payloads; retained batches never exceed `MEMORY_SURVIVOR_BATCHES` and memory is below the 1 GiB container limit.
4. Dynatrace entry: open the artifact service profile/memory view and inspect allocations and survivors.
5. Reset: reset scenarios, then request the catalog once.
6. Stable confirmation: the bounded deque clears on the next stable request and memory recovers.

## combined-incident

1. Trigger: apply **Combined incident**.
2. Symptom: slow catalog requests, delayed releases, and quota HTTP 500s appear together.
3. Evidence: PostgreSQL latency, ActiveMQ depth/async latency, and quota errors are visible in their separate services.
4. Dynatrace entry: begin with the `platform-api` topology, then follow the three affected edges.
5. Reset: reset scenarios or run `make reset`.
6. Stable confirmation: all three signals return to baseline and reload reports no active scenario.
