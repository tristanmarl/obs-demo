# Summarize an analysis trace

Summarize the optional `gateway-api -> analysis-api -> mock-llm` path. Use `gen_ai.operation.name`, provider, model, token counts, latency, and HTTP status. Never reproduce prompt or response bodies. If `ai-latency` is active, call out the mock model delay and distinguish it from gateway or database latency.
