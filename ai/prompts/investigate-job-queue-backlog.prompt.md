# Investigate a jobs queue backlog

Investigate `jobs.requested` when asynchronous job processing falls behind. Correlate ActiveMQ depth with `receive jobs.requested` and `process jobs.requested` spans, then follow `job-worker -> grpc-service -> result-api`. Separate producer latency, receive delay, gRPC execution, and result callback failures. Finish with `make reset`.
