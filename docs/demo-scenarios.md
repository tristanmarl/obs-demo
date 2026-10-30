# Failure scenarios

Apply scenarios from the control UI or `POST /api/scenarios/{id}`. Scenarios are boolean [OpenFeature](https://openfeature.dev) flags served by `flagd`: the gateway rewrites the ConfigMap `obs-demo-flags` in a single patch (all flags off, then the scenario's flags on), `flagd` re-syncs it from `gateway-api` every ~2 s, and the services evaluate the flag on every request or job. No workload restarts, so switching is instant and deterministic. Exactly one scenario is active at a time (applying one resets the others), and active state is derived from the flag store, never cached in the UI. Services fall back to `false` (stable) if `flagd` is unreachable.

There are four scenarios, each backed by the flag with the same id: `database-latency`, `queue-backlog`, `error-spike`, `memory-pressure`.

Evaluations are recorded on the active span as `feature_flag.*` span events by the OpenFeature OpenTelemetry hooks, so `fetch spans | filter feature_flag.key == "database-latency"` finds affected traces (see `docs/telemetry.md` for which runtimes record them). Each scenario card also has a **Look in Dynatrace** list with DQL snippets, plus links to the Services and Distributed Tracing apps when `DT_TENANT_URL` is set on `gateway-api`.

Reset: `POST /api/scenarios/reset`, or `make reset`, which rewrites the flag ConfigMap directly from `config/flags.json` so it works even when `gateway-api` is down. Re-applying the dist manifest also resets the flags. Each runbook includes a trigger, expected behavior, evidence, Dynatrace entry point, reset, and stable confirmation.

## database-latency

1. Trigger: apply **Database latency**, then query `/api/catalog`.
2. Expected behavior: with flag `database-latency` on, `catalog-api` runs `pg_sleep(2)` before its PostgreSQL query.
3. Evidence: catalog HTTP spans contain a slow PostgreSQL database span and the query activity shows `pg_sleep(2)`.
4. Dynatrace entry: open `gateway-api -> catalog-api -> PostgreSQL` and drill into the database span.
5. Reset: `POST /api/scenarios/reset` or `make reset`.
6. Stable confirmation: catalog latency returns to baseline and reload reports no active scenario.

## queue-backlog

1. Trigger: apply **Queue backlog**, then submit jobs.
2. Expected behavior: with flag `queue-backlog` on, `job-worker` delays 3 s before processing and ACK.
3. Evidence: ActiveMQ `jobs.requested` depth rises; receive/process spans remain correlated and asynchronous latency grows.
4. Dynatrace entry: open the ActiveMQ queue and `job-worker` message-processing view, then follow a job trace.
5. Reset: `POST /api/scenarios/reset` or `make reset`.
6. Stable confirmation: the queue drains and successful jobs reach `succeeded`.

## error-spike

1. Trigger: apply **Error spike**, then call `/api/cache` or let load-generator continue.
2. Expected behavior: with flag `error-spike` on, `cache-api` returns HTTP 500 for about 70% of requests.
3. Evidence: failed cache HTTP requests are application failures; the remaining requests show the real Redis dependency.
4. Dynatrace entry: open `gateway-api -> cache-api -> Redis` and filter `cache-api` failures.
5. Reset: `POST /api/scenarios/reset` or `make reset`.
6. Stable confirmation: cache GET returns `{key,value}` and POST increments the value.

## memory-pressure

1. Trigger: apply **Memory pressure**, then request the catalog repeatedly.
2. Expected behavior: `buildCatalogBatch` allocates bounded payload batches and retains only the configured number.
3. Evidence: Java allocation and survivor activity increase; the deque never exceeds `MEMORY_SURVIVOR_BATCHES` and stays below the 1 GiB limit.
4. Dynatrace entry: open the `catalog-api` profile/memory view and inspect `buildCatalogBatch`.
5. Reset: reset scenarios, then request the catalog once (load-generator does this); the stable request clears retained batches.
6. Stable confirmation: the bounded state is empty after reset/stable traffic and memory recovers.
