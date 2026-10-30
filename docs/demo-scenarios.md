# Failure scenarios

Apply scenarios from the control UI or `POST /api/scenarios/{id}`. The gateway resets every target before enabling one scenario, so switching is deterministic. Each runbook includes a trigger, expected behavior, evidence, Dynatrace entry point, reset, and stable confirmation.

## database-latency

1. Trigger: apply **Database latency**, then query `/api/catalog`.
2. Expected behavior: `catalog-api` runs `pg_sleep(2)` before its PostgreSQL query.
3. Evidence: catalog HTTP spans contain a slow PostgreSQL database span and the query activity shows `pg_sleep(2)`.
4. Dynatrace entry: open `gateway-api -> catalog-api -> PostgreSQL` and drill into the database span.
5. Reset: `POST /api/scenarios/reset` or `make reset`.
6. Stable confirmation: catalog latency returns to baseline and reload reports no active scenario.

## queue-backlog

1. Trigger: apply **Queue backlog**, then submit jobs.
2. Expected behavior: `job-worker` delays before processing and ACK.
3. Evidence: ActiveMQ `jobs.requested` depth rises; receive/process spans remain correlated and asynchronous latency grows.
4. Dynatrace entry: open the ActiveMQ queue and `job-worker` message-processing view, then follow a job trace.
5. Reset: `POST /api/scenarios/reset` or `make reset`.
6. Stable confirmation: the queue drains and successful jobs reach `succeeded`.

## cache-errors

1. Trigger: apply **Cache errors**, then call Redis or let load-generator continue.
2. Expected behavior: `cache-api` returns frequent HTTP 500 responses.
3. Evidence: failed cache HTTP requests are application failures; stable requests show the real Redis dependency.
4. Dynatrace entry: open `gateway-api -> cache-api -> Redis` and filter `cache-api` failures.
5. Reset: `POST /api/scenarios/reset` or `make reset`.
6. Stable confirmation: cache GET returns `{key,value}` and POST increments the value.

## mesh-aborts

1. Trigger: apply **Mesh aborts**, then call `/api/cache`.
2. Expected behavior: Istio aborts about half of cache requests with HTTP 503 before pod invocation.
3. Evidence: the `cache-api` VirtualService has a 50% fault block, Envoy reports 503s, and aborted requests lack application work.
4. Dynatrace entry: open the `cache-api` service flow and inspect the Istio/Envoy edge.
5. Reset: `POST /api/scenarios/reset` or `make reset`.
6. Stable confirmation: the VirtualService has only the stable route and cache requests succeed.

## grpc-deadline

1. Trigger: apply **gRPC deadline**, then submit a job.
2. Expected behavior: `grpc-service` sleeps beyond the worker deadline and the job fails/NACKs.
3. Evidence: the job trace shows the failed unary RPC, PostgreSQL records `failed`, and the result callback receives the failure status.
4. Dynatrace entry: open `job-worker -> grpc-service` and inspect `ValidateJob`/deadline status.
5. Reset: reset scenarios, then submit a new job.
6. Stable confirmation: a new job reaches `succeeded` after all three methods complete.

## ai-latency

1. Trigger: apply **AI latency**, then call `/api/analysis`.
2. Expected behavior: `mock-llm` sleeps for about two seconds.
3. Evidence: `gen_ai.*` spans show increased model latency; prompt and response bodies are absent.
4. Dynatrace entry: open `gateway-api -> analysis-api -> mock-llm` and inspect GenAI latency.
5. Reset: `POST /api/scenarios/reset` or `make reset`.
6. Stable confirmation: analysis returns promptly with the normal mock response.

## allocation-pressure

1. Trigger: apply **Allocation pressure**, then request the catalog repeatedly.
2. Expected behavior: `buildCatalogBatch` allocates bounded payload batches and retains only the configured number.
3. Evidence: Java allocation and survivor activity increase; the deque never exceeds `MEMORY_SURVIVOR_BATCHES` and stays below the 1 GiB limit.
4. Dynatrace entry: open the `catalog-api` profile/memory view and inspect `buildCatalogBatch`.
5. Reset: reset scenarios, then request the catalog once; the stable request clears retained batches.
6. Stable confirmation: the bounded state is empty after reset/stable traffic and memory recovers.

## host-db-latency

1. Trigger: apply **Host DB latency** (requires `make host-monitoring`, see `docs/host-monitoring.md`), then submit jobs.
2. Expected behavior: `result-api` runs `SELECT SLEEP(2)` against the MariaDB on the EC2 host before each insert.
3. Evidence: `result-api` spans lengthen, jobs complete about two seconds later, and MariaDB process metrics on the `mariadbd` `otel:process` entity show the extra activity.
4. Dynatrace entry: open a `obs-edge-agent` trace and follow it to `result-api`, then open the `mariadbd` process entity.
5. Reset: `POST /api/scenarios/reset` or `make reset`.
6. Stable confirmation: result writes return to baseline and reload reports no active scenario.

## combined-failure

1. Trigger: apply **Combined failure**.
2. Expected behavior: catalog latency, job-worker backlog, and cache errors degrade together.
3. Evidence: PostgreSQL latency, ActiveMQ depth, and cache failures are visible as separate connected signals.
4. Dynatrace entry: start at `gateway-api`, then follow catalog, jobs, and cache edges.
5. Reset: `POST /api/scenarios/reset` or `make reset`.
6. Stable confirmation: all three signals return to baseline and reload reports no active scenario.
