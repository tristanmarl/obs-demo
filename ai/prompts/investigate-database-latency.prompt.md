# Investigate a catalog database-latency trace

Investigate slow catalog requests. Follow `gateway-api -> catalog-api -> PostgreSQL`, inspect the database span and the `pg_sleep(2)` scenario state, and compare it with a stable catalog trace. Avoid claiming a database outage when the evidence shows only latency. Finish with `make reset`.
