# Investigate database latency

Investigate slow artifact catalog requests. Follow `platform-api -> artifact-api -> PostgreSQL`, inspect the database span and `pg_sleep(2)` scenario state, and compare it with a stable catalog trace. Avoid claiming a database outage when the evidence shows only latency. Finish with `make reset`.
