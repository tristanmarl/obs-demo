# Investigate a deployment queue backlog

Investigate `deployments.requested` when release processing falls behind. Correlate ActiveMQ depth with `process deployments.requested` spans, then follow `deployment-worker -> runner-agent -> audit-api`. Separate producer latency, consumer delay, gRPC execution, and audit callback failures. Finish with the reset command `make reset`.
